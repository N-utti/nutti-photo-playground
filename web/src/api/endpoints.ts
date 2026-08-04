/**
 * docs/05-api-spec.md §3 엔드포인트를 타입 붙여 감싼 얇은 레이어.
 * 정책·캐싱은 여기 두지 않습니다 — 그건 api/queries.ts.
 */

import { request, session } from './client'
import type {
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
  StyleCatalog,
  StyleDetail,
  UploadResult,
  ClaimableAction,
} from './types'

// ---------------------------------------------------------------- 인증

export const auth = {
  guest: () => request<GuestSession>('/auth/guest', { method: 'POST' }),

  /*
    로그인 시작(authorize)은 지금 프론트에서 호출할 수 없습니다.

    GET /v1/auth/cafe24/authorize 가 `Authorization: Bearer <게스트 토큰>` 을 요구하고
    (app/routers/auth.py) 302 로 cafe24api.com 에 넘깁니다. 브라우저 이동은 헤더를 실을
    수 없어 무조건 401 이고, fetch 로 부르면 cross-origin 302 라 Location 을 읽을 수
    없습니다(redirect:'manual' → opaqueredirect). 즉 두 방식 다 성립하지 않습니다.

    ADR-11/PR #13 이 이 엔드포인트를 200 `{authorize_url}` 로 바꾸기로 했으므로, 배선은
    그 구현이 올라온 뒤 fetch → location.href 패턴으로 추가합니다. 그때까지 링크를 두면
    100% 실패하는 버튼이 되므로 화면에서도 뺐습니다.
  */

  cafe24Callback: (code: string, state: string) =>
    request<MemberSession>('/auth/cafe24/callback', { query: { code, state } }),

  kakao: (kakaoToken: string) =>
    request<MemberSession>('/auth/kakao', { method: 'POST', json: { kakao_token: kakaoToken } }),

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
  create: (name: string, uploadId: string) =>
    request<Pet>('/pets', { method: 'POST', json: { name, upload_id: uploadId } }),
  rename: (petId: string, name: string) =>
    request<Pet>(`/pets/${petId}`, { method: 'PATCH', json: { name } }),
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

  select: (jobId: string, resultIndex: number) =>
    request<{ job_id: string; selected_index: number }>(`/jobs/${jobId}/select`, {
      method: 'POST',
      json: { result_index: resultIndex },
    }),

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
