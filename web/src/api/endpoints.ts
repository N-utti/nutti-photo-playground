/**
 * docs/05-api-spec.md §3 엔드포인트를 타입 붙여 감싼 얇은 레이어.
 * 정책·캐싱은 여기 두지 않습니다 — 그건 api/queries.ts.
 */

import { request, session } from './client'
import type {
  AuthorizeResponse,
  Cafe24LinkResult,
  CalculatorLink,
  ClaimResult,
  CreateJobBody,
  Credits,
  GuestSession,
  Job,
  LedgerEntry,
  LibraryPage,
  Me,
  MemberSession,
  MetricEventBody,
  Paginated,
  Pet,
  PetSummary,
  SocialProvider,
  StyleCatalog,
  StyleDetail,
  UploadResult,
  ClaimableAction,
} from './types'

// ---------------------------------------------------------------- 인증

export const auth = {
  guest: () => request<GuestSession>('/auth/guest', { method: 'POST' }),

  /**
   * 로그인·연동 시작 (PR #21).
   *
   * 302 리다이렉트가 아니라 200 `{authorize_url}` 입니다 — state 가 호출 주체의 토큰에
   * 바인딩돼 Authorization 헤더가 필수인데 브라우저 링크 이동으로는 헤더를 실을 수
   * 없기 때문입니다(§3 인증). 그래서 fetch 로 URL 을 받아 `window.location` 으로
   * 이동하는 2단계가 됩니다 — `<a href>` 로 바꾸면 다시 401 이 됩니다.
   *
   * 토큰 요구가 provider 마다 다릅니다: 소셜은 **게스트 토큰**(회원이면 409
   * ALREADY_MEMBER), cafe24 는 **회원 토큰**(게스트면 401 — 먼저 로그인).
   */
  authorize: (provider: SocialProvider | 'cafe24') =>
    request<AuthorizeResponse>(`/auth/${provider}/authorize`),

  /** 소셜 로그인 완료. 여기서 게스트 자산 병합·승격(UC-07)이 일어납니다. */
  socialCallback: (provider: SocialProvider, code: string, state: string) =>
    request<MemberSession>(`/auth/${provider}/callback`, { query: { code, state } }),

  /**
   * 카페24 **연동** 완료. 로그인이 아니므로 토큰이 바뀌지 않고 자산 병합도 없습니다
   * (UC-07 미적용) — 응답에 token 이 없는 게 그 신호입니다.
   */
  cafe24Callback: (code: string, state: string) =>
    request<Cafe24LinkResult>('/auth/cafe24/callback', { query: { code, state } }),

  /**
   * 로컬 가입. 게스트 토큰 필수이며 성공 시 그 게스트 행이 회원으로 승격됩니다.
   * 비밀번호 재설정이 MVP 에 없어 **분실 시 복구 수단이 없습니다**(이슈 #17) —
   * 화면은 가입 전에 이 사실을 고지해야 합니다.
   */
  register: (email: string, password: string) =>
    request<MemberSession>('/auth/register', { method: 'POST', json: { email, password } }),

  /** 로컬 로그인. 실패는 이메일 존재 여부를 구분하지 않는 401 INVALID_CREDENTIALS. */
  login: (email: string, password: string) =>
    request<MemberSession>('/auth/login', { method: 'POST', json: { email, password } }),

  me: () => request<Me>('/auth/me'),

  /**
   * 서버는 204 만 주고 토큰을 무효화하지 않습니다(app/routers/auth.py `logout`) —
   * 실제 로그아웃은 로컬 토큰 삭제 쪽입니다. 서버 호출이 실패해도 반드시 지웁니다.
   */
  logout: async () => {
    try {
      await request<void>('/auth/logout', { method: 'POST' })
    } finally {
      session.clear()
    }
  },
}

// ---------------------------------------------------------------- 스타일

export const styles = {
  list: (params: { section?: string; limit?: number } = {}) =>
    request<StyleCatalog>('/styles', { query: params }),

  detail: (styleId: number) => request<StyleDetail>(`/styles/${styleId}`),
}

// ---------------------------------------------------------------- 업로드 · 펫

export const uploads = {
  create: (file: File, petId?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (petId) formData.append('pet_id', petId)
    return request<UploadResult>('/uploads', { method: 'POST', formData })
  },
}

export const pets = {
  list: () => request<{ items: Pet[] }>('/pets'),
  /*
    생성·수정 응답은 `PetSummary` 입니다 — `latest_upload_id` 를 주는 건 목록뿐입니다
    (app/routers/pets.py). 여기서 `Pet` 이라고 적으면 없는 필드를 있다고 말하는 셈이라,
    두 뮤테이션은 응답을 캐시에 쓰지 않고 목록을 무효화합니다(api/queries.ts).
  */
  create: (name: string, uploadId: string) =>
    request<PetSummary>('/pets', { method: 'POST', json: { name, upload_id: uploadId } }),
  rename: (petId: string, name: string) =>
    request<PetSummary>(`/pets/${petId}`, { method: 'PATCH', json: { name } }),
  remove: (petId: string) => request<void>(`/pets/${petId}`, { method: 'DELETE' }),
}

// ---------------------------------------------------------------- 생성 job

export const jobs = {
  /** idempotencyKey 는 api/idempotency.ts 가 관리합니다 — 직접 UUID 를 만들지 마세요. */
  create: (body: CreateJobBody, idempotencyKey: string) =>
    request<{ job_id: string; status: 'queued' }>('/jobs', {
      method: 'POST',
      json: body,
      idempotencyKey,
    }),

  get: (jobId: string, signal?: AbortSignal) => request<Job>(`/jobs/${jobId}`, { signal }),

  share: (jobId: string, channel = 'instagram') =>
    request<{ share_image_url: string }>(`/jobs/${jobId}/share`, {
      method: 'POST',
      json: { channel },
    }),
}

// ---------------------------------------------------------------- 계산기 · 보관함

export const calculator = {
  /** pet_id 또는 job_id 중 하나. calculator_url 은 UTM 까지 붙어서 오므로 그대로 씁니다. */
  link: (params: { pet_id?: string; job_id?: string }) =>
    request<CalculatorLink>('/calculator-link', { query: params }),
}

export const library = {
  page: (params: { pet_id?: string; cursor?: string } = {}) =>
    request<LibraryPage>('/library', { query: params }),

  removeMany: (ids: string[]) => request<void>('/library', { method: 'DELETE', json: { ids } }),
}

// ---------------------------------------------------------------- 크레딧

export const credits = {
  get: () => request<Credits>('/credits'),

  /** 'order' 는 배치 자동 지급이라 이 경로로 들어오지 않습니다(§2 W-10). */
  claim: (action: ClaimableAction) =>
    request<ClaimResult>('/credits/claim', { method: 'POST', json: { action } }),

  ledger: (cursor?: string) => request<Paginated<LedgerEntry>>('/credits/ledger', { query: { cursor } }),
}

// ---------------------------------------------------------------- 이벤트 비콘

export const events = {
  track: (body: MetricEventBody) =>
    request<void>('/events', { method: 'POST', json: body }).catch(() => {
      // 비콘 실패가 화면을 막으면 안 됩니다 — metric_event 는 내부 로그일 뿐입니다.
    }),
}
