/**
 * 단일 API 클라이언트. docs/05-api-spec.md §1 공통 규약을 여기 한 곳에만 구현합니다.
 *
 * 화면 코드는 fetch 를 직접 부르지 않습니다 — 토큰 부착, 에러 포맷 파싱,
 * 게스트 토큰 재발급이 전부 이 파일에 모여 있어야 규약이 한 군데서 관리됩니다.
 */

import type { ApiErrorBody, ErrorCode, GuestSession, MemberRefresh } from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/v1'
const TOKEN_STORAGE_KEY = 'nutti.session.token'
const KIND_STORAGE_KEY = 'nutti.session.kind'
const REFRESH_STORAGE_KEY = 'nutti.session.refresh'

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
 *
 * 회원만 리프레시 토큰을 하나 더 답니다(PR #57) — 액세스는 1h, 리프레시는 30일이라
 * 회원 세션의 실제 수명은 이 값이 결정합니다. 게스트는 30일 JWT + 재발급이라 없습니다.
 */
export const session = {
  get token(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  },
  get kind(): 'guest' | 'member' | null {
    return localStorage.getItem(KIND_STORAGE_KEY) as 'guest' | 'member' | null
  },
  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_STORAGE_KEY)
  },
  /**
   * `refreshToken` 을 생략하면 **지웁니다**. 게스트 발급이 회원 리프레시를 남겨 두면
   * 다음 만료에서 남의 세션으로 되살아나는 셈이라, 기본값이 삭제여야 안전합니다.
   */
  set(token: string, kind: 'guest' | 'member', refreshToken?: string | null) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
    localStorage.setItem(KIND_STORAGE_KEY, kind)
    if (refreshToken) localStorage.setItem(REFRESH_STORAGE_KEY, refreshToken)
    else localStorage.removeItem(REFRESH_STORAGE_KEY)
  },
  clear() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(KIND_STORAGE_KEY)
    localStorage.removeItem(REFRESH_STORAGE_KEY)
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
 *
 * 회원의 리프레시 회전이 401 로 실패한 경우도 여기로 옵니다(PR #57). 게스트와 달리
 * 회원은 «새로 시작»이 아니라 **재로그인**이 답이라, 무엇이 끊겼는지 `detail.kind` 로
 * 함께 알립니다 — 안내 문구가 갈리기 때문입니다.
 */
export const SESSION_LOST_EVENT = 'nutti:session-lost'

export interface SessionLostDetail {
  /** 끊긴 세션의 종류. 판정 시점에 저장소는 이미 비어 있으므로 여기 실어 보냅니다. */
  kind: 'guest' | 'member' | null
}

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

/**
 * 회원의 리프레시 회전이 **429** 로 막혔을 때 발행됩니다 (이슈 #11 R3).
 *
 * 서버의 `/refresh` 실패 버킷은 IP 단위라, 사무실 NAT·CGNAT 처럼 주소를 나눠 쓰는
 * 곳에서는 오작동 클라이언트 하나가 한도를 태우면 같은 IP 의 **정상 사용자 갱신까지**
 * 최대 1시간 막힙니다. 백엔드가 잔여 위험으로 수용한 성질이라(#11 R3) 화면이 흡수합니다.
 *
 * 401 과 정반대로 다뤄야 하는 상태입니다 — 토큰은 멀쩡하고 시간이 지나면 그대로
 * 풀립니다. 그래서 세션을 버리지 않고(재로그인은 필요 없는데 시키는 꼴이 됩니다),
 * 대신 «지금은 안 되고 언제 풀린다»를 말해 줍니다. 알리지 않으면 화면마다 «토큰이
 * 만료되었습니다» 만 뜨고, 사용자는 같은 실패를 부르는 «다시 시도» 를 1시간 동안
 * 반복하게 됩니다.
 *
 * `detail.throttled: false` 는 회전이 다시 성공했다는 뜻입니다 — 막힘이 저절로 풀린
 * 경우가 정상 경로라, 배너를 내리는 신호가 없으면 멀쩡해진 앱에 경고만 남습니다.
 */
export const MEMBER_REFRESH_THROTTLED_EVENT = 'nutti:member-refresh-throttled'

export interface MemberRefreshThrottledDetail {
  throttled: boolean
  /** 429 의 `Retry-After`(초). 없으면 null — 화면은 "잠시 뒤"로 폴백합니다. */
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
  /**
   * Authorization 헤더를 붙이지 않습니다.
   *
   * `POST /v1/auth/refresh` 전용입니다 — 이 엔드포인트는 **만료된 액세스 상태에서**
   * 부르는 곳이라 헤더가 불요이고(§3), 굳이 죽은 토큰을 실어 보내면 그걸 걸러내는
   * 인증 계층에 먼저 막혀 회전 자체를 못 합니다.
   */
  skipAuth?: boolean
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
  const { method = 'GET', json, formData, query, idempotencyKey, signal, skipAuth } = options

  const headers: Record<string, string> = {}
  const token = skipAuth ? null : session.token
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
  /*
    리프레시 토큰도 **보낼 때** 찍어 둡니다.

    이건 kind 와 같은 이유에 더해 회전 때문에 더 중요합니다. 네 갈래가 함께 401 로
    돌아와 먼저 온 하나가 회전을 끝내면 저장소의 리프레시는 이미 새 값입니다. 그때
    저장소를 읽어 회전을 또 시도하는 건 **방금 발급받은 유효한 토큰을 한 번 더
    태우는 것**이고, 서버는 회원당 한 개만 살려 두므로 마지막 하나를 뺀 나머지가
    401 이 됩니다 — 로그인 직후 멀쩡한 세션이 스스로 끊깁니다.
  */
  const sentRefresh = session.refreshToken
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

    // §1: 게스트는 재발급, 회원은 리프레시 회전(PR #57). 어느 쪽이든 1회만 재시도합니다.
    if (parsed.code === 'TOKEN_EXPIRED' && !options._retried) {
      if (kind === 'guest') {
        await reissueGuestSession()
        return request<T>(path, { ...options, _retried: true })
      }
      if (kind === 'member') {
        if (sentRefresh && (await rotateMemberSession(sentRefresh))) {
          return request<T>(path, { ...options, _retried: true })
        }
        /*
          리프레시가 없는 회원 = 이 배선(PR #57) 이전에 로그인한 브라우저입니다.
          회전할 재료가 없으니 만료를 만회할 방법도 없는데, 그냥 던지면 화면마다
          «토큰이 만료되었습니다» 만 뜨고 다음 행동을 아무도 말해 주지 않습니다.
          끊긴 것으로 확정하고 재로그인을 안내합니다.
        */
        if (!sentRefresh && !keepsSessionOn401(path)) dropSessionIfCurrent(kind, token)
      }
    }

    // 만료가 아닌 401 은 재발급으로 풀리지 않습니다. 서버가 거절한 토큰을 들고 있으면
    // 이후 모든 요청이 같은 401 이므로 지우고, 다음 행동은 화면이 사용자에게 묻습니다.
    if (parsed.code === 'UNAUTHORIZED' && token && !keepsSessionOn401(path)) {
      dropSessionIfCurrent(kind, token)
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
 *
 * 반대로 register/login/소셜 authorize 의 401 은 게스트 토큰 자체가 거절된 것이라
 * 예외가 아닙니다(회원 토큰이면 401 이 아니라 409 ALREADY_MEMBER 로 옵니다).
 *
 * **목록이 줄었습니다**(PR #58). `/credits/claim` 과 `/auth/cafe24/authorize` 는 이제
 * 401 이 아니라 **403 MEMBER_ONLY** 로 옵니다(이슈 #52) — 권한 부족이 토큰 무효와 다른
 * 코드로 오게 되면서 예외를 손으로 관리할 이유가 사라졌습니다. 남은 한 줄은 «같은 401 인데
 * 뜻이 다른» 진짜 예외라 계속 남습니다.
 */
function keepsSessionOn401(path: string): boolean {
  return path.startsWith('/auth/') && path.endsWith('/callback')
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

/** 세션을 버리고 화면에 알립니다. 게스트·회원의 다음 행동이 달라 kind 를 함께 실어 보냅니다. */
function dropSession(kind: 'guest' | 'member' | null): void {
  session.clear()
  window.dispatchEvent(new CustomEvent<SessionLostDetail>(SESSION_LOST_EVENT, { detail: { kind } }))
}

/**
 * **내가 보낸 토큰이 아직 저장소의 그 토큰일 때만** 세션을 버립니다.
 *
 * 백엔드 PR #119(이슈 #11 M6) 전까지 회원 액세스 토큰은 서명만으로 검증돼서, 한 번
 * 유효했던 토큰이 남은 수명 안에 401 로 바뀌는 일이 없었습니다. 이제 로그아웃이
 * `member.token_version` 을 올려 **발급된 액세스를 즉시 전부 무효화**하므로, 그 창이
 * 생겼습니다:
 *
 *   1. 마이페이지가 회원 토큰 M 으로 조회 몇 개를 띄워 둔 채
 *   2. 사용자가 로그아웃 → 서버가 M 을 무효화 → `session.clear()` → 새 게스트 G 발급
 *      (api/queries.ts `useLogout` 이 한 동작으로 묶습니다)
 *   3. 1번의 응답이 이제야 도착 — M 은 죽었으니 401 `UNAUTHORIZED`
 *
 * 여기서 무조건 `session.clear()` 하면 **방금 받은 G 를 지웁니다**. `ensureSession()`
 * 은 이미 지나갔으므로 아무도 다시 발급하지 않고, 앱은 토큰이 하나도 없는 채로 남아
 * 이후 모든 요청이 401 이 됩니다 — 로그아웃 한 번이 앱을 멈춰 세우는 셈입니다.
 *
 * 판정 재료는 이 파일이 이미 쓰는 «보낼 때 찍어 둔 값» 그대로입니다(`request` 의
 * `kind`·`sentRefresh` 주석). 지금 저장소에 다른 토큰이 있다는 건 그 사이 누군가
 * 세션을 갈아 끼웠다는 뜻이고, 그렇다면 이 401 은 **지금 세션의 소식이 아닙니다**.
 *
 * 게스트 재발급(`reissueGuestSession`)과 겹치는 창도 같은 이유로 함께 막힙니다.
 */
function dropSessionIfCurrent(kind: 'guest' | 'member' | null, sentToken: string | null): void {
  if (session.token !== sentToken) return
  dropSession(kind)
}

/**
 * 만료된 회원 액세스 토큰을 리프레시로 갈아 끼웁니다 (PR #57, 이슈 #47).
 *
 * 게스트 재발급과 겉모습은 같지만 의미가 정반대입니다 — 저쪽은 **다른 사람이 되는**
 * 복구 불가 경로고, 이쪽은 같은 회원으로 이어 붙는 진짜 복구입니다. 그래서 화면에
 * 아무것도 알리지 않고 조용히 원요청을 재시도합니다.
 *
 * 반환값 true 는 "이제 유효한 액세스 토큰이 저장소에 있다"는 뜻입니다 — 내가 회전시켰든,
 * 기다리는 사이 다른 요청이 회전시켰든 같습니다.
 *
 * 서버는 회전할 때마다 구 리프레시를 즉시 버리므로(회원당 활성 1개) 동시에 두 번
 * 부르면 뒤엣것이 앞엣것을 무효화합니다. 그래서 발급이 **한 번**인 게 낭비 문제가
 * 아니라 정확성 문제입니다 — 아래 두 겹이 그걸 막습니다.
 * 1. 내가 보낸 리프레시가 이미 저장소에서 바뀌었으면 = 다른 요청이 끝냈다 → 그대로 성공.
 * 2. 동시에 들어오면 in-flight 프라미스 하나를 같이 기다린다.
 */
let rotateInFlight: Promise<boolean> | null = null

/**
 * 마지막 회전이 429 로 막혀 있는지. 배너를 **내리기** 위해서만 있는 값입니다 —
 * 성공할 때마다 이벤트를 쏘면 평소에도 매 시간 빈 알림이 흐르므로, 막힌 적이 있을
 * 때만 «풀렸다»를 알립니다.
 */
let refreshThrottled = false

function announceThrottle(throttled: boolean, retryAfter: number | null): void {
  refreshThrottled = throttled
  window.dispatchEvent(
    new CustomEvent<MemberRefreshThrottledDetail>(MEMBER_REFRESH_THROTTLED_EVENT, {
      detail: { throttled, retryAfter },
    }),
  )
}

function rotateMemberSession(sentRefresh: string): Promise<boolean> {
  if (session.refreshToken !== sentRefresh) return Promise.resolve(true)
  rotateInFlight ??= (async () => {
    try {
      const rotated = await request<MemberRefresh>('/auth/refresh', {
        method: 'POST',
        json: { refresh_token: sentRefresh },
        skipAuth: true,
        _retried: true,
      })
      session.set(rotated.token, 'member', rotated.refresh_token)
      if (refreshThrottled) announceThrottle(false, null)
      return true
    } catch (error) {
      /*
        401 은 위조·만료·이미 회전된 토큰의 재사용입니다(§3) — 다시 물어봐도 답이 같으니
        여기서 세션을 접고 재로그인을 안내합니다. 나머지(네트워크 단절·429)는 지금만
        안 되는 것이라 토큰을 버리지 않습니다. 버리면 잠깐의 단절이 로그아웃이 됩니다.

        단, **내가 보낸 리프레시가 아직 저장소의 그것일 때만** 접습니다. 회전 중에
        사용자가 로그아웃하면 서버가 리프레시를 폐기하므로 이 회전은 401 로 끝나는데,
        그 시점의 저장소에는 이미 새 게스트가 서 있습니다(api/queries.ts `useLogout`).
        그걸 지우면 사용자가 스스로 끝낸 세션을 두고 «로그인이 만료됐어요» 를 띄우면서
        새 게스트까지 날립니다 — `dropSessionIfCurrent` 와 같은 이유, 같은 판정입니다.
      */
      if (isApiError(error) && error.status === 401 && session.refreshToken === sentRefresh) {
        dropSession('member')
      }
      /*
        429 는 «지금만 안 된다» 중에서도 유일하게 **끝을 아는** 실패라 따로 알립니다
        (이슈 #11 R3). 토큰을 그대로 두는 건 위와 같지만, 조용히 두면 만료된 액세스로
        보내는 모든 요청이 화면마다 제각각의 «불러오지 못했어요» 로 흩어집니다.
      */
      if (isApiError(error) && error.status === 429) announceThrottle(true, error.retryAfter)
      return false
    } finally {
      rotateInFlight = null
    }
  })()
  return rotateInFlight
}

/**
 * 막혔던 회전을 사용자 요청으로 한 번 더 시도합니다 (이슈 #11 R3 배너 전용).
 *
 * 세션 상실 배너의 «새로 시작하기» 와 **절대 같은 동작이면 안 됩니다** — 저쪽은
 * `session.clear()` 로 시작하는데, 여기서 그러면 아직 30일이 남은 멀쩡한 리프레시를
 * 버리는 것이라 «기다리면 풀릴 일» 이 «재로그인해야 할 일» 로 악화됩니다.
 */
export function retryMemberRotation(): Promise<boolean> {
  const refresh = session.refreshToken
  if (!refresh) return Promise.resolve(false)
  return rotateMemberSession(refresh)
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
