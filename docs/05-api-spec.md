# API 명세

> 기준: wireframe-spec v0.5 / cebb865

---

## §0 문서 수명 규칙

이 문서는 2층 구조입니다.

- **§1(공통 규약) · §2(화면-API 매핑) · §4(시나리오) · §5(관리자 API)**: 장수명. API가 존재하는 한 유지·갱신합니다.
- **§3(엔드포인트 스키마)**: 소모성. **구현 착수 시 §3은 삭제하고 실제 OpenAPI/`/docs`(FastAPI 자동 생성 문서) 링크로 대체합니다.** 손으로 쓴 스펙과 구현이 어긋나는 것을 막기 위함입니다.
  - **삭제 전제조건**(이슈 #4): 전 엔드포인트에 `response_model`이 부착되어 `/openapi.json`의 각 경로에 응답 스키마(`responses.200.content.application/json.schema`)가 실제로 노출된 시점 이후에만 삭제할 수 있습니다. 그 전까지 §3이 프론트엔드의 유일한 응답 계약입니다(현재 스캐폴딩 스텁에는 응답 모델이 없음).
  - 엔드포인트 구현 시 §3 예시를 그대로 응답 Pydantic 모델로 옮겨 `response_model`을 함께 부착합니다. `response_model_exclude_none`은 **켜지 않습니다** — §1 옵셔널 필드 규약("항상 키를 내려줌")이 깨져 `blocking_issue: null` 같은 키가 사라지면 클라이언트 분기가 무너집니다.

---

## §1 공통 규약

- **베이스 URL**: `/v1`
- **인증**: `Authorization: Bearer <JWT>`. 게스트와 회원이 **동일한 JWT 형식**을 사용합니다 — 게스트는 `POST /v1/auth/guest`로 발급받은 토큰을 그대로 쓰다가, 로그인 시 회원 토큰으로 교체합니다(§4 시나리오 1 참고).
- **JSON 규약**: 모든 필드는 `snake_case`. 시각 값은 ISO 8601(`2026-08-03T10:00:00+09:00`). 값이 없을 수 있는 필드는 예시에서 `null`을 명시합니다(옵셔널 필드를 생략하지 않고 항상 키를 내려줌 — Pydantic `Optional[T] = None` 이관을 염두에 둔 규약).
- **에러 포맷**: 모든 실패 응답(4xx/5xx)은 단일 포맷을 따릅니다.
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "요청 형식이 올바르지 않습니다", "detail": {} } }
  ```
- **페이지네이션**: 커서 방식. 목록 응답은 `{"items": [...], "next_cursor": "..."}` — `next_cursor`가 `null`이면 마지막 페이지.
- **Idempotency-Key**: 생성 계열 POST(`POST /v1/jobs`)는 요청 헤더 `Idempotency-Key: <클라이언트 생성 UUID>`가 필수입니다.
  - 같은 키로 재요청하면 새 작업을 만들지 않고 **원래 job을 그대로 반환**합니다(409 아님). 네트워크 재시도·중복 탭 대응.
  - **"다시 만들기" 버튼(W-06)은 반드시 새 UUID를 발급**해 새 job을 만듭니다 — 같은 키를 재사용하면 안 됩니다.
  - ERD 정합: `generation_job.idempotency_key`는 `UNIQUE(member_id, idempotency_key)`(전역 아님, [04-erd.md §2.6](04-erd.md)).
- **Rate limit**: IP/세션 단위로 생성 계열 엔드포인트에 제한을 둡니다(구체 임계치는 구현 시 결정). 초과 시 `RATE_LIMITED`.

### 코드 표

이 API의 코드는 두 채널로 쓰입니다. ① **HTTP 에러**: 요청 자체가 실패해 `error.code`로 내려가는 코드(4xx/5xx). ② **리소스 필드값**: 요청은 200으로 성공하되 리소스 상태를 코드로 표현하는 경우(예: 업로드는 항상 200이고 차단 여부는 `blocking_issue` 필드로 표현 — 사전 경고를 에러로 취급하면 클라이언트가 매번 예외 처리를 해야 해서 UX상 불리함). [04-erd.md](04-erd.md)의 `generation_job.error_code`, `credit_ledger.reason`과 이름·값을 맞췄습니다.

| 코드 | 채널 | HTTP | 의미 |
|---|---|---|---|
| `VALIDATION_ERROR` | HTTP 에러 | 400 | 요청 필드 누락·형식 오류 |
| `UNAUTHORIZED` | HTTP 에러 | 401 | 토큰 없음/서명 무효 |
| `TOKEN_EXPIRED` | HTTP 에러 | 401 | Bearer JWT 만료 — 클라이언트는 게스트면 `POST /v1/auth/guest` 재발급, 회원이면 재로그인 |
| `NOT_FOUND` | HTTP 에러 | 404 | 대상 리소스 없음 |
| `RATE_LIMITED` | HTTP 에러 | 429 | 요청 빈도 초과 |
| `INSUFFICIENT_CREDIT` | HTTP 에러 | 402 | `POST /v1/jobs` 시점 크레딧 부족(FR-EDGE-03) |
| `ALREADY_CLAIMED` | HTTP 에러 | 409 | `POST /v1/credits/claim` 중복 요청 — `credit_ledger.dedupe_key` UNIQUE 충돌([04-erd.md §2.8](04-erd.md)) |
| `INVALID_CREDENTIALS` | HTTP 에러 | 401 | `POST /v1/auth/login` 실패 — 이메일 존재 여부를 구분하지 않는 단일 메시지 |
| `EMAIL_TAKEN` | HTTP 에러 | 409 | `POST /v1/auth/register` — 이미 가입된 이메일 |
| `CAFE24_ALREADY_LINKED` | HTTP 에러 | 409 | 카페24 연동(request/verify) — 이미 다른 회원/다른 카페24 계정에 연동됨 |
| `CAFE24_MEMBER_NOT_FOUND` | HTTP 에러 | 404 | `POST /v1/auth/cafe24/link/request` — 입력한 아이디/휴대폰 번호의 쇼핑몰 회원이 없음 |
| `FOLLOW_IG_NOT_OPENED` | HTTP 에러 | 400 | `POST /v1/credits/claim` follow_ig — 「팔로우하러 가기」(`follow_ig_open` 이벤트) 없이/10초 안에/30분 지나서 받기 |
| `INSTAGRAM_ALREADY_USED` | HTTP 에러 | 409 | follow_ig — 같은 인스타 아이디(claim) 또는 같은 인스타 계정 igsid(redeem-instagram)로 이미 다른 회원이 받음 |
| `INSTAGRAM_CODE_INVALID` | HTTP 에러 | 404 | `POST /v1/credits/redeem-instagram` — 없는/만료(30일)/팔로우 미확인 코드 |
| `CAFE24_CODE_INVALID` | HTTP 에러 | 400 | `POST /v1/auth/cafe24/link/verify` — 인증번호 불일치·만료·미발급(오답 1회로 코드 소비, 재발송 필요) |
| `ALREADY_MEMBER` | HTTP 에러 | 409 | 회원 토큰으로 register/login/소셜 authorize 호출 — 로그인 수단 추가는 MVP 미지원(이슈 #17) |
| `MEMBER_ONLY` | HTTP 에러 | 403 | **유효한 게스트 토큰**으로 회원 전용 기능 접근(`POST /v1/credits/claim`·카페24 연동) — 401과 달리 토큰은 살아있으므로 클라이언트는 세션을 지우지 말고 로그인 시트를 띄움(이슈 #52) |
| `CAT_DETECTED` | 리소스 필드값(`uploads.blocking_issue.code`) | — (본 요청은 200) | 고양이 감지 — 업로드 진행 차단(FR-EDGE-07) |
| `NOT_A_DOG` | 리소스 필드값(`uploads.warnings[].code`) | — (200) | 강아지 미검출 — 경고만, 진행 허용(FR-EDGE-08) |
| `MULTI_SUBJECT` | 리소스 필드값(`uploads.warnings[].code`) | — (200) | 여러 마리 감지(FR-EDGE-09) |
| `QUALITY_WARNING` | 리소스 필드값(`uploads.warnings[].code`) | — (200) | 흐림/저조도 — 경고만, 진행 허용(`detail.issues`에 `blur`/`dark`) |
| `HUMAN_FACE_DETECTED` | 리소스 필드값(`uploads.warnings[]` 또는 `blocking_issue`) | — (200) | 사람 얼굴 포함 — `app_setting.human_face_policy`(`warn`/`block`/`allow`)에 따라 경고 또는 차단(FR-EDGE-06) |
| `GENERATION_FAILED` | 리소스 필드값(`generation_job.error_code`) | — (job 조회는 200) | 모델 생성 오류(FR-EDGE-01) |
| `SAFETY_BLOCKED` | 리소스 필드값(`generation_job.error_code`) | — (200) | 생성 후 안전 필터 차단(FR-EDGE-13) |
| `MAX_RETRIES_EXCEEDED` | 리소스 필드값(`generation_job.error_code`) | — (200) | lease 재시도 임계 초과([06-architecture-deployment.md §2.2](06-architecture-deployment.md)) |

---

## §2 화면-API 매핑

각 화면(W-01~W-11)의 UI 요소가 어느 엔드포인트·필드에서 오는지 정리합니다. "정적"으로 표기된 요소는 API 호출 없이 클라이언트에 고정된 콘텐츠입니다.

### W-01 · 랜딩 ([#p01](wireframe-spec-v0.5.html#p01))

| UI 요소 | 데이터 출처 |
|---|---|
| 로그인 칩 | `POST /v1/auth/*` (§3 인증 참고) |
| before/after 히어로 슬라이더 | 정적 자산(고정 예시 이미지) |
| "지금 인기 스타일" 카드 3~5장 | `GET /v1/styles?section=popular&limit=5` |
| 주 버튼("사진 올리고 무료로 1장 만들기") | 네비게이션만, API 호출 없음(W-02/W-04로 이동) |

### W-02 · 홈 · 스타일 카탈로그 ([#p02](wireframe-spec-v0.5.html#p02))

| UI 요소 | 데이터 출처 |
|---|---|
| 크레딧 배지 "◆ 12" | `GET /v1/credits` → `balance` |
| 앵커바 섹션 목록(인기/여름/직업/영화/아트…) | `GET /v1/styles` → `sections[].name` |
| 섹션별 스타일 카드 그리드(이름·결과예시 이미지·비용) | `GET /v1/styles` → `sections[].styles[]`(id, name, thumbnail_url, credit_cost) |
| 하단 "전체 68개" | `GET /v1/styles` → `total_count` |
| ETag 캐싱 | `GET /v1/styles` 응답 헤더 `ETag`, 클라이언트 `If-None-Match` → 변경 없으면 304 |

### W-03 · 스타일 상세(바텀시트) ([#p03](wireframe-spec-v0.5.html#p03))

| UI 요소 | 데이터 출처 |
|---|---|
| 적용 예시 캐러셀(6장) | `GET /v1/styles/{style_id}` → `examples[]` |
| 타이틀·크레딧 비용 | `GET /v1/styles/{style_id}` → `name`, `credit_cost` |
| 적합도 태그 칩(소형견◎/대형견◎/검은털△) | `GET /v1/styles/{style_id}` → `fit_tags[]` |
| "평균 48초 · 1장 생성" | `GET /v1/styles/{style_id}` → `avg_duration_seconds`, `output_count` |
| "이 스타일로 만들기" | 네비게이션(W-04로), 생성 자체는 `POST /v1/jobs` |

### W-04 · 사진 업로드 · 품질 체크 ([#p04](wireframe-spec-v0.5.html#p04))

| UI 요소 | 데이터 출처 |
|---|---|
| "저장된 강아지" 프로필 목록 | `GET /v1/pets` |
| 업로드 영역 | `POST /v1/uploads`(파일 전송) |
| 품질 경고("얼굴이 조금 어두워요" 등, 비차단) | `POST /v1/uploads` 응답 → `warnings[]`(`QUALITY_WARNING`/`NOT_A_DOG`/`MULTI_SUBJECT`/`HUMAN_FACE_DETECTED`) |
| 진행 자체를 막는 경우(고양이) | `POST /v1/uploads` 응답 → `blocking_issue`(`CAT_DETECTED`, 정책에 따라 `HUMAN_FACE_DETECTED`) |
| "이대로 만들기 · 1 크레딧" | `POST /v1/jobs`(§4 시나리오 2) |
| "실패하면 크레딧은 자동 반환됩니다" | 정적 안내 문구 |

### W-05 · 생성 대기 ([#p05](wireframe-spec-v0.5.html#p05))

| UI 요소 | 데이터 출처 |
|---|---|
| 진행바·진행 문구·"약 14초" | `GET /v1/jobs/{job_id}` 폴링 → `progress`, `status_message`, `eta_seconds` |
| "알림 받고 나가기" | 이탈해도 서버는 계속 처리(폴링 중단만, 별도 API 없음). 재방문 시 동일 `GET /v1/jobs/{job_id}`로 상태 복원 |
| "기다리는 동안" 스타일 카드 3장 | `GET /v1/styles?section=popular&limit=3` |

### W-06 · 결과 ([#p06](wireframe-spec-v0.5.html#p06))

| UI 요소 | 데이터 출처 |
|---|---|
| 비교 슬라이더(원본/변환) + 서명 | `GET /v1/jobs/{job_id}` → `source_image_url`, `results[].image_url`(서명은 이미지 자체에 합성되어 저장됨) |
| 결과 이미지 1장 | `GET /v1/jobs/{job_id}` → `results[]`(1개 — Q4 확정: 1요청 1장, 썸네일 선택 UI 제거) |
| 저장(보관함) | 로그인 회원은 결과가 자동으로 보관함에 남음(`GET /v1/library`에서 조회). 게스트는 W-06 B 계정 연동 필요 |
| 인스타 공유 | `POST /v1/jobs/{job_id}/share` |
| "다시 만들기 · 1 크레딧" | `POST /v1/jobs`(**새 Idempotency-Key** 필수) |
| 계산기 배너 | `GET /v1/calculator-link?pet_id=` 또는 `?job_id=`(§2 W-07 참고) |
| 쇼핑몰 행(썸네일·배송안내) | 정적 콘텐츠(운영이 갱신하는 설정값, API 비대상) |
| "이 사진으로 다른 스타일" | `GET /v1/styles?section=popular&limit=3` |
| W-06 B 계정 연동 바텀시트 | 로그인 3종(ADR-11): "카카오로 계속하기" → `GET /v1/auth/kakao/authorize`, "네이버로 계속하기" → `GET /v1/auth/naver/authorize`, 이메일 가입/로그인 → `POST /v1/auth/register` / `POST /v1/auth/login`. 카페24 버튼 없음(연동은 로그인 후 마이페이지·W-10) |

### W-07 · 계산기로 넘기기 ([#p07](wireframe-spec-v0.5.html#p07))

| UI 요소 | 데이터 출처 |
|---|---|
| 계산기 배너 문구("사진에서 푸들로 봤어요") + URL | `GET /v1/calculator-link?pet_id=` → `{breed_code, breed_label, size_label, calculator_url}` |
| URL 표기(`calculator.html?name=…&breed=…&size=…`) | 위 응답의 `calculator_url`을 그대로 사용(서버가 완성된 URL 반환, UTM 포함) |

**계약 노트**(Q9 확정, PR #122·이슈 #161): 계산기는 별도 코드 체계 없이 **한글 견종명이 키**(`calculator.js` `BREEDS` 40종)라 `breed_code` = `breed_label` = 한글명입니다(`app/breeds.py` 스냅샷, `07-decisions.md#Q9`). 목록에 없거나 매칭 불가 시 `breed_code: "믹스견"` 폴백, 완전 실패 시 `breed_code: null` → 계산기 1단계부터 시작(URL에 breed 파라미터 생략). 3케이스 예시는 §3 `GET /v1/calculator-link` 참고. 견종은 사용자가 W-04 에서 고르거나 직접 쓴 값입니다(`POST /v1/jobs` `breed`).

### W-08 · 크리에이티브 모드 ([#p08](wireframe-spec-v0.5.html#p08))

| UI 요소 | 데이터 출처 |
|---|---|
| 예시 칩("눈 오는 날 산책" 등) | 정적 콘텐츠(고정 예시 목록) |
| "만들기 · 2 크레딧" | `POST /v1/jobs`(`custom_prompt` 필드 포함, `credit_cost=2`) |
| 제약 안내(품종·털색 변경 불가) | 정적 문구 |

### W-09 · 보관함 ([#p09](wireframe-spec-v0.5.html#p09))

| UI 요소 | 데이터 출처 |
|---|---|
| 강아지별 필터 칩 | `GET /v1/pets` |
| 월 섹션 그리드 | `GET /v1/library?pet_id=&cursor=`(월별 그룹, 커서 페이지네이션) |
| 롱프레스 선택 모드 → 삭제/일괄 저장 | `DELETE /v1/library`(bulk, `{ids: []}`) |

### W-10 · 크레딧 받기 ([#p10](wireframe-spec-v0.5.html#p10))

| UI 요소 | 데이터 출처 |
|---|---|
| A · 잔액 "보유 크레딧 11" | `GET /v1/credits` → `balance` |
| A · 4개 획득 행(주문+20/연동+3/팔로우+2/오늘의무료+1)과 각 행의 상태(가능/완료/내일 다시) | `GET /v1/credits` → `earn_actions[]`(action, amount, status, cta) |
| "쇼핑몰 →" (주문하기) | **레퍼럴 링크** `https://nutti.co.kr/?utm_source=nutti_playground&utm_medium=referral&utm_campaign=playground_exit&utm_content=w10_credits`(W-06 배너 `w06_result`, 탭바 `tabbar` — `web/src/app/externalLinks.ts shopLink`, 계산기 링크와 같은 UTM 규약). GA4 크로스도메인 `_gl`은 gtag가 앵커 클릭에 자동 부착. 지급 자체는 카페24 주문 동기화·웹훅이 처리 |
| 연동 +3 행 CTA("연동하기", 미연동 회원) | 쇼핑몰 가입 휴대폰 번호(또는 아이디) 입력 → `POST /v1/auth/cafe24/link/request`(회원 토큰, 카페24가 회원 휴대폰으로 SMS 인증번호 발송) → 6자리 입력 → `POST /v1/auth/cafe24/link/verify`가 +3 지급(§3 인증). 게스트에게는 로그인 유도(§3 로그인 3종) |
| 각 획득 CTA(팔로우/오늘의무료 받기) | `POST /v1/credits/claim` → `{action: "follow_ig", instagram_username}` \| `{action: "daily"}` — 팔로우는 인스타 아이디 입력 + 「팔로우하러 가기」(`POST /v1/events {event_type:"follow_ig_open"}`) 10초~30분 뒤에만("order"는 배치 자동 지급, "link_account"는 카페24 연동 콜백이 지급하므로 이 엔드포인트로 클레임하지 않음) |
| B · 받은 내역 테이블 | `GET /v1/credits/ledger?cursor=`(커서 페이지네이션) → `{reason, ref_label, occurred_on, amount}` |

### W-11 · 프롬프트 운영 콘솔(내부/관리자) ([#p11](wireframe-spec-v0.5.html#p11))

관리자 전용 화면. 엔드포인트 상세는 **§5 관리자 API**에서 다룹니다(사용자 대면 API와 인증·권한 경계가 다름).

| UI 요소 | 데이터 출처 |
|---|---|
| 스타일 테이블(선택률·공유율·쇼핑몰) | `GET /v1/admin/styles`(§5) |
| "새 스타일" / 스타일 CRUD | `POST/PATCH/DELETE /v1/admin/styles/{id}`(§5) |
| 커스텀 입력 상위 + "스타일로 승격" | `GET /v1/admin/custom-prompts/top`, `POST /v1/admin/custom-prompts/{id}/promote`(§5) |
| 프롬프트 버전·A/B | `GET/POST/PATCH /v1/admin/styles/{id}/prompt-versions`(§5) |
| 모델 설정 | `style_prompt_version.model_config`(§5 프롬프트 버전 엔드포인트에 포함) |
| 크레딧 지급 규칙 | `app_setting`(§5 `GET/PATCH /v1/admin/settings`) |
| 카페24 연동 상태 | `GET /v1/admin/cafe24/status`(§5) |

---

## §3 엔드포인트 시그니처

### 인증

**구조(ADR-11, 2026-08-04 개정)**: 로그인 수단은 **카카오 · 네이버 · 로컬(이메일+비밀번호) 3종**이며, 게스트 병합·승격(UC-07)은 이 3종의 가입/로그인 시점에 일어납니다. **카페24는 로그인 수단이 아니라 회원의 쇼핑몰 계정 연동**입니다(마이페이지·W-10) — 연동 시 +3 크레딧과 주문 보상 자격(`order_reward_cutoff`)이 발생합니다.

**OAuth 공통 규칙**:

- `authorize` 계열은 302 리다이렉트가 아니라 **200 `{"authorize_url": ...}`**을 반환합니다. state가 호출 주체의 토큰에 바인딩되어 Authorization 헤더가 필수인데, 브라우저 링크 이동으로는 헤더를 실을 수 없기 때문 — 프론트는 fetch로 URL을 받아 `window.location`으로 이동합니다.
- 프로바이더 콘솔에 등록하는 redirect_uri는 **프론트 라우트**입니다 — 놀이터 도메인이 `play.nutti.co.kr`로 확정(2026-08-26)되어 등록값은 `https://play.nutti.co.kr/auth/callback/{kakao|naver}` 두 개입니다(카카오·네이버 콘솔 각각 — 카페24 연동은 OAuth가 아니라 SMS OTP라 콜백이 없음). 프로바이더는 등록값과 **정확히** 일치해야 받아 주므로 스킴·후행 슬래시까지 그대로여야 하고, 프론트가 이 경로(`web/src/screens/AuthCallback.tsx`)를 바꾸면 콘솔 두 곳도 같이 바꿔야 합니다. 프론트는 쿼리로 받은 `code`·`state`를 아래 콜백 엔드포인트에 fetch로 전달해 세션 JSON을 받습니다.
- `state`는 서명 JWT + DB nonce(`member.oauth_state_nonce`, 5분 만료)로 **일회성**입니다. 재사용·주체 불일치·만료는 전부 401.
- **이미 회원인 토큰**으로 `register`/`login`/소셜 `authorize`를 호출하면 `409 ALREADY_MEMBER`(로그인 수단 추가는 MVP 미지원 — 이슈 #17). 프론트는 `/me`의 `kind`가 `member`면 로그인 시트를 띄우지 않습니다.

#### `POST /v1/auth/guest`

요청 본문 없음. IP당 **30회/시간** 레이트리밋(기본값, `GUEST_RATE_LIMIT_PER_HOUR` — 이슈 #15). 초과 시 `429 RATE_LIMITED` + `Retry-After: <초>` 헤더.

```json
// 201
{
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI4ZjE0ZTQ1NyJ9.xxx",
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "guest"
}
```

#### `GET /v1/auth/{provider}/authorize` — `provider ∈ kakao | naver`

헤더: `Authorization: Bearer <guestToken>` **필수**(미병합 게스트).

```json
// 200
{ "authorize_url": "https://kauth.kakao.com/oauth/authorize?client_id=...&response_type=code&state=..." }
```

#### `GET /v1/auth/{provider}/callback?code=...&state=...`

```json
// 200 — MemberSession
{
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI4ZjE0ZTQ1NyJ9.yyy",
  "refresh_token": "8fFq3...one-time-plaintext...Zk",
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "member",
  "merged": true,
  "credit_balance": 15
}
```
`merged: true`는 UC-07 분기 A(기존 회원 행에 병합·자산 이관), `false`는 분기 B(게스트 행 승격). 클라이언트는 즉시 게스트 토큰을 회원 토큰으로 교체합니다.

**회원 세션 = 액세스(1h) + 리프레시(30일, 회전)** — 이슈 #47(2026-08-10 확정). MemberSession을 반환하는 모든 응답(소셜 콜백·register·login)에 `refresh_token`이 포함되며 원문은 이때 한 번만 노출됩니다(서버는 해시만 보관, 회원당 활성 1개 — 새 로그인 시 이전 세션 무효화). 게스트는 리프레시 없음(30일 JWT + `POST /v1/auth/guest` 재발급 유지).

#### `POST /v1/auth/register` — 로컬 가입

헤더: `Authorization: Bearer <guestToken>` 필수.

```json
// 요청
{ "email": "user@example.com", "password": "correct-horse-battery" }
```
```json
// 201 — MemberSession (게스트 행 승격, merged: false)
{ "token": "eyJ...", "member_id": "8f14e457-...", "kind": "member", "merged": false, "credit_balance": 4 }
```
`409 EMAIL_TAKEN`: 이미 가입된 이메일. 형식 오류·길이 위반은 `400 VALIDATION_ERROR`(§1 공통 포맷).
레이트리밋: IP당 20회/시간(`429` + `Retry-After`). 이메일은 소문자화·공백 제거 후 비교, 최대 254자·비밀번호 8~128자.

> **로컬 계정 복구 불가(이슈 #17)**: MVP는 비밀번호 재설정·이메일 인증을 제공하지 않습니다. 가입 이메일의 소유 증명이 없으므로 비밀번호 분실 시 **계정과 누적 크레딧을 복구할 수단이 없습니다** — 프론트는 로컬 가입 시트에 이를 사전 고지합니다(#11 L6 게스트 잔액 고지와 동일한 성격). 재설정은 후속 범위.

#### `POST /v1/auth/login` — 로컬 로그인

헤더: `Authorization: Bearer <guestToken>` 필수.

```json
// 요청
{ "email": "user@example.com", "password": "correct-horse-battery" }
```
```json
// 200 — MemberSession (현재 게스트가 기존 회원에 병합됨)
{ "token": "eyJ...", "member_id": "8f14e457-...", "kind": "member", "merged": true, "credit_balance": 15 }
```
`401 INVALID_CREDENTIALS`: 이메일 존재 여부를 구분하지 않습니다.
레이트리밋: IP당 20회/시간 + 이메일당 10회/시간(온라인 대입 방어, `429` + `Retry-After`).

#### `POST /v1/auth/refresh` — 액세스 토큰 재발급(이슈 #47)

헤더: Authorization **불요**(만료된 액세스 상태에서 호출하는 엔드포인트). IP당 20회/시간 레이트리밋(`429` + `Retry-After`).

```json
// 요청
{ "refresh_token": "8fFq3...Zk" }
```
```json
// 200 — 회전: 액세스·리프레시 둘 다 새로 발급, 구 리프레시는 즉시 무효
{ "token": "eyJ...", "refresh_token": "새로운-리프레시-원문" }
```
`401 UNAUTHORIZED`: 위조·만료·**이미 회전된 구 토큰 재사용** — 클라이언트는 SESSION_LOST 처리 후 재로그인 유도. **주의**: 이 401은 재생 방지이지 도난 탐지가 아닙니다 — 탈취자가 먼저 회전하면 탈취자 세션이 살아남고 정상 사용자가 로그아웃됩니다(잔여 위험 수용, 재사용 탐지·절대 세션 수명 상한은 후속 — 이슈 #11 추적).

**프론트 배선**: `TOKEN_EXPIRED` 수신 시 게스트는 `POST /v1/auth/guest`, 회원은 이 엔드포인트로 재시도(1회) — refresh도 401이면 그때 세션 끊김 안내.

#### `POST /v1/auth/cafe24/link/request` — 쇼핑몰 계정 연동 1/2: 인증번호 발송(회원 전용)

> 카페24 OAuth(`/oauth/authorize`)는 **몰 운영자** 로그인이라 고객 본인 확인에 쓸 수 없음이 확인돼(2026-09-01) **SMS OTP 2단계**로 교체. 서버는 고객 휴대폰 번호를 보지 않고, 카페24 Admin API(`POST /admin/sms`, 수신자=쇼핑몰 회원 아이디)가 카페24에 등록된 번호로 대신 발송한다 — "그 아이디의 회원 휴대폰을 쥔 사람"만 코드를 알 수 있으므로 소유권 검증이 성립한다.

헤더: `Authorization: Bearer <memberToken>` **필수**(게스트는 `403 MEMBER_ONLY` — 먼저 로그인).

```json
// 요청 — 둘 중 하나만
{ "cellphone": "01012345678" }      // 기본: 쇼핑몰 가입 휴대폰 번호(숫자만, 01로 시작 10~11자리)
{ "shop_member_id": "kongmom" }     // 폴백: 아이디 2~64자, A-Za-z0-9 _ . @ -
```
카카오/네이버로 쇼핑몰에 가입한 고객은 아이디가 `4993695098@k` 꼴이라 본인이 모른다 → **번호가 기본 경로**(Admin API `GET /admin/customers?cellphone=`, 하이픈은 클라이언트가 제거). 둘 다/둘 다 없음/형식 위반 → `400 VALIDATION_ERROR`. 한 번호에 계정이 여러 개일 수 있으며(실측 3개) 그래도 같은 폰이라 SMS는 첫 계정으로 1통만 보낸다.

```json
// 200 — 5분 유효 6자리 코드를 카페24가 SMS 발송
{ "sent": true, "expires_in": 300 }
```
- `404 CAFE24_MEMBER_NOT_FOUND`: 해당 아이디/번호의 쇼핑몰 회원 없음.
- `409 CAFE24_ALREADY_LINKED`: 연동 가능한 계정이 하나도 없음 — ① 찾은 계정이 전부 **다른 회원**에 연동됨, 또는 ② 이 회원이 이미 **다른 카페24 계정**에 연동됨(재바인딩 금지 — 해제는 MVP 미지원). 발송 전에 검사하므로 SMS 비용이 나가지 않는다.
- `429 RATE_LIMITED`: **시간당 3회** — 요청 회원 기준과 수신 쇼핑몰 아이디 기준 둘 다(새 회원을 찍어내며 한 사람 폰에 퍼붓는 SMS 펌핑 차단). 한도 검사가 409 검사보다 먼저라 "이미 연동된 아이디인지"도 무제한으로 캐물을 수 없다.
- `502 BAD_GATEWAY`: 카페24 토큰 미발급/만료·SMS 잔액 부족·발신번호 미등록 등 Admin API 실패.
- 재요청은 이전 코드를 **덮어쓴다**(마지막 코드만 유효). 코드는 원문 저장 없이 `sha256(tel|id:입력값:code:서버키)` 다이제스트만 `member.oauth_state_nonce`(+`oauth_state_expires_at`)에 둔다.

#### `POST /v1/auth/cafe24/link/verify` — 쇼핑몰 계정 연동 2/2: 인증번호 확인

헤더: `Authorization: Bearer <memberToken>` **필수**.

```json
// 요청 — request와 같은 식별자(번호 또는 아이디) + 코드
{ "cellphone": "01012345678", "code": "482913" }
```
```json
// 200 — 연동 완료
{ "cafe24_linked": true, "credit_balance": 15, "candidates": null }
```
```json
// 200 — 번호에 연동 가능한 쇼핑몰 계정이 여러 개: 아직 미연동, 코드는 **소비되지 않음**
{ "cafe24_linked": false, "credit_balance": 12, "candidates": ["tester123", "4950033661@k"] }
// → 같은 코드로 한 번 더: { "cellphone": "01012345678", "code": "482913", "shop_member_id": "4950033661@k" }
```
- 코드는 **단일 시도**: 오답은 즉시 소비, 정답은 연동(또는 계정 선택 완료)과 같은 잠금 안에서 소비된다(무차별 대입 차단). 오답이면 `400 CAFE24_CODE_INVALID` → 프론트는 "인증번호 다시 받기"로 유도. 만료(5분)·미발급도 같은 400.
- `candidates`는 OTP를 **통과한 뒤에만** 내려간다 — 번호만 알고 코드가 없는 사람은 그 번호의 쇼핑몰 아이디를 알아낼 수 없다. 다른 회원이 선점한 계정은 목록에서 빠지고, 이미 연동된 회원은 자기 계정만 남는다(재바인딩 금지).
- 연동 +3 크레딧은 `credit_ledger` dedupe(`link_account`)로 1회만 지급 — 재연동해도 반복 수령 불가.
- `member.order_reward_cutoff` 기록(최초 1회) → 이후 주문부터 +20 보상 자격(ADR-09). 동일 계정 재연동(멱등 재시도)은 200이며 cutoff를 앞으로 밀지 않는다.
- `409 CAFE24_ALREADY_LINKED`: request와 같은 두 경우(request 이후 다른 탭에서 먼저 연동된 경합). **자산 병합은 일어나지 않습니다** — 연동은 로그인이 아니므로 UC-07 미적용.

**프론트 배선**: `web/src/api/endpoints.ts`의 `authorize('cafe24')`/`cafe24Callback`과 `AuthCallback.tsx`의 cafe24 분기는 폐기 대상 — W-10 연동 행·W-12 마이페이지 CTA는 아이디 입력 → 코드 입력 2단계 시트로 바뀌고, 성공 시 `/auth/me`·`/credits`·원장 캐시를 무효화한다.

> `POST /v1/auth/kakao`(클라이언트 SDK 토큰 전달)는 이슈 #10 A안(서버 리다이렉트) 확정으로 **삭제**되었습니다.

#### `GET /v1/auth/me`

```json
// 200
{
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "member",
  "credit_balance": 11,
  "email": null,
  "nickname": "콩이엄마",
  "providers": ["kakao"],
  "cafe24_linked": true
}
```
`providers`: 회원이 보유한 로그인 수단(`kakao`/`naver`/`local`, 복수 가능). 게스트는 `[]`이며 `email`은 `local` 미보유 시 `null`. `nickname`은 소셜 로그인 시 프로바이더 프로필에서 수집(이슈 #12) — 로컬 전용 회원·미제공 시 `null`(프론트는 이메일 앞부분/이니셜 폴백).

#### `POST /v1/auth/logout`

응답: `204 No Content`(본문 없음). 회원이면 서버가 리프레시 토큰을 폐기하고 `member.token_version`을 증가시켜 **기발급 액세스 토큰도 즉시 무효화**합니다(#11 M6). 게스트는 서버측 무효화 없음(30일 만료 수용).

#### `DELETE /v1/auth/me`

회원 탈퇴(이슈 #22). 응답: `204 No Content`. 게스트는 `403 MEMBER_ONLY`.

- **자산 파기**: 업로드 원본(`source_image`)·생성 결과물(`generation_result`)을 즉시 논리삭제(`deleted_at`) — 스토리지 실파기(R2 삭제·CDN 퍼지)는 06-architecture §4 삭제 파이프라인 배치가 유예 없이 수행. 펫 프로필은 즉시 삭제.
- **크레딧**: 잔액 즉시 소멸(`withdrawal_forfeit` 원장 기록, 재가입 복구 없음). `credit_ledger`는 감사 목적으로 보존.
- **member 행**: 삭제 대신 **익명화**(email·소셜 ID·카페24 ID·닉네임·비밀번호 해시·토큰 관련 필드 전부 NULL) + `withdrawn_at` 기록 + `token_version` 증가(모든 토큰 즉시 무효). 원장 FK 유지를 위해 행은 남습니다.
- **재가입**: 동일 이메일/소셜로 재가입 시 완전 신규 회원(익명화로 unique 충돌 없음, 데이터·크레딧 승계 없음).
- **카페24**: 놀이터 탈퇴는 쇼핑몰 회원에 무영향 — 프론트가 확인 화면에 고지(W-12).

---

### 스타일

#### `GET /v1/styles`

쿼리: `section?`(string), `limit?`(int)

```json
// 200 — 헤더 ETag: "a1b2c3d4"
{
  "sections": [
    {
      "name": "인기",
      "count": 8,
      "styles": [
        {
          "id": 101,
          "code": "lego-minifig",
          "name": "레고 미니피겨",
          "thumbnail_url": "https://cdn.nutti.co.kr/styles/lego-minifig/thumb.jpg",
          "credit_cost": 1,
          "uses_pet_name": true,
          "uses_breed": false
        },
        {
          "id": 108,
          "code": "ghibli-watercolor",
          "name": "지브리 수채",
          "thumbnail_url": "https://cdn.nutti.co.kr/styles/ghibli-watercolor/thumb.jpg",
          "credit_cost": 2,
          "uses_pet_name": false,
          "uses_breed": true
        }
      ]
    }
  ],
  "total_count": 68
}
```

- **`section=popular`은 예약 키워드**(이슈 #53, 2026-08-10 확정): 컬럼 매칭이 아니라 **public 전체에서 `sort_order` 상위 N**(N=`limit`, 기본 12)을 `name: "인기"` 섹션 하나로 반환합니다. W-01·W-05·W-06의 인기 카드 호출(§2)이 이 키워드를 사용합니다. 그 외 `section` 값은 저장된 한글 섹션명과 정확 일치로 필터.
- **`total_count`는 필터와 무관하게 전체 public 스타일 수**입니다(W-02 하단 "전체 N개" 용도) — 섹션 개수는 `sections[].count`를 사용하세요.

#### `GET /v1/styles/{style_id}`

```json
// 200
{
  "id": 101,
  "code": "lego-minifig",
  "name": "레고 미니피겨",
  "credit_cost": 1,
  "examples": [
    "https://cdn.nutti.co.kr/styles/lego-minifig/ex1.jpg",
    "https://cdn.nutti.co.kr/styles/lego-minifig/ex2.jpg",
    "https://cdn.nutti.co.kr/styles/lego-minifig/ex3.jpg",
    "https://cdn.nutti.co.kr/styles/lego-minifig/ex4.jpg",
    "https://cdn.nutti.co.kr/styles/lego-minifig/ex5.jpg",
    "https://cdn.nutti.co.kr/styles/lego-minifig/ex6.jpg"
  ],
  "fit_tags": [
    { "label": "소형견", "score": "good" },
    { "label": "대형견", "score": "good" },
    { "label": "검은 털", "score": "caution" }
  ],
  "avg_duration_seconds": 24,
  "output_count": 1,
  "uses_pet_name": true,
  "uses_breed": false
}
```
`404 NOT_FOUND`: 존재하지 않거나 `status='retired'`인 스타일.

---

### 업로드

#### `POST /v1/uploads`

요청: `multipart/form-data` — `file`(이미지), `pet_id?`(기존 프로필 재사용 시)

```json
// 200 — 정상(경고 없음)
{
  "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "blocking_issue": null,
  "warnings": []
}
```
```json
// 200 — 품질 경고(비차단, 진행 버튼 그대로 활성)
{
  "upload_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
  "image_url": "https://cdn.nutti.co.kr/uploads/9c858901.../orig.jpg",
  "blocking_issue": null,
  "warnings": [
    { "code": "QUALITY_WARNING", "message": "얼굴이 조금 어두워요", "detail": { "issues": ["dark"] } }
  ]
}
```
견종은 업로드가 추정하지 않습니다(비전 견종 추정 폐기). 사용자가 W-04 에서 고르거나 직접 쓴 값을 `POST /v1/jobs` 의 `breed` 로 보내면 서버가 업로드(와 붙은 강아지 `breed_label`)에 적어 두고, 워커 `[breed]` 치환·`calculator-link` 가 그 라벨을 읽습니다.
```json
// 200 — 차단(고양이 감지, FR-EDGE-07)
{
  "upload_id": null,
  "image_url": null,
  "blocking_issue": { "code": "CAT_DETECTED", "message": "누띠는 강아지 전용이에요. 다른 사진을 골라주세요." },
  "warnings": []
}
```
`400 VALIDATION_ERROR`: 파일 누락·지원하지 않는 형식·용량 초과.

---

### 펫 CRUD

#### `GET /v1/pets`

```json
// 200
{
  "items": [
    { "id": "b6f9e6b0-...", "name": "콩이", "thumbnail_url": "https://cdn.nutti.co.kr/pets/b6f9e6b0.jpg", "breed": "토이푸들", "latest_upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6" },
    { "id": "d1a2b3c4-...", "name": "두부", "thumbnail_url": "https://cdn.nutti.co.kr/pets/d1a2b3c4.jpg", "breed": null, "latest_upload_id": null }
  ]
}
```
`breed`: 이 강아지로 만들 때 마지막에 입력한 견종(`POST /v1/jobs` `breed` 가 `pet_profile.breed_label` 갱신). 없으면 null — W-04 가 저장된 강아지 선택 시 견종 칸을 미리 채운다.
`latest_upload_id`(이슈 #9 A안): 해당 펫에 연결된 가장 최근 `source_image` id. 값이 있으면 W-04에서 **업로드 단계 스킵** — 이 값을 `POST /v1/jobs`의 `upload_id`로 그대로 사용(FR-W04-02). 연결된 업로드가 만료·삭제됐으면 `null`(스킵 불가, 새로 업로드).

#### `POST /v1/pets`

```json
// 요청
{ "name": "콩이", "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6" }
```
```json
// 201
{ "id": "b6f9e6b0-...", "name": "콩이", "thumbnail_url": "https://cdn.nutti.co.kr/pets/b6f9e6b0.jpg", "breed": null }
```

#### `PATCH /v1/pets/{pet_id}`

```json
// 요청
{ "name": "두부" }
```
```json
// 200
{ "id": "d1a2b3c4-...", "name": "두부", "thumbnail_url": "https://cdn.nutti.co.kr/pets/d1a2b3c4.jpg", "breed": "믹스견" }
```

#### `DELETE /v1/pets/{pet_id}`

응답: `204 No Content`.

---

### 생성 job

#### `POST /v1/jobs`

헤더: `Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000`

```json
// 요청 — 프리셋 스타일
{
  "style_id": 101,
  "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "pet_id": null,
  "custom_prompt": null,
  "breed": "말티즈"
}
```
`breed?`(≤50자): 견종 선택 목록(`app/breeds.py` 40종) 값 또는 직접 입력한 이름. 업로드 `source_image.breed_estimate.label` 과 붙은 강아지 `pet_profile.breed_label` 에 저장. 비우면 그 사진의 지난 값 유지(재생성 시 다시 안 물음).
```json
// 202
{ "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab", "status": "queued" }
```
```json
// 402 INSUFFICIENT_CREDIT
{
  "error": {
    "code": "INSUFFICIENT_CREDIT",
    "message": "크레딧이 부족합니다",
    "detail": { "required": 1, "balance": 0 }
  }
}
```

#### `GET /v1/jobs/{job_id}`

`style_id`·`upload_id`·`pet_id`(이슈 #9 A안): 이 job을 만든 재료 참조. W-06 "다시 만들기"(같은 재료 + 새 Idempotency-Key)와 "이 사진으로 다른 스타일"(같은 `upload_id` + 다른 `style_id`)이 이 세 필드로 `POST /v1/jobs`를 재조립합니다(FR-W06-04·FR-W06-07). 커스텀 프롬프트 job은 `style_id: null`, 펫 프로필이 연결되지 않은 이미지는 `pet_id: null`.

`queued_at`·`started_at`(이슈 #41, 2026-08-10 확정): 모든 job 응답에 포함되는 ISO 8601 시각 — `started_at`은 워커가 집기 전까지 `null`. FR-EDGE-02(90초 초과 → 백그라운드 전환) 판정은 **`started_at` 기준**입니다(큐 대기 시간 불포함 — NFR-PERF-01의 "생성 처리" 정의와 일치). 프론트의 localStorage `startedAt` 색인은 이 필드로 대체.

```json
// 200 — 진행 중(90초 이내)
{
  "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
  "status": "processing",
  "style_id": 101,
  "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "pet_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "breed": "말티즈",
  "progress": 62,
  "eta_seconds": 14,
  "status_message": "레고 블록을 쌓는 중…",
  "source_image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "results": null,
  "error_code": null
}
```
```json
// 200 — 완료
{
  "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
  "status": "succeeded",
  "style_id": 101,
  "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "pet_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "breed": "말티즈",
  "progress": 100,
  "eta_seconds": 0,
  "status_message": null,
  "source_image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "results": [
    { "index": 0, "image_url": "https://cdn.nutti.co.kr/results/aaa1.jpg" }
  ],
  "error_code": null
}
```
`results[]`는 항상 1개(Q4 확정 — 1요청 1장). 배열 형태는 산출 수 상향 대비로 유지하며, 다른 결과가 필요하면 "다시 만들기"(새 job·새 크레딧)로 재생성합니다.
```json
// 200 — 실패(모델 오류, 크레딧 자동 반환됨)
{
  "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
  "status": "failed",
  "style_id": 101,
  "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "pet_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "progress": null,
  "eta_seconds": null,
  "status_message": null,
  "source_image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "results": null,
  "error_code": "GENERATION_FAILED"
}
```
```json
// 200 — 안전 필터 차단(W-08 커스텀 프롬프트, 크레딧 자동 반환됨)
{
  "job_id": "c4f24d5b-3g2f-5b4b-0c2f-2345678901bc",
  "status": "failed",
  "style_id": null,
  "upload_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
  "pet_id": null,
  "progress": null,
  "eta_seconds": null,
  "status_message": null,
  "source_image_url": "https://cdn.nutti.co.kr/uploads/9c858901.../orig.jpg",
  "results": null,
  "error_code": "SAFETY_BLOCKED"
}
```
`404 NOT_FOUND`: 존재하지 않거나 다른 회원 소유의 job.

> `POST /v1/jobs/{job_id}/select`와 `selected_index` 필드는 **Q4 확정(1요청 1장)으로 삭제**되었습니다 — 단일 결과에는 선택이 없습니다.

#### `POST /v1/jobs/{job_id}/share`

```json
// 요청
{ "channel": "instagram" }
```
```json
// 200
{ "share_image_url": "https://cdn.nutti.co.kr/share/b3e13c4a-0.jpg" }
```

---

### 계산기 연결

#### `GET /v1/calculator-link`

쿼리: `pet_id?` 또는 `job_id?`

**Q9 확정(2026-08-19, 계산기 실측)**: 계산기(calculator/js/calculator.js의 `BREEDS` 40종)는 별도 코드 체계 없이 **한글 견종명이 키**다 — 따라서 `breed_code`=`breed_label`=한글명(app/breeds.py가 40종·크기 스냅샷 보유, 계산기 목록 변경 시 함께 갱신). 견종 후보는 펫 프로필 `breed_label` → 최신 업로드 라벨 순 — 둘 다 `POST /v1/jobs` `breed`(사용자가 고르거나 직접 쓴 값)로 채워진다(비전 추정 폐기). 프리필 **수신부 구현됨**(2026-09-02, 스마트디자인 calculator.js v=15 — `?breed=` 40종 한글명 매칭 시 카드 선택+2단계 진입, `?name=` 주입, 미매칭·미지정은 1단계 유지).

```json
// 200 — 정상 매칭
{
  "breed_code": "토이푸들",
  "breed_label": "토이푸들",
  "size_label": "소형",
  "calculator_url": "https://nutti.co.kr/calculator.html?name=콩이&breed=토이푸들&size=소형&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff"
}
```
```json
// 200 — 견종 40종 목록에 없음(FR-EDGE-11, "믹스견" 폴백)
{
  "breed_code": "믹스견",
  "breed_label": "믹스견",
  "size_label": "중형",
  "calculator_url": "https://nutti.co.kr/calculator.html?name=콩이&breed=믹스견&size=중형&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff"
}
```
```json
// 200 — 추정 완전 실패(FR-EDGE-10, breed 파라미터 생략 → 계산기 1단계부터)
{
  "breed_code": null,
  "breed_label": null,
  "size_label": null,
  "calculator_url": "https://nutti.co.kr/calculator.html?name=콩이&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff"
}
```

---

### 보관함

#### `GET /v1/library`

쿼리: `pet_id?`, `cursor?`

회원 전용입니다. 게스트는 `403 MEMBER_ONLY`를 반환합니다. 페이지당 최대 20개를 반환하며, `next_cursor`는 현재 페이지의 마지막 `result_id`입니다. 잘못된 `cursor` 또는 `pet_id`는 `400 VALIDATION_ERROR`를 반환합니다.

```json
// 200
{
  "months": [
    {
      "label": "2026년 8월",
      "items": [
        {
          "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
          "result_id": "e5f6a7b8-...",
          "image_url": "https://cdn.nutti.co.kr/results/aaa1.jpg",
          "pet_id": "b6f9e6b0-...",
          "created_at": "2026-08-03T10:00:00+09:00"
        }
      ]
    }
  ],
  "next_cursor": null
}
```

`pet_id`는 `uuid | null`입니다(이슈 #33) — **펫이 삭제됐거나**(`DELETE /v1/pets` 시 `source_image.pet_profile_id` SET NULL, 이슈 #12 결정4) **애초에 펫 없이 만든 결과**(`POST /v1/jobs`의 `pet_id: null`) 둘 다 `null`로 내려오며 클라이언트는 구분하지 않습니다("전체"에서만 노출). 삭제된 펫을 가리키는 `?pet_id=` 조회는 빈 목록(`months: []`)을 반환합니다(404 아님 — 필터 결과가 없는 것과 동일 취급).

페이지 경계에서 같은 달이 두 페이지로 나뉠 수 있으므로 클라이언트는 `label` 기준으로 병합합니다. 월 `label`과 `created_at`은 KST 기준입니다.

#### `DELETE /v1/library`

```json
// 요청
{ "ids": ["e5f6a7b8-...", "f6a7b8c9-..."] }
```
응답: `204 No Content`.

회원 전용이며 본인 소유 `result`만 논리 삭제합니다. 타인 소유 또는 존재하지 않는 `id`는 무시하므로 멱등적입니다. 삭제된 결과는 `GET /v1/jobs/{id}`와 share에서도 제외됩니다(이슈 #152).

---

### 크레딧

#### `POST /v1/webhooks/cafe24` — 카페24 주문 웹훅 수신(서버 간, 2026-09-01)

카페24 개발자센터 앱의 WebHook에 등록하는 URL. **주문 접수(90023) · 입금상태 변경(90025) · 취소상태 변경(90026/90072) · 환불상태 변경(90029/90073)** 이벤트를 받아 그 쇼핑몰 회원과 연동된 놀이터 회원의 주문을 **즉시 재동기화**한다(`cafe24.sync_member_orders(force=True)` → 배치와 같은 `_apply_order` 규칙). 페이로드의 `paid`/취소 여부는 **신뢰하지 않고 트리거로만** 쓴다 — 판정은 Admin API 재조회로. 주문 → 결제완료 → 수 초 안에 +20, 취소 → −20.

- 인증: 카페24가 개발자센터 "WebHook 인증정보"를 `X-API-Key` 헤더로 보냄 → `CAFE24_WEBHOOK_API_KEY`와 상수 시간 비교, 불일치·미설정 시 `401`.
- 응답: 항상 `202 {"accepted": true|false}` — 다른 몰·관심 없는 이벤트·비회원 주문·미연동 회원은 `false`로 조용히 무시(카페24는 실패율이 높으면 웹훅을 자동 OFF 하므로 4xx/5xx를 남발하지 않는다). 형식이 깨진 본문만 `400`.
- 동기화는 BackgroundTasks로 응답 뒤 실행(웹훅 타임아웃 회피). 누락 보정 = `GET /v1/credits` 진입 즉석 동기화 + 30분 크론(카페24 문서도 웹훅 단독 운영 비권장).
- 등록 절차·필요 권한(주문 이벤트는 상품분류·판매분류·회원·주문·상품·프로모션·공급사 **읽기** 권한 전부 필요)은 `deploy/README.md` §5.

#### `POST /v1/webhooks/instagram` · `GET /v1/webhooks/instagram` — 인스타 댓글→DM 퍼널(서버 간, 2026-09-01)

Meta 앱(Instagram API with Instagram Login)의 Webhooks에 등록하는 URL. 팔로우 여부를 제3자가 알 수 있는 **유일한 공식 경로**는 메시징 API의 사용자 프로필 `is_user_follow_business`이고, 이 값은 그 사용자가 **우리 계정에 DM을 보낸 뒤**에만 조회된다. 그래서:

1. `comments` 이벤트: 게시물 댓글에 키워드(`INSTAGRAM_COMMENT_KEYWORDS`, 기본 `놀이터`)가 있으면 그 댓글에 **비공개 답장**(댓글 후 7일 내 1회) — "팔로우 후 「완료」라고 답장".
2. `messages` 이벤트: 답장한 사용자의 프로필 조회 → 팔로우 O면 **1회용 코드(8자, 30일)** + `{INSTAGRAM_LANDING_URL}/?ig=<code>` DM, 팔로우 X면 재안내 DM. 같은 사용자의 미사용 코드는 하나만(웹훅 재전송·재답장에 재발급 없음). 우리 계정의 메아리(`is_echo`)·우리 댓글은 무시.
3. 놀이터에서 `POST /v1/credits/redeem-instagram`으로 소진(아래).

- 구독 확인: `GET`에 `hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` → 토큰 일치 시 challenge 그대로(200 text), 아니면 403.
- 인증: `X-Hub-Signature-256: sha256=<HMAC-SHA256(원문, 앱 시크릿)>` 검증 → 불일치·미설정 401. `object != "instagram"`은 200 `{"accepted": false}`.
- 응답은 즉시 200, 처리(Graph 호출)는 BackgroundTasks — 실패는 로그만(Meta 재시도·구독 해제 회피).
- 운영 요건·Meta 앱 생성·검수는 `deploy/README.md` §5-2. **검수 통과 전엔 앱 역할(테스터) 계정의 댓글/DM만 웹훅이 온다.**

#### `POST /v1/credits/redeem-instagram` — DM으로 받은 코드 소진(회원 전용)

```json
// 요청
{ "code": "K7M2P9QX" }
```
```json
// 200 — ClaimCreditResponse
{ "balance": 13, "amount_granted": 2 }
```
코드는 팔로우가 **API로 확인된** 인스타 사용자에게만 발급되므로 아이디 입력·열기 이벤트 없이 `follow_ig`를 지급한다(원장 `ref_id = "ig:<인스타 username>"`, 회원당 1회 dedupe → 재소진 `409 ALREADY_CLAIMED`). **인스타 계정(igsid)당 1회**: 같은 계정이 새 코드를 받아 다른 놀이터 회원이 넣어도 `409 INSTAGRAM_ALREADY_USED`. 없는/만료/미확인 코드 `404 INSTAGRAM_CODE_INVALID`, 게스트 `403 MEMBER_ONLY`, 형식(6~16자 영숫자) 위반 400. 프론트는 랜딩 `?ig=` 를 기억했다가 로그인 직후 자동 소진하고, W-10 팔로우 행에도 코드 입력을 둔다(검수 통과 후 아이디 입력 경로 제거 예정).

#### `GET /v1/credits`

> **연동 회원은 응답 전에 그 회원의 쇼핑몰 주문만 즉석 동기화**한다(2026-09-01, "주문하고 돌아오면 바로 +20"). 카페24 `GET /admin/orders?member_id=`를 `order_reward_cutoff`부터 조회해 배치와 같은 규칙(`app/cafe24.py _apply_order`)으로 지급/회수 → 잔액을 다시 읽어 응답. 회원당 **60초에 1회**(새로고침 연타 보호), 카페24 실패 시 조용히 건너뛰고 기존 잔액 응답(화면은 절대 안 죽음). 30분 크론은 놓친 건 보정용으로 유지. 미연동 회원은 카페24 호출 없음.

```json
// 200
{
  "balance": 11,
  "custom_prompt_credit_cost": 2,
  "earn_actions": [
    { "action": "order", "amount": 20, "status": "available", "cta": "쇼핑몰 →" },
    { "action": "link_account", "amount": 3, "status": "done", "cta": null },
    { "action": "follow_ig", "amount": 2, "status": "available", "cta": "받기" },
    { "action": "daily", "amount": 1, "status": "tomorrow", "cta": "내일 다시" }
  ]
}
```
custom_prompt_credit_cost는 app_setting 정책값이며, 미설정 시 2로 폴백한다.

`status` 값: `available`(가능) / `done`(이미 완료, `link_account`·`follow_ig`처럼 1회 한정) / `tomorrow`(오늘 이미 받음, `daily` 전용) / `login_required`(게스트 — 크레딧 획득은 **회원 전용**, 이슈 #52).

**게스트 응답**: 게스트에게는 4행 전부 `status: "login_required"`, `cta: "로그인"`으로 내려갑니다. 게스트가 `POST /v1/credits/claim`을 호출하면 `403 MEMBER_ONLY`(§1) — 401이 아니므로 게스트 세션은 유지됩니다.

#### `POST /v1/credits/claim`

```json
// 요청 — daily
{ "action": "daily" }
// 요청 — follow_ig: 인스타 아이디 필수(선행 @ 허용, 소문자 정규화)
{ "action": "follow_ig", "instagram_username": "@kong.mom" }
```

> **팔로우 검증 불가 → 마찰 3겹(2026-09-01)**: 인스타그램은 "A가 B를 팔로우하는지"를 제3자에게 알려 주는 API가 없다(Basic Display 폐지, Graph API는 본인 비즈니스 계정 한정). 그래서 `follow_ig`는 ① `instagram_username` 필수 — 원장 `ref_id = "ig:<아이디>"`로 기록해 운영자가 실제 팔로워 목록과 대조·회수(`GET /v1/admin/follow-ig/claims`, 회수는 `POST /v1/admin/credits/adjust` 음수) ② 같은 아이디는 **전 회원 통틀어 1회**(`409 INSTAGRAM_ALREADY_USED`) ③ 프론트가 「팔로우하러 가기」를 누를 때 보낸 `POST /v1/events {event_type: "follow_ig_open"}`가 **10초 이상 30분 이내**에 있어야 함(`400 FOLLOW_IG_NOT_OPENED`). 아이디 형식은 `^@?[A-Za-z0-9._]{1,30}$`, 그 외 `400 VALIDATION_ERROR`.
```json
// 200
{ "balance": 13, "amount_granted": 2 }
```
```json
// 409 ALREADY_CLAIMED — 같은 사유로 재요청(dedupe_key 충돌)
{
  "error": {
    "code": "ALREADY_CLAIMED",
    "message": "이미 받은 크레딧이에요",
    "detail": { "action": "follow_ig" }
  }
}
```

#### `GET /v1/credits/ledger`

쿼리: `cursor?`. [04-erd.md §7](04-erd.md) 예시 쿼리와 동일한 5행을 반환하는 예:

```json
// 200
{
  "items": [
    { "reason": "generation_charge", "ref_label": "레고", "occurred_on": "2026-08-03", "amount": -1 },
    { "reason": "order_reward", "ref_label": "#20260802", "occurred_on": "2026-08-02", "amount": 20 },
    { "reason": "generation_refund", "ref_label": "지브리", "occurred_on": "2026-08-02", "amount": 2 },
    { "reason": "link_account", "ref_label": null, "occurred_on": "2026-07-28", "amount": 3 },
    { "reason": "daily_free", "ref_label": null, "occurred_on": "2026-07-28", "amount": 1 }
  ],
  "next_cursor": null
}
```

---

### 이벤트 비콘

#### `POST /v1/events`

```json
// 요청
{
  "event_type": "share_click",
  "properties": { "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab", "channel": "instagram" }
}
```
응답: `204 No Content`.

인증 필수(게스트 가능). `properties.job_id`가 본인 소유 job이면 style/job 집계에 연결하고, 그렇지 않으면 `meta`에만 보존합니다.

---

## §4 시나리오

### 시나리오 1 · 게스트 → 로그인 승격 (카카오·네이버·로컬 공통)

요청 순서:

1. `POST /v1/auth/guest` → `{token: guestToken, member_id, kind: "guest"}`. 이후 모든 요청에 `Authorization: Bearer <guestToken>`.
2. 게스트 상태로 자유롭게 진행: `POST /v1/uploads` → `POST /v1/jobs`(Idempotency-Key) → `GET /v1/jobs/{id}` 폴링 → 결과 확인.
3. W-06 B 시트에서 로그인 선택:
   - **소셜(카카오/네이버)**: `GET /v1/auth/{provider}/authorize`(게스트 토큰) → `{authorize_url}` 수신 → `window.location` 이동 → 프로바이더 로그인 → 프론트 라우트 `/auth/callback/{provider}`로 복귀 → 쿼리의 `code`·`state`를 `GET /v1/auth/{provider}/callback`에 fetch.
   - **로컬**: `POST /v1/auth/register`(신규) 또는 `POST /v1/auth/login`(기존) — 둘 다 게스트 토큰 필수.
4. 서버 처리: 해당 로그인 식별자(kakao_id/naver_id/email)에 기존 `member` 행이 있으면(재방문) 게스트 자산(pet/source_image/job/custom_prompt_log/metric_event)을 이관하고 게스트 행에 `merged_into_id` 기록. `guest_trial` 크레딧은 기존 회원이 이미 받았다면 dedupe 충돌로 스킵. 없으면(신규) 게스트 행 자체를 `kind: guest → member`로 승격.
5. 응답 `{token: memberToken, member_id, kind: "member", merged, credit_balance}` — 클라이언트는 즉시 `guestToken`을 `memberToken`으로 교체.
6. `GET /v1/credits` 재조회 → 병합/승격된 크레딧 반영 확인.

### 시나리오 1-B · 회원의 카페24 연동 (+3 크레딧, 마이페이지·W-10)

1. 전제: `kind: "member"` 토큰 보유(시나리오 1 완료). 게스트가 연동을 시도하면 `403 MEMBER_ONLY` — 로그인 유도.
2. W-10 "연동 +3" CTA 또는 마이페이지에서 쇼핑몰 가입 휴대폰 번호(또는 아이디) 입력 → `POST /v1/auth/cafe24/link/request` → 카페24가 그 회원의 휴대폰으로 6자리 SMS 발송(5분) → 사용자가 코드 입력 → `POST /v1/auth/cafe24/link/verify`(번호에 계정이 여럿이면 목록에서 골라 같은 코드로 한 번 더).
3. 서버 처리: 코드 다이제스트 대조(단일 시도) 후 회원 행에 `cafe24_member_id` 기록 + `order_reward_cutoff` 세팅 + `link_account` 크레딧 +3(dedupe — 재연동 반복 수령 불가). 해당 카페24 계정이 이미 다른 회원에 연동돼 있으면 `409 CAFE24_ALREADY_LINKED`(자산 병합 없음), 없는 아이디는 `404 CAFE24_MEMBER_NOT_FOUND`, 오답은 `400 CAFE24_CODE_INVALID`.
4. 응답 `{cafe24_linked: true, credit_balance}` → W-10 연동 행이 "완료"로 전환, 이후 쇼핑몰 주문은 동기화 배치가 +20 자동 지급.

### 시나리오 2 · 생성 폴링 흐름

1. `POST /v1/jobs`(헤더 `Idempotency-Key: <새 UUID>`) → 202, `{job_id, status: "queued"}`.
2. `GET /v1/jobs/{job_id}`를 **2초 간격, 지수 백오프(2s → 4s → 8s …)**로 폴링. 서버는 큐 길이 기반으로 `eta_seconds`·`progress`를 계산.
3. `status`가 `processing`으로 90초를 넘겨도 실패가 아님 — W-05 "알림 받고 나가기"로 이탈 가능. 서버는 계속 처리, 재조회 시 상태가 그대로 복원.
4. `status: "succeeded"` → `results[]`(1장) 반환, W-06 전환.
5. `status: "failed"` → `error_code`(`GENERATION_FAILED` 또는 `SAFETY_BLOCKED`) 포함, 크레딧 자동 반환(`credit_ledger`에 `refund:<job_uuid>` 기록) — 사용자는 별도 요청 없이 `GET /v1/credits`에서 반환된 잔액 확인.

### 시나리오 3 · 크레딧 부족 인라인 흐름

1. `POST /v1/jobs`가 `402 INSUFFICIENT_CREDIT`을 반환하면 job을 만들지 않고 크레딧 부족 상태로 전환.
2. "크레딧 받기" 시트를 **인라인 오버레이**로 띄우고 `GET /v1/credits` 호출(주문 보상이 최상단·최대치).
3. `POST /v1/credits/claim`(`follow_ig`/`daily` — `link_account`는 카페24 연동 콜백이 지급하고 `order`는 배치 자동 지급이라 이 경로로 들어오지 않음). 회원 전용 — 게스트는 `403 MEMBER_ONLY`(§1, 이슈 #52).
4. 클레임 성공 시 갱신된 `balance` 즉시 반영, 시트 닫고 `POST /v1/jobs`를 **동일 Idempotency-Key로 재시도**(아직 job이 생성되지 않았으므로 원래 시도의 키를 그대로 사용).

---

## §5 관리자 API

W-11 프롬프트 운영 콘솔 전용. 별도 인증 경계(`admin_user` 세션, 사용자 대면 게스트/회원 JWT와 다른 발급 경로 — 세부는 구현 시 결정)를 사용합니다.

#### `POST /v1/admin/login`

```json
// 요청
{"email": "admin@nutti.co.kr", "password": "..."}
// 200
{"token": "...", "admin_id": 1, "email": "admin@nutti.co.kr"}
```

JWT는 `kind: admin` 클레임을 가지며 만료는 회원 토큰과 동일한 `JWT_EXPIRES_IN` 설정값을 따릅니다. 관리자 계정은 회원가입 API 없이 `scripts/create_admin.py`로만 생성할 수 있습니다. 로그인은 IP당 10회/시간, 이메일당 실패 5회(성공 시 초기화)로 제한하며 실패 시 `401 INVALID_CREDENTIALS`를 반환합니다. 모든 관리자 엔드포인트는 `Authorization: Bearer <admin token>`이 필수이며 일반 회원 토큰으로 호출하면 401을 반환합니다.

| 엔드포인트 | 설명 |
|---|---|
| `GET /v1/admin/styles` | 스타일 테이블(선택률/공유율/쇼핑몰 클릭률 포함) |
| `POST /v1/admin/styles` | 새 스타일 생성(`status: draft`로 시작) |
| `PATCH /v1/admin/styles/{id}` | 스타일 수정(공개/초안/회수 전환 포함) |
| `DELETE /v1/admin/styles/{id}` | 스타일 회수(`status: retired`, 물리 삭제 아님) |
| `GET /v1/admin/styles/{id}/prompt-versions` | 프롬프트 버전 목록 |
| `POST /v1/admin/styles/{id}/prompt-versions` | 새 버전 생성(`prompt_text`, `model_config`) |
| `PATCH /v1/admin/styles/{id}/prompt-versions/{version_id}` | 상태·트래픽 비중 변경(A/B, 롤백) |
| `GET /v1/admin/custom-prompts/top` | 커스텀 입력 빈도 상위(`normalized_text` 기준) |
| `POST /v1/admin/custom-prompts/{id}/promote` | 프리셋 스타일로 승격(신규 `style` 행 생성) |
| `POST /v1/admin/credits/adjust` | 수동 크레딧 조정(CS 대응, `dedupe_key`는 관리자가 사유별로 직접 지정) |
| `GET /v1/admin/cafe24/status` | `cafe24_oauth_token`의 `last_synced_at`(워터마크)·`expires_at`·`last_refresh_error` 노출 |
| `GET /v1/admin/follow-ig/claims` | 인스타 팔로우 +2 수령 목록(아이디·회원·시각, 최신순 커서) — 실제 팔로워와 수동 대조용 |
| `GET /v1/admin/settings` / `PATCH /v1/admin/settings` | `app_setting` key-value 조회·수정(`human_face_policy` 등) |

#### `GET /v1/admin/styles`

```json
// 200 (W-11 스타일 테이블)
{
  "items": [
    {
      "id": 101,
      "code": "lego-minifig",
      "name": "레고 미니피겨",
      "section": "인기",
      "status": "public",
      "sort_order": 1,
      "credit_cost": 1,
      "output_count": 1,
      "avg_seconds": 48,
      "selection_rate": 0.184,
      "share_rate": 0.41,
      "shop_click_rate": 0.12
    },
    {
      "id": 108,
      "code": "ghibli-watercolor",
      "name": "지브리 수채",
      "section": "인기",
      "status": "public",
      "sort_order": 4,
      "credit_cost": 2,
      "output_count": 1,
      "avg_seconds": 48,
      "selection_rate": 0.097,
      "share_rate": 0.08,
      "shop_click_rate": 0.02
    }
  ]
}
```
`selection_rate`/`share_rate`/`shop_click_rate`는 집계한 파생값(저장 컬럼 아님). 나머지 필드는 [04-erd.md §2.3](04-erd.md) `style` 컬럼과 동일.

- `selection_rate`: `GenerationJob` 테이블에서 `style_id IS NOT NULL`인 전체 job 대비 해당 스타일 job 비율
- `share_rate`: 해당 스타일의 `result_view` 대비 `share_click` `MetricEvent` 비율
- `shop_click_rate`: 해당 스타일의 `result_view` 대비 `shop_exit_click` `MetricEvent` 비율

#### `POST /v1/admin/styles`

```json
// 요청
{
  "code": "pilot",
  "name": "파일럿",
  "section": "직업",
  "credit_cost": 1,
  "output_count": 1,
  "avg_seconds": 48,
  "progress_message": null,
  "fit_tags": [],
  "example_keys": []
}
```
```json
// 201
{
  "id": 130,
  "code": "pilot",
  "name": "파일럿",
  "section": "직업",
  "status": "draft",
  "sort_order": 0,
  "credit_cost": 1,
  "output_count": 1,
  "avg_seconds": 48,
  "progress_message": null,
  "fit_tags": [],
  "example_keys": [],
  "created_at": "2026-08-03T10:00:00+09:00",
  "updated_at": "2026-08-03T10:00:00+09:00"
}
```
`input_fields`(W-04 입력폼 스키마, 각 항목 `label` 필수 — `GET /v1/styles/{id}`와 동일 형식)도 받습니다.

`400 VALIDATION_ERROR`: `code` 중복(UNIQUE 위반) 또는 필수 필드 누락.

#### `PATCH /v1/admin/styles/{id}`

```json
// 요청 — 공개 전환
{ "status": "public" }
```
```json
// 200
{
  "id": 130,
  "code": "pilot",
  "name": "파일럿",
  "section": "직업",
  "status": "public",
  "sort_order": 0,
  "credit_cost": 1,
  "output_count": 1,
  "avg_seconds": 48,
  "progress_message": null,
  "fit_tags": [],
  "example_keys": [],
  "created_at": "2026-08-03T10:00:00+09:00",
  "updated_at": "2026-08-03T10:05:00+09:00"
}
```
`avg_seconds`·`input_fields`도 수정 가능하며, `status`는 `draft|public|ab|retired` 중 하나여야 합니다.

`404 NOT_FOUND`: 존재하지 않는 `id`.

#### `DELETE /v1/admin/styles/{id}`

물리 삭제가 아니라 `status: retired` 전환이므로 갱신된 객체를 반환합니다.

```json
// 200
{
  "id": 130,
  "code": "pilot",
  "name": "파일럿",
  "status": "retired",
  "sort_order": 0,
  "credit_cost": 1,
  "output_count": 1,
  "avg_seconds": 48,
  "updated_at": "2026-08-03T11:00:00+09:00"
}
```
`404 NOT_FOUND`: 존재하지 않는 `id`.

#### `GET /v1/admin/styles/{id}/prompt-versions`

```json
// 200
{
  "items": [
    {
      "id": 501,
      "style_id": 101,
      "version": 2,
      "prompt_text": "레고 미니피겨 스타일로 변환. 배경은 스튜디오 화이트...",
      "model_config": { "provider": "gemini", "model": "gemini-2.5-flash-image" },
      "traffic_weight": 100,
      "status": "active",
      "created_at": "2026-07-20T09:00:00+09:00"
    },
    {
      "id": 498,
      "style_id": 101,
      "version": 1,
      "prompt_text": "레고 미니피겨 스타일로 변환(구버전)...",
      "model_config": { "provider": "gemini", "model": "gemini-2.5-flash-image" },
      "traffic_weight": 0,
      "status": "retired",
      "created_at": "2026-06-01T09:00:00+09:00"
    }
  ]
}
```
필드는 [04-erd.md §2.4](04-erd.md) `style_prompt_version` 컬럼과 동일. `prompt_text`는 사용자 대면 API(§3 `GET /v1/styles/{style_id}`)에서는 비노출되지만 관리자 API에서는 편집 대상이라 노출됩니다.

#### `POST /v1/admin/styles/{id}/prompt-versions`

```json
// 요청 — 신규 A/B 버전
{
  "prompt_text": "레고 미니피겨 스타일로 변환, 조명을 더 밝게...",
  "model_config": { "provider": "gemini", "model": "gemini-2.5-flash-image" },
  "traffic_weight": 20
}
```
```json
// 201
{
  "id": 512,
  "style_id": 101,
  "version": 3,
  "prompt_text": "레고 미니피겨 스타일로 변환, 조명을 더 밝게...",
  "model_config": { "provider": "gemini", "model": "gemini-2.5-flash-image" },
  "traffic_weight": 20,
  "status": "draft",
  "created_at": "2026-08-03T10:00:00+09:00"
}
```
`400 VALIDATION_ERROR`: `(style_id, version)` UNIQUE 위반 등.
`version`은 서버가 해당 스타일의 최대값+1로 부여하며 요청에 포함하지 않습니다. `traffic_weight`는 0 이상이며, 동일 스타일에 `active` 상태인 버전이 여러 개면 가중치 비례 랜덤으로 선택됩니다(§3 job 생성 참고).

#### `PATCH /v1/admin/styles/{id}/prompt-versions/{version_id}`

```json
// 요청 — 롤백(이전 버전 재활성화)
{ "status": "active", "traffic_weight": 100 }
```
```json
// 200
{
  "id": 498,
  "style_id": 101,
  "version": 1,
  "traffic_weight": 100,
  "status": "active"
}
```
`404 NOT_FOUND`: 존재하지 않는 `version_id`. `style_id`와 소속이 일치하지 않는 `version_id`도 404로 처리합니다.

#### `GET /v1/admin/custom-prompts/top`

```json
// 200
{
  "items": [
    { "id": "...", "normalized_text": "눈 오는 날 산책", "frequency": 412, "promotable": true },
    { "id": "...", "normalized_text": "한복 입은", "frequency": 287, "promotable": true },
    { "id": "...", "normalized_text": "파일럿", "frequency": 190, "promotable": false }
  ]
}
```
`normalized_text`/`frequency`는 [04-erd.md §2.9](04-erd.md) `custom_prompt_log.normalized_text` GROUP BY 집계. `promotable: false`는 이미 `promoted_style_id`가 채워진 문구(중복 승격 방지).

#### `POST /v1/admin/custom-prompts/{id}/promote`

`{id}`는 승격 대상 `normalized_text` 그룹의 대표 `custom_prompt_log.id`입니다.

```json
// 요청
{ "section": "겨울", "credit_cost": 1 }
```
```json
// 201
{
  "id": 131,
  "code": "snowy-walk",
  "name": "눈 오는 날 산책",
  "section": "겨울",
  "status": "draft",
  "credit_cost": 1,
  "output_count": 1
}
```
응답은 새로 생성된 `style` 객체(다른 `POST /v1/admin/styles`와 동일 스키마). 서버는 이 `normalized_text`를 가진 모든 `custom_prompt_log` 행의 `promoted_style_id`를 이 신규 `style.id`로 채웁니다. `409 ALREADY_CLAIMED`: 이미 승격된 문구 재요청.

#### `POST /v1/admin/credits/adjust`

CS 대응 등 수동 조정. `dedupe_key`는 관리자가 사유별로 직접 지정해 중복 조정을 방지합니다([04-erd.md §2.8](04-erd.md)와 동일 제약).

```json
// 요청
{
  "member_id": "9a11e2b0-...",
  "amount": 5,
  "dedupe_key": "cs:2026-08-03-001",
  "reason": "cs_adjustment"
}
```
```json
// 200
{ "member_id": "9a11e2b0-...", "balance": 16, "amount_granted": 5 }
```
`409 ALREADY_CLAIMED`: 동일 `dedupe_key` 재요청(`credit_ledger` UNIQUE 충돌).
`404 NOT_FOUND`: 존재하지 않거나 탈퇴한 `member_id`. `400 VALIDATION_ERROR`: `amount`가 0이거나 음수 조정으로 잔액이 0 미만이 되는 경우. `reason` 기본값은 `cs_adjustment`이며 `credit_ledger.reason` 값만 허용.

#### `GET /v1/admin/follow-ig/claims`

쿼리: `limit?`(기본 50, 최대 200) · `cursor?`(이전 응답 `next_cursor` = 마지막 `ledger_id`).

```json
// 200
{
  "items": [
    { "ledger_id": 812, "member_id": "8f14e457-…", "instagram_username": "kong.mom", "amount": 2, "claimed_at": "2026-09-01T14:20:11+00:00" }
  ],
  "next_cursor": 812
}
```
운영자가 `@nutti_official` 팔로워 목록과 대조해 허위 수령은 `POST /v1/admin/credits/adjust`(음수, `reason: cs_adjustment`)로 회수한다. 별도 회수 엔드포인트는 두지 않는다.

#### `GET /v1/admin/cafe24/status`

```json
// 200
{
  "mall_id": "nutti",
  "expires_at": "2026-08-03T12:00:00+09:00",
  "last_synced_at": "2026-08-03T09:30:00+09:00",
  "last_refresh_error": null
}
```
`last_refresh_error`가 `null`이 아니면 토큰 갱신 실패 상태(FR-EDGE-04의 관측 지점). `404 NOT_FOUND`: 카페24 OAuth 토큰이 아직 발급된 적 없음(미연동).

#### `GET /v1/admin/settings` / `PATCH /v1/admin/settings/{key}`

```json
// GET 200
{
  "items": [
    { "key": "human_face_policy", "value": "warn", "updated_at": "2026-07-01T00:00:00+09:00" },
    { "key": "order_reward_amount", "value": 20, "updated_at": "2026-07-01T00:00:00+09:00" }
  ]
}
```
```json
// PATCH /v1/admin/settings/human_face_policy — 요청
{ "value": "block" }
```
```json
// 200
{ "key": "human_face_policy", "value": "block", "updated_at": "2026-08-03T10:00:00+09:00" }
```
필드는 [04-erd.md §2.13](04-erd.md) `app_setting` 컬럼과 동일. `404 NOT_FOUND`: 존재하지 않는 `key`.
`key`는 서버가 아는 설정 키(`human_face_policy`, `custom_prompt_credit_cost`, `daily_free_amount`, `follow_ig_amount`, `link_account_amount`, `order_reward_amount`, `catalog_search_threshold`)만 허용. GET은 저장된 적 없는 키도 기본값으로 돌려주며 그 경우 `updated_at`은 `null`. `400 VALIDATION_ERROR`: `human_face_policy`는 `block`/`warn`/`allow`, 나머지는 0 이상 정수만.

---

## 부록 · 화면별 자기검증 워크스루

"이 화면의 응답 JSON만으로 모든 표시 값을 채울 수 있는가"를 11개 화면 각각에 대해 확인한 결과입니다.

| 화면 | 결과 | 비고 |
|---|---|---|
| W-01 | 예 | before/after 히어로는 정적 자산 — API 대상에서 명시적으로 제외(§2) |
| W-02 | 예 | `GET /v1/styles` + `GET /v1/credits` |
| W-03 | 예 | `GET /v1/styles/{id}` |
| W-04 | 예 | `GET /v1/pets` + `POST /v1/uploads`(`blocking_issue`/`warnings[]`로 전 케이스 커버) |
| W-05 | 예 | `GET /v1/jobs/{id}` 폴링 |
| W-06 | 예 | `GET /v1/jobs/{id}` + `GET /v1/calculator-link`. 쇼핑몰 배너는 정적 콘텐츠 — API 대상에서 명시적으로 제외 |
| W-07 | 예 | `GET /v1/calculator-link`(정상/폴백/완전실패 3케이스 모두 예시 있음) |
| W-08 | 예 | 예시 칩은 정적, 생성은 `POST /v1/jobs`(`custom_prompt`) |
| W-09 | 예 | `GET /v1/pets` + `GET /v1/library` |
| W-10 (A+B) | 예 | `GET /v1/credits` + `GET /v1/credits/ledger` |
| W-11 | 예 | §5 관리자 API 전건(스타일 테이블·프롬프트버전·커스텀승격·카페24상태·설정) |

**결론**: 11개 화면 전부 "예" — 정적 콘텐츠로 명시 제외한 요소(before/after 히어로, 쇼핑몰 배너, 크리에이티브 예시 칩)를 제외하면 모든 표시 값에 필드 출처가 있습니다.
