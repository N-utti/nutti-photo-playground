/**
 * MSW 핸들러 — 백엔드 전 엔드포인트가 501 스텁이므로(PR #2) 프론트는 이 목 위에서 만듭니다.
 *
 * 응답 본문은 docs/05-api-spec.md §3 예시를 따릅니다(mocks/fixtures.ts).
 * 여기서 추가로 하는 일은 §3 이 정적 예시로만 보여 주는 것들을 **움직이게** 만드는 것입니다 —
 * job 이 시간에 따라 queued → processing → succeeded 로 전이하고, 크레딧이 실제로 차감되고,
 * 같은 Idempotency-Key 가 같은 job 을 돌려줍니다.
 *
 * 시나리오 강제: localStorage 에 `nutti.mock.scenario` 를 넣으면 해당 케이스로 고정됩니다.
 *   upload:warn | upload:block | job:fail | job:safety | job:flaky | credit:empty
 *   session:expired | guest:ratelimited | session:lost | auth:statefail | cafe24:linked
 *
 * 로컬 로그인 목 규칙: 비밀번호 `nutti1234` 만 성공(그 외 401), 이메일
 * `taken@nutti.co.kr` 로 가입하면 409 EMAIL_TAKEN.
 */

import { HttpResponse, http, delay } from 'msw'
import type {
  AuthProvider,
  Credits,
  EarnAction,
  Job,
  JobErrorCode,
  LibraryItem,
  LibraryMonth,
  Me,
  UploadResult,
} from '../api/types'
import {
  initialCredits,
  ledgerEntries,
  libraryItems,
  petList,
  placeholderImage,
  styleCatalog,
  styleDetailFor,
  uploadBlocked,
  uploadOk,
  uploadWarned,
} from './fixtures'

const BASE = '*/v1'

function scenario(): string {
  return localStorage.getItem('nutti.mock.scenario') ?? ''
}

// ---------------------------------------------------------------- 목 상태

interface MockJob {
  id: string
  createdAt: number
  creditCost: number
  /** 재료 참조(이슈 #9 A안) — 스펙 §3 이 job 응답에 그대로 싣기로 확정한 값입니다. */
  styleId: number | null
  uploadId: string
  /**
   * 어느 강아지의 결과인지. job 응답에는 없는 값이고(§3), 보관함 항목이 이걸 답니다 —
   * 서버에서는 `source_image.pet_profile_id` 가 그 연결입니다. 없으면 W-09 강아지
   * 필터가 방금 만든 결과를 영영 «전체»에만 두게 됩니다.
   */
  petId?: string | null
  forcedError: JobErrorCode | null
}

/**
 * 리로드를 건너뛰는 목 상태 (크레딧 · `/auth/me`).
 *
 * 로그인·연동은 `authorize_url` 로 페이지를 통째로 넘겼다가 콜백으로 돌아오는 구조라
 * 모듈 변수만 쓰면 왕복 도중에 목이 초기화됩니다 — 돌아온 순간 회원이 다시 게스트가
 * 되므로 "로그인 후 연동" 같은 2단계 흐름을 목 위에서 한 번도 못 밟습니다.
 *
 * 탭 수명과 묶으려고 sessionStorage 를 씁니다. job 은 수명이 달라 아래에서 따로 다룹니다.
 */
const PERSIST_KEY = 'nutti.mock.state'

function restored(): { credits: Credits; me: Omit<Me, 'credit_balance'> } | null {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY)
    return raw ? (JSON.parse(raw) as { credits: Credits; me: Omit<Me, 'credit_balance'> }) : null
  } catch {
    return null
  }
}

function persist(): void {
  sessionStorage.setItem(PERSIST_KEY, JSON.stringify({ credits: state.credits, me: state.me }))
}

/**
 * job 은 **localStorage** 에 따로 남깁니다 — 목의 나머지 상태와 수명이 다릅니다.
 *
 * Q7(07-decisions.md)이 완료 알림 대신 약속한 게 "URL 보존 + 재방문 시 복원"이고,
 * W-05 는 그 약속을 화면에서 문장으로 말합니다("이 브라우저에서 이 주소로 다시 오면
 * 결과를 볼 수 있어요"). job 을 메모리에만 두면 새로고침 한 번에 `/jobs/{id}` 가 404 라
 * 이 앱의 핵심 결정을 목 위에서 **한 번도 확인할 수 없습니다**.
 *
 * sessionStorage 가 아니라 localStorage 인 이유도 같습니다 — 탭을 닫았다 URL 로
 * 돌아오는 게 바로 Q7 이 말하는 시나리오라, 탭 수명에 묶으면 절반만 재현됩니다.
 * (`nutti.job-context` 가 localStorage 인 것도 같은 이유입니다.)
 *
 * `placeholderImage` 는 label 이 같으면 같은 data URI 를 내는 결정론적 함수라,
 * 되살린 job 도 이미지까지 원래대로 그려집니다.
 */
const JOBS_KEY = 'nutti.mock.jobs'

/** 색인이 아니라 목 데이터라 수명이 짧습니다. 오래된 것부터 버립니다. */
const MAX_JOBS = 20

interface PersistedJobs {
  jobs: Record<string, MockJob>
  /** 같은 키 재요청 보장(§1)도 리로드를 건너야 job 과 짝이 맞습니다. */
  idempotency: Record<string, string>
}

function restoredJobs(): PersistedJobs {
  try {
    const raw = localStorage.getItem(JOBS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<PersistedJobs>) : null
    return { jobs: parsed?.jobs ?? {}, idempotency: parsed?.idempotency ?? {} }
  } catch {
    return { jobs: {}, idempotency: {} }
  }
}

function persistJobs(): void {
  // Map 은 삽입 순서를 지키므로 뒤에서 자르면 최신 MAX_JOBS 건이 남습니다.
  const jobs = [...state.jobs.entries()].slice(-MAX_JOBS)
  const kept = new Set(jobs.map(([id]) => id))
  const idempotency = [...state.idempotency.entries()].filter(([, id]) => kept.has(id))
  localStorage.setItem(
    JOBS_KEY,
    JSON.stringify({ jobs: Object.fromEntries(jobs), idempotency: Object.fromEntries(idempotency) }),
  )
}

/**
 * 보관함에서 지운 `result_id`.
 *
 * job 과 같은 이유로 localStorage 입니다 — 지우고 새로고침했더니 되살아나면, 삭제가
 * 됐는지 안 됐는지를 화면만 보고는 판단할 수 없습니다. 목록에서 항목을 빼는 대신
 * 가리는 방식이라 시드를 되돌릴 수 있고, 그 초기화가 아래 리셋 키입니다.
 */
const DELETED_KEY = 'nutti.mock.library-deleted'

function restoredDeleted(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function persistDeletedResults(): void {
  localStorage.setItem(DELETED_KEY, JSON.stringify([...state.deletedResults]))
}

const snapshot = restored()
const jobSnapshot = restoredJobs()

const state = {
  credits: snapshot?.credits ?? (structuredClone(initialCredits) as Credits),
  jobs: new Map<string, MockJob>(Object.entries(jobSnapshot.jobs)),
  /** Idempotency-Key → job_id. 같은 키 재요청 시 새 job 을 만들지 않습니다(§1). */
  idempotency: new Map<string, string>(Object.entries(jobSnapshot.idempotency)),
  /** 보관함에서 지운 결과. 목록 조립에서 가려집니다. */
  deletedResults: restoredDeleted(),
  /** session:expired 시나리오에서 "만료된 것으로 칠" Authorization 헤더 값. */
  expiredToken: null as string | null,
  /** `/auth/me` 의 원본. 로그인·연동이 이 값을 바꾸므로 화면 분기가 실제로 움직입니다. */
  me:
    snapshot?.me ??
    ({
      member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
      kind: 'guest',
      email: null,
      nickname: null,
      providers: [],
      cafe24_linked: false,
    } as Omit<Me, 'credit_balance'>),
}

/** 목 authorize_url — 프로바이더 대신 우리 콜백 라우트로 되돌립니다. */
function mockAuthorizeUrl(provider: string): string {
  return `${location.origin}/auth/callback/${provider}?code=mock-code&state=mock-state-${crypto.randomUUID()}`
}

/** 획득 행 1건을 지급 처리. 연동 +3 처럼 claim 을 거치지 않는 경로가 씁니다. */
function grantEarnAction(action: EarnAction): void {
  const row = state.credits.earn_actions.find((entry) => entry.action === action)
  if (!row || row.status !== 'available') return
  state.credits.balance += row.amount
  row.status = 'done'
  row.cta = null
  persist()
}

/**
 * 게스트 → 회원 (UC-07). merged 여부와 무관하게 목의 `/auth/me` 는 회원이 됩니다.
 * 실제 서버는 병합이면 **다른 member_id** 를 주지만, 목은 자산을 실제로 옮기지 않으므로
 * id 를 유지해 job 주소가 살아 있게 둡니다 — 그 차이는 백엔드에서만 관찰됩니다.
 */
function promoteToMember(options: {
  provider: AuthProvider
  email?: string
  nickname?: string
  merged?: boolean
}) {
  state.me.kind = 'member'
  if (!state.me.providers.includes(options.provider)) state.me.providers.push(options.provider)
  if (options.email) state.me.email = options.email.trim().toLowerCase()
  if (options.nickname && state.me.nickname === null) state.me.nickname = options.nickname
  persist()
  return {
    token: `mock-member-jwt.${crypto.randomUUID()}`,
    member_id: state.me.member_id,
    kind: 'member' as const,
    merged: options.merged ?? false,
    credit_balance: state.credits.balance,
  }
}

/** 생성에 걸리는 시간. W-03 "평균 24초"보다 짧게 잡아 개발 반복을 빠르게 합니다. */
const JOB_DURATION_MS = 12_000

/**
 * `job:flaky` — 생성 중 서버가 잠깐 5xx 를 뱉는 구간.
 *
 * W-05 는 404(job 이 없음)와 5xx(서버가 지금 답을 못 줌)를 다르게 다룹니다. 전자는
 * 복원 실패 안내로 끝내고, 후자는 **화면을 헐지 않고 폴링을 계속 두드려 스스로
 * 되살아나야** 합니다 — 서버는 그 사이에도 job 을 그리고 있고 크레딧은 이미 나갔기
 * 때문입니다. 목에 이 구간이 없으면 그 분기는 브라우저에서 한 번도 밟히지 않습니다.
 *
 * 구간이 18초로 넉넉한 이유: 재시도 3회가 백오프 포함 7초 안팎에 소진되므로, 그보다
 * 짧으면 재시도 단계에서 조용히 복구돼 정작 확인하려던 «에러 상태에서의 재개»에
 * 도달하지 못합니다.
 */
const FLAKY_OUTAGE_MS = { from: 3_000, to: 18_000 }

/**
 * flaky 시나리오에서만 job 을 길게 잡습니다.
 *
 * 재시도 소진(≈7초) + 상한 간격 재개(8초)를 합치면 복구는 20초 언저리인데, 12초짜리
 * job 은 그때 이미 끝나 있습니다. 그러면 결과 화면으로 넘어가 버려서 «막대가 다시
 * 움직인다»는, 이 분기의 유일한 육안 증거를 놓칩니다.
 */
const FLAKY_JOB_DURATION_MS = 35_000

/**
 * `job:slow` — 60초를 넘겨 «백그라운드 전환»(FR-EDGE-02)에 들어가는 job.
 *
 * NFR-PERF-01 이 정한 목표가 20–40초라 12초짜리 기본 job 으로는 초과 상태를 한 번도
 * 못 밟습니다. 실제로 넘겨 봐야 하는 이유는 그 구간에서 화면이 말을 바꾸기 때문입니다 —
 * 남은 초 표기가 사라지고 «나가도 된다»가 주 버튼이 됩니다(W-05).
 *
 * 150초인 건 60초를 넘긴 뒤에도 **초과 상태를 충분히 들여다볼 시간**을 남기기
 * 위해서입니다. 70초짜리면 안내가 뜨자마자 결과로 넘어가 버립니다.
 */
const SLOW_JOB_DURATION_MS = 150_000

function jobDuration(): number {
  const forced = scenario()
  if (forced === 'job:flaky') return FLAKY_JOB_DURATION_MS
  if (forced === 'job:slow') return SLOW_JOB_DURATION_MS
  return JOB_DURATION_MS
}

/**
 * `credit:empty` 는 "항상 402"가 아니라 **잔액 0에서 시작**입니다.
 *
 * 402 를 무조건 던지면 크레딧을 받아도 계속 막혀서, §4 시나리오3 의 뒷부분
 * (시트에서 클레임 → 같은 키로 재시도 → 성공)을 목 위에서 밟을 수 없습니다.
 * 잔액만 0으로 떨어뜨리면 이후는 실제 규칙(`balance < cost` → 402)이 처리합니다.
 */
let emptyApplied = false
function applyEmptyScenario() {
  if (scenario() !== 'credit:empty') {
    emptyApplied = false
    return
  }
  if (!emptyApplied) {
    state.credits.balance = 0
    emptyApplied = true
    persist()
  }
}

function apiError(status: number, code: string, message: string, detail: unknown = {}) {
  return HttpResponse.json({ error: { code, message, detail } }, { status })
}

/**
 * `session:expired` 판정 — 지금 들어온 토큰이 만료 대상인지, 재발급된 새 게스트인지.
 *
 * "몇 번째 요청이냐"가 아니라 **어떤 토큰이냐**로 봅니다. 회차로 세면 StrictMode 이중
 * 마운트나 재시도 한 번에 만료가 소진돼 재발급 경로를 못 밟습니다.
 *
 * 판정을 함수로 뽑아 둔 이유: 이 시나리오가 `/jobs/{id}` 하나에만 걸려 있는 동안은
 * **보관함으로 들어온 사용자가 겪는 경로를 목이 만들 수 없었습니다**. 게스트가 결과를
 * 잃는 사고는 job URL 로 직접 들어온 사람보다 탭바로 보관함을 여는 사람이 먼저
 * 만나므로(이슈 #5), 같은 판정을 두 곳이 나눠 씁니다.
 */
function expiredSession(request: Request): 'expired' | 'reissued' | null {
  if (scenario() !== 'session:expired') return null
  const token = request.headers.get('Authorization') ?? ''
  // 토큰 없는 요청 = 발급 그 자체. 이걸 판정에 넣으면 첫 방문(토큰 없이 시작)에서
  // 빈 문자열이 «만료 대상»으로 굳어, 아직 만료된 적 없는 세션이 만료로 보입니다.
  if (!token) return null
  state.expiredToken ??= token
  return token === state.expiredToken ? 'expired' : 'reissued'
}

/** 경과 시간으로 job 상태를 계산 — 타이머 없이 폴링만으로 진행이 보입니다. */
function projectJob(job: MockJob): Job {
  const elapsed = Date.now() - job.createdAt
  const duration = jobDuration()
  const sourceImageUrl = placeholderImage('원본')
  // 어느 상태에서든 실립니다 — W-06 "다시 만들기"는 실패한 job 에서도 눌리기 때문입니다.
  const materials = { style_id: job.styleId, upload_id: job.uploadId }

  if (elapsed >= duration) {
    if (job.forcedError) {
      return {
        job_id: job.id,
        status: 'failed',
        ...materials,
        progress: null,
        eta_seconds: null,
        status_message: null,
        source_image_url: sourceImageUrl,
        results: null,
        error_code: job.forcedError,
      }
    }
    return {
      job_id: job.id,
      status: 'succeeded',
      ...materials,
      progress: 100,
      eta_seconds: 0,
      status_message: null,
      source_image_url: sourceImageUrl,
      // Q4 확정으로 1요청 1장(§3 `results[]`는 항상 1개).
      results: [{ index: 0, image_url: placeholderImage('결과', '#F9E5EC') }],
      error_code: null,
    }
  }

  if (elapsed < 1_500) {
    return {
      job_id: job.id,
      status: 'queued',
      ...materials,
      progress: 0,
      eta_seconds: Math.ceil(duration / 1000),
      status_message: '대기 중…',
      source_image_url: sourceImageUrl,
      results: null,
      error_code: null,
    }
  }

  const ratio = elapsed / duration
  return {
    job_id: job.id,
    status: 'processing',
    ...materials,
    progress: Math.floor(ratio * 100),
    eta_seconds: Math.ceil((duration - elapsed) / 1000),
    status_message: '레고 블록을 쌓는 중…',
    source_image_url: sourceImageUrl,
    results: null,
    error_code: null,
  }
}

// ---------------------------------------------------------------- 보관함 조립

/** 한 페이지에 담는 개수. 시드(8건)보다 작아야 «더 보기»가 목 위에서 눌립니다. */
const LIBRARY_PAGE_SIZE = 6

/**
 * '2026-08-03T10:00:00+09:00' → '2026년 8월'.
 *
 * `new Date` 로 파싱하지 않습니다 — 실행 환경 시간대가 KST 가 아니면 8월 1일 09:00+09:00
 * 이 7월로 넘어가 월 섹션이 하나 어긋납니다. 서버는 KST 기준으로 라벨을 만들 것이고,
 * 문자열 앞부분이 이미 그 값입니다.
 */
function monthLabel(createdAt: string): string {
  const [year, month] = createdAt.slice(0, 10).split('-')
  return `${year}년 ${Number(month)}월`
}

/**
 * 보관함 목록 = 시드 + **이 브라우저에서 성공한 job**.
 *
 * 후자가 없으면 W-06 «보관함 보기» 로 들어와도 방금 만든 결과가 없습니다 — 정작
 * 확인해야 할 연결(만들기 → 보관함)이 목 위에서 성립하지 않는 것이고, 그건 화면이
 * 아니라 목의 결함입니다.
 *
 * 삭제는 항목을 지우는 대신 `deletedResults` 로 가립니다. job 자체는 남겨야
 * `/jobs/{id}` 주소가 계속 열리고(Q7 복원), 그건 보관함 삭제와 다른 사안입니다.
 */
function libraryEntries(): LibraryItem[] {
  const fromJobs: LibraryItem[] = [...state.jobs.values()]
    .filter((job) => projectJob(job).status === 'succeeded')
    .map((job) => ({
      job_id: job.id,
      result_id: `${job.id}:0`,
      image_url: placeholderImage('결과', '#F9E5EC'),
      // 옛 저장분에는 이 필드가 없습니다(나중에 추가된 필드).
      pet_id: job.petId ?? null,
      created_at: new Date(job.createdAt).toISOString(),
    }))

  return [...fromJobs, ...libraryItems]
    .filter((item) => !state.deletedResults.has(item.result_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

/** 시드 항목의 `job_id` 로 들어온 상세 요청. 보관함에서 결과를 열면 여기로 옵니다. */
function seededJob(jobId: string): Job | null {
  const item = libraryItems.find((entry) => entry.job_id === jobId)
  if (!item) return null
  return {
    job_id: item.job_id,
    status: 'succeeded',
    style_id: null,
    upload_id: `upload-${item.result_id}`,
    progress: 100,
    eta_seconds: 0,
    status_message: null,
    source_image_url: placeholderImage('원본'),
    results: [{ index: 0, image_url: item.image_url }],
    error_code: null,
  }
}

// ---------------------------------------------------------------- 핸들러

export const handlers = [
  /*
    만료 판정을 맨 앞에 한 번만 겁니다.

    실서버에서 만료는 엔드포인트의 관심사가 아니라 인증 의존성이 걸러내는 일입니다
    (app/auth.py `get_current_member`) — 만료된 토큰으로는 **어떤 경로도** 통과하지
    못합니다. 목이 이걸 핸들러마다 붙이면 빠뜨린 곳이 «만료됐는데 되는» 구멍이 되고,
    그게 정확히 목이 실서버에 없는 화면을 만들어 내는 방식입니다. 실제로 `/pets` 가
    통과하는 동안, 새 게스트인데 «콩이» 칩은 살아 있고 사진만 0장인 상태가 나왔습니다.

    아무것도 반환하지 않으면 MSW 가 다음 핸들러로 넘깁니다 — 만료가 아닐 때는 이
    핸들러가 없는 것과 같습니다.
  */
  http.all(`${BASE}/*`, ({ request }) => {
    if (expiredSession(request) === 'expired') {
      return apiError(401, 'TOKEN_EXPIRED', '토큰이 만료되었습니다')
    }
    return undefined
  }),

  // ------------------------------------------------------------ 인증
  http.post(`${BASE}/auth/guest`, async () => {
    await delay(120)
    // IP 당 시간당 발급 제한(app/routers/auth.py `_check_guest_rate_limit`, 이슈 #15).
    if (scenario() === 'guest:ratelimited') {
      return apiError(429, 'RATE_LIMITED', '게스트 발급 한도를 초과했습니다')
    }
    // 새 게스트 발급 = 다른 사람이 되는 것. 유지 중인 `/auth/me` 를 게스트로 되돌리지
    // 않으면 토큰을 지우고 새로 시작해도 화면이 계속 회원으로 보입니다.
    const member_id = crypto.randomUUID()
    state.me = {
      member_id,
      kind: 'guest',
      email: null,
      nickname: null,
      providers: [],
      cafe24_linked: false,
    }
    persist()
    return HttpResponse.json(
      { token: `mock-guest-jwt.${crypto.randomUUID()}`, member_id, kind: 'guest' },
      { status: 201 },
    )
  }),

  http.get(`${BASE}/auth/me`, () => HttpResponse.json({ ...state.me, credit_balance: state.credits.balance })),

  /*
    로그인·연동 시작. 실제 서버는 카카오/네이버/카페24 URL 을 조립해 주지만, 목에서는
    **우리 콜백 라우트로 되돌립니다** — 그래야 프로바이더 없이 왕복 전체(시트 → 이동 →
    /auth/callback → 세션 교체 → 복귀)를 로컬에서 밟아 볼 수 있습니다.
  */
  http.get(`${BASE}/auth/cafe24/authorize`, async () => {
    await delay(150)
    if (state.me.kind !== 'member') {
      return apiError(401, 'UNAUTHORIZED', '회원만 연동할 수 있습니다')
    }
    return HttpResponse.json({ authorize_url: mockAuthorizeUrl('cafe24') })
  }),

  http.get(`${BASE}/auth/cafe24/callback`, async () => {
    await delay(300)
    if (scenario() === 'cafe24:linked') {
      return apiError(409, 'CAFE24_ALREADY_LINKED', '이미 연동된 계정입니다')
    }
    if (!state.me.cafe24_linked) {
      state.me.cafe24_linked = true
      grantEarnAction('link_account') // 연동 +3 은 클레임이 아니라 이 콜백이 지급합니다.
    }
    return HttpResponse.json({ cafe24_linked: true, credit_balance: state.credits.balance })
  }),

  http.get(`${BASE}/auth/:provider/authorize`, async ({ params }) => {
    await delay(150)
    const provider = String(params.provider)
    if (provider !== 'kakao' && provider !== 'naver') {
      return apiError(404, 'NOT_FOUND', '알 수 없는 프로바이더입니다')
    }
    // 회원이 로그인 수단을 더 붙이는 건 MVP 미지원(이슈 #17).
    if (state.me.kind === 'member') {
      return apiError(409, 'ALREADY_MEMBER', '이미 로그인되어 있습니다')
    }
    return HttpResponse.json({ authorize_url: mockAuthorizeUrl(provider) })
  }),

  http.get(`${BASE}/auth/:provider/callback`, async ({ params }) => {
    await delay(400)
    const provider = String(params.provider)
    if (provider !== 'kakao' && provider !== 'naver') {
      return apiError(404, 'NOT_FOUND', '알 수 없는 프로바이더입니다')
    }
    // state 는 1회용 nonce — 재사용·만료는 401 입니다(§3 인증). 이중 호출 방지가
    // 제대로 걸렸는지 보려면 이 시나리오가 필요합니다.
    if (scenario() === 'auth:statefail') {
      return apiError(401, 'UNAUTHORIZED', 'state 검증에 실패했습니다')
    }
    return HttpResponse.json(promoteToMember({ provider, nickname: '콩이엄마' }))
  }),

  http.post(`${BASE}/auth/register`, async ({ request }) => {
    await delay(350)
    const { email } = (await request.json()) as { email: string }
    if (email.trim().toLowerCase() === 'taken@nutti.co.kr') {
      return apiError(409, 'EMAIL_TAKEN', '이미 가입된 이메일입니다')
    }
    return HttpResponse.json(promoteToMember({ provider: 'local', email }), { status: 201 })
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    await delay(350)
    const { email, password } = (await request.json()) as { email: string; password: string }
    // 이메일 존재 여부를 구분하지 않는 단일 실패 메시지(§3) — 목도 같은 규칙을 지킵니다.
    if (password !== 'nutti1234') {
      return apiError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다')
    }
    // 재방문 로그인이 기본 경로이므로(UC-07) 병합(merged: true)으로 답합니다.
    return HttpResponse.json(promoteToMember({ provider: 'local', email, merged: true }))
  }),

  http.post(`${BASE}/auth/logout`, () => new HttpResponse(null, { status: 204 })),

  // ------------------------------------------------------------ 스타일
  http.get(`${BASE}/styles`, async ({ request }) => {
    await delay(150)
    const url = new URL(request.url)
    const section = url.searchParams.get('section')
    const limit = Number(url.searchParams.get('limit')) || undefined

    let sections = styleCatalog.sections
    if (section === 'popular') sections = sections.slice(0, 1)
    else if (section) sections = sections.filter((s) => s.name === section)

    if (limit) {
      sections = sections.map((s) => ({ ...s, styles: s.styles.slice(0, limit) }))
    }
    return HttpResponse.json({ sections, total_count: styleCatalog.total_count })
  }),

  http.get(`${BASE}/styles/:styleId`, async ({ params }) => {
    await delay(120)
    const detail = styleDetailFor(Number(params.styleId))
    if (!detail) return apiError(404, 'NOT_FOUND', '스타일을 찾을 수 없습니다')
    return HttpResponse.json(detail)
  }),

  // ------------------------------------------------------------ 업로드
  http.post(`${BASE}/uploads`, async () => {
    await delay(700) // 품질 체크가 도는 체감을 남깁니다.
    const forced = scenario()
    let body: UploadResult = uploadOk
    if (forced === 'upload:warn') body = uploadWarned
    else if (forced === 'upload:block') body = uploadBlocked
    // 차단도 HTTP 200 입니다(§1 코드 표) — 에러로 내리면 안 됩니다.
    return HttpResponse.json(body)
  }),

  // ------------------------------------------------------------ 펫
  /*
    새 게스트에게는 강아지도 없습니다. 여기를 빼먹으면 «콩이» 칩은 떠 있는데 그 강아지로
    만든 사진은 한 장도 없는 상태가 되어, 목이 실서버에 없는 화면을 보여 주게 됩니다.
  */
  http.get(`${BASE}/pets`, ({ request }) =>
    expiredSession(request) === 'reissued'
      ? HttpResponse.json({ items: [] })
      : HttpResponse.json({ items: petList }),
  ),

  http.post(`${BASE}/pets`, async ({ request }) => {
    const { name, upload_id } = (await request.json()) as { name: string; upload_id: string }
    const pet = {
      id: crypto.randomUUID(),
      name,
      thumbnail_url: placeholderImage(name),
      // 방금 올린 사진이 곧 이 펫의 최근 업로드입니다 — 다음 방문에서 스킵이 성립합니다.
      latest_upload_id: upload_id ?? null,
    }
    petList.push(pet)
    return HttpResponse.json(pet, { status: 201 })
  }),

  // W-12 C 섹션(FR-W12-03). 목록 배열을 실제로 고쳐야 화면 갱신이 확인됩니다.
  http.patch(`${BASE}/pets/:petId`, async ({ params, request }) => {
    const pet = petList.find((item) => item.id === String(params.petId))
    if (!pet) return apiError(404, 'NOT_FOUND', '강아지를 찾을 수 없습니다')
    const { name } = (await request.json()) as { name: string }
    pet.name = name
    return HttpResponse.json(pet)
  }),

  http.delete(`${BASE}/pets/:petId`, ({ params }) => {
    const index = petList.findIndex((item) => item.id === String(params.petId))
    if (index === -1) return apiError(404, 'NOT_FOUND', '강아지를 찾을 수 없습니다')
    const [removed] = petList.splice(index, 1)
    // 결과물은 지우지 않습니다 — `source_image.pet_profile_id` 만 NULL 이 되고 보관함에
    // 남는 게 확정된 동작입니다(이슈 #12 결정4). 그 NULL 을 실제로 적용해야 W-09
    // 강아지 필터에서 사라지고 «전체»에만 남는 상태가 목 위에서 재현됩니다.
    for (const item of libraryItems) {
      if (item.pet_id === removed.id) item.pet_id = null
    }
    for (const job of state.jobs.values()) {
      if (job.petId === removed.id) job.petId = null
    }
    persistJobs()
    return new HttpResponse(null, { status: 204 })
  }),

  // ------------------------------------------------------------ 생성 job
  http.post(`${BASE}/jobs`, async ({ request }) => {
    await delay(200)
    const key = request.headers.get('Idempotency-Key')
    if (!key) {
      return apiError(400, 'VALIDATION_ERROR', 'Idempotency-Key 헤더가 필요합니다')
    }

    // 같은 키 재요청 → 새 job 을 만들지 않고 원래 job 을 그대로 반환(§1).
    const existing = state.idempotency.get(key)
    if (existing) return HttpResponse.json({ job_id: existing, status: 'queued' }, { status: 202 })

    const body = (await request.json()) as {
      custom_prompt: string | null
      style_id: number | null
      upload_id: string
      pet_id: string | null
    }
    /*
      비용은 **스타일마다 다릅니다**(§3 `credit_cost`) — 여기서 1 로 고정하면 목이
      계약을 대변하지 않습니다. W-03·W-04 는 `credit_cost` 를 그대로 버튼에 박으므로
      (노트4) 2 크레딧이라고 말해 놓고 1 만 빠지는 화면이 됩니다.

      더 중요한 건 402 를 못 밟는다는 점입니다. 잔액 1 · 2크레딧 스타일이 정확히
      §4 시나리오3 의 진입 조건인데, 비용이 항상 1 이면 잔액이 0 이 되기 전까지
      INSUFFICIENT_CREDIT 이 한 번도 나오지 않습니다.

      커스텀 프롬프트는 스타일과 무관하게 2 고정입니다(FR-W08-04) — 그래서 이쪽이 먼저.
    */
    const cost = body.custom_prompt
      ? 2
      : (styleDetailFor(body.style_id ?? -1)?.credit_cost ?? 1)

    applyEmptyScenario()
    if (state.credits.balance < cost) {
      return apiError(402, 'INSUFFICIENT_CREDIT', '크레딧이 부족합니다', {
        required: cost,
        balance: Math.max(0, state.credits.balance),
      })
    }

    const forced = scenario()
    const job: MockJob = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      creditCost: cost,
      styleId: body.style_id,
      uploadId: body.upload_id,
      petId: body.pet_id ?? null,
      forcedError:
        forced === 'job:fail' ? 'GENERATION_FAILED' : forced === 'job:safety' ? 'SAFETY_BLOCKED' : null,
    }
    state.jobs.set(job.id, job)
    state.idempotency.set(key, job.id)
    state.credits.balance -= cost // 차감은 job 생성 시점(04-erd 크레딧 트랜잭션).
    persist()
    persistJobs()

    return HttpResponse.json({ job_id: job.id, status: 'queued' }, { status: 202 })
  }),

  http.get(`${BASE}/jobs/:jobId`, ({ params, request }) => {
    // 만료 자체는 위 인증 핸들러가 잡습니다. 여기 남는 건 그 다음 단계 —
    // 재발급된 토큰 = 다른 게스트라, 이전 job 은 남의 것이라 404 입니다(§3).
    if (expiredSession(request) === 'reissued') {
      return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    }

    const job = state.jobs.get(String(params.jobId))

    // 일시적 장애는 job 이 **있는데도** 답을 못 주는 상태입니다. 그래서 404 판정보다
    // 먼저 오고, 실패해도 job 은 그대로 남아 구간이 끝나면 원래 진행률로 돌아옵니다.
    if (job && scenario() === 'job:flaky') {
      const elapsed = Date.now() - job.createdAt
      if (elapsed >= FLAKY_OUTAGE_MS.from && elapsed < FLAKY_OUTAGE_MS.to) {
        return apiError(503, 'SERVICE_UNAVAILABLE', '일시적으로 응답할 수 없습니다')
      }
    }

    if (!job) {
      // 보관함 시드에서 열린 과거 결과. 없으면 목록의 모든 항목이 404 로 이어져
      // 보관함 → 결과 상세라는 이 화면의 존재 이유(FR-W09-03)를 못 밟습니다.
      const seeded = seededJob(String(params.jobId))
      if (seeded) return HttpResponse.json(seeded)
      return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    }

    const projected = projectJob(job)
    // 실패 확정 시 크레딧 자동 반환(§4 시나리오2 5단계) — 1회만.
    if (projected.status === 'failed' && job.creditCost > 0) {
      state.credits.balance += job.creditCost
      job.creditCost = 0
      persist()
      // creditCost 를 0 으로 만든 사실까지 남겨야 리로드 후 같은 job 이 또 반환하지 않습니다.
      persistJobs()
    }
    return HttpResponse.json(projected)
  }),

  http.post(`${BASE}/jobs/:jobId/share`, async ({ params }) => {
    await delay(400)
    return HttpResponse.json({ share_image_url: placeholderImage(`공유 ${params.jobId}`, '#F9E5EC') })
  }),

  // ------------------------------------------------------------ 계산기 연결
  http.get(`${BASE}/calculator-link`, async () => {
    await delay(120)
    return HttpResponse.json({
      breed_code: 'toy_poodle',
      breed_label: '토이푸들',
      size_label: '소형',
      calculator_url:
        'https://nutti.co.kr/calculator.html?name=콩이&breed=toy_poodle&size=소형' +
        '&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff',
    })
  }),

  // ------------------------------------------------------------ 보관함
  /*
    필터·월 묶기·커서는 서버가 하는 일이라 여기서 합니다. 정적 픽스처를 그대로
    돌려주면 W-09 의 세 축이 화면에서만 있는 척하게 됩니다.
  */
  http.get(`${BASE}/library`, async ({ request }) => {
    await delay(150)

    /*
      재발급 뒤의 보관함. 여기서 404 를 주면 안 됩니다 — 새 게스트에게 이전 결과는
      «막힌» 게 아니라 **없는** 것이라, 실서버는 200 + 빈 목록을 냅니다. 그 차이가
      화면을 가릅니다: 404 면 오류 화면이, 빈 목록이면 «아직 없어요»가 뜨고, 후자가
      사고를 침묵으로 덮는 진짜 경로입니다(W09Library 의 리셋 안내).
    */
    if (expiredSession(request) === 'reissued') {
      return HttpResponse.json({ months: [], next_cursor: null })
    }

    const url = new URL(request.url)
    const petId = url.searchParams.get('pet_id')
    // 커서 값의 형식은 서버가 정합니다(§1 은 불투명 문자열로만 규정) — 목은 오프셋을
    // 씁니다. 프론트는 이 값을 해석하지 않고 그대로 되돌려주기만 해야 합니다.
    const offset = Number(url.searchParams.get('cursor') ?? 0) || 0

    const all = libraryEntries()
    const filtered = petId ? all.filter((item) => item.pet_id === petId) : all
    const slice = filtered.slice(offset, offset + LIBRARY_PAGE_SIZE)

    const months: LibraryMonth[] = []
    for (const item of slice) {
      const label = monthLabel(item.created_at)
      const last = months.at(-1)
      if (last?.label === label) last.items.push(item)
      else months.push({ label, items: [item] })
    }

    const next = offset + LIBRARY_PAGE_SIZE
    return HttpResponse.json({
      months,
      next_cursor: next < filtered.length ? String(next) : null,
    })
  }),

  http.delete(`${BASE}/library`, async ({ request }) => {
    await delay(200)
    const { ids } = (await request.json()) as { ids: string[] }
    for (const id of ids) state.deletedResults.add(id)
    persistDeletedResults()
    return new HttpResponse(null, { status: 204 })
  }),

  // ------------------------------------------------------------ 크레딧
  http.get(`${BASE}/credits`, ({ request }) => {
    // 만료가 아닌 401 — 병합된 게스트 토큰·kind 불일치(app/auth.py `get_current_member`).
    // TOKEN_EXPIRED 와 달리 재발급으로 풀리지 않는다는 게 이 시나리오의 요점입니다.
    // 앱바 크레딧 pill 이 어느 화면에서나 이걸 부르므로 여기에 겁니다.
    if (scenario() === 'session:lost') {
      return apiError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다')
    }

    /*
      새 게스트의 잔액은 발급 시 받은 `guest_trial` +1 뿐입니다(app/routers/auth.py).
      이전 잔액을 그대로 두면 앱바에 «11» 을 단 채로 "이전 결과는 열 수 없어요"를
      말하게 되어, 화면이 스스로를 반박합니다. `state` 는 건드리지 않습니다 — 리셋된
      세션에서만 다르게 보이면 되고, 시나리오를 끄면 원래 잔액으로 돌아와야 합니다.
    */
    if (expiredSession(request) === 'reissued') {
      return HttpResponse.json({ balance: 1, earn_actions: state.credits.earn_actions })
    }
    applyEmptyScenario()
    return HttpResponse.json(state.credits)
  }),

  http.post(`${BASE}/credits/claim`, async ({ request }) => {
    await delay(250)
    const { action } = (await request.json()) as { action: string }
    const row = state.credits.earn_actions.find((a) => a.action === action)

    if (!row) return apiError(400, 'VALIDATION_ERROR', '알 수 없는 획득 경로입니다', { action })
    if (row.status !== 'available') {
      return apiError(409, 'ALREADY_CLAIMED', '이미 받은 크레딧이에요', { action })
    }

    state.credits.balance += row.amount
    row.status = action === 'daily' ? 'tomorrow' : 'done'
    row.cta = action === 'daily' ? '내일 다시' : null
    persist()
    return HttpResponse.json({ balance: state.credits.balance, amount_granted: row.amount })
  }),

  http.get(`${BASE}/credits/ledger`, () =>
    HttpResponse.json({ items: ledgerEntries, next_cursor: null }),
  ),

  // ------------------------------------------------------------ 이벤트 비콘
  http.post(`${BASE}/events`, () => new HttpResponse(null, { status: 204 })),
]
