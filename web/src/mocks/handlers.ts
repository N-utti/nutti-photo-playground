/**
 * MSW 핸들러 — 백엔드 전 엔드포인트가 501 스텁이므로(PR #2) 프론트는 이 목 위에서 만듭니다.
 *
 * 응답 본문은 docs/05-api-spec.md §3 예시를 따릅니다(mocks/fixtures.ts).
 * 여기서 추가로 하는 일은 §3 이 정적 예시로만 보여 주는 것들을 **움직이게** 만드는 것입니다 —
 * job 이 시간에 따라 queued → processing → succeeded 로 전이하고, 크레딧이 실제로 차감되고,
 * 같은 Idempotency-Key 가 같은 job 을 돌려줍니다.
 *
 * 시나리오 강제: localStorage 에 `nutti.mock.scenario` 를 넣으면 해당 케이스로 고정됩니다.
 *   upload:warn | upload:nodog | upload:multi | upload:face | upload:face-block | upload:block
 *   job:fail | job:safety | job:retries | job:unknown-error | job:flaky | job:slow | job:queued
 *   credit:empty
 *   styles:no-images | styles:rich
 *   session:expired | guest:ratelimited | session:lost | auth:statefail | cafe24:linked
 *   refresh:fail | refresh:429
 *
 * 로컬 로그인 목 규칙: 비밀번호 `nutti1234` 만 성공(그 외 401), 이메일
 * `taken@nutti.co.kr` 로 가입하면 409 EMAIL_TAKEN.
 */

import { HttpResponse, http, delay } from 'msw'
import type {
  AuthProvider,
  BreedEstimate,
  Credits,
  EarnAction,
  Job,
  LibraryItem,
  LibraryMonth,
  Me,
  Pet,
  PetSummary,
  UploadResult,
} from '../api/types'
import { BREED_SIZES, MIX_BREED } from './calculatorBreeds'
import {
  RESULT_SIZE,
  SOURCE_SIZE,
  initialCredits,
  ledgerEntries,
  libraryItems,
  petList,
  placeholderImage,
  styleCatalog,
  styleCatalogNoImages,
  styleDetailFor,
  uploadBlocked,
  uploadHumanFaceBlocked,
  uploadHumanFaceWarned,
  uploadMultiSubject,
  uploadNoDog,
  uploadOk,
  uploadWarned,
} from './fixtures'

const BASE = '*/v1'

/** 시나리오 강제 키(README «목 시나리오 강제»). 리셋이 같이 지웁니다. */
const SCENARIO_KEY = 'nutti.mock.scenario'

function scenario(): string {
  return localStorage.getItem(SCENARIO_KEY) ?? ''
}

/**
 * `upload_id` → 그 업로드가 추정한 견종.
 *
 * 업로드 픽스처마다 `upload_id` 가 고정이라 되짚을 수 있습니다. 별도 저장소를 두지
 * 않는 이유는 리로드입니다 — job 은 localStorage 에 남는데 견종 색인이 메모리에만
 * 있으면, 새로고침 한 번에 "견종을 못 찾은 job" 이 조용히 정상 케이스로 바뀝니다.
 *
 * 모르는 업로드(펫의 `latest_upload_id`, 보관함 시드)는 정상 케이스로 둡니다.
 */
function breedForUpload(uploadId: string): BreedEstimate | null {
  const known = [uploadOk, uploadWarned, uploadNoDog, uploadMultiSubject, uploadHumanFaceWarned]
  const match = known.find((upload) => upload.upload_id === uploadId)
  return match ? match.breed_estimate : uploadOk.breed_estimate
}

/** 생성·수정 응답 모양. 목록(`Pet`)과 달리 `latest_upload_id` 가 없습니다(§3). */
function petSummary(pet: Pet): PetSummary {
  return { id: pet.id, name: pet.name, thumbnail_url: pet.thumbnail_url }
}

/**
 * 견종 추정 → 계산기가 아는 이름·크기 (Q9 확정, PR #122 착지분).
 *
 * 서버가 보는 건 `code` 가 아니라 **`label`** 입니다(`app/routers/results.py` —
 * `estimate.get("label")`). 계산기에 코드 체계가 없어서 한글 이름이 곧 키이기
 * 때문인데, 그래서 비전이 준 `code` 는 여기서 쓸 자리가 없습니다.
 *
 * 반환: 매칭되면 그 이름·크기 / 목록 밖이면 믹스견(FR-EDGE-11) / 후보가 아예
 * 없으면 null(FR-EDGE-10).
 */
function calculatorBreed(label: string | null | undefined): { name: string; size: string } | null {
  const candidate = label?.trim()
  if (!candidate) return null
  const name = candidate in BREED_SIZES ? candidate : MIX_BREED
  return { name, size: BREED_SIZES[name] }
}

// ---------------------------------------------------------------- 목 상태

interface MockJob {
  id: string
  createdAt: number
  /**
   * 이 job 이 차감한 크레딧. **실패해도 줄이지 않습니다** — 서버의 자동 반환은 크레딧
   * 트랜잭션을 따로 쌓을 뿐 `generation_job.credit_cost` 를 건드리지 않습니다
   * (`app/worker.py` `_refund`). 예전 목은 반환 표시로 이 값을 0 으로 만들었는데,
   * 그 값이 이제 `credit_cost` 로 응답에 실리므로(PR #83) 그대로 두면 실패한 job 의
   * «다시 만들기»가 «0 크레딧»이라고 말합니다. 반환 여부는 아래 `refunded` 가 셉니다.
   */
  creditCost: number
  /** 크레딧 자동 반환을 이미 했는지(§4 시나리오2 5단계) — 1회만 돌려주기 위한 표시. */
  refunded?: boolean
  /**
   * 커스텀 job 의 문구 원문(PR #83 `custom_prompt`). 프리셋 job 은 null.
   * 서버는 `CustomPromptLog.raw_text` 를 그대로 주므로 **앞뒤 공백까지 원문**입니다.
   */
  customPrompt?: string | null
  /**
   * 이 job 이 실제로 쓴 스타일 입력값 (이슈 #127 → 백엔드 PR #139).
   *
   * **검증을 통과한 최종 값**이지 보낸 값이 아닙니다 — `default` 병합·`trim` 이 끝난
   * 상태이고, `default` 없는 `prefill` 칸은 들어 있지 않습니다(워커가 채웁니다).
   *
   * 옵셔널인 이유는 옛 저장분입니다(`persistJobs`). 이 필드가 생기기 전에 만든 job 은
   * `undefined` 라, 응답에서는 `null` 로 떨어집니다 — 즉 «값을 모른다» 가 되고 화면은
   * 기본값으로 시작합니다. 서버에서도 옛 job 이 같은 모양이 될 수 있습니다.
   */
  inputs?: Record<string, string> | null
  /** 재료 참조(이슈 #9 A안) — 스펙 §3 이 job 응답에 그대로 싣기로 확정한 값입니다. */
  styleId: number | null
  uploadId: string
  /**
   * 어느 강아지의 결과인지. job 응답에는 없는 값이고(§3), 보관함 항목이 이걸 답니다 —
   * 서버에서는 `source_image.pet_profile_id` 가 그 연결입니다. 없으면 W-09 강아지
   * 필터가 방금 만든 결과를 영영 «전체»에만 두게 됩니다.
   */
  petId?: string | null
  /**
   * `Job['error_code']` 를 그대로 씁니다 — **`JobErrorCode` 로 좁히지 않습니다**.
   * 서버 컬럼이 자유 텍스트라 문서화된 셋 밖의 값이 실제로 올 수 있고(§1 주석),
   * 목이 그 값을 만들 수 없으면 화면의 폴백을 브라우저에서 한 번도 밟지 못합니다.
   */
  forcedError: Job['error_code']
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

interface PersistedState {
  credits: Credits
  me: Omit<Me, 'credit_balance'>
  /**
   * 살아 있는 리프레시 토큰 (PR #57).
   *
   * 이걸 안 남기면 목이 **새로고침 한 번에 모든 회원을 로그아웃시킵니다** — 브라우저의
   * 리프레시는 localStorage 라 살아 돌아오는데 목의 대조본만 사라져서, 첫 만료가
   * 무조건 401 이 됩니다. 실서버는 해시를 DB 에 들고 있으므로 그런 일이 없습니다.
   */
  refreshToken?: string | null
}

function restored(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : null
  } catch {
    return null
  }
}

function persist(): void {
  const snapshot: PersistedState = {
    credits: state.credits,
    me: state.me,
    refreshToken: state.refreshToken,
  }
  sessionStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot))
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

/**
 * 아직 아무것도 안 한 사람. 리셋이 되돌아갈 지점이라 상수로 뺐습니다.
 *
 * `member_id` 가 고정값인 건 의도입니다 — 게스트도 job 주소를 갖고, 그 주소가 리셋마다
 * 바뀌면 «URL 로 돌아오면 결과가 있다»(Q7)를 목 위에서 확인할 수 없습니다.
 */
const INITIAL_ME: Omit<Me, 'credit_balance'> = {
  member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
  kind: 'guest',
  email: null,
  nickname: null,
  providers: [],
  cafe24_linked: false,
}

/**
 * `fixtures.ts` 의 가변 배열 원본.
 *
 * 픽스처는 «읽기용 시드» 처럼 생겼지만 핸들러가 **제자리에서 고칩니다** — 펫 추가는
 * `petList.push`, 삭제는 `splice`, 이름 변경은 `pet.name =`, 그리고 펫을 지우면
 * `libraryItems[].pet_id` 가 null 로 덮입니다(이슈 #12 결정4 의 FK NULL 을 흉내내는 것).
 *
 * 그래서 `state` 만 되돌리면 격리가 절반만 됩니다. 펫 삭제 테스트 하나가 프로세스
 * 전체의 시드를 줄여 놓고, 그 뒤 «저장된 강아지로 바로 만들기» 칩을 세는 테스트가
 * 뜬금없이 깨집니다(W04Upload.test.tsx 가 이 목록에 의존합니다).
 *
 * 로드 직후에 뜨므로 이 사본은 아직 아무도 건드리지 않은 상태입니다.
 */
const PRISTINE_PETS = structuredClone(petList)
const PRISTINE_LIBRARY = structuredClone(libraryItems)

const state = {
  credits: snapshot?.credits ?? (structuredClone(initialCredits) as Credits),
  jobs: new Map<string, MockJob>(Object.entries(jobSnapshot.jobs)),
  /** Idempotency-Key → job_id. 같은 키 재요청 시 새 job 을 만들지 않습니다(§1). */
  idempotency: new Map<string, string>(Object.entries(jobSnapshot.idempotency)),
  /** 보관함에서 지운 결과. 목록 조립에서 가려집니다. */
  deletedResults: restoredDeleted(),
  /** session:expired 시나리오에서 "만료된 것으로 칠" Authorization 헤더 값. */
  expiredToken: null as string | null,
  /**
   * 지금 살아 있는 회원 리프레시 토큰 **하나** (PR #57).
   *
   * 서버가 회원당 활성 1개만 두고 회전할 때마다 구 토큰을 버리므로(이슈 #47 B안),
   * 목도 값 하나로 흉내 냅니다 — 배열로 두면 «이미 쓴 토큰 재사용 = 401» 이라는
   * 이 계약의 핵심이 목에서만 통과해 버립니다. 로그아웃은 null.
   */
  refreshToken: snapshot?.refreshToken ?? null,
  /** `/auth/me` 의 원본. 로그인·연동이 이 값을 바꾸므로 화면 분기가 실제로 움직입니다. */
  me: snapshot?.me ?? structuredClone(INITIAL_ME),
}

/**
 * 목을 방금 켠 상태로 되돌립니다. **테스트 전용 진입점**입니다(src/test/setup.ts).
 *
 * 이게 없던 동안 `state` 는 모듈 수준이라 테스트 사이에 그대로 흘러갔습니다. 잔액을
 * 읽기만 하는 테스트끼리는 티가 안 나지만, 클레임·삭제·생성처럼 **상태를 바꾸는**
 * 테스트가 하나라도 끼면 그때부터 결과가 실행 순서에 달립니다 — 혼자 돌리면 통과하고
 * 전체를 돌리면 깨지는(혹은 그 반대인) 종류라, 원인을 찾는 데 드는 시간이 테스트를
 * 붙여서 아낀 시간을 넘깁니다.
 *
 * 저장본까지 지웁니다. jsdom 은 파일마다 새 환경이지만 같은 파일 안의 테스트끼리는
 * `localStorage` 를 공유하고, 무엇보다 `state` 를 비워 놓고 저장본을 남기면 다음
 * 모듈 로드가 그걸 되살려 «리셋했는데 안 지워지는» 상태가 됩니다.
 *
 * 시나리오 키도 함께 지웁니다 — `job:fail` 같은 걸 세워 둔 테스트가 뒷 테스트까지
 * 실패 응답으로 끌고 가지 않도록.
 */
export function resetMockState(): void {
  state.credits = structuredClone(initialCredits) as Credits
  state.jobs.clear()
  state.idempotency.clear()
  state.deletedResults.clear()
  state.expiredToken = null
  state.refreshToken = null
  state.me = structuredClone(INITIAL_ME)

  /*
    픽스처 배열은 **참조를 유지한 채** 내용만 갈아 끼웁니다(`splice`). 다른 모듈이
    이미 이 배열을 import 해 놓았으므로 새 배열을 대입하면 그쪽은 옛 배열을 계속
    들여다봅니다. 매번 새로 clone 하는 건 복원된 객체를 다음 테스트가 또 고치기
    때문입니다 — 사본을 한 번만 만들어 돌려쓰면 두 번째 테스트부터 오염됩니다.
  */
  petList.splice(0, petList.length, ...structuredClone(PRISTINE_PETS))
  libraryItems.splice(0, libraryItems.length, ...structuredClone(PRISTINE_LIBRARY))

  // 잔액을 건드리는 시나리오가 «한 번만 떨어뜨린다» 를 기억하는 플래그. 안 풀면 다음
  // 테스트에서 시나리오를 다시 켜도 잔액이 안 떨어집니다.
  balanceApplied = false

  sessionStorage.removeItem(PERSIST_KEY)
  localStorage.removeItem(JOBS_KEY)
  localStorage.removeItem(DELETED_KEY)
  localStorage.removeItem(SCENARIO_KEY)
}

/**
 * 목을 **로그인한 회원** 상태로 세웁니다. **테스트 전용 진입점**입니다.
 *
 * `GET /auth/me` 응답만 덮는 기존 `asMember()` 패턴(W12MyPage.test 등)으로는 부족한
 * 화면이 생겼습니다 — 보관함처럼 **목이 스스로 회원 여부를 보고 갈리는** 엔드포인트는
 * `/auth/me` 를 아무리 회원으로 꾸며도 403 을 계속 냅니다. 화면과 목이 서로 다른 답을
 * 보는 그 상태가 테스트에서만 성립하는 세계고, 그건 목을 두는 이유를 지웁니다.
 *
 * 토큰·리프레시는 만들지 않습니다. 목은 Authorization 을 검사하지 않고, 여기서 굳이
 * 회전을 흉내 내면 `session:expired` 시나리오의 판정(`expiredSession`)이 흔들립니다.
 */
export function mockAsMember(): void {
  state.me.kind = 'member'
  state.me.email = 'member@nutti.co.kr'
  state.me.nickname = '콩이엄마'
  if (!state.me.providers.includes('kakao')) state.me.providers.push('kakao')
  persist()
}

/** 목 authorize_url — 프로바이더 대신 우리 콜백 라우트로 되돌립니다. */
function mockAuthorizeUrl(provider: string): string {
  return `${location.origin}/auth/callback/${provider}?code=mock-code&state=mock-state-${crypto.randomUUID()}`
}

/**
 * 게스트에게는 획득 목록 4행이 전부 `login_required` 로 갑니다 (PR #58, 이슈 #52).
 *
 * 상태를 저장본에 쓰지 않고 **응답에서만** 갈아 끼웁니다 — 로그인하면 원래 상태
 * (done·tomorrow 포함)가 그대로 돌아와야 하기 때문입니다. 목이 이걸 안 하면 게스트
 * 화면에 «받기» 가 그대로 보이고, 프론트의 로그인 CTA 분기를 브라우저에서 못 밟습니다.
 */
function guestAware(rows: Credits['earn_actions']): Credits['earn_actions'] {
  if (state.me.kind === 'member') return rows
  return rows.map((row) => ({ ...row, status: 'login_required' as const, cta: '로그인' }))
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
  // 새 로그인은 이전 리프레시를 무효화합니다(회원당 1개) — 덮어쓰기가 그 규칙입니다.
  state.refreshToken = `mock-refresh.${crypto.randomUUID()}`
  persist()
  return {
    token: `mock-member-jwt.${crypto.randomUUID()}`,
    refresh_token: state.refreshToken,
    member_id: state.me.member_id,
    kind: 'member' as const,
    merged: options.merged ?? false,
    credit_balance: state.credits.balance,
  }
}

/**
 * `app/routers/jobs.py` `_CUSTOM_PROMPT_BLOCKLIST` 를 그대로 옮긴 것 (PR #60).
 *
 * 화면 필터와 합치지 않습니다 — 두 겹이 같은 목록을 보면 방어가 한 겹으로 줄고,
 * 무엇보다 서버가 자기 목록을 바꿔도 목은 옛 규칙으로 통과시키게 됩니다. 서버 쪽이
 * 바뀌면 이 배열도 같이 갱신하는 게 이 파일의 일입니다.
 */
const SERVER_PROMPT_BLOCKLIST = [
  '품종',
  '털색',
  '색깔',
  '색으로',
  '종으로',
  '푸들로',
  '말티즈로',
  '치와와로',
  '골든리트리버로',
  '리트리버로',
  '포메라니안으로',
  '흰둥이로',
  '검은둥이로',
  '갈색으로',
  '하얀색으로',
  '검은색으로',
]

/** 생성에 걸리는 시간. W-03 이 말하는 평균(48초)보다 짧게 잡아 개발 반복을 빠르게 합니다. */
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
 * `job:slow` — 90초를 넘겨 «지연 안내»(FR-EDGE-02)에 들어가는 job.
 *
 * 12초짜리 기본 job 으로는 초과 상태를 한 번도 못 밟습니다. 실제로 넘겨 봐야 하는
 * 이유는 그 구간에서 화면이 말을 바꾸기 때문입니다 — 남은 초 표기가 사라지고
 * «나가도 된다»가 주 버튼이 됩니다(W-05).
 *
 * 150초인 건 초과 상태를 **충분히 들여다볼 시간**을 남기기 위해서입니다. 임계값이
 * 60 → 90 으로 올라가면서(2026-08-24, app/jobProgress.ts) 관찰 가능한 구간이 90초
 * → 60초로 줄었지만, 안내가 뜨자마자 결과로 넘어가지 않을 만큼은 됩니다. 임계값을
 * 더 올린다면 **이 값도 같이 올려야 합니다.**
 */
const SLOW_JOB_DURATION_MS = 150_000

/** 워커가 큐에서 집기까지. 재시도 타임라인이 이 값을 기준으로 쌓입니다. */
const INITIAL_QUEUE_MS = 1_500

/**
 * `job:retries` — 재시도 3회를 다 태우고 `MAX_RETRIES_EXCEEDED` 로 끝나는 job.
 *
 * PR #70(이슈 #64) 전까지 이 코드는 **moderation 거부까지 받아 내는 자리**였습니다.
 * 이제 안전 차단은 재시도 없이 `SAFETY_BLOCKED` 로 즉시 끝나므로(app/worker.py
 * `_is_safety_block`), 여기 남는 건 «진짜로 세 번 다 실패한 일시적 오류» 하나뿐이고
 * W-06 의 세 번째 문구("여러 번 시도했지만 실패했어요 · 잠시 뒤에 다시")가 정확히
 * 그 경우에만 뜹니다. 그런데 목이 이 코드를 만들 수 없어서, 문서화된 실패 코드 3종
 * 중 이것만 브라우저에서 **한 번도 뜨지 않았습니다**.
 *
 * 한 번 실패할 때마다 워커는 status 를 `queued` 로 되돌립니다(process_job 마지막
 * else). 그래서 이 시나리오는 processing → queued → processing 을 실제로 오가고,
 * W-05 가 그 되감기에서 막대를 뒤로 보내거나 «대기 중»으로 화면을 되돌리지 않는지도
 * 여기서만 확인됩니다. `started_at` 은 재시도해도 최초 시각 그대로입니다(이슈 #41) —
 * FR-EDGE-02 판정 시계는 재시도로 리셋되지 않습니다.
 */
const RETRY_ATTEMPTS = 3
const RETRY_ATTEMPT_MS = 6_000
const RETRY_REQUEUE_MS = 2_000
const RETRY_TOTAL_MS =
  INITIAL_QUEUE_MS + RETRY_ATTEMPTS * RETRY_ATTEMPT_MS + (RETRY_ATTEMPTS - 1) * RETRY_REQUEUE_MS

/** 워커가 집은 뒤 경과분이 «실패하고 다시 큐에 앉아 있는» 구간인지. */
function inRequeueGap(sincePickup: number): boolean {
  const cycle = RETRY_ATTEMPT_MS + RETRY_REQUEUE_MS
  return sincePickup % cycle >= RETRY_ATTEMPT_MS
}

function jobDuration(): number {
  const forced = scenario()
  if (forced === 'job:flaky') return FLAKY_JOB_DURATION_MS
  if (forced === 'job:slow') return SLOW_JOB_DURATION_MS
  if (forced === 'job:retries') return RETRY_TOTAL_MS
  return JOB_DURATION_MS
}

/**
 * `credit:empty` 는 "항상 402"가 아니라 **잔액 0에서 시작**입니다.
 *
 * 402 를 무조건 던지면 크레딧을 받아도 계속 막혀서, §4 시나리오3 의 뒷부분
 * (시트에서 클레임 → 같은 키로 재시도 → 성공)을 목 위에서 밟을 수 없습니다.
 * 잔액만 0으로 떨어뜨리면 이후는 실제 규칙(`balance < cost` → 402)이 처리합니다.
 *
 * `credit:custom-cost-3` 은 같은 장치를 **1** 로 씁니다. 이 시나리오의 목적은 커스텀
 * 비용이 2 가 아닌 서버(`app_setting` 값, 이슈 #149)를 흉내내는 것입니다. 이제 화면은
 * 그 값을 요청 전에 압니다 — `GET /v1/credits` 의 `custom_prompt_credit_cost` (PR #151).
 *
 * 그래도 잔액을 1 로 떨어뜨립니다. 라벨이 3 이라고 적히는 것만 보면 **고지액과 차감액이
 * 같은지**는 확인되지 않습니다 — 402 까지 가야 서버가 실제로 요구한 값이 나옵니다.
 * 1 이면 3 에 모자라 402 가 나고, 시트에서 2 를 받으면 정확히 3 이 되어 재시도까지
 * 이어집니다.
 */
const SCENARIO_BALANCE: Record<string, number> = {
  'credit:empty': 0,
  'credit:custom-cost-3': 1,
}

/**
 * 커스텀 프롬프트 비용 — 목의 `app_setting.custom_prompt_credit_cost` 입니다.
 *
 * 두 곳이 이 값을 씁니다: `GET /v1/credits` 가 화면에 **말하는** 값과 `POST /v1/jobs`
 * 가 실제로 **빼 가는** 값. 실서버는 같은 헬퍼(`app.credits.custom_prompt_credit_cost`)
 * 를 둘 다 부르므로 목도 하나여야 합니다 — 갈라 놓으면 «2 크레딧» 이라고 적어 두고
 * 3 을 빼 가는 화면을 목이 정상으로 보여 주게 됩니다.
 *
 * 기본 2 는 실서버 실측값입니다(그 행이 없어서 폴백). `credit:custom-cost-3` 은
 * 운영이 그 행을 3 으로 넣은 서버를 흉내냅니다 — 이슈 #149 가 «지금 2 가 맞는 건
 * 우연» 이라고 적은 그 상태를 브라우저로 밟는 유일한 방법입니다.
 */
function customPromptCost(): number {
  return scenario() === 'credit:custom-cost-3' ? 3 : 2
}
let balanceApplied = false
function applyEmptyScenario() {
  const forced = SCENARIO_BALANCE[scenario()]
  if (forced === undefined) {
    balanceApplied = false
    return
  }
  if (!balanceApplied) {
    state.credits.balance = forced
    balanceApplied = true
    persist()
  }
}

/**
 * `retryAfter` 는 429 전용입니다 (§1). 헤더 없이 429 만 주면 화면이 늘 "잠시 뒤"로
 * 폴백해, 실서버가 초를 내려줄 때만 나오는 문구("약 N분 뒤")를 목에서 한 번도 볼 수
 * 없습니다 — 제한 안내는 그 숫자가 있고 없고가 사용자 경험의 전부입니다.
 */
function apiError(
  status: number,
  code: string,
  message: string,
  detail: unknown = {},
  retryAfter?: number,
) {
  return HttpResponse.json(
    { error: { code, message, detail } },
    { status, headers: retryAfter === undefined ? undefined : { 'Retry-After': String(retryAfter) } },
  )
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
 *
 * `reissued` 는 **게스트 재발급**만 뜻합니다 — 아래 분기들(크레딧 1·빈 보관함·job 404)이
 * 전부 «다른 사람이 됐다»를 그리기 때문입니다. 회원의 리프레시 회전(PR #57)은 정반대로
 * 같은 회원이 그대로 이어지는 것이라, 회전한 회원 토큰을 여기로 보내면 목이 **성공한
 * 회전을 데이터 유실로 그립니다**. 그러면 회전이 실제로 깨져 회원이 새 게스트로
 * 떨어지는 사고가 나도 화면이 성공했을 때와 똑같아, 회귀를 화면으로 판정할 수 없습니다.
 */
function expiredSession(request: Request): 'expired' | 'reissued' | null {
  // refresh:fail·refresh:429 도 «만료된 액세스»에서 출발합니다 — 회전은 그다음에야 시도됩니다.
  const forced = scenario()
  if (forced !== 'session:expired' && forced !== 'refresh:fail' && forced !== 'refresh:429') {
    return null
  }
  const token = request.headers.get('Authorization') ?? ''
  // 토큰 없는 요청 = 발급 그 자체. 이걸 판정에 넣으면 첫 방문(토큰 없이 시작)에서
  // 빈 문자열이 «만료 대상»으로 굳어, 아직 만료된 적 없는 세션이 만료로 보입니다.
  if (!token) return null
  state.expiredToken ??= token
  if (token === state.expiredToken) return 'expired'
  // 만료 대상이 아닌 **회원** 토큰 = 회전이 성공한 같은 회원. 실서버는 member_id 가
  // 그대로라 크레딧도 보관함도 그대로이므로, 목도 아무 일 없었던 것처럼 통과시킵니다.
  if (token.includes('mock-member-jwt.')) return null
  return 'reissued'
}

/** 경과 시간으로 job 상태를 계산 — 타이머 없이 폴링만으로 진행이 보입니다. */
function projectJob(job: MockJob): Job {
  const elapsed = Date.now() - job.createdAt
  const duration = jobDuration()
  const sourceImageUrl = placeholderImage('원본', undefined, SOURCE_SIZE)
  /*
    어느 상태에서든 실립니다 — W-06 "다시 만들기"는 실패한 job 에서도 눌리기 때문입니다.

    시각 두 개는 PR #60(이슈 #41) 착지분입니다. 목의 «큐 구간»은 아래 1.5초라,
    `started_at` 은 그 뒤부터 값이 생깁니다 — 큐에 있는 동안 null 인 게 이 계약의
    핵심이고(FR-EDGE-02 판정 기준), 목이 처음부터 값을 주면 W-05 의 대기/처리 구분이
    브라우저에서 한 번도 갈라지지 않습니다.
  */
  /*
    `job:queued` — 워커가 집지 않아 **큐에 머무는** job.

    이 상태는 PR #60 이 만들어 낸 새 엣지입니다. 그전에는 시각이 아예 없어 대기와
    처리를 구분할 수단도 없었는데, 이제 `started_at: null` 이 «아직 시작 안 함»을
    분명히 말합니다. 화면이 그때 무엇을 할지(§3 판정 기준은 started_at, 그런데
    대기도 90초를 넘으면 «약 48초»가 거짓말이 됨)를 브라우저에서 밟아 보려면 목이
    이 상태를 만들 수 있어야 합니다.
  */
  const QUEUE_MS = scenario() === 'job:queued' ? Number.POSITIVE_INFINITY : INITIAL_QUEUE_MS
  const materials = {
    style_id: job.styleId,
    upload_id: job.uploadId,
    /*
      이슈 #101 2번 착지분 — 서버는 `source_image.pet_profile_id` 를 내려줍니다
      (app/routers/jobs.py). 목은 만들 때 받은 `pet_id` 를 그대로 기억해 두었다가
      돌려주는데, 그 사진에 강아지를 붙이는 경로가 목에서도 같기 때문입니다
      (`POST /v1/uploads` 의 pet_id · `POST /v1/pets`). 강아지를 지우면 이 값도
      null 로 떨어집니다(아래 DELETE /pets 핸들러) — 서버의 SET NULL 과 같은 모양.
    */
    pet_id: job.petId ?? null,
    /*
      PR #83 착지 예정분(이슈 #81). `style_id` 와 같은 자리에 두는 이유는 이 둘이
      **같은 성격의 값**이기 때문입니다 — job 을 다시 조립하는 재료입니다. 이게 없는
      동안 커스텀 job 의 «다시 만들기»는 문구를 만든 브라우저에서만 보였습니다.

      옛 저장분에는 `customPrompt` 가 없습니다(나중에 추가된 필드) — 그때는 프리셋
      job 과 구분할 방법이 없으니 `null`, 즉 서버가 «로그가 지워졌다»고 답한 것과 같은
      모양이 됩니다. 화면은 그 경우 문구 없는 재생성 대신 «다른 스타일»로 보냅니다.
    */
    custom_prompt: job.customPrompt ?? null,
    /*
      이슈 #127 → 백엔드 PR #139. W-06 «다시 만들기» 가 지난번 값을 되살리는 재료입니다.

      옛 저장분(`undefined`)은 `null` 로 떨어뜨립니다 — 빈 객체로 만들면 «고를 게 있는
      스타일인데 아무 값도 안 썼다» 는, 서버가 낼 수 없는 상태가 됩니다.
    */
    inputs: job.inputs ?? null,
    credit_cost: job.creditCost,
    queued_at: new Date(job.createdAt).toISOString(),
    started_at:
      elapsed >= QUEUE_MS ? new Date(job.createdAt + QUEUE_MS).toISOString() : null,
  }

  if (elapsed >= duration && Number.isFinite(QUEUE_MS)) {
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
      results: [{ index: 0, image_url: placeholderImage('결과', '#F9E5EC', RESULT_SIZE) }],
      error_code: null,
    }
  }

  if (elapsed < QUEUE_MS) {
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
  const progress = Math.floor(ratio * 100)
  const etaSeconds = Math.ceil((duration - elapsed) / 1000)

  /*
    재시도 사이의 큐 대기(job:retries). 상태만 `queued` 로 되돌리고 `started_at` 과
    진행률은 그대로 둡니다 — 워커가 되돌리는 것도 status 하나뿐이고(process_job),
    진행률을 0 으로 떨어뜨리면 서버 progress 가 단조 증가라는 W-05 의 전제를 목이
    깨뜨려 «되감기는 막대»를 없는 계약으로 만들어 냅니다.
  */
  if (scenario() === 'job:retries' && inRequeueGap(elapsed - QUEUE_MS)) {
    return {
      job_id: job.id,
      status: 'queued',
      ...materials,
      progress,
      eta_seconds: etaSeconds,
      status_message: '잠시 뒤 다시 시도할게요…',
      source_image_url: sourceImageUrl,
      results: null,
      error_code: null,
    }
  }

  return {
    job_id: job.id,
    status: 'processing',
    ...materials,
    progress,
    eta_seconds: etaSeconds,
    status_message: '레고 블록을 쌓는 중…',
    source_image_url: sourceImageUrl,
    results: null,
    error_code: null,
  }
}

// ---------------------------------------------------------------- 보관함 조립

/**
 * 한 페이지에 담는 개수. 시드(8건)보다 작아야 «더 보기»가 목 위에서 눌립니다.
 *
 * 실서버는 20 입니다(app/routers/library.py `.limit(21)`). 목이 일부러 작게 잡는 건
 * 페이지가 **하나로 끝나면 커서·월 병합이 목 위에서 한 번도 안 밟히기** 때문입니다 —
 * 시드를 21건으로 불리면 그리드가 화면 두 배가 되고, 그러느니 경계를 앞으로 당깁니다.
 * 프론트는 이 숫자를 모릅니다(커서는 불투명 값) 그래서 작아도 계약을 어기지 않습니다.
 */
const LIBRARY_PAGE_SIZE = 6

/**
 * 한 삭제 요청에 담기는 상한 (`DeleteLibraryRequest.ids: Field(max_length=100)`,
 * 백엔드 PR #157). 넘기면 pydantic 이 걸러 400 `VALIDATION_ERROR` 입니다.
 */
const LIBRARY_DELETE_LIMIT = 100

/** `uuid.UUID(...)` 가 받아 주는 범위. 서버가 파싱에 실패하면 400 입니다. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 *
 * 정렬은 서버의 `order_by("-created_at", "-id")` 를 그대로 옮깁니다. 같은 시각이 둘
 * 이상이면(시드는 8/2 가 두 건입니다) 순서가 흔들리는데, 커서가 **마지막 항목의 위치**
 * 로 다음 페이지를 정하므로 흔들리는 순간 항목이 겹치거나 사라집니다.
 */
function librarySorted(): LibraryItem[] {
  const fromJobs: LibraryItem[] = [...state.jobs.values()]
    .filter((job) => projectJob(job).status === 'succeeded')
    .map((job) => ({
      job_id: job.id,
      result_id: `${job.id}:0`,
      image_url: placeholderImage('결과', '#F9E5EC', RESULT_SIZE),
      // 옛 저장분에는 이 필드가 없습니다(나중에 추가된 필드).
      pet_id: job.petId ?? null,
      created_at: new Date(job.createdAt).toISOString(),
    }))

  return [...fromJobs, ...libraryItems].sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) ||
      b.result_id.localeCompare(a.result_id),
  )
}

/** 목록에 실제로 나가는 것 — 논리삭제분은 빠집니다. */
function libraryEntries(): LibraryItem[] {
  return librarySorted().filter((item) => !state.deletedResults.has(item.result_id))
}

/**
 * 이 job 의 결과가 **전부** 보관함에서 지워졌는지.
 *
 * 논리삭제는 `deleted_at` 을 찍는 것으로 끝나지 않고, 그 뒤로는 조회에서 빠지는 것이
 * 계약입니다(06-architecture §4 삭제 경로). 지금 서버는 `/jobs` 에서 그 컬럼을 안
 * 봐서 지운 사진이 그대로 열리지만(이슈 #152), 목이 그 결함까지 흉내 내면 «지우고
 * 나서 그 주소로 돌아온 사람» 을 화면에서 영영 못 밟습니다. 그래서 계약 쪽을 그립니다.
 *
 * `every` 인 이유: 삭제 단위는 결과이고 job 이 아닙니다. 지금은 1요청 1장이라(Q4)
 * 한 장뿐이지만, 결과가 여럿이 되면 «일부만 지운 job» 은 계속 열려야 합니다.
 */
function jobResultsDeleted(jobId: string): boolean {
  const seeded = libraryItems.filter((item) => item.job_id === jobId)
  const resultIds = seeded.length > 0 ? seeded.map((item) => item.result_id) : [`${jobId}:0`]
  return resultIds.every((id) => state.deletedResults.has(id))
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
    // 시드 항목은 보관함이 이미 `pet_id` 를 들고 있습니다(§3, 이슈 #33) — 같은 값입니다.
    pet_id: item.pet_id,
    /*
      시드는 «옛날에 만든 결과»라 무엇으로 만들었는지 기록이 남아 있지 않습니다.
      `style_id: null` 과 짝이 맞는 값은 «커스텀인데 문구를 모름» 하나뿐이라(#83 의
      로그 삭제 케이스와 같은 모양) W-06 이 재생성 버튼 대신 «이 사진으로 다른
      스타일»을 그립니다 — 보관함에서 연 결과의 실제 동선이 그쪽입니다.
    */
    custom_prompt: null,
    // 위와 같은 이유로 null 입니다. `style_id` 가 null 이면 서버도 `input_values` 를
    // 만들지 않으므로(app/routers/jobs.py), 이 둘이 함께 null 인 게 계약상 정합입니다.
    inputs: null,
    credit_cost: 1,
    // 시드는 이미 끝난 job 이라 두 시각이 같습니다 — 보관함에서 여는 결과의 경과는
    // 아무도 세지 않습니다(W-05 를 거치지 않음).
    queued_at: item.created_at,
    started_at: item.created_at,
    progress: 100,
    eta_seconds: 0,
    status_message: null,
    source_image_url: placeholderImage('원본', undefined, SOURCE_SIZE),
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
      // 실서버는 `Retry-After` 를 함께 내려줍니다(PR #21). 목이 빼먹으면 배너가 늘
      // "잠시 뒤"만 그려서, 시간을 말해 주는 쪽 문구가 검증되지 않습니다.
      return apiError(429, 'RATE_LIMITED', '게스트 발급 한도를 초과했습니다', {}, 900)
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
    /*
      신규 게스트는 `guest_trial` 로 **1 크레딧**을 받습니다(app/routers/auth.py
      `issue_guest_token`). 목이 이걸 빼먹는 동안에는 앞 계정의 잔액이 그대로 따라와서,
      «다른 사람이 됐다» 는 이 발급의 의미가 잔액에서만 안 지켜졌습니다. 탈퇴(#123)가
      그 차이를 정면으로 밟습니다 — 파기를 고지해 놓고 새 게스트 화면이 옛 잔액을
      그대로 말하면 목이 화면의 고지를 배신합니다.
    */
    state.credits.balance = 1
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
    // claim 과 같은 이유로 403 MEMBER_ONLY (PR #58) — 게스트 토큰은 멀쩡합니다.
    if (state.me.kind !== 'member') {
      return apiError(403, 'MEMBER_ONLY', '로그인이 필요합니다')
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

  /*
    액세스 재발급 (PR #57, 이슈 #47).

    Authorization 을 **읽지 않습니다** — 만료된 액세스 상태에서 부르는 엔드포인트라
    헤더가 불요이고(§3), 그래서 위 만료 가드도 이 요청은 그냥 통과시킵니다.

    회전을 실제로 구현하는 게 이 목의 요점입니다. 새 값을 주기만 하고 구 값을 살려
    두면 «이미 회전된 토큰 재사용 = 401» 이 브라우저에서 한 번도 밟히지 않고, 그
    401 이야말로 프론트가 SESSION_LOST 로 갈라져야 하는 지점입니다.
  */
  http.post(`${BASE}/auth/refresh`, async ({ request }) => {
    await delay(200)
    const { refresh_token } = (await request.json()) as { refresh_token?: string }
    /*
      `refresh:fail` — 회전이 막힌 회원. 다른 기기 로그인·30일 초과·이미 쓴 토큰이
      전부 같은 401 로 오므로(§3) 하나로 묶어 재현합니다. 시나리오 값이 하나뿐이라
      만료도 이 시나리오가 함께 겁니다(`expiredSession`) — 그래야 «만료 → 회전 시도 →
      실패 → 재로그인 안내» 한 줄이 브라우저에서 이어집니다.
    */
    if (scenario() === 'refresh:fail') {
      return apiError(401, 'UNAUTHORIZED', '다시 로그인해 주세요')
    }
    /*
      `refresh:429` — 공유 IP 에서 남이 태운 실패 버킷에 정상 사용자가 걸린 경우
      (이슈 #11 R3). 401 과 겉모습만 비슷하고 정반대 상태라 시나리오를 나눕니다 —
      토큰은 살아 있고 시간이 지나면 풀립니다. 이걸 목이 못 만들면 «갱신만 막힌 회원»
      을 브라우저에서 한 번도 못 밟고, 그 사이 화면들이 무엇을 보여 주는지도 모릅니다.
      만료는 `expiredSession` 이 함께 걸어 줍니다 — 만료가 있어야 회전을 시도합니다.
    */
    if (scenario() === 'refresh:429') {
      return apiError(429, 'RATE_LIMITED', '요청이 너무 많습니다', {}, 900)
    }
    if (!refresh_token || refresh_token !== state.refreshToken) {
      return apiError(401, 'UNAUTHORIZED', '다시 로그인해 주세요')
    }
    state.refreshToken = `mock-refresh.${crypto.randomUUID()}`
    persist()
    return HttpResponse.json({
      token: `mock-member-jwt.${crypto.randomUUID()}`,
      refresh_token: state.refreshToken,
    })
  }),

  /*
    회원이면 서버가 리프레시를 폐기합니다(PR #57) — 지운 뒤엔 그 값으로 회전할 수 없습니다.

    실서버는 여기서 `member.token_version` 도 올려 **발급된 액세스를 즉시 전부 무효화**
    합니다(백엔드 PR #119 · 이슈 #11 M6). 그건 흉내 내지 않습니다 — 아래 탈퇴 목과 같은
    이유로 이 목은 Authorization 을 계약 검증에 쓰지 않아서 «이후 호출이 전부 401» 을
    만들 수단이 없고, 프론트는 204 직후 새 게스트를 받으므로(api/queries.ts `useLogout`)
    그 401 창에 스스로 들어가지도 않습니다.

    그 무효화가 만드는 **진짜 위험은 로그아웃 직전에 띄워 둔 조회가 뒤늦게 401 로 돌아오는
    것**인데, 그건 목의 응답이 아니라 요청 사이의 순서라 여기서는 재현되지 않습니다.
    그래서 요청 계층에서 직접 세웁니다(api/client.test.ts).
  */
  http.post(`${BASE}/auth/logout`, () => {
    state.refreshToken = null
    persist()
    return new HttpResponse(null, { status: 204 })
  }),

  /*
    회원 탈퇴 (이슈 #123 · 백엔드 #22 → PR #120).

    **파기까지 흉내 냅니다.** 204 만 돌려주고 데이터를 남겨 두면, 탈퇴 화면이 «사진과
    결과물이 즉시 지워져요» 라고 고지한 직후 새 게스트 화면에 그대로 남아 있는 상태를
    목이 만들어 냅니다 — 화면 쪽 정리(캐시·초안)가 빠졌을 때 그 사실이 브라우저에서
    안 드러납니다. 실서버가 하는 일을 목도 해야 그 구멍이 보입니다.

    게스트 호출은 403 `MEMBER_ONLY` 입니다. 화면은 회원에게만 진입점을 그리므로 정상
    경로로는 닿지 않지만, 계약의 두 갈래 중 하나를 목이 낼 수 없으면 그 분기는 영영
    검증되지 않습니다(이 파일 상단 «한 코드의 두 얼굴» 과 같은 이유).

    토큰 무효화는 흉내 내지 않습니다 — 목은 Authorization 을 검사하지 않아서 «이후
    호출이 전부 401» 을 만들 수단이 없습니다. 프론트는 곧바로 `POST /auth/guest` 로
    새 게스트를 받으므로(api/queries.ts `useWithdraw`) 그 401 창에 실제로 들어가지도
    않습니다.
  */
  http.delete(`${BASE}/auth/me`, async () => {
    await delay(200)
    if (state.me.kind !== 'member') {
      return apiError(403, 'MEMBER_ONLY', '회원만 탈퇴할 수 있습니다')
    }

    state.credits.balance = 0
    state.jobs.clear()
    state.idempotency.clear()
    state.refreshToken = null
    petList.splice(0, petList.length)
    // 보관함 시드는 상수 배열이라 지우는 대신 «지운 결과» 로 표시합니다 — 목록 조립이
    // 이미 그 집합을 가려 냅니다(libraryFor).
    for (const item of libraryItems) state.deletedResults.add(item.result_id)
    persist()
    persistJobs()
    persistDeletedResults()
    return new HttpResponse(null, { status: 204 })
  }),

  // ------------------------------------------------------------ 스타일
  http.get(`${BASE}/styles`, async ({ request }) => {
    await delay(150)
    const url = new URL(request.url)
    const section = url.searchParams.get('section')
    const limit = Number(url.searchParams.get('limit')) || undefined

    // 기본은 **지금 실서버 그대로** — 시드가 썸네일을 채웁니다(PR #141, mocks/fixtures.ts).
    // 예시 이미지가 없는 스타일은 계약상 여전히 가능해서 시나리오로 남겨 뒀습니다.
    const catalog = scenario() === 'styles:no-images' ? styleCatalogNoImages : styleCatalog

    let sections = catalog.sections
    if (section === 'popular') {
      /*
        `popular` 은 **예약 키워드**입니다 (PR #58, 이슈 #53).

        저장된 섹션명과 매칭하는 게 아니라 public 전체에서 정렬 상위 N 을 뽑아
        «인기» 한 섹션으로 돌려줍니다. 목이 예전처럼 «첫 번째 섹션»을 주면 W-01 의
        인기 카드가 **한 섹션 안에서만** 뽑히므로, 실서버에서 다른 스타일이 오는데도
        목에서는 아무 문제가 안 보입니다. `count` 도 자른 뒤 길이여야 화면의
        "N개"가 실제로 그린 카드 수와 맞습니다.
      */
      const top = catalog.sections.flatMap((s) => s.styles).slice(0, limit ?? 12)
      return HttpResponse.json({
        sections: [{ name: '인기', count: top.length, styles: top }],
        total_count: catalog.total_count,
      })
    }
    if (section) sections = sections.filter((s) => s.name === section)

    if (limit) {
      sections = sections.map((s) => ({ ...s, styles: s.styles.slice(0, limit) }))
    }
    // total_count 는 필터와 무관하게 **전체 public 수**입니다(§3) — W-02 하단 "전체 N개".
    return HttpResponse.json({ sections, total_count: catalog.total_count })
  }),

  http.get(`${BASE}/styles/:styleId`, async ({ params }) => {
    await delay(120)
    // 상세의 예시는 카탈로그 썸네일과 **같은 `example_keys`** 에서 나오므로 같은
    // 시나리오를 봅니다 — 한쪽만 채우면 서버가 낼 수 없는 조합이 됩니다(fixtures.ts).
    const forced = scenario()
    const detail = styleDetailFor(
      Number(params.styleId),
      forced === 'styles:no-images' ? 'none' : forced === 'styles:rich' ? 'rich' : 'seeded',
    )
    if (!detail) return apiError(404, 'NOT_FOUND', '스타일을 찾을 수 없습니다')
    return HttpResponse.json(detail)
  }),

  // ------------------------------------------------------------ 업로드
  http.post(`${BASE}/uploads`, async () => {
    await delay(700) // 품질 체크가 도는 체감을 남깁니다.
    // §1 판정 코드 5개를 전부 만들 수 있어야 W-04 의 코드별 분기(FR-EDGE-06·07·08·09)를
    // 밟을 수 있습니다. 차단 2종은 `blocking_issue`, 나머지는 `warnings[]` 입니다.
    const uploads: Record<string, UploadResult> = {
      'upload:warn': uploadWarned,
      'upload:nodog': uploadNoDog,
      'upload:multi': uploadMultiSubject,
      'upload:face': uploadHumanFaceWarned,
      'upload:face-block': uploadHumanFaceBlocked,
      'upload:block': uploadBlocked,
    }
    // 차단도 HTTP 200 입니다(§1 코드 표) — 에러로 내리면 안 됩니다.
    return HttpResponse.json(uploads[scenario()] ?? uploadOk)
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
    // 응답은 `latest_upload_id` 없이 나갑니다 — 그 필드를 주는 건 목록뿐입니다
    // (app/routers/pets.py `PetResponse`). 목이 더 주면 화면이 목록 재조회 없이도
    // 스킵을 아는 척하게 되고, 실서버에서만 그 가정이 무너집니다.
    return HttpResponse.json(petSummary(pet), { status: 201 })
  }),

  // W-12 C 섹션(FR-W12-03). 목록 배열을 실제로 고쳐야 화면 갱신이 확인됩니다.
  http.patch(`${BASE}/pets/:petId`, async ({ params, request }) => {
    const pet = petList.find((item) => item.id === String(params.petId))
    if (!pet) return apiError(404, 'NOT_FOUND', '강아지를 찾을 수 없습니다')
    const { name } = (await request.json()) as { name: string }
    pet.name = name
    return HttpResponse.json(petSummary(pet))
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
      inputs?: Record<string, string>
    }
    /*
      비용은 **스타일마다 다릅니다**(§3 `credit_cost`) — 여기서 1 로 고정하면 목이
      계약을 대변하지 않습니다. W-03·W-04 는 `credit_cost` 를 그대로 버튼에 박으므로
      (노트4) 2 크레딧이라고 말해 놓고 1 만 빠지는 화면이 됩니다.

      더 중요한 건 402 를 못 밟는다는 점입니다. 잔액 1 · 2크레딧 스타일이 정확히
      §4 시나리오3 의 진입 조건인데, 비용이 항상 1 이면 잔액이 0 이 되기 전까지
      INSUFFICIENT_CREDIT 이 한 번도 나오지 않습니다.

      커스텀 프롬프트는 스타일과 무관하게 **서버 설정값**입니다 — `customPromptCost()`
      가 그 값의 유일한 출처고, `GET /v1/credits` 가 화면에 알려 주는 값도 같은
      함수에서 나옵니다. 둘을 따로 적으면 «2 크레딧» 이라고 말해 놓고 3 을 빼 가는
      목이 됩니다 — 정확히 이슈 #149 가 실서버에서 걱정하던 그 상태입니다.
    */
    const cost = body.custom_prompt
      ? customPromptCost()
      : (styleDetailFor(body.style_id ?? -1)?.credit_cost ?? 1)

    /*
      서버 입력 필터 (PR #60, FR-EDGE-13 (b) — `app/routers/jobs.py`).

      2중 방어의 두 번째 겹이라 화면 필터(app/promptFilter.ts)와 목록이 **일부러**
      다릅니다. 목이 이걸 빼면 화면 필터가 놓친 문장이 목에서는 그냥 만들어지고,
      실서버에서만 400 이 나는 차이가 QA 에서 안 보입니다. 서버 목록 그대로 옮겨
      두면 «화면은 통과, 서버는 거절» 조합을 브라우저에서 직접 밟을 수 있습니다
      (예: "털을 갈색으로 바꿔줘" — 화면 필터는 색+털을 보고 걸지만, "색깔만 바꿔줘"
      처럼 털 단어가 없으면 통과하고 서버가 잡습니다).

      차감 판정보다 **앞**입니다 — 서버도 차감 트랜잭션 전에 막으므로 크레딧이
      나가지 않습니다(UC-08 A1-a).
    */
    const normalized = body.custom_prompt?.trim().toLowerCase() ?? ''
    if (normalized && SERVER_PROMPT_BLOCKLIST.some((word) => normalized.includes(word))) {
      return apiError(400, 'VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
        reason: 'input_filter_blocked',
      })
    }

    /*
      스타일 입력 검증 (이슈 #114 · `app/routers/jobs.py` `_resolve_input_values`).

      화면도 같은 규칙으로 먼저 막지만(app/styleInputs.ts) 목이 이걸 빼면 **화면 필터를
      우회했을 때 무슨 일이 나는지**를 브라우저에서 밟을 수 없습니다 — 프리필 값이 규칙을
      어긴 채 남는 경로가 실제로 있어서(«입덕직캠» 이름 3자 제한) 그게 400 으로 끝나는지
      크레딧이 나가는지가 화면 설계의 전제입니다.

      차감보다 **앞**입니다 — 서버도 그렇고, 그래서 이 400 에는 크레딧이 나가지 않습니다.

      ---------------------------------------------------------------------------
      스키마에 없는 라벨은 **400 이 아니라 조용한 무시**입니다 (백엔드 PR #139).

      예전에는 400 `unknown_inputs` 였습니다. 지금 서버는 `logger.info` 로 적고 넘어가며
      생성을 계속합니다 — 즉 **크레딧이 나가고**, 사용자가 고른 값은 결과에 반영되지
      않습니다. 400 이던 시절과 손익이 정반대라, 목이 계속 400 을 내면 목에서만 실패하는
      경로가 생깁니다(그리고 «크레딧은 안 나간다» 는 화면 설계의 전제가 목에서만 참이 됩니다).

      서버가 로그를 남기듯 여기서도 콘솔에 적습니다. 조용히 버리면 목을 켠 채 브라우저를
      보는 동안 «내가 보낸 값이 왜 안 먹지» 를 추적할 단서가 아무 데도 안 남습니다.
    */
    const inputFields = styleDetailFor(body.style_id ?? -1)?.input_fields ?? []
    /*
      검증을 통과한 **최종 값**. 서버의 `_resolve_input_values` 반환값과 같은 것이고,
      `generation_job.input_values` 에 저장돼 나중에 job 응답의 `inputs` 로 나옵니다
      (백엔드 PR #139 · 이슈 #127).

      «보낸 값» 과 다른 지점이 둘입니다 — 안 보낸 칸에 `default` 가 있으면 그 값이
      **들어가고**, `default` 없는 `prefill` 칸은 **안 들어갑니다**(워커가 그때
      강아지 이름으로 채웁니다). 목이 이걸 그대로 흉내 내지 않으면 W-06 «다시 만들기»
      의 복원이 목에서만 완벽해집니다.

      `null` 은 «고를 게 없는 스타일 · 커스텀 job» 입니다. 빈 객체와 다릅니다.
    */
    let resolvedInputs: Record<string, string> | null = null
    if (inputFields.length > 0) {
      const labels = new Set(inputFields.map((field) => field.label))
      const unknown = Object.keys(body.inputs ?? {})
        .filter((label) => !labels.has(label))
        .sort()
      if (unknown.length > 0) {
        console.info('[mock] 스키마에 없는 입력 라벨을 무시합니다:', unknown)
      }
      resolvedInputs = {}
      for (const field of inputFields) {
        const value = (body.inputs?.[field.label] ?? '').trim()
        // 빈 값은 서버가 default 로 채웁니다 — 검증 대상이 아닙니다.
        if (!value) {
          if (field.default) resolvedInputs[field.label] = field.default
          continue
        }
        const reason =
          field.max_length && [...value].length > field.max_length
            ? 'max_length'
            : field.pattern && !new RegExp(`^(?:${field.pattern})$`, 'u').test(value)
              ? 'pattern'
              : field.type === 'choice' &&
                  !field.allow_custom &&
                  !(field.options ?? []).some((option) => option.value === value)
                ? 'not_in_options'
                : null
        if (reason) {
          return apiError(400, 'VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
            input: field.label,
            reason,
          })
        }
        // 서버도 `trim()` 한 값을 저장합니다 — 원문이 아니라 이 값이 워커에게 갑니다.
        resolvedInputs[field.label] = value
      }
    }

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
      // 서버는 `CustomPromptLog.raw_text` 에 **정규화 전 원문**을 남기고 응답에도 그걸
      // 그대로 싣습니다(PR #83 테스트가 `"  우주복을 입혀줘  "` 로 못 박음). 여기서
      // trim 하면 목만 다듬은 문구를 주게 되고, 화면이 그 차이를 못 밟습니다.
      customPrompt: body.custom_prompt,
      // 보낸 값이 아니라 위에서 판정한 최종 값입니다(서버 `_resolve_input_values`).
      inputs: resolvedInputs,
      styleId: body.style_id,
      uploadId: body.upload_id,
      petId: body.pet_id ?? null,
      /*
        `job:unknown-error` — 문서(§1)에 없는 코드로 실패하는 job.

        지어낸 상황이 아닙니다. `generation_job.error_code` 는 값을 제한하지 않는
        자유 텍스트라 워커가 새 사유를 하나 추가하면 그날로 프론트에 도착하고,
        백엔드 테스트가 이미 `PROVIDER_ERROR` 를 심어 둡니다. 화면이 그때 문구를
        모른다는 건 괜찮지만 화면째 죽는 건 다른 문제라(실측: FailurePanel 크래시),
        폴백이 살아 있는지를 목 위에서 계속 밟을 수 있어야 합니다.
      */
      forcedError:
        forced === 'job:fail'
          ? 'GENERATION_FAILED'
          : forced === 'job:safety'
            ? 'SAFETY_BLOCKED'
            : forced === 'job:retries'
              ? 'MAX_RETRIES_EXCEEDED'
              : forced === 'job:unknown-error'
                ? 'PROVIDER_ERROR'
                : null,
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

    /*
      보관함에서 지운 결과 (jobResultsDeleted 참고).

      **404 가 아니라 빈 `results` 로 200 입니다.** 여기는 오랫동안 404 였는데, 그건
      «논리삭제되면 이 주소도 닫힌다» 는 목의 추측이었습니다. 백엔드가 이슈 #152
      코멘트에서 계약을 확정했습니다 — 조회는 `results: []` 로 200, `share` 만 404
      (PR #157). job 자체는 살아 있고 사라지는 건 결과물뿐입니다.

      그 차이가 화면을 가릅니다. 404 면 «열 수 없는 결과» 한 장으로 끝나지만, 200 이면
      `style_id`·`upload_id`·`inputs` 가 손에 들어와 **같은 설정으로 다시 만들 수**
      있습니다(screens/W06Result.tsx `RemovedResultPanel`). 목이 404 를 주는 동안은
      그 화면을 브라우저에서 한 번도 못 밟습니다.
    */
    const removed = jobResultsDeleted(String(params.jobId))

    if (!job) {
      // 보관함 시드에서 열린 과거 결과. 없으면 목록의 모든 항목이 404 로 이어져
      // 보관함 → 결과 상세라는 이 화면의 존재 이유(FR-W09-03)를 못 밟습니다.
      const seeded = seededJob(String(params.jobId))
      if (seeded) return HttpResponse.json(removed ? { ...seeded, results: [] } : seeded)
      return apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')
    }

    const projected = projectJob(job)
    if (removed) return HttpResponse.json({ ...projected, results: [] })
    // 실패 확정 시 크레딧 자동 반환(§4 시나리오2 5단계) — 1회만.
    //
    // 반환 표시는 `refunded` 입니다. 예전에는 `creditCost` 를 0 으로 만들어 겸했는데,
    // 그 값이 이제 응답의 `credit_cost` 라(PR #83) 실패한 job 이 «0 크레딧짜리»로
    // 보이게 됩니다 — 서버는 반환해도 이 컬럼을 줄이지 않습니다(app/worker.py `_refund`).
    // 옛 저장분(`refunded` 없음, `creditCost === 0`)은 이미 돌려준 것으로 봅니다.
    if (projected.status === 'failed' && !(job.refunded ?? job.creditCost === 0)) {
      state.credits.balance += job.creditCost
      job.refunded = true
      persist()
      // 돌려줬다는 사실까지 남겨야 리로드 후 같은 job 이 또 반환하지 않습니다.
      persistJobs()
    }
    return HttpResponse.json(projected)
  }),

  /*
    PR #73 착지분. 그전까지 이 목은 «공유 {jobId}» 라고 적힌 **별도 이미지**를 항상 200
    으로 돌려줬는데, 서버는 정반대입니다 — 공유용 사본을 만들지 않고 결과 JPEG 의
    `public_url` 을 그대로 돌려줍니다(app/routers/jobs.py 238행과 276행이 같은 함수).
    목이 다른 그림을 주는 동안 브라우저에는 «공유하면 새 이미지가 생긴다»는, 계약에
    없는 화면이 떠 있었습니다. 그래서 결과 이미지를 **그대로** 돌려줍니다.

    404 도 마찬가지로 목이 만들 수 없던 상태였습니다. 서버는 없는 job·남의 job·비UUID
    뿐 아니라 **결과가 없는 job**(queued·processing·failed)에도 404 를 줍니다. 아래
    조회가 그 넷을 한 번에 만듭니다 — 결과가 없으면 `results[0]` 이 비니까요.
  */
  http.post(`${BASE}/jobs/:jobId/share`, async ({ params, request }) => {
    await delay(400)
    const jobId = String(params.jobId)
    const notFound = () => apiError(404, 'NOT_FOUND', '작업을 찾을 수 없습니다')

    // `/jobs/{id}` 와 같은 소유권 판정 — 재발급된 게스트에게 이 job 은 남의 것입니다(§3).
    if (expiredSession(request) === 'reissued') return notFound()

    /*
      지운 결과는 **여기서만 404 입니다.** 조회(`GET /jobs/{id}`)는 빈 `results` 로
      200 을 주는데 share 는 404 로 갈라집니다 — 백엔드가 이슈 #152 코멘트에서 그렇게
      확정했고, 서버 코드도 두 자리가 다릅니다(`app/routers/jobs.py` — 조회는 필터로
      결과를 비우고, share 는 결과가 없으면 `_not_found()`).

      목이 이 갈래를 안 흉내 내면 «화면은 지워진 걸 아는데 공유 버튼만 살아 있는»
      상태를 못 밟습니다. 그건 W-06 이 막아야 하는 바로 그 화면입니다.
    */
    const own = state.jobs.get(jobId)
    const job = own ? projectJob(own) : seededJob(jobId)
    const result = jobResultsDeleted(jobId) ? undefined : job?.results?.[0]
    if (!result) return notFound()

    return HttpResponse.json({ share_image_url: result.image_url })
  }),

  // ------------------------------------------------------------ 계산기 연결
  /*
    §3 은 이 엔드포인트의 응답을 **세 개**(정상 · 믹스견 폴백 · 완전 실패) 보여 주는데,
    상수 하나를 돌려주면 그중 정상만 존재하게 됩니다. 그러면 `api/calculatorLink.ts` 가
    FR-EDGE-10/11 을 위해 갈라 둔 문구가 W-06 배너에서도 W-07 화면에서도 안 나옵니다.

    무엇을 돌려줄지는 서버가 지어내는 게 아니라 **업로드가 추정한 견종**에서 나옵니다
    (`UploadResult.breed_estimate`). 그래서 job → upload → 견종으로 따라갑니다 —
    "강아지를 못 찾은 사진"(upload:nodog)이 결과 화면 출구까지 어떻게 이어지는지가
    이 경로에서만 보입니다.
  */
  http.get(`${BASE}/calculator-link`, async ({ request }) => {
    await delay(120)
    const query_ = new URL(request.url).searchParams
    const jobId = query_.get('job_id')
    const job = jobId ? state.jobs.get(jobId) : null
    // 두 진입이 있습니다(§2): 결과에서 오면 `job_id`, 보관함 강아지 필터에서 오면 `pet_id`.
    const petId = query_.get('pet_id') ?? job?.petId ?? null
    // 펫 진입(W-09 → W-07)과 시드 job 은 업로드를 되짚을 수 없어 정상 케이스로 둡니다.
    const breed = job ? breedForUpload(job.uploadId) : uploadOk.breed_estimate

    /*
      추정 라벨을 계산기 40종에 맞춰 봅니다(PR #122 · `calculatorBreeds.ts`). 라벨이
      비어 오는 일이 실제로 있고(PR #59 — 비전이 확신하지 못하면 필드가 빈 채로 옵니다),
      그때가 FR-EDGE-10 이 말하는 «세 필드 모두 null + URL 에서 breed 파라미터 생략»
      입니다. 라벨이 있는데 목록 밖이면 믹스견으로 떨어집니다(FR-EDGE-11).

      서버는 여기서 **펫 프로필 기입값(`breed_label`)을 먼저** 봅니다. 그 칸을 채우는
      API 가 아직 없어(`POST /v1/pets` 에 견종 필드 없음) 오늘은 늘 비어 있고, 따라서
      후보는 언제나 비전 추정입니다 — 화면이 «사진에서» 라고 말해도 되는 근거입니다.
      펫에 견종을 받는 날 이 전제와 문구가 함께 바뀝니다.
    */
    const matched = calculatorBreed(breed?.label)
    const breedCode = matched?.name ?? null
    const size = matched?.size ?? null
    /*
      이름은 **저장된 강아지가 있을 때만** 붙습니다. 상수로 넣어 두면 펫을 고르지 않고
      만든 결과에도 «콩이는 하루 몇 g까지…»가 떠서, 배너가 남의 강아지 이름을 말합니다.
      그러면 `calculatorLink.ts` 가 이름 없는 경우를 위해 준비한 «우리 아이는» 도 영영
      안 나옵니다 — 게스트 첫 방문이 정확히 그 경우입니다.
    */
    const petName = petList.find((pet) => pet.id === petId)?.name ?? null
    // §3 예시가 한글을 인코딩하지 않은 채로 보여 주므로 목도 같은 모양을 냅니다.
    // 견종을 모르면 breed·size 파라미터 자체가 빠집니다(FR-EDGE-10).
    const query = [
      ...(petName ? [`name=${petName}`] : []),
      ...(breedCode ? [`breed=${breedCode}`, `size=${size}`] : []),
      'utm_source=nutti_playground',
      'utm_medium=referral',
      'utm_campaign=calculator_handoff',
    ].join('&')

    return HttpResponse.json({
      // 계산기에 코드 체계가 없어 `breed_code` = `breed_label` = 한글 견종명입니다(Q9).
      breed_code: breedCode,
      breed_label: breedCode,
      size_label: size,
      // 서버가 UTM 까지 붙여 완성해 내려주는 값입니다(FR-W07-03) — 프론트는 가공하지 않습니다.
      calculator_url: `https://nutti.co.kr/calculator.html?${query}`,
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
      보관함은 **회원 기능**이라 게스트에게는 목록이 아니라 403 `MEMBER_ONLY` 가
      갑니다(app/routers/library.py, 백엔드 PR #156).

      이 목은 오래 게스트에게도 목록을 줬습니다. 구현이 열려 있는 동안 목이 서버를
      앞지르지 않게 둔 것이었는데(#142·#144 가 그 반대로 났던 사고), 서버가 착지했으니
      이제 목이 서버를 따라갑니다. 그전까지 W-09 의 `MemberOnlyNotice` 는 테스트에서만
      존재하고 브라우저에서는 한 번도 안 뜨는 화면이었습니다.

      재발급 직후(`expiredSession === 'reissued'`)도 여기서는 따로 갈리지 않습니다 —
      재발급된 세션은 새 **게스트**라 같은 403 입니다. 화면은 리셋 안내를 위에, 로그인
      안내를 목록 자리에 함께 답니다(W09Library). 그전에 여기 있던 «200 + 빈 목록» 은
      회원 전용이 아니던 시절의 추측이었고, 그 경로로는 «아직 보관된 사진이 없어요» 가
      떠서 사고가 침묵으로 덮였습니다.
    */
    if (state.me.kind !== 'member') {
      return apiError(403, 'MEMBER_ONLY', '로그인이 필요합니다')
    }

    const url = new URL(request.url)
    const petId = url.searchParams.get('pet_id')
    const cursor = url.searchParams.get('cursor')

    // 서버는 `uuid.UUID(pet_id)` 로 파싱합니다 — 형식이 아니면 빈 목록이 아니라 400 입니다.
    // (없는 펫·지워진 펫은 형식이 맞으므로 그대로 빈 목록입니다. 이슈 #33)
    if (petId !== null && !UUID_RE.test(petId)) {
      return apiError(400, 'VALIDATION_ERROR', '요청 형식이 올바르지 않습니다')
    }

    /*
      커서는 오프셋이 아니라 **직전 페이지 마지막 항목의 `result_id`** 입니다
      (백엔드 PR #156 — keyset). 오프셋으로 흉내 내던 동안 목에는 실서버에 없는 버그가
      있었습니다: 1페이지에서 한 장을 지우고 «더 보기» 를 누르면 뒤가 한 칸 당겨져
      **한 장이 통째로 건너뛰어집니다.**

      그래서 커서 항목은 삭제분까지 포함한 목록(`librarySorted`)에서 찾습니다 — 서버도
      커서 스코프에서 `deleted_at` 을 뺍니다("1페이지 마지막을 지운 뒤 2페이지를
      요청해도 커서가 유효해야 한다"). 스코프 밖의 커서는 400 입니다.
    */
    const inScope = (item: LibraryItem) => !petId || item.pet_id === petId
    const anchor = cursor
      ? librarySorted().find((item) => item.result_id === cursor && inScope(item))
      : undefined
    if (cursor && !anchor) {
      return apiError(400, 'VALIDATION_ERROR', '요청 형식이 올바르지 않습니다')
    }

    const filtered = libraryEntries().filter(inScope)
    const after = anchor
      ? filtered.findIndex(
          (item) =>
            Date.parse(item.created_at) < Date.parse(anchor.created_at) ||
            (item.created_at === anchor.created_at && item.result_id < anchor.result_id),
        )
      : 0
    const start = after === -1 ? filtered.length : after
    const slice = filtered.slice(start, start + LIBRARY_PAGE_SIZE)

    const months: LibraryMonth[] = []
    for (const item of slice) {
      const label = monthLabel(item.created_at)
      const last = months.at(-1)
      if (last?.label === label) last.items.push(item)
      else months.push({ label, items: [item] })
    }

    return HttpResponse.json({
      months,
      next_cursor:
        filtered.length > start + LIBRARY_PAGE_SIZE ? (slice.at(-1)?.result_id ?? null) : null,
    })
  }),

  http.delete(`${BASE}/library`, async ({ request }) => {
    await delay(200)
    // 목록과 같은 문(門)입니다 — 게스트는 보관함에 결과를 두지 않으므로 지울 것도 없습니다.
    if (state.me.kind !== 'member') {
      return apiError(403, 'MEMBER_ONLY', '로그인이 필요합니다')
    }

    const { ids } = (await request.json()) as { ids: string[] }

    /*
      한 요청 100개 상한. 화면이 그보다 많이 고를 수 있으면 «삭제하지 못했어요 · 다시
      시도» 로 끝나는데 다시 눌러도 영영 같은 답입니다 — W-09 가 고르는 단계에서 막는
      근거가 이것이고, 그 상한이 실제로 존재한다는 걸 목이 보여야 밟힙니다.
    */
    if (ids.length > LIBRARY_DELETE_LIMIT) {
      return apiError(400, 'VALIDATION_ERROR', '요청 형식이 올바르지 않습니다', {
        ids: `최대 ${LIBRARY_DELETE_LIMIT}개`,
      })
    }

    // 남의 것·없는 id 는 서버가 조용히 무시합니다(멱등) — 목도 표시만 하고 끝냅니다.
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
      return HttpResponse.json({
        balance: 1,
        earn_actions: guestAware(state.credits.earn_actions),
        custom_prompt_credit_cost: customPromptCost(),
      })
    }
    applyEmptyScenario()
    return HttpResponse.json({
      ...state.credits,
      earn_actions: guestAware(state.credits.earn_actions),
      // 픽스처의 2 를 그대로 흘리지 않습니다 — 시나리오가 «3 인 서버» 를 만들면
      // 차감액(POST /v1/jobs)과 고지액이 갈라집니다.
      custom_prompt_credit_cost: customPromptCost(),
    })
  }),

  http.post(`${BASE}/credits/claim`, async ({ request }) => {
    await delay(250)
    const { action } = (await request.json()) as { action: string }
    const row = state.credits.earn_actions.find((a) => a.action === action)

    /*
      게스트 거절 — 이제 **403 MEMBER_ONLY** 입니다 (PR #58, 이슈 #52 확정분).

      401 이던 시절에는 이 한 줄이 게스트의 job·보관함·잔액을 통째로 날렸습니다.
      화면은 401 을 «내 토큰이 죽었다»로 읽고 세션을 지우니까요. 코드가 갈린 지금
      목이 옛 401 을 계속 주면, 프론트가 새로 붙인 분기(로그인 시트)가 브라우저에서
      한 번도 안 밟히고 대신 사라진 예외 처리에 기대게 됩니다.
    */
    if (state.me.kind !== 'member') {
      return apiError(403, 'MEMBER_ONLY', '로그인이 필요합니다')
    }

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
