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

  constructor(code: ErrorCode, message: string, status: number, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
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
    if (parsed.code === 'TOKEN_EXPIRED' && !options._retried && session.kind === 'guest') {
      await reissueGuestSession()
      return request<T>(path, { ...options, _retried: true })
    }
    throw parsed
  }

  return (await response.json()) as T
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>
    const error = body.error
    if (error?.code) return new ApiError(error.code, error.message ?? '', response.status, error.detail)
  } catch {
    // 본문이 JSON 이 아닌 경우(프록시 502 등)는 아래 폴백으로 떨어집니다.
  }
  return new ApiError('HTTP_ERROR', `요청이 실패했습니다 (HTTP ${response.status})`, response.status)
}

/**
 * 만료된 게스트 토큰을 새로 발급받습니다.
 *
 * 주의: 이건 복구가 아니라 **새 게스트 생성**입니다. 이전 자산은 되찾을 수 없습니다.
 */
async function reissueGuestSession(): Promise<void> {
  session.clear()
  const fresh = await request<GuestSession>('/auth/guest', { method: 'POST', _retried: true })
  session.set(fresh.token, 'guest')
  window.dispatchEvent(new CustomEvent(GUEST_SESSION_RESET_EVENT))
}

/**
 * 앱 진입 시 1회 호출. 토큰이 없으면 게스트로 시작합니다(§4 시나리오1 1단계).
 * 이미 토큰이 있으면 아무것도 하지 않습니다 — 회원 토큰을 게스트로 덮어쓰면 안 됩니다.
 */
export async function ensureSession(): Promise<void> {
  if (session.token) return
  const guest = await request<GuestSession>('/auth/guest', { method: 'POST' })
  session.set(guest.token, 'guest')
}
