/**
 * docs/05-api-spec.md §3 을 수기로 옮긴 타입.
 *
 * 이 파일은 **임시**입니다. 백엔드가 전 엔드포인트에 `response_model`을 부착하면
 * (이슈 #4) `openapi-typescript`로 생성한 타입으로 교체하고 이 파일을 지웁니다.
 * 그 전까지 §3이 유일한 계약이므로 §3을 삭제해서는 안 됩니다(ADR-08 순서 함정).
 */

// ---------------------------------------------------------------- 공통 (§1)

/** 모든 4xx/5xx 응답의 단일 포맷. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    detail?: unknown
  }
}

/** §1 코드 표 중 **HTTP 에러 채널**만. 리소스 필드값 채널은 아래 IssueCode. */
export type ErrorCode =
  | 'VALIDATION_ERROR' // 400
  | 'UNAUTHORIZED' // 401
  | 'TOKEN_EXPIRED' // 401
  | 'INVALID_CREDENTIALS' // 401 — 로컬 로그인 실패. 이메일 존재 여부를 구분하지 않습니다
  | 'NOT_FOUND' // 404
  | 'RATE_LIMITED' // 429
  | 'INSUFFICIENT_CREDIT' // 402
  | 'ALREADY_CLAIMED' // 409
  | 'EMAIL_TAKEN' // 409 — register, 이미 가입된 이메일
  | 'ALREADY_MEMBER' // 409 — 회원 토큰으로 register/login/소셜 authorize (이슈 #17)
  | 'CAFE24_ALREADY_LINKED' // 409 — 타 회원 연동 or 타 카페24 계정으로 재바인딩
  | 'HTTP_ERROR' // 백엔드 공통 핸들러의 폴백 (app/main.py:34)

/**
 * §1 코드 표 중 **리소스 필드값 채널**. HTTP 200과 함께 내려오므로
 * 에러 인터셉터가 잡으면 안 되고, 화면이 직접 분기해야 합니다.
 */
export type IssueCode =
  | 'CAT_DETECTED' // 차단
  | 'NOT_A_DOG' // 경고
  | 'MULTI_SUBJECT' // 경고
  | 'QUALITY_WARNING' // 경고
  | 'HUMAN_FACE_DETECTED' // app_setting.human_face_policy 에 따라 경고 또는 차단

/** generation_job.error_code 로만 등장하는 코드. */
export type JobErrorCode = 'GENERATION_FAILED' | 'SAFETY_BLOCKED' | 'MAX_RETRIES_EXCEEDED'

/** 커서 페이지네이션 (§1). next_cursor 가 null 이면 마지막 페이지. */
export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}

// ---------------------------------------------------------------- 인증

export type MemberKind = 'guest' | 'member'

export interface GuestSession {
  token: string
  member_id: string
  kind: 'guest'
}

/** 로그인 수단 3종(ADR-11). 카페24는 로그인이 아니라 **연동**이라 여기 없습니다. */
export type AuthProvider = 'kakao' | 'naver' | 'local'

/** 소셜 provider — authorize/callback 경로에 들어가는 값. */
export type SocialProvider = Extract<AuthProvider, 'kakao' | 'naver'>

/**
 * 로그인 3종(소셜 callback · register · login)의 공통 응답.
 *
 * 카페24 콜백은 **이 타입이 아닙니다** — 연동은 로그인이 아니라서 토큰을 주지
 * 않습니다(Cafe24LinkResult).
 */
export interface MemberSession {
  token: string
  member_id: string
  kind: 'member'
  /** true = 기존 회원 행에 병합(UC-07 분기 A), false = 게스트 행 승격(분기 B). */
  merged: boolean
  credit_balance: number
}

/** authorize 계열 응답. 302 가 아니라 200 인 이유는 §3 인증 노트 참고. */
export interface AuthorizeResponse {
  authorize_url: string
}

/** `GET /v1/auth/cafe24/callback` — 토큰 없음. 세션은 그대로 두고 연동 상태만 바뀝니다. */
export interface Cafe24LinkResult {
  cafe24_linked: true
  credit_balance: number
}

export interface Me {
  member_id: string
  kind: MemberKind
  credit_balance: number
  /** `local` 미보유 시 null. 게스트는 항상 null. */
  email: string | null
  /** 소셜 프로필에서 수집(이슈 #12). 로컬 전용·미제공 시 null — 표시는 화면이 폴백합니다. */
  nickname: string | null
  /** 보유한 로그인 수단(복수 가능). 게스트는 `[]`. */
  providers: AuthProvider[]
  cafe24_linked: boolean
}

// ---------------------------------------------------------------- 스타일

export interface StyleCard {
  id: number
  code: string
  name: string
  thumbnail_url: string
  credit_cost: number
}

export interface StyleSection {
  name: string
  count: number
  styles: StyleCard[]
}

export interface StyleCatalog {
  sections: StyleSection[]
  total_count: number
}

/**
 * 적합도 태그. §3 예시에는 'good' | 'caution' 두 값만 등장하고
 * 전체 값 도메인이 명세돼 있지 않습니다 — 세 번째 등급(◎/○/△의 ○ 등)이
 * 있는지 백엔드 확정 필요. 미확정이므로 넓게 열어 둡니다.
 */
export interface FitTag {
  label: string
  score: 'good' | 'caution' | (string & {})
}

export interface StyleDetail {
  id: number
  code: string
  name: string
  credit_cost: number
  /** W-03 캐러셀 6장. */
  examples: string[]
  fit_tags: FitTag[]
  avg_duration_seconds: number
  output_count: number
}

// ---------------------------------------------------------------- 업로드

export interface UploadIssue {
  code: IssueCode
  message: string
  detail?: { issues?: string[] } & Record<string, unknown>
}

export interface BreedEstimate {
  /** 계산기 견종 42종 코드표와 값 도메인을 공유(§2 W-07 계약 노트). */
  code: string
  label: string
  confidence: number
}

export interface UploadResult {
  /** 차단된 경우 null. */
  upload_id: string | null
  image_url: string | null
  blocking_issue: Pick<UploadIssue, 'code' | 'message'> | null
  warnings: UploadIssue[]
  breed_estimate: BreedEstimate | null
}

// ---------------------------------------------------------------- 펫

export interface Pet {
  id: string
  name: string
  thumbnail_url: string
  /**
   * 이 펫에 연결된 가장 최근 `source_image` id (이슈 #9 A안, §3).
   * 값이 있으면 W-04 에서 **업로드 단계를 건너뛰고** 그대로 `POST /v1/jobs` 의
   * `upload_id` 로 씁니다(FR-W04-02). 연결된 업로드가 만료·삭제됐으면 `null`.
   *
   * 옵셔널인 이유: 스펙(§3)에는 확정됐지만 백엔드 구현이 아직 안 올라왔습니다
   * (app/routers/pets.py). 필드가 없으면 스킵을 제안하지 않고 기존 동작(이번
   * 업로드에 펫 태깅)으로 떨어집니다 — 구현이 착지하면 `?`만 떼면 됩니다.
   */
  latest_upload_id?: string | null
}

// ---------------------------------------------------------------- 생성 job

/**
 * 04-erd.md §2.6 CHECK 제약 및 app/models.py JobStatus 와 동일한 4값.
 * (06-architecture-deployment.md §4 6단계의 'completed' 는 해당 문서의 오기입니다.)
 */
export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

export interface JobResultImage {
  index: number
  image_url: string
}

export interface Job {
  job_id: string
  status: JobStatus
  /**
   * 이 job 을 만든 재료 참조 (이슈 #9 A안, §3). W-06 "다시 만들기"(FR-W06-04)와
   * "이 사진으로 다른 스타일"(FR-W06-07)이 이 둘로 `POST /v1/jobs` 를 재조립합니다.
   * 커스텀 프롬프트 job 은 `style_id: null`.
   *
   * `Pet.latest_upload_id` 와 같은 이유로 옵셔널입니다 — 백엔드 미구현 구간에서는
   * api/jobContext.ts 의 localStorage 색인이 대신 답합니다(resolveJobContext).
   */
  style_id?: number | null
  upload_id?: string
  /** 진행 중에만 값이 있고 실패 시 null. */
  progress: number | null
  eta_seconds: number | null
  status_message: string | null
  source_image_url: string
  /**
   * 성공 시에만 채워지고 그 외에는 null. **길이는 항상 1**(Q4 확정 2026-08-04 —
   * 1요청 1장). 배열 형태는 산출 수 상향 대비로 남겨 둔 것이고, 지금 화면은
   * `results[0]` 하나만 그립니다. `selected_index` 와 `POST /jobs/{id}/select` 는
   * 같은 결정으로 §3 에서 삭제됐습니다.
   */
  results: JobResultImage[] | null
  error_code: JobErrorCode | null
}

export interface CreateJobBody {
  style_id: number | null
  upload_id: string
  pet_id: string | null
  /** W-08 크리에이티브 모드에서만 사용. 이때 credit_cost=2. */
  custom_prompt: string | null
}

// ---------------------------------------------------------------- 계산기 연결

export interface CalculatorLink {
  /** 추정 완전 실패 시 세 필드 모두 null, URL 에서 breed 파라미터 생략(FR-EDGE-10). */
  breed_code: string | null
  breed_label: string | null
  size_label: string | null
  /** UTM 까지 서버가 조립해 내려주므로 클라이언트는 그대로 사용. */
  calculator_url: string
}

// ---------------------------------------------------------------- 보관함

export interface LibraryItem {
  job_id: string
  result_id: string
  image_url: string
  pet_id: string
  created_at: string
}

export interface LibraryMonth {
  label: string
  items: LibraryItem[]
}

export interface LibraryPage {
  months: LibraryMonth[]
  next_cursor: string | null
}

// ---------------------------------------------------------------- 크레딧

/** 'order' 는 카페24 주문 동기화 배치가 자동 지급 — claim 대상이 아님(§2 W-10). */
export type EarnAction = 'order' | 'link_account' | 'follow_ig' | 'daily'
export type ClaimableAction = Exclude<EarnAction, 'order'>

export interface EarnActionRow {
  action: EarnAction
  amount: number
  /** done = 1회 한정 완료, tomorrow = daily 를 오늘 이미 받음. */
  status: 'available' | 'done' | 'tomorrow'
  cta: string | null
}

export interface Credits {
  /** ADR-02 로 음수가 될 수 있습니다. 표시는 max(0, balance), 판정은 balance >= cost. */
  balance: number
  earn_actions: EarnActionRow[]
}

export interface ClaimResult {
  balance: number
  amount_granted: number
}

export interface LedgerEntry {
  reason: string
  ref_label: string | null
  occurred_on: string
  amount: number
}

// ---------------------------------------------------------------- 이벤트 비콘

export interface MetricEventBody {
  event_type: string
  properties: Record<string, unknown>
}
