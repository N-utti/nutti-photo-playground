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
  /**
   * 403 — **살아 있는 게스트 토큰**으로 회원 전용 기능 접근(PR #58, 이슈 #52).
   *
   * 401 과 갈라 놓은 게 이 코드의 존재 이유입니다. 권한 부족을 401 로 받으면 클라이언트는
   * "내 토큰이 죽었다"로 읽고 세션을 지우는데, 게스트는 그 순간 job·보관함·크레딧을 전부
   * 잃습니다 — 화면이 권한 뒤에 누르라고 제안한 버튼이 세션을 지우는 사고였습니다.
   * 이 코드를 받으면 세션은 그대로 두고 로그인 시트를 띄웁니다.
   */
  | 'MEMBER_ONLY' // 403
  | 'NOT_FOUND' // 404
  | 'RATE_LIMITED' // 429
  | 'INSUFFICIENT_CREDIT' // 402
  | 'ALREADY_CLAIMED' // 409
  | 'EMAIL_TAKEN' // 409 — register, 이미 가입된 이메일
  | 'ALREADY_MEMBER' // 409 — 회원 토큰으로 register/login/소셜 authorize (이슈 #17)
  | 'CAFE24_ALREADY_LINKED' // 409 — 타 회원 연동 or 타 카페24 계정으로 재바인딩
  | 'CAFE24_MEMBER_NOT_FOUND' // 404 — link/request, 그 아이디의 쇼핑몰 회원 없음
  | 'CAFE24_CODE_INVALID' // 400 — link/verify, 인증번호 불일치·만료(오답 1회로 소비)
  | 'BAD_GATEWAY' // 502 — 카페24 Admin API 실패(토큰·SMS 잔액·발신번호)
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

/**
 * generation_job.error_code 로만 등장하는 코드 — **§1 이 문서화한 셋**입니다.
 *
 * 이게 전부라는 보장은 없습니다. 서버 쪽 컬럼은 자유 텍스트(`TextField`)라 스키마가
 * 값을 제한하지 않고, 실제로 백엔드 테스트가 `PROVIDER_ERROR` 를 심어 둡니다
 * (tests/test_jobs.py). 그래서 이 유니온은 «올 수 있는 값 전부»가 아니라 «우리가
 * 화면 문구를 준비해 둔 값»으로 읽어야 하고, 읽는 쪽은 항상 폴백을 둡니다
 * (screens/W06Result.tsx `failureCopy`).
 */
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
  /**
   * 회원 리프레시 토큰 **원문** — 이 응답에서 딱 한 번만 옵니다(PR #57, 이슈 #47).
   *
   * 서버는 sha256 해시만 들고 있어 다시 물어볼 수 없습니다. 받은 즉시 저장하지 않으면
   * 액세스(1h)가 만료되는 순간 회원이 재로그인 말고는 방법이 없어집니다.
   * 회원당 활성 1개 — 다른 기기에서 로그인하면 이쪽 리프레시는 그때 무효가 됩니다.
   */
  refresh_token: string
  member_id: string
  kind: 'member'
  /** true = 기존 회원 행에 병합(UC-07 분기 A), false = 게스트 행 승격(분기 B). */
  merged: boolean
  credit_balance: number
}

/**
 * `POST /v1/auth/refresh` 응답 — 액세스·리프레시가 **둘 다** 새로 옵니다(회전).
 *
 * 구 리프레시는 이 응답이 나온 순간 서버에서 무효라, 새 값을 저장하지 못하면 세션이
 * 그 자리에서 끊깁니다. 회전 실패(위조·만료·이미 쓴 토큰)는 401 UNAUTHORIZED.
 */
export interface MemberRefresh {
  token: string
  refresh_token: string
}

/** authorize 계열 응답. 302 가 아니라 200 인 이유는 §3 인증 노트 참고. */
export interface AuthorizeResponse {
  authorize_url: string
}

/** `POST /v1/auth/cafe24/link/request` — 카페24가 그 회원 휴대폰으로 6자리 SMS 를 보냈습니다. */
export interface Cafe24LinkRequestResult {
  sent: true
  expires_in: number
}

/**
 * 쇼핑몰 계정을 가리키는 방법 — 가입 휴대폰 번호(기본, 숫자만) 또는 아이디. 카카오/네이버로
 * 쇼핑몰에 가입한 고객은 아이디(`4993695098@k`)를 모르므로 번호가 기본 경로입니다.
 */
export type Cafe24LinkTarget = { cellphone: string; shop_member_id?: string } | { shop_member_id: string }

/**
 * `POST /v1/auth/cafe24/link/verify` — 토큰 없음. 세션은 그대로 두고 연동 상태만 바뀝니다.
 * 한 번호에 쇼핑몰 계정이 여러 개면 `cafe24_linked: false` + `candidates` 가 오고, 같은 코드로
 * `shop_member_id` 를 골라 한 번 더 부릅니다(그때까지 코드는 소비되지 않음).
 */
export interface Cafe24LinkResult {
  cafe24_linked: boolean
  credit_balance: number
  candidates: string[] | null
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

/**
 * 스타일별 사용자 입력 스키마 (이슈 #114 · 백엔드 #116·#118).
 *
 * 워커가 선택값을 `"라벨: 값"` 줄로 프롬프트 앞에 붙이므로(app/worker.py) **`label`
 * 이 곧 `POST /v1/jobs` `inputs` 의 키**입니다. 39종 중 25종이 1~2개를 갖고
 * 나머지는 `[]` 라, 빈 배열이 정상이고 폼을 통째로 생략하는 쪽이 기본입니다.
 *
 * 값 검증은 서버가 최종 판단하지만(400 `VALIDATION_ERROR`) 프론트도 같은 규칙으로
 * 막습니다 — 여기서 못 막으면 왕복 한 번을 버리고 나서야 «형식이 올바르지 않습니다»
 * 를 보게 되고, 그 응답은 어느 칸이 틀렸는지 화면 문구로 옮길 만큼 친절하지 않습니다.
 */
export interface StyleInputField {
  /** 폼 라벨이자 `inputs` 의 키. */
  label: string
  type: 'choice' | 'text'
  /** `choice` 에만 있습니다. */
  options?: { value: string; description?: string }[]
  /** `choice` 에서 목록 밖 값을 허용하는가. false 면 서버가 `not_in_options` 로 막습니다. */
  allow_custom?: boolean
  max_length?: number
  /** 서버가 `re.fullmatch` 로 봅니다 — 프론트도 앵커를 붙여 같은 판정을 합니다. */
  pattern?: string
  /** 비워 두면 서버가 이 값으로 채웁니다. 없는 필드도 있습니다(prefill 계열). */
  default?: string
  /** `"pet_name"` 이면 선택된 강아지 이름으로 초기값을 채웁니다(수정 가능). */
  prefill?: string
  help?: string
}

export interface StyleCard {
  id: number
  code: string
  name: string
  /**
   * **null 이 될 수 있습니다** — 서버가 `example_keys[0]` 으로 만드는 값이라 예시
   * 이미지가 한 장도 없는 스타일은 null 입니다(app/routers/styles.py `StyleSummary`).
   * `<img src>` 에 그대로 넣으면 깨진 이미지가 되므로 app/Thumbnail.tsx 를 씁니다.
   */
  thumbnail_url: string | null
  credit_cost: number
  /**
   * 활성 프롬프트에 `[pet name]`·`[breed]` 가 있는지를 **서버가 계산해** 줍니다
   * (이슈 #101 → 백엔드 #111). 프롬프트 원문은 클라이언트로 오지 않으므로 이 두
   * 플래그가 "결과물에 글자가 인쇄되는가"를 아는 유일한 길입니다.
   */
  uses_pet_name: boolean
  uses_breed: boolean
  input_fields: StyleInputField[]
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
  /** 카드와 같은 값입니다(app/routers/styles.py `StyleDetailResponse`). */
  uses_pet_name: boolean
  uses_breed: boolean
  input_fields: StyleInputField[]
}

// ---------------------------------------------------------------- 업로드

export interface UploadIssue {
  code: IssueCode
  message: string
  /** `QUALITY_WARNING` 만 `{issues}` 를 채우고 나머지는 **명시적 null**(PR #59). */
  detail?: ({ issues?: string[] } & Record<string, unknown>) | null
}

/**
 * 견종 추정 (PR #59 구현 착지분).
 *
 * 세 필드가 **각각** null 이 될 수 있습니다 — 서버가 비전 응답을 그대로 흘려보내므로
 * 모델이 확신하지 못하면 값이 빈 채로 옵니다(`app/routers/uploads.py` `BreedEstimate`).
 * 지금 화면은 이 값을 직접 그리지 않고 `GET /v1/calculator-link` 가 조립해 주는
 * `breed_label` 만 쓰므로 표시에 영향은 없습니다. 나중에 직접 그릴 때 «null» 이라고
 * 적힌 화면이 나오지 않도록 여기서 미리 사실대로 적어 둡니다.
 */
export interface BreedEstimate {
  /**
   * 비전 모델이 준 **내부 식별자**입니다. 계산기와 값 도메인을 공유하지 않습니다 —
   * 계산기에는 코드 체계가 없어 한글 견종명이 곧 키이고(Q9 확정, PR #122), 서버도
   * 매칭에 `label` 만 씁니다(`app/routers/results.py` · `app/worker.py` 둘 다
   * `estimate["label"]`). 즉 이 필드를 읽어 견종을 판단하는 코드는 어디에도 없어야
   * 합니다 — 이건 이제 우리 쪽 규율이 아니라 **계약**입니다(05-api-spec.md §3 업로드
   * 노트 «클라이언트도 `code` 를 계산기 값으로 쓰지 말 것», 이슈 #161 → PR #169).
   * 그전까지 §2 W-07 노트는 «42종 코드표와 일치» 라는 Q9 이전 내용이라, 스펙만 읽고
   * 구현하면 이 필드를 계산기 값으로 넘기는 게 오히려 «맞는» 것처럼 보였습니다.
   */
  code: string | null
  label: string | null
  confidence: number | null
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

/**
 * 펫의 공통 필드. `POST /v1/pets` · `PATCH /v1/pets/{id}` 응답이 **여기까지만**
 * 줍니다(app/routers/pets.py `PetResponse`) — `latest_upload_id` 는 목록 전용입니다.
 */
export interface PetSummary {
  id: string
  name: string
  /**
   * **null 이 될 수 있습니다** — 썸네일 키가 없는 펫 행이 그렇습니다
   * (app/routers/pets.py `_thumbnail_url`). StyleCard 와 같은 이유로 app/Thumbnail.tsx.
   */
  thumbnail_url: string | null
}

/** `GET /v1/pets` 목록 항목. */
export interface Pet extends PetSummary {
  /**
   * 이 펫에 연결된 가장 최근 `source_image` id (이슈 #9 A안, §3).
   * 값이 있으면 W-04 에서 **업로드 단계를 건너뛰고** 그대로 `POST /v1/jobs` 의
   * `upload_id` 로 씁니다(FR-W04-02). 연결된 업로드가 만료·삭제됐으면 `null`
   * (서버가 `expires_at` 을 지난 업로드를 null 로 떨굽니다 — app/routers/pets.py:75).
   *
   * PR #49 로 백엔드 구현이 착지해 옵셔널을 뗐습니다.
   */
  latest_upload_id: string | null
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
   * PR #60 으로 백엔드 구현이 착지해 옵셔널을 뗐습니다 — 이제 모든 job 응답이
   * 답합니다(맥락 조립은 app/reuseFromJob.ts `contextFromJob`).
   */
  style_id: number | null
  upload_id: string
  /**
   * 이 job 의 사진에 붙어 있던 강아지 (이슈 #101 2번 → 백엔드 착지분,
   * `app/routers/jobs.py` 가 `source_image.pet_profile_id` 를 그대로 내려줍니다).
   *
   * "이 사진으로 다른 스타일"(FR-W06-07)로 W-04 확인 단계에 바로 들어오는 경로가
   * 이 값을 씁니다 — 없던 동안에는 이름이 인쇄되는 스타일에서 «있으면 그 이름이,
   * 없으면 우리 아이가» 라는 흐린 문구밖에 쓸 수 없었습니다.
   */
  pet_id: string | null
  /**
   * 커스텀 job 이면 W-08 에서 보낸 문구 원문, 프리셋 job 이면 `null` (이슈 #81).
   *
   * PR #83 으로 백엔드 구현이 착지해 옵셔널을 뗐습니다 — 이 필드가 로컬 색인
   * (`api/jobContext.ts`)의 마지막 존재 이유였고, 착지와 함께 그 파일을 지웠습니다.
   *
   * 원문이라 **앞뒤 공백이 그대로 옵니다**(PR #83 테스트가 `"  우주복을 입혀줘  "` 로
   * 못 박음). 정규화본이 아니므로 재생성에 그대로 실어 보내면 됩니다 — 서버가 만들 때
   * 쓴 값과 같습니다. 로그가 먼저 지워진 job(`on_delete=SET_NULL`)은 커스텀이었어도
   * `null` 로 옵니다 — 그 경우는 서버도 문구를 모르는 것이라 재생성이 불가능합니다.
   */
  custom_prompt: string | null
  /**
   * 이 job 이 실제로 쓴 스타일 입력값 (이슈 #127 → 백엔드 PR #139).
   *
   * `POST /v1/jobs` 로 **보낸 값이 아니라 서버가 판정한 최종 값**입니다
   * (`app/routers/jobs.py` `_resolve_input_values` → `generation_job.input_values`).
   * 셋이 다릅니다:
   *   - 스키마에 없는 라벨은 빠져 있습니다(서버가 버립니다)
   *   - 안 보낸 칸에 `default` 가 있으면 **그 기본값이 들어가 있습니다**
   *   - `default` 도 없는 `prefill` 칸은 **아예 없습니다** — 워커가 그때 강아지 이름
   *     으로 채우므로 job 이 만들어지는 시점에는 값이 정해지지 않습니다(app/worker.py)
   *
   * 마지막 항목 때문에 이 값을 «폼의 완성된 초기값» 으로 그대로 쓰면 안 됩니다. 빠진
   * 칸은 `initialInputValues` 가 채우던 그 규칙으로 다시 채워야 같은 그림이 나옵니다
   * (screens/W06Result.tsx `Regenerate`).
   *
   * `null` 인 경우: 커스텀 job(`style_id: null`)이거나, 스타일에 `input_fields` 가
   * 없는 경우입니다. 즉 고를 게 있는 스타일이면 최소한 `{}` 는 옵니다.
   */
  inputs: Record<string, string> | null
  /**
   * 이 job 이 실제로 차감한 크레딧(이슈 #81). 스타일 비용은 스타일마다 다르고
   * 커스텀은 2 라(FR-W08-04) 화면이 «다시 만들기»의 값을 지어내지 않으려면 이 값이
   * 필요합니다.
   *
   * **실패해도 0 이 되지 않습니다** — 자동 반환은 크레딧 트랜잭션을 따로 쌓을 뿐
   * `generation_job.credit_cost` 를 건드리지 않습니다(`app/worker.py` `_refund`).
   * 그래서 실패 화면의 «다시 만들기»도 이 값을 그대로 말할 수 있습니다.
   */
  credit_cost: number
  /**
   * 큐에 들어간 시각(ISO 8601). 워커가 집기 전까지 `started_at` 은 null 입니다(PR #60).
   *
   * FR-EDGE-02(90초 초과 → 지연 안내) 판정은 **`started_at` 기준**입니다 — 큐
   * 대기는 «생성 처리» 시간이 아니라는 게 NFR-PERF-01 의 정의입니다(§3). 다만 화면이
   * 대기 자체를 못 본 척할 수는 없어서, `started_at` 이 아직 없는 동안은 `queued_at`
   * 으로 같은 판정을 겁니다(screens/W05Waiting.tsx 주석).
   */
  queued_at: string
  started_at: string | null
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
  /**
   * 실패 사유. `(string & {})` 를 섞은 건 자동완성은 살리면서 **유니온 밖 값도 타입
   * 상 가능**하게 만들기 위해서입니다 — 서버 컬럼이 자유 텍스트라 그게 사실이고,
   * `JobErrorCode` 로만 좁혀 두면 문구 표를 그냥 인덱싱해도 컴파일러가 통과시켜
   * 알 수 없는 코드 하나에 결과 화면이 통째로 죽습니다(실측: W-06 FailurePanel).
   */
  error_code: JobErrorCode | (string & {}) | null
}

export interface CreateJobBody {
  style_id: number | null
  upload_id: string
  pet_id: string | null
  /** W-08 크리에이티브 모드에서만 사용. 이때 credit_cost=2. */
  custom_prompt: string | null
  /**
   * 스타일 입력값 `{라벨: 값}` (이슈 #114). 스키마가 없는 스타일·W-08 에서는 생략합니다.
   *
   * 미제공 필드는 서버가 `default` 로 채우므로 **부분 전송이 정상**입니다. 반대로
   * 스키마에 없는 라벨은 서버가 **조용히 버리고 생성을 계속합니다**(백엔드 PR #139 —
   * 예전에는 400 `unknown_inputs`). 그래서 화면이 임의로 키를 만들면 오류가 아니라
   * **크레딧이 나간 뒤 값만 사라집니다**. 조립은 app/styleInputs.ts `inputsForRequest` 로만.
   */
  inputs?: Record<string, string>
}

/**
 * `POST /v1/jobs/{job_id}/share` 응답 (PR #73 착지분).
 *
 * **`share_image_url` 은 `results[0].image_url` 과 같은 URL 입니다** — 서버는 공유용
 * 사본을 따로 만들지 않고 결과 JPEG 의 `public_url` 을 그대로 돌려줍니다
 * (`app/routers/jobs.py` 의 238행과 276행이 같은 `public_url(storage_key)`).
 * 워커가 생성 시점에 누띠 서명을 합성해 저장하므로 그 파일이 곧 «서명 포함 이미지»고,
 * §3 예시 URL 의 `share/` 경로는 예시일 뿐 실제 경로가 아닙니다(PR #73 본문).
 *
 * 그래서 화면은 이 응답을 «새 이미지»로 소개하면 안 됩니다 — 사용자가 위에서 보고 있는
 * 그 결과물입니다. 그럼에도 호출을 유지하는 이유는 인스타 전용 리사이즈·합성이 생기면
 * 값이 갈라질 자리가 여기이기 때문입니다.
 *
 * 404 조건(모두 같은 `NOT_FOUND`): 없는 job · 다른 회원 소유 · 비UUID job_id ·
 * **결과가 아직/영영 없는 job**(queued·processing·failed). 게스트도 호출할 수 있습니다.
 */
export interface ShareResult {
  share_image_url: string
}

// ---------------------------------------------------------------- 계산기 연결

/**
 * Q9 확정(PR #122, 계산기 실측): 계산기에 코드 체계가 없어 **한글 견종명이 곧 키**라
 * `breed_code` 와 `breed_label` 이 **같은 값**입니다(예: 둘 다 `"토이푸들"`). 목록은
 * 40종이고 스냅샷은 `app/breeds.py` — 목록 밖 견종은 `"믹스견"` 으로 떨어집니다
 * (FR-EDGE-11). 세 필드는 **함께** 채워지거나 함께 null 입니다.
 *
 * 견종 후보는 펫 프로필 기입값(`pet_profile.breed_label`) → 비전 추정 라벨 순인데,
 * 그 칸을 채우는 API 가 아직 없어(`POST /v1/pets` 에 견종 필드 없음) 오늘 오는 값은
 * 언제나 사진 추정입니다. 화면이 «사진에서» 라고 말하는 근거가 여기까지입니다.
 */
export interface CalculatorLink {
  /** 추정 완전 실패 시 세 필드 모두 null, URL 에서 breed 파라미터 생략(FR-EDGE-10). */
  breed_code: string | null
  /** `breed_code` 와 같은 한글 견종명 — 표시용으로 갈라져 있을 뿐입니다. */
  breed_label: string | null
  /** `"소형"` · `"중형"` · `"대형"` (`app/breeds.py`). 견종을 알면 반드시 함께 옵니다. */
  size_label: string | null
  /** UTM 까지 서버가 조립해 내려주므로 클라이언트는 그대로 사용. */
  calculator_url: string
}

// ---------------------------------------------------------------- 보관함

export interface LibraryItem {
  job_id: string
  result_id: string
  image_url: string
  /**
   * §3 예시에는 값이 있는 경우만 나오지만 **null 이 될 수 있습니다**.
   *
   * 펫 삭제는 `source_image.pet_profile_id` 를 NULL 로 만들고 결과물은 남기기로
   * 확정됐고(이슈 #12 결정4), W-12 삭제 확인 문구가 사용자에게 그렇게 약속합니다 —
   * "결과는 남고 강아지 필터에서만 사라진다". 그 상태의 결과가 여기서 무엇을 다는지가
   * §3 에 안 적혀 있는데, 지워진 펫의 id 를 계속 달고 있으면 «전체»에서만 보인다는
   * 약속이 성립하지 않으므로 null 로 봅니다. 백엔드 구현 시 확인 필요.
   */
  pet_id: string | null
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
  /**
   * done = 1회 한정 완료, tomorrow = daily 를 오늘 이미 받음,
   * login_required = **게스트**(PR #58, 이슈 #52).
   *
   * 게스트에게는 서버가 4행 전부 `login_required` + `cta: "로그인"` 으로 내려줍니다 —
   * 크레딧 획득이 회원 전용이라는 사실을 목록 자체가 말하게 됐습니다. 그전에는 게스트도
   * "받기" 가 보였고, 누르면 401 이었습니다.
   */
  status: 'available' | 'done' | 'tomorrow' | 'login_required'
  cta: string | null
}

export interface Credits {
  /** ADR-02 로 음수가 될 수 있습니다. 표시는 max(0, balance), 판정은 balance >= cost. */
  balance: number
  earn_actions: EarnActionRow[]
  /**
   * 커스텀 프롬프트(W-08 「직접 만들기」) 1회 비용 — `app_setting.custom_prompt_credit_cost`
   * 이고 그 행이 없을 때만 서버가 2 로 떨어집니다(이슈 #149 A안, PR #151).
   *
   * 프리셋 비용(`StyleCard.credit_cost`)과 달리 스타일에 딸린 값이 아니라 **정책값**이라
   * 여기 실립니다. 잔액을 보는 화면은 이미 전부 이 쿼리를 구독하므로 왕복이 늘지 않습니다.
   */
  custom_prompt_credit_cost: number
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
