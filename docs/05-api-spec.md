# API 명세

> 기준: wireframe-spec v0.5 / cebb865

---

## §0 문서 수명 규칙

이 문서는 2층 구조입니다.

- **§1(공통 규약) · §2(화면-API 매핑) · §4(시나리오) · §5(관리자 API)**: 장수명. API가 존재하는 한 유지·갱신합니다.
- **§3(엔드포인트 스키마)**: 소모성. **구현 착수 시 §3은 삭제하고 실제 OpenAPI/`/docs`(FastAPI 자동 생성 문서) 링크로 대체합니다.** 손으로 쓴 스펙과 구현이 어긋나는 것을 막기 위함입니다.

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
| "평균 24초 · 4장 생성" | `GET /v1/styles/{style_id}` → `avg_duration_seconds`, `output_count` |
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
| 썸네일 4장·"4장 중 N번" | `GET /v1/jobs/{job_id}` → `results[]`(4개), `selected_index` |
| 결과 선택 | `POST /v1/jobs/{job_id}/select` → `{result_index}` |
| 저장(보관함) | 로그인 회원은 결과가 자동으로 보관함에 남음(`GET /v1/library`에서 조회). 게스트는 W-06 B 계정 연동 필요 |
| 인스타 공유 | `POST /v1/jobs/{job_id}/share` |
| "다시 만들기 · 1 크레딧" | `POST /v1/jobs`(**새 Idempotency-Key** 필수) |
| 계산기 배너 | `GET /v1/calculator-link?pet_id=` 또는 `?job_id=`(§2 W-07 참고) |
| 쇼핑몰 행(썸네일·배송안내) | 정적 콘텐츠(운영이 갱신하는 설정값, API 비대상) |
| "이 사진으로 다른 스타일" | `GET /v1/styles?section=popular&limit=3` |
| W-06 B 계정 연동 바텀시트 | "누띠 쇼핑몰 계정으로 로그인" → `GET /v1/auth/cafe24/authorize`, "카카오로 계속하기" → `POST /v1/auth/kakao` |

### W-07 · 계산기로 넘기기 ([#p07](wireframe-spec-v0.5.html#p07))

| UI 요소 | 데이터 출처 |
|---|---|
| 계산기 배너 문구("사진에서 푸들로 봤어요") + URL | `GET /v1/calculator-link?pet_id=` → `{breed_code, breed_label, size_label, calculator_url}` |
| URL 표기(`calculator.html?name=…&breed=…&size=…`) | 위 응답의 `calculator_url`을 그대로 사용(서버가 완성된 URL 반환, UTM 포함) |

**계약 노트**: `breed_code`의 값 도메인은 계산기 측 **견종 42종 코드표**와 일치해야 합니다(놀이터 저장소 밖의 계산기 자산과 공유하는 계약, `07-decisions.md#Q9`). 견종 추정 실패(믹스견 등 매칭 불가) 시 `breed_code: "mixed"` 폴백값을 반환하고, 완전 실패 시 `breed_code: null` → 계산기 1단계부터 시작(URL에 breed 파라미터 생략).

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
| "쇼핑몰 →" (주문하기) | 정적 링크(쇼핑몰 이동), 지급 자체는 카페24 주문 동기화 배치가 처리 |
| 각 획득 CTA(연동 완료/받기) | `POST /v1/credits/claim` → `{action: "link_account" \| "follow_ig" \| "daily"}`("order"는 배치 자동 지급이라 이 엔드포인트로 클레임하지 않음) |
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

#### `POST /v1/auth/guest`

요청 본문 없음.

```json
// 201
{
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI4ZjE0ZTQ1NyJ9.xxx",
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "guest"
}
```

#### `GET /v1/auth/cafe24/authorize`

302 리다이렉트(카페24 로그인 페이지), 응답 본문 없음.

#### `GET /v1/auth/cafe24/callback?code=...&state=...`

```json
// 200
{
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI4ZjE0ZTQ1NyJ9.yyy",
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "member",
  "merged": true,
  "credit_balance": 15
}
```
`merged: true`는 UC-07 분기 A(기존 회원 행에 병합)가 발생했음을 의미. 분기 B(신규 승격)면 `merged: false`.

#### `POST /v1/auth/kakao`

```json
// 요청
{ "kakao_token": "kakao-oauth-access-token-abcd1234" }
```
```json
// 200 — 응답 형태는 cafe24/callback과 동일
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "member",
  "merged": false,
  "credit_balance": 4
}
```

#### `GET /v1/auth/me`

```json
// 200
{
  "member_id": "8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f",
  "kind": "member",
  "credit_balance": 11,
  "cafe24_linked": true
}
```

#### `POST /v1/auth/logout`

응답: `204 No Content`(본문 없음).

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
          "credit_cost": 1
        },
        {
          "id": 108,
          "code": "ghibli-watercolor",
          "name": "지브리 수채",
          "thumbnail_url": "https://cdn.nutti.co.kr/styles/ghibli-watercolor/thumb.jpg",
          "credit_cost": 2
        }
      ]
    }
  ],
  "total_count": 68
}
```

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
  "output_count": 4
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
  "warnings": [],
  "breed_estimate": { "code": "toy_poodle", "label": "토이푸들", "confidence": 0.82 }
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
  ],
  "breed_estimate": { "code": "mixed", "label": "믹스견", "confidence": 0.41 }
}
```
```json
// 200 — 차단(고양이 감지, FR-EDGE-07)
{
  "upload_id": null,
  "image_url": null,
  "blocking_issue": { "code": "CAT_DETECTED", "message": "누띠는 강아지 전용이에요. 다른 사진을 골라주세요." },
  "warnings": [],
  "breed_estimate": null
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
    { "id": "b6f9e6b0-...", "name": "콩이", "thumbnail_url": "https://cdn.nutti.co.kr/pets/b6f9e6b0.jpg" },
    { "id": "d1a2b3c4-...", "name": "두부", "thumbnail_url": "https://cdn.nutti.co.kr/pets/d1a2b3c4.jpg" }
  ]
}
```

#### `POST /v1/pets`

```json
// 요청
{ "name": "콩이", "upload_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6" }
```
```json
// 201
{ "id": "b6f9e6b0-...", "name": "콩이", "thumbnail_url": "https://cdn.nutti.co.kr/pets/b6f9e6b0.jpg" }
```

#### `PATCH /v1/pets/{pet_id}`

```json
// 요청
{ "name": "두부" }
```
```json
// 200
{ "id": "d1a2b3c4-...", "name": "두부", "thumbnail_url": "https://cdn.nutti.co.kr/pets/d1a2b3c4.jpg" }
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
  "custom_prompt": null
}
```
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

```json
// 200 — 진행 중(60초 이내)
{
  "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
  "status": "processing",
  "progress": 62,
  "eta_seconds": 14,
  "status_message": "레고 블록을 쌓는 중…",
  "source_image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "results": null,
  "selected_index": null,
  "error_code": null
}
```
```json
// 200 — 완료
{
  "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
  "status": "succeeded",
  "progress": 100,
  "eta_seconds": 0,
  "status_message": null,
  "source_image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "results": [
    { "index": 0, "image_url": "https://cdn.nutti.co.kr/results/aaa1.jpg" },
    { "index": 1, "image_url": "https://cdn.nutti.co.kr/results/aaa2.jpg" },
    { "index": 2, "image_url": "https://cdn.nutti.co.kr/results/aaa3.jpg" },
    { "index": 3, "image_url": "https://cdn.nutti.co.kr/results/aaa4.jpg" }
  ],
  "selected_index": null,
  "error_code": null
}
```
```json
// 200 — 실패(모델 오류, 크레딧 자동 반환됨)
{
  "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab",
  "status": "failed",
  "progress": null,
  "eta_seconds": null,
  "status_message": null,
  "source_image_url": "https://cdn.nutti.co.kr/uploads/3fa85f64.../orig.jpg",
  "results": null,
  "selected_index": null,
  "error_code": "GENERATION_FAILED"
}
```
```json
// 200 — 안전 필터 차단(W-08 커스텀 프롬프트, 크레딧 자동 반환됨)
{
  "job_id": "c4f24d5b-3g2f-5b4b-0c2f-2345678901bc",
  "status": "failed",
  "progress": null,
  "eta_seconds": null,
  "status_message": null,
  "source_image_url": "https://cdn.nutti.co.kr/uploads/9c858901.../orig.jpg",
  "results": null,
  "selected_index": null,
  "error_code": "SAFETY_BLOCKED"
}
```
`404 NOT_FOUND`: 존재하지 않거나 다른 회원 소유의 job.

#### `POST /v1/jobs/{job_id}/select`

```json
// 요청
{ "result_index": 0 }
```
```json
// 200
{ "job_id": "b3e13c4a-2f1e-4a3a-9b1e-1234567890ab", "selected_index": 0 }
```

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

```json
// 200 — 정상 매칭
{
  "breed_code": "toy_poodle",
  "breed_label": "토이푸들",
  "size_label": "소형",
  "calculator_url": "https://nutti.co.kr/calculator.html?name=콩이&breed=toy_poodle&size=소형&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff"
}
```
```json
// 200 — 견종 42종 목록에 없음(FR-EDGE-11, "믹스견" 폴백)
{
  "breed_code": "mixed",
  "breed_label": "믹스견",
  "size_label": "중형",
  "calculator_url": "https://nutti.co.kr/calculator.html?name=콩이&breed=mixed&size=중형&utm_source=nutti_playground&utm_medium=referral&utm_campaign=calculator_handoff"
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

#### `DELETE /v1/library`

```json
// 요청
{ "ids": ["e5f6a7b8-...", "f6a7b8c9-..."] }
```
응답: `204 No Content`.

---

### 크레딧

#### `GET /v1/credits`

```json
// 200
{
  "balance": 11,
  "earn_actions": [
    { "action": "order", "amount": 20, "status": "available", "cta": "쇼핑몰 →" },
    { "action": "link_account", "amount": 3, "status": "done", "cta": null },
    { "action": "follow_ig", "amount": 2, "status": "available", "cta": "받기" },
    { "action": "daily", "amount": 1, "status": "tomorrow", "cta": "내일 다시" }
  ]
}
```
`status` 값: `available`(가능) / `done`(이미 완료, `link_account`·`follow_ig`처럼 1회 한정) / `tomorrow`(오늘 이미 받음, `daily` 전용).

#### `POST /v1/credits/claim`

```json
// 요청
{ "action": "follow_ig" }
```
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

---

## §4 시나리오

### 시나리오 1 · 게스트 → 로그인 승격

요청 순서:

1. `POST /v1/auth/guest` → `{token: guestToken, member_id, kind: "guest"}`. 이후 모든 요청에 `Authorization: Bearer <guestToken>`.
2. 게스트 상태로 자유롭게 진행: `POST /v1/uploads` → `POST /v1/jobs`(Idempotency-Key) → `GET /v1/jobs/{id}` 폴링 → 결과 확인.
3. W-06 B에서 "누띠 쇼핑몰 계정으로 로그인" → `GET /v1/auth/cafe24/authorize` → (카페24 로그인) → `GET /v1/auth/cafe24/callback?code=...`.
4. 서버 처리: 콜백된 카페24 회원에 기존 `member` 행이 있으면(재방문) 게스트 자산(pet/source_image/job/custom_prompt_log/metric_event)을 이관하고 게스트 행에 `merged_into_id` 기록. `guest_trial` 크레딧은 기존 회원이 이미 받았다면 dedupe 충돌로 스킵. 없으면(신규) 게스트 행 자체를 `kind: guest → member`로 승격.
5. 응답 `{token: memberToken, member_id, kind: "member", merged, credit_balance}` — 클라이언트는 즉시 `guestToken`을 `memberToken`으로 교체.
6. `GET /v1/credits` 재조회 → 병합/승격된 크레딧 반영 확인.

### 시나리오 2 · 생성 폴링 흐름

1. `POST /v1/jobs`(헤더 `Idempotency-Key: <새 UUID>`) → 202, `{job_id, status: "queued"}`.
2. `GET /v1/jobs/{job_id}`를 **2초 간격, 지수 백오프(2s → 4s → 8s …)**로 폴링. 서버는 큐 길이 기반으로 `eta_seconds`·`progress`를 계산.
3. `status`가 `processing`으로 60초를 넘겨도 실패가 아님 — W-05 "알림 받고 나가기"로 이탈 가능. 서버는 계속 처리, 재조회 시 상태가 그대로 복원.
4. `status: "succeeded"` → `results[]`(4장) 반환, W-06 전환.
5. `status: "failed"` → `error_code`(`GENERATION_FAILED` 또는 `SAFETY_BLOCKED`) 포함, 크레딧 자동 반환(`credit_ledger`에 `refund:<job_uuid>` 기록) — 사용자는 별도 요청 없이 `GET /v1/credits`에서 반환된 잔액 확인.

### 시나리오 3 · 크레딧 부족 인라인 흐름

1. `POST /v1/jobs`가 `402 INSUFFICIENT_CREDIT`을 반환하면 job을 만들지 않고 크레딧 부족 상태로 전환.
2. "크레딧 받기" 시트를 **인라인 오버레이**로 띄우고 `GET /v1/credits` 호출(주문 보상이 최상단·최대치).
3. `POST /v1/credits/claim`(`follow_ig`/`daily`/`link_account`; `order`는 배치 자동 지급이라 이 경로로 들어오지 않음).
4. 클레임 성공 시 갱신된 `balance` 즉시 반영, 시트 닫고 `POST /v1/jobs`를 **동일 Idempotency-Key로 재시도**(아직 job이 생성되지 않았으므로 원래 시도의 키를 그대로 사용).

---

## §5 관리자 API

W-11 프롬프트 운영 콘솔 전용. 별도 인증 경계(`admin_user` 세션, 사용자 대면 게스트/회원 JWT와 다른 발급 경로 — 세부는 구현 시 결정)를 사용합니다.

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
| `GET /v1/admin/settings` / `PATCH /v1/admin/settings` | `app_setting` key-value 조회·수정(`human_face_policy` 등) |

```json
// GET /v1/admin/styles → 200 (W-11 스타일 테이블)
{
  "items": [
    {
      "id": 101,
      "name": "레고 미니피겨",
      "status": "public",
      "selection_rate": 0.184,
      "share_rate": 0.41,
      "shop_click_rate": 0.12
    },
    {
      "id": 108,
      "name": "지브리 수채",
      "status": "public",
      "selection_rate": 0.097,
      "share_rate": 0.08,
      "shop_click_rate": 0.02
    }
  ]
}
```
`selection_rate`/`share_rate`/`shop_click_rate`는 `metric_event`를 `style_id`로 집계한 파생값(저장 컬럼 아님).

```json
// GET /v1/admin/cafe24/status → 200
{
  "mall_id": "nutti",
  "expires_at": "2026-08-03T12:00:00+09:00",
  "last_synced_at": "2026-08-03T09:30:00+09:00",
  "last_refresh_error": null
}
```

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
