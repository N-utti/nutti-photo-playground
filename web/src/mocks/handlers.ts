/**
 * MSW 핸들러 — 백엔드 전 엔드포인트가 501 스텁이므로(PR #2) 프론트는 이 목 위에서 만듭니다.
 *
 * 응답 본문은 docs/05-api-spec.md §3 예시를 따릅니다(mocks/fixtures.ts).
 * 여기서 추가로 하는 일은 §3 이 정적 예시로만 보여 주는 것들을 **움직이게** 만드는 것입니다 —
 * job 이 시간에 따라 queued → processing → succeeded 로 전이하고, 크레딧이 실제로 차감되고,
 * 같은 Idempotency-Key 가 같은 job 을 돌려줍니다.
 *
 * 시나리오 강제: localStorage 에 `nutti.mock.scenario` 를 넣으면 해당 케이스로 고정됩니다.
 *   upload:warn | upload:block | job:fail | job:safety | credit:empty | session:expired
 *   guest:ratelimited | session:lost | auth:statefail | cafe24:linked
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
  Me,
  UploadResult,
} from '../api/types'
import {
  initialCredits,
  ledgerEntries,
  libraryPage,
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
  forcedError: JobErrorCode | null
  selectedIndex: number | null
}

/**
 * 리로드를 건너뛰는 목 상태 (크레딧 · `/auth/me`).
 *
 * 로그인·연동은 `authorize_url` 로 페이지를 통째로 넘겼다가 콜백으로 돌아오는 구조라
 * 모듈 변수만 쓰면 왕복 도중에 목이 초기화됩니다 — 돌아온 순간 회원이 다시 게스트가
 * 되므로 "로그인 후 연동" 같은 2단계 흐름을 목 위에서 한 번도 못 밟습니다.
 *
 * 탭 수명과 묶으려고 sessionStorage 를 씁니다. job 은 여기 넣지 않습니다 — 결과 이미지가
 * 런타임 placeholder 라 되살려도 의미가 없고, 목 job 의 수명은 원래 한 세션입니다.
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

const snapshot = restored()

const state = {
  credits: snapshot?.credits ?? (structuredClone(initialCredits) as Credits),
  jobs: new Map<string, MockJob>(),
  /** Idempotency-Key → job_id. 같은 키 재요청 시 새 job 을 만들지 않습니다(§1). */
  idempotency: new Map<string, string>(),
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

/** 경과 시간으로 job 상태를 계산 — 타이머 없이 폴링만으로 진행이 보입니다. */
function projectJob(job: MockJob): Job {
  const elapsed = Date.now() - job.createdAt
  const sourceImageUrl = placeholderImage('원본')

  if (elapsed >= JOB_DURATION_MS) {
    if (job.forcedError) {
      return {
        job_id: job.id,
        status: 'failed',
        progress: null,
        eta_seconds: null,
        status_message: null,
        source_image_url: sourceImageUrl,
        results: null,
        selected_index: null,
        error_code: job.forcedError,
      }
    }
    return {
      job_id: job.id,
      status: 'succeeded',
      progress: 100,
      eta_seconds: 0,
      status_message: null,
      source_image_url: sourceImageUrl,
      results: Array.from({ length: 4 }, (_, index) => ({
        index,
        image_url: placeholderImage(`결과 ${index + 1}`, '#F9E5EC'),
      })),
      selected_index: job.selectedIndex,
      error_code: null,
    }
  }

  if (elapsed < 1_500) {
    return {
      job_id: job.id,
      status: 'queued',
      progress: 0,
      eta_seconds: Math.ceil(JOB_DURATION_MS / 1000),
      status_message: '대기 중…',
      source_image_url: sourceImageUrl,
      results: null,
      selected_index: null,
      error_code: null,
    }
  }

  const ratio = elapsed / JOB_DURATION_MS
  return {
    job_id: job.id,
    status: 'processing',
    progress: Math.floor(ratio * 100),
    eta_seconds: Math.ceil((JOB_DURATION_MS - elapsed) / 1000),
    status_message: '레고 블록을 쌓는 중…',
    source_image_url: sourceImageUrl,
    results: null,
    selected_index: null,
    error_code: null,
  }
}

// ---------------------------------------------------------------- 핸들러

export const handlers = [
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
  http.get(`${BASE}/pets`, () => HttpResponse.json({ items: petList })),

  http.post(`${BASE}/pets`, async ({ request }) => {
    const { name } = (await request.json()) as { name: string }
    const pet = { id: crypto.randomUUID(), name, thumbnail_url: placeholderImage(name) }
    petList.push(pet)
    return HttpResponse.json(pet, { status: 201 })
  }),

  http.delete(`${BASE}/pets/:petId`, () => new HttpResponse(null, { status: 204 })),

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

    const body = (await request.json()) as { custom_prompt: string | null }
    const cost = body.custom_prompt ? 2 : 1

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
      forcedError:
        forced === 'job:fail' ? 'GENERATION_FAILED' : forced === 'job:safety' ? 'SAFETY_BLOCKED' : null,
      selectedIndex: null,
    }
    state.jobs.set(job.id, job)
    state.idempotency.set(key, job.id)
    state.credits.balance -= cost // 차감은 job 생성 시점(04-erd 크레딧 트랜잭션).
    persist()

    return HttpResponse.json({ job_id: job.id, status: 'queued' }, { status: 202 })
  }),

  http.get(`${BASE}/jobs/:jobId`, ({ params, request }) => {
    // 게스트 토큰 만료 → 재발급 → **다른 member_id** 라 원래 job 이 사라지는 경로.
    // 이슈 #5 의 복원 실패 안내를 실제로 밟아 보려면 이 시나리오가 필요합니다.
    //
    // "몇 번째 요청이냐"가 아니라 **어떤 토큰이냐**로 판정합니다. 회차로 세면
    // StrictMode 이중 마운트나 재시도 한 번에 만료가 소진돼 재발급 경로를 못 밟습니다.
    if (scenario() === 'session:expired') {
      const token = request.headers.get('Authorization') ?? ''
      state.expiredToken ??= token
      if (token === state.expiredToken) {
        return apiError(401, 'TOKEN_EXPIRED', '토큰이 만료되었습니다')
      }
      // 재발급된 토큰 = 다른 게스트. 이전 job 은 남의 것이라 404 입니다(§3).
      return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    }

    const job = state.jobs.get(String(params.jobId))
    if (!job) return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')

    const projected = projectJob(job)
    // 실패 확정 시 크레딧 자동 반환(§4 시나리오2 5단계) — 1회만.
    if (projected.status === 'failed' && job.creditCost > 0) {
      state.credits.balance += job.creditCost
      job.creditCost = 0
      persist()
    }
    return HttpResponse.json(projected)
  }),

  http.post(`${BASE}/jobs/:jobId/select`, async ({ params, request }) => {
    const job = state.jobs.get(String(params.jobId))
    if (!job) return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    const { result_index } = (await request.json()) as { result_index: number }
    job.selectedIndex = result_index
    return HttpResponse.json({ job_id: job.id, selected_index: result_index })
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
  http.get(`${BASE}/library`, () => HttpResponse.json(libraryPage)),
  http.delete(`${BASE}/library`, () => new HttpResponse(null, { status: 204 })),

  // ------------------------------------------------------------ 크레딧
  http.get(`${BASE}/credits`, () => {
    // 만료가 아닌 401 — 병합된 게스트 토큰·kind 불일치(app/auth.py `get_current_member`).
    // TOKEN_EXPIRED 와 달리 재발급으로 풀리지 않는다는 게 이 시나리오의 요점입니다.
    // 앱바 크레딧 pill 이 어느 화면에서나 이걸 부르므로 여기에 겁니다.
    if (scenario() === 'session:lost') {
      return apiError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다')
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
