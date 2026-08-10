/**
 * 단일 API 클라이언트. docs/05-api-spec.md §1 공통 규약을 여기 한 곳에만 구현합니다.
 *
 * 화면 코드는 fetch 를 직접 부르지 않습니다 — 토큰 부착, 에러 포맷 파싱,
 * 게스트 토큰 재발급이 전부 이 파일에 모여 있어야 규약이 한 군데서 관리됩니다.
 */

import type { ApiErrorBody, ErrorCode, GuestSession } from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/v1'
const TOKEN_STORAGE_KEY = 'nutti.session.token'
const KIND_STORAGE_KEY = 'nutti.session.kind'

// ---------------------------------------------------------------- 에러

/** 4xx/5xx 응답을 §1 포맷으로 파싱한 결과. 200 응답의 blocking_issue 는 이게 아닙니다. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly detail: unknown
  /**
   * 429 응답의 `Retry-After`(초). 인증·게스트 발급 레이트리밋이 함께 내려줍니다(§3 인증).
   * 없으면 null — 헤더가 없는 429 도 있으므로 화면은 값이 없을 때를 항상 감안해야 합니다.
   */
  readonly retryAfter: number | null

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    detail?: unknown,
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
    this.retryAfter = retryAfter
  }
}

/** 네트워크 단절·CORS 차단처럼 응답 자체를 못 받은 경우. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('네트워크에 연결할 수 없습니다')
    this.name = 'NetworkError'
    this.cause = cause
  }
}

export function isApiError(e: unknown, code?: ErrorCode): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code)
}

// ---------------------------------------------------------------- 세션 저장소

/**
 * 게스트·회원이 같은 JWT 형식을 쓰므로(§1) 저장소도 하나입니다.
 * 로그인 성공 시 setSession 으로 회원 토큰을 덮어씁니다(§4 시나리오1 5단계).
 */
export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  },
  get kind(): 'guest' | 'member' | null {
    return localStorage.getItem(KIND_STORAGE_KEY) as 'guest' | 'member' | null
  },
  set(token: string, kind: 'guest' | 'member') {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
    localStorage.setItem(KIND_STORAGE_KEY, kind)
  },
  clear() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(KIND_STORAGE_KEY)
  },
}

/**
 * 게스트 토큰이 만료돼 새 게스트로 재발급된 순간 발행됩니다.
 *
 * 재발급은 곧 **다른 member_id** 이므로 이전 job·업로드·크레딧에 더는 접근할 수
 * 없습니다. Q7("URL 보존 + 재방문 시 복원")이 게스트에게는 이 지점에서 깨지므로
 * (이슈 #5) 화면은 이 이벤트를 받아 사용자에게 알려야 합니다 — 조용히 넘기면
 * 결과가 사라진 이유를 사용자가 알 수 없습니다.
 */
export const GUEST_SESSION_RESET_EVENT = 'nutti:guest-session-reset'

/**
 * 재발급으로 풀리지 않는 401(UNAUTHORIZED)이 왔을 때 발행됩니다.
 *
 * 백엔드는 만료(TOKEN_EXPIRED)와 그 외 무효를 구분해서 내려줍니다(app/auth.py). 병합된
 * 게스트 토큰·kind 불일치·위조는 전부 UNAUTHORIZED 이고, 이건 새 토큰을 받아도 같은
 * 결과가 아니라 **다른 사람이 되는 것**이라 자동 재발급 대상이 아닙니다. 화면이 사용자
 * 의사를 물어야 하므로 여기서는 알리기만 합니다.
 */
export const SESSION_LOST_EVENT = 'nutti:session-lost'

/**
 * 게스트 발급이 429 로 막혔을 때 발행됩니다.
 *
 * 서버는 IP 당 시간당 발급 횟수를 제한합니다(app/routers/auth.py `_check_guest_rate_limit`).
 * 막히면 앱은 토큰 없이 뜨고 이후 모든 요청이 401 이므로, 조용히 넘기면 사용자는 전부
 * 고장난 화면만 보게 됩니다.
 *
 * `detail.retryAfter` 는 429 의 `Retry-After`(초, PR #21). 없으면 null 입니다 — 언제
 * 풀리는지 말해 줄 수 있으면 "잠시 뒤"보다 훨씬 나은 안내가 됩니다.
 */
export const GUEST_RATE_LIMITED_EVENT = 'nutti:guest-rate-limited'

export interface GuestRateLimitedDetail {
  retryAfter: number | null
}

// ---------------------------------------------------------------- 요청

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** JSON 본문. FormData 를 보낼 때는 body 대신 formData 를 씁니다. */
  json?: unknown
  formData?: FormData
  query?: Record<string, string | number | null | undefined>
  /** 생성 계열 POST 전용(§1). 값 관리는 api/idempotency.ts 참고. */
  idempotencyKey?: string
  signal?: AbortSignal
  /** 내부용 — 토큰 재발급 후 재시도가 무한 반복되지 않도록 하는 플래그. */
  _retried?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', json, formData, query, idempotencyKey, signal } = options

  const headers: Record<string, string> = {}
  const token = session.token
  /*
    kind 를 **보낼 때** 찍어 둡니다.

    401 을 받은 뒤에 `session.kind` 를 읽으면 안 됩니다 — 같은 화면이 네 갈래로 동시에
    요청을 보내고(크레딧·me·펫·목록) 만료된 세션에서는 넷이 함께 401 로 돌아옵니다.
    먼저 도착한 하나가 재발급을 시작하며 `session.clear()` 를 부르는 순간 kind 는
    null 이 되고, 그 찰나에 판정하는 나머지는 «게스트가 아니다»가 되어 재발급 경로를
    통째로 건너뜁니다. 그래서 크레딧은 복구됐는데 보관함만 «토큰이 만료되었습니다»로
    남는, 화면마다 결과가 다른 상태가 나옵니다.
  */
  const kind = session.kind
  if (token) headers.Authorization = `Bearer ${token}`
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  // FormData 는 boundary 를 브라우저가 붙여야 하므로 Content-Type 을 직접 넣지 않습니다.
  if (json !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: formData ?? (json !== undefined ? JSON.stringify(json) : undefined),
      signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError(cause)
  }

  if (response.status === 204) return undefined as T

  if (!response.ok) {
    const parsed = await parseErrorBody(response)

    // §1: 게스트는 재발급, 회원은 재로그인. 재발급 후 원요청을 1회만 재시도합니다.
    if (parsed.code === 'TOKEN_EXPIRED' && !options._retried && kind === 'guest') {
      await reissueGuestSession()
      return request<T>(path, { ...options, _retried: true })
    }

    // 만료가 아닌 401 은 재발급으로 풀리지 않습니다. 서버가 거절한 토큰을 들고 있으면
    // 이후 모든 요청이 같은 401 이므로 지우고, 다음 행동은 화면이 사용자에게 묻습니다.
    if (parsed.code === 'UNAUTHORIZED' && token && !isOAuthPath(path)) {
      session.clear()
      window.dispatchEvent(new CustomEvent(SESSION_LOST_EVENT))
    }
    throw parsed
  }

  return (await response.json()) as T
}

/**
 * 여기서의 401 은 "내 토큰이 죽었다"가 아니라서 세션을 지우면 안 되는 경로입니다.
 *
 * - `/auth/{provider}/callback`: state 검증 실패(재사용·만료·주체 불일치, app/routers/auth.py).
 *   로그인 한 번 실패했다고 게스트 자산까지 버리면 안 됩니다.
 * - `/auth/cafe24/authorize`: 게스트가 회원 전용 엔드포인트를 부른 경우 — 권한 부족이지
 *   토큰이 무효라는 뜻이 아닙니다(§3 인증).
 *
 * 반대로 register/login/소셜 authorize 의 401 은 게스트 토큰 자체가 거절된 것이라
 * 예외가 아닙니다(회원 토큰이면 401 이 아니라 409 ALREADY_MEMBER 로 옵니다).
 */
function isOAuthPath(path: string): boolean {
  if (!path.startsWith('/auth/')) return false
  return path.endsWith('/callback') || path === '/auth/cafe24/authorize'
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(response)
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>
    const error = body.error
    if (error?.code) {
      return new ApiError(error.code, error.message ?? '', response.status, error.detail, retryAfter)
    }
  } catch {
    // 본문이 JSON 이 아닌 경우(프록시 502 등)는 아래 폴백으로 떨어집니다.
  }
  return new ApiError(
    'HTTP_ERROR',
    `요청이 실패했습니다 (HTTP ${response.status})`,
    response.status,
    undefined,
    retryAfter,
  )
}

/**
 * 만료된 게스트 토큰을 새로 발급받습니다.
 *
 * 주의: 이건 복구가 아니라 **새 게스트 생성**입니다. 이전 자산은 되찾을 수 없습니다.
 *
 * 동시에 여러 번 불려도 발급은 **한 번**입니다. 화면 하나가 네 갈래로 요청을 보내므로
 * 그대로 두면 만료된 세션으로 진입할 때마다 게스트가 네 명 생기고, 앞의 셋은 태어나자
 * 마자 버려집니다. 낭비로 끝나지 않는 이유는 발급이 **IP 당 시간당 30회**로 제한되기
 * 때문입니다(`GUEST_RATE_LIMIT_PER_HOUR`) — 한 번의 방문이 한도를 네 칸씩 태우면 몇
 * 번 만에 429 가 되고, 그때는 토큰을 아예 못 받아 앱 전체가 멈춥니다.
 */
let reissueInFlight: Promise<void> | null = null

function reissueGuestSession(): Promise<void> {
  reissueInFlight ??= (async () => {
    try {
      session.clear()
      const fresh = await issueGuestSession()
      session.set(fresh.token, 'guest')
      window.dispatchEvent(new CustomEvent(GUEST_SESSION_RESET_EVENT))
    } finally {
      // 성공이든 실패든 비웁니다. 실패한 프라미스를 붙들고 있으면 이후 모든 재발급이
      // 그 실패를 되돌려받아, 한 번의 네트워크 단절이 세션을 영구히 못 고치게 만듭니다.
      reissueInFlight = null
    }
  })()
  return reissueInFlight
}

/**
 * 게스트 발급 1회. 429 는 삼키지 않고 알린 뒤 그대로 던집니다 — 여기서 재시도하면
 * 서버의 시간당 카운터만 더 태워서 잠긴 시간이 길어집니다.
 */
async function issueGuestSession(): Promise<GuestSession> {
  try {
    return await request<GuestSession>('/auth/guest', { method: 'POST', _retried: true })
  } catch (error) {
    if (isApiError(error, 'RATE_LIMITED')) {
      window.dispatchEvent(
        new CustomEvent<GuestRateLimitedDetail>(GUEST_RATE_LIMITED_EVENT, {
          detail: { retryAfter: error.retryAfter },
        }),
      )
    }
    throw error
  }
}

/**
 * 앱 진입 시 1회 호출. 토큰이 없으면 게스트로 시작합니다(§4 시나리오1 1단계).
 * 이미 토큰이 있으면 아무것도 하지 않습니다 — 회원 토큰을 게스트로 덮어쓰면 안 됩니다.
 */
export async function ensureSession(): Promise<void> {
  if (session.token) return
  const guest = await issueGuestSession()
  session.set(guest.token, 'guest')
}
