/**
 * docs/05-api-spec.md §3 엔드포인트를 타입 붙여 감싼 얇은 레이어.
 * 정책·캐싱은 여기 두지 않습니다 — 그건 api/queries.ts.
 */

import { request, session } from './client'
import type {
  AuthorizeResponse,
  Cafe24LinkRequestResult,
  Cafe24LinkResult,
  Cafe24LinkTarget,
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
  ShareResult,
  SocialProvider,
  StyleCatalog,
  StyleDetail,
  UploadResult,
  ClaimBody,
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
   * **게스트 토큰**으로 부릅니다(회원이면 409 ALREADY_MEMBER). 쇼핑몰 연동은 OAuth 가
   * 아니라 아래 cafe24Link* (SMS 인증번호) 입니다.
   */
  authorize: (provider: SocialProvider) =>
    request<AuthorizeResponse>(`/auth/${provider}/authorize`),

  /** 소셜 로그인 완료. 여기서 게스트 자산 병합·승격(UC-07)이 일어납니다. */
  socialCallback: (provider: SocialProvider, code: string, state: string) =>
    request<MemberSession>(`/auth/${provider}/callback`, { query: { code, state } }),

  /**
   * 카페24 **연동** 1/2 — 쇼핑몰 아이디를 보내면 카페24가 그 회원의 휴대폰으로 6자리
   * 인증번호를 SMS 로 보냅니다(5분, 회원당 시간당 3회). 회원 토큰 필수(게스트 403).
   */
  cafe24LinkRequest: (target: Cafe24LinkTarget) =>
    request<Cafe24LinkRequestResult>('/auth/cafe24/link/request', { method: 'POST', json: target }),

  /**
   * 카페24 **연동** 2/2 — 인증번호는 단일 시도(오답도 소비). 로그인이 아니므로 토큰이
   * 바뀌지 않고 자산 병합도 없습니다(UC-07 미적용) — 응답에 token 이 없는 게 그 신호입니다.
   */
  cafe24LinkVerify: (body: Cafe24LinkTarget & { code: string }) =>
    request<Cafe24LinkResult>('/auth/cafe24/link/verify', { method: 'POST', json: body }),

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
   * 회원이면 서버가 **리프레시 토큰을 폐기**하고(PR #57), 이제 **발급된 액세스 토큰도
   * 전부 즉시 무효화**합니다(백엔드 PR #119 · 이슈 #11 M6). `member.token_version` 을
   * 원자적으로 올리고 검증이 토큰의 `ver` 클레임과 대조하는 방식이라, 204 를 받은
   * 순간부터 이전 토큰은 남은 수명과 무관하게 401 입니다 — 다른 기기에 남아 있던
   * 세션까지 함께 끊깁니다. 게스트는 종전대로 만료(30일)까지 수용합니다.
   *
   * 그래서 **뒤늦게 도착하는 401 이 정상 경로에 생겼습니다.** 로그아웃 직전에 띄워 둔
   * 조회가 여기 응답보다 늦게 돌아오면 그건 죽은 토큰의 401 인데, 그때 저장소에는
   * 이미 새 게스트가 서 있습니다. 지우면 안 되는 401 이라 `api/client.ts`
   * `dropSessionIfCurrent` 가 «보낸 토큰이 아직 그 토큰인지» 로 갈라 냅니다.
   *
   * 실패를 삼키는 건 그대로입니다 — 서버에 못 닿았다고 로컬에 회원 토큰을 남겨 두면
   * 사용자는 로그아웃을 눌렀는데 계속 로그인 상태인 화면을 보게 됩니다. 인증이 필요한
   * 엔드포인트이므로(`get_current_member`) 토큰 없이 부르면 401 인데, 그 401 도 여기서
   * 끝납니다. 다만 실패한 로그아웃은 **서버 쪽 무효화가 없었다는 뜻**이라, 원문이 사라진
   * 이 브라우저 밖에서는 액세스가 최대 1h 더 살아 있습니다(리프레시는 30일).
   */
  logout: async () => {
    try {
      await request<void>('/auth/logout', { method: 'POST' })
    } finally {
      session.clear()
    }
  },

  /**
   * 회원 탈퇴 (이슈 #123 · 백엔드 #22 → PR #120). 204 를 주고, 그 시점에 **보유한
   * 액세스·리프레시가 전부 즉시 무효**가 됩니다 — 이후 호출은 전부 401 입니다.
   *
   * `logout` 과 결정적으로 다른 점: 실패를 삼키지 않고, `session.clear()` 도
   * **204 를 받은 뒤에만** 합니다. 로그아웃은 서버에 못 닿아도 로컬을 비우는 게
   * 맞습니다(사용자가 원한 건 이 브라우저에서 나가는 것이고, 남은 토큰은 최대 1h 뒤
   * 죽습니다). 탈퇴는 반대입니다 — 서버가 실패했는데 로컬만 비우면 사용자는 «탈퇴됐다»
   * 고 믿는데 계정과 사진은 그대로 살아 있습니다. 되돌릴 수 없는 동작에서 그 착각은
   * 화면이 할 수 있는 가장 나쁜 거짓말입니다. 그래서 실패는 그대로 던집니다.
   *
   * 403 `MEMBER_ONLY` 는 게스트가 부른 경우입니다. 진입점을 회원에게만 그리므로
   * (W12MyPage 의 DangerSection 은 MemberSections 안에 있습니다) 정상 경로에는 없습니다.
   */
  withdraw: async () => {
    await request<void>('/auth/me', { method: 'DELETE' })
    session.clear()
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

  /**
   * `channel` 은 서버가 받기만 하고 검증도 저장도 하지 않습니다(PR #73) — 값 도메인
   * 제약이 §3 에 없어서입니다. 응답 URL 은 채널과 무관하게 같은 결과 이미지입니다.
   *
   * FR-W06-12 의 share_click 지표는 이 호출이 아니라 `POST /v1/events` 비콘이
   * 기록합니다(W06Result.tsx ShareRow) — 서버는 여기서 아무 지표도 남기지 않습니다.
   */
  share: (jobId: string, channel = 'instagram') =>
    request<ShareResult>(`/jobs/${jobId}/share`, {
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

  /** 'order' 는 배치 자동 지급이라 이 경로로 들어오지 않습니다(§2 W-10). follow_ig 는 instagram_username 필수. */
  claim: (body: ClaimBody) => request<ClaimResult>('/credits/claim', { method: 'POST', json: body }),

  /**
   * 인스타 DM으로 받은 1회용 코드 소진 → follow_ig 크레딧. 코드는 팔로우가 **API로 확인된**
   * 사람에게만 발급되므로(app/instagram.py) 아이디 입력·열기 이벤트가 필요 없습니다.
   */
  redeemInstagram: (code: string) =>
    request<ClaimResult>('/credits/redeem-instagram', { method: 'POST', json: { code } }),

  ledger: (cursor?: string) => request<Paginated<LedgerEntry>>('/credits/ledger', { query: { cursor } }),
}

// ---------------------------------------------------------------- 이벤트 비콘

export const events = {
  track: (body: MetricEventBody) =>
    request<void>('/events', { method: 'POST', json: body }).catch(() => {
      // 비콘 실패가 화면을 막으면 안 됩니다 — metric_event 는 내부 로그일 뿐입니다.
    }),
}
