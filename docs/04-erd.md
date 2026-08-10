# 04. 데이터 모델 (ERD)

> 기준: wireframe-spec v0.5 / cebb865

13개 테이블(MVP 기준). 근거: [03-usecases.md](03-usecases.md), [07-decisions.md](07-decisions.md) ADR-01·02·03·09.

---

## 1. ERD

```mermaid
erDiagram
    member ||--o{ pet_profile : "소유"
    member ||--o{ source_image : "업로드"
    member ||--o{ generation_job : "요청"
    member ||--o{ credit_ledger : "귀속"
    member ||--o{ custom_prompt_log : "작성"
    member ||--o{ metric_event : "발생"
    member ||--o| member : "merged_into_id(게스트→회원)"
    pet_profile ||--o{ source_image : "연결(선택)"
    style ||--o{ style_prompt_version : "버전"
    style ||--o{ generation_job : "사용(선택, 커스텀시 NULL)"
    style ||--o{ metric_event : "집계 대상(선택)"
    style ||--o{ custom_prompt_log : "승격 대상(선택)"
    style_prompt_version ||--o{ generation_job : "사용(선택)"
    source_image ||--o{ generation_job : "원본"
    generation_job ||--o{ generation_result : "결과 N장"
    generation_job ||--o| custom_prompt_log : "연결(선택)"
    generation_job ||--o{ metric_event : "연관(선택)"

    member {
        uuid id PK
        text kind "guest | member"
        text cafe24_member_id UK "NULL 허용"
        text kakao_id UK "NULL 허용"
        text naver_id UK "NULL 허용"
        text email UK "NULL 허용, 로컬 로그인"
        text password_hash "NULL, 로컬 로그인"
        text nickname "NULL, 소셜 프로필 수집"
        int credit_balance "캐시, 음수 허용"
        uuid merged_into_id FK "자기참조, NULL"
        timestamptz guest_expires_at "NULL(회원은 NULL)"
        text oauth_state_nonce "NULL, OAuth state 일회성 nonce"
        timestamptz oauth_state_expires_at "NULL, state 만료(5분)"
        timestamptz order_reward_cutoff "NULL, 연동 시점"
        timestamptz created_at
    }
    pet_profile {
        uuid id PK
        uuid member_id FK
        text name
        text breed_code "NULL, 42종 코드 또는 믹스견"
        text breed_label "NULL"
        text size "NULL"
        text thumbnail_key "R2 UUID key"
        timestamptz created_at
    }
    style {
        bigint id PK
        text code UK "URL 슬러그"
        text section
        text name
        int credit_cost
        text status "draft/public/ab/retired"
        int sort_order
        int output_count "기본 1, Q4 확정"
        int avg_seconds "기본 24"
        text progress_message "NULL"
        jsonb fit_tags
        jsonb example_keys "R2 key 6개"
        timestamptz created_at
        timestamptz updated_at
    }
    style_prompt_version {
        bigint id PK
        bigint style_id FK
        int version
        text prompt_text "비노출"
        jsonb model_config "provider 필드 포함"
        int traffic_weight
        text status "draft/active/retired"
        timestamptz created_at
    }
    source_image {
        uuid id PK
        uuid member_id FK
        uuid pet_profile_id FK "NULL"
        text storage_key UK "R2 UUID key"
        int width
        int height
        jsonb quality_check "blur/dark/multi_subject/no_dog/cat/human_face"
        jsonb breed_estimate "NULL, {code,label,confidence}"
        timestamptz expires_at "NULL"
        timestamptz created_at
    }
    generation_job {
        uuid id PK
        uuid member_id FK
        uuid source_image_id FK
        bigint style_id FK "NULL(커스텀시)"
        bigint prompt_version_id FK "NULL"
        uuid custom_prompt_id FK "NULL"
        uuid idempotency_key "UNIQUE(member_id,idempotency_key)"
        text status "queued/processing/succeeded/failed"
        int credit_cost
        text provider_job_id "NULL"
        text error_code "NULL, SAFETY_BLOCKED 포함"
        timestamptz lease_expires_at "NULL"
        int attempt_count
        timestamptz queued_at
        timestamptz started_at "NULL"
        timestamptz finished_at "NULL"
    }
    generation_result {
        uuid id PK
        uuid job_id FK
        int seq "항상 1, UNIQUE(job_id,seq)"
        text storage_key UK
        text signature_variant "NULL, Q5 A/B"
        boolean is_selected
        timestamptz deleted_at "NULL, 논리삭제"
        timestamptz created_at
    }
    credit_ledger {
        bigint id PK
        uuid member_id FK
        text dedupe_key "UNIQUE(member_id,dedupe_key)"
        text reason
        text ref_id "NULL, order_id/job_id"
        int amount "델타, 음수 가능"
        int balance_after
        timestamptz created_at
    }
    custom_prompt_log {
        uuid id PK
        uuid member_id FK
        text raw_text
        text normalized_text
        jsonb moderation "{input_filter_blocked, reason}"
        uuid job_id FK "NULL"
        bigint promoted_style_id FK "NULL"
        timestamptz created_at
    }
    metric_event {
        bigint id PK
        text event_type
        uuid member_id FK
        bigint style_id FK "NULL"
        uuid job_id FK "NULL"
        jsonb meta
        timestamptz created_at
    }
    cafe24_oauth_token {
        bigint id PK
        text mall_id UK
        text access_token
        text refresh_token
        timestamptz expires_at
        timestamptz last_synced_at "워터마크, NULL"
        text last_refresh_error "NULL"
        timestamptz updated_at
    }
    admin_user {
        bigint id PK
        text email UK
        text password_hash
        text role
        timestamptz created_at
    }
    app_setting {
        text key PK
        jsonb value
        timestamptz updated_at
    }
```

---

## 2. 테이블별 컬럼 · 제약 · 인덱스

### 2.1 `member` — 게스트·회원 통합 계정

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `kind` | TEXT | NOT NULL, CHECK IN (`guest`,`member`) | 게스트 테이블을 따로 두지 않음(UC-07) |
| `cafe24_member_id` | TEXT | UNIQUE, NULL | 회원 전환 시 채워짐 |
| `kakao_id` | TEXT | UNIQUE, NULL | 카카오 로그인 식별자(ADR-11 — 로그인 3종 중 하나) |
| `naver_id` | TEXT | UNIQUE, NULL | 네이버 로그인 식별자(ADR-11) |
| `email` | TEXT | UNIQUE, NULL | 로컬 로그인 식별자(ADR-11). 소셜 전용 회원은 NULL |
| `password_hash` | TEXT | NULL | 로컬 로그인 비밀번호 해시(stdlib scrypt `scrypt$N$r$p$salt$hash` 포맷). `email`과 함께만 존재 |
| `nickname` | VARCHAR(100) | NULL | 소셜 로그인 시 프로바이더 프로필에서 수집(이슈 #12, 마이페이지 표시용). 로컬 전용·미제공 시 NULL |
| `credit_balance` | INT | NOT NULL DEFAULT 0 | **캐시**. 원장(`credit_ledger`)이 진실. **음수 허용**(CHECK 제약 없음) — 표시는 `max(0, credit_balance)`, 차감 판정은 `credit_balance >= cost` |
| `merged_into_id` | UUID | FK → `member.id`(자기참조), NULL | 게스트가 기존 회원에 병합된 경우 대상 회원을 가리킴(UC-07 분기 A) |
| `guest_expires_at` | TIMESTAMPTZ | NULL | 게스트만 값 존재(가입 시 NULL로 전환). 미병합 게스트 세션·자산의 만료 시점(**30일** — 게스트 JWT 만료와 정렬, FR-EDGE-12·`07-decisions.md#Q7`) |
| `oauth_state_nonce` | VARCHAR(64) | NULL | 카페24 OAuth `state`의 일회성 nonce — `/auth/cafe24/authorize`에서 발급, 콜백에서 검증 직후 NULL로 소비(재사용 차단, PR #8 C1) |
| `oauth_state_expires_at` | TIMESTAMPTZ | NULL | 위 nonce의 만료 시점(발급 +5분) — 경과 시 콜백 거부 |
| `order_reward_cutoff` | TIMESTAMPTZ | NULL | 회원이 쇼핑몰 계정을 연동한 시점 — 주문 보상 자격 필터(06-architecture-deployment.md §6.2와 동일 정의, `cafe24_oauth_token.last_synced_at` 워터마크와는 다른 개념) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

인덱스: `cafe24_member_id`, `kakao_id`, `naver_id`, `email`(UNIQUE 인덱스가 조회에도 사용됨).

### 2.2 `pet_profile` — 저장된 강아지

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `member_id` | UUID | FK → `member.id`, NOT NULL | |
| `name` | TEXT | NOT NULL | |
| `breed_code` | TEXT | NULL | 계산기 42종 코드표 또는 `"믹스견"`(FR-EDGE-11 폴백) |
| `breed_label` | TEXT | NULL | |
| `size` | TEXT | NULL | |
| `thumbnail_key` | TEXT | NULL | R2 storage key(UUID) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

인덱스: `(member_id)`.

### 2.3 `style` — 스타일 카탈로그

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `code` | TEXT | UNIQUE, NOT NULL | URL 슬러그(공개 카탈로그이므로 순차 ID 노출에 보안 문제 없음) |
| `section` | TEXT | NOT NULL | 앵커바 섹션(인기/여름/직업/영화/아트…) |
| `name` | TEXT | NOT NULL | |
| `credit_cost` | INT | NOT NULL DEFAULT 1 | |
| `status` | TEXT | NOT NULL, CHECK IN (`draft`,`public`,`ab`,`retired`) | |
| `sort_order` | INT | NOT NULL DEFAULT 0 | 시즌 섹션 노출 순서(W-11에서 운영이 조정) |
| `output_count` | INT | NOT NULL DEFAULT 1 | **Q4 확정(2026-08-04): 1요청 1장.** 컬럼은 산출 수 상향 대비로 유지 |
| `avg_seconds` | INT | NOT NULL DEFAULT 24 | |
| `progress_message` | TEXT | NULL | W-05 스타일별 진행 문구 |
| `fit_tags` | JSONB | NOT NULL DEFAULT `[]` | 적합도 태그(소형견◎ 등) |
| `example_keys` | JSONB | NOT NULL DEFAULT `[]` | 적용 예시 이미지 R2 key 6개 |
| `created_at` / `updated_at` | TIMESTAMPTZ | NOT NULL | |

인덱스: `(section, status, sort_order)`(W-02 목록 조회), `code`(UNIQUE).

### 2.4 `style_prompt_version` — 프롬프트 버전 · A/B

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `style_id` | BIGINT | FK → `style.id`, NOT NULL | |
| `version` | INT | NOT NULL | |
| `prompt_text` | TEXT | NOT NULL | 영업기밀, API로 비노출(FR-W03-06) |
| `model_config` | JSONB | NOT NULL | `{provider, model, ...}` — 06-architecture-deployment.md §3 프로바이더 필드 |
| `traffic_weight` | INT | NOT NULL DEFAULT 100 | A/B 트래픽 분배 % |
| `status` | TEXT | NOT NULL, CHECK IN (`draft`,`active`,`retired`) | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

제약: `UNIQUE(style_id, version)`.

### 2.5 `source_image` — 업로드 원본

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `member_id` | UUID | FK → `member.id`, NOT NULL | |
| `pet_profile_id` | UUID | FK → `pet_profile.id`, NULL | |
| `storage_key` | TEXT | UNIQUE, NOT NULL | R2 key(**UUID**, 추측 방지 — NFR-SEC-02) |
| `width` / `height` | INT | | |
| `quality_check` | JSONB | NOT NULL | `{blur, dark, multi_subject, no_dog, cat, human_face}` 감지 결과(UC-03) |
| `breed_estimate` | JSONB | NULL | `{code, label, confidence}` |
| `expires_at` | TIMESTAMPTZ | NULL | 보존 정책 §4 참고 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

인덱스: `(member_id)`.

### 2.6 `generation_job` — 생성 작업

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `member_id` | UUID | FK → `member.id`, NOT NULL | |
| `source_image_id` | UUID | FK → `source_image.id`, NOT NULL | |
| `style_id` | BIGINT | FK → `style.id`, NULL | 커스텀 프롬프트(W-08)면 NULL |
| `prompt_version_id` | BIGINT | FK → `style_prompt_version.id`, NULL | |
| `custom_prompt_id` | UUID | `custom_prompt_log.id` 참조, NULL | **구현 노트**: `custom_prompt_log.job_id`와 양방향 FK를 걸면 Tortoise 스키마 생성기가 순환 참조로 실패 — 실제 FK 제약은 `custom_prompt_log.job_id` 쪽 한 방향만 걸고, 이 컬럼은 제약 없는 UUID로 구현(app/models.py ponytail 주석 참조) |
| `idempotency_key` | UUID | NOT NULL | |
| `status` | TEXT | NOT NULL, CHECK IN (`queued`,`processing`,`succeeded`,`failed`) | |
| `credit_cost` | INT | NOT NULL | 프리셋 1(또는 스타일별 값), 커스텀 2 |
| `provider_job_id` | TEXT | NULL | 비동기 프로바이더 응답 ID(06-architecture §3 중복 과금 방지) |
| `error_code` | TEXT | NULL | 실패 사유. `SAFETY_BLOCKED`, `GENERATION_FAILED`, `MAX_RETRIES_EXCEEDED` (05-api-spec §1 대문자 상수와 동일 표기) |
| `lease_expires_at` | TIMESTAMPTZ | NULL | 워커 큐 회수용(06-architecture §2.2) |
| `attempt_count` | INT | NOT NULL DEFAULT 0 | |
| `queued_at` / `started_at` / `finished_at` | TIMESTAMPTZ | NULL 허용(started/finished) | |

제약: **`UNIQUE(member_id, idempotency_key)`** — 전역 유니크가 아니라 회원 단위(§1 공통규약, 05-api-spec §1과 정합).
인덱스: **`(status, lease_expires_at)`** — 06-architecture-deployment.md §2.1 `FOR UPDATE SKIP LOCKED` 폴링 쿼리가 이 인덱스를 스캔.

> **상태 모델링 노트(03-usecases.md와의 정합)**: [03-usecases.md §2](03-usecases.md)의 상태머신은 `queued/running/succeeded/failed/safety_blocked`를 개념적으로 구분된 결과로 그립니다. DB 컬럼 레벨에서는 `status`가 `queued/processing/succeeded/failed` 4값만 가지고, **`safety_blocked`는 `status='failed'` + `error_code='SAFETY_BLOCKED'`로 표현**됩니다(별도 status 값이 아님) — 개념 모델과 구현 모델의 압축 차이이며 모순이 아닙니다. "타임아웃 → 백그라운드 전환"도 마찬가지로 별도 status 값 없이 `status='processing'`이 60초를 넘겨 유지되는 것으로 표현됩니다.

### 2.7 `generation_result` — 결과 이미지 N장

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `job_id` | UUID | FK → `generation_job.id`, NOT NULL | |
| `seq` | INT | NOT NULL | 항상 1(Q4 — 1요청 1장). 컬럼·UNIQUE 제약은 상향 대비 유지 |
| `storage_key` | TEXT | UNIQUE, NOT NULL | 서명 합성 완료본(06-architecture §4) |
| `signature_variant` | TEXT | NULL | Q5 서명 A/B 실험용 |
| `is_selected` | BOOLEAN | NOT NULL DEFAULT false | |
| `deleted_at` | TIMESTAMPTZ | NULL | 논리삭제(06-architecture §4 삭제 경로) |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

제약: `UNIQUE(job_id, seq)`.

### 2.8 `credit_ledger` — 크레딧 원장(append-only)

**원장이 진실**. `member.credit_balance`는 같은 트랜잭션에서 갱신되는 파생 캐시([03-usecases.md](03-usecases.md) §3 크레딧 트랜잭션 4단계: 락 → 검사 → 원장 INSERT → 캐시 UPDATE).

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `member_id` | UUID | FK → `member.id`, NOT NULL | |
| `dedupe_key` | TEXT | **NOT NULL** | 멱등성 키. 값 규약은 §3.1 |
| `reason` | TEXT | NOT NULL | 표시용 사유 코드(§3.2) |
| `ref_id` | TEXT | NULL | 주문번호 또는 `generation_job.id` — 내역 화면 조인용 |
| `amount` | INT | NOT NULL | 델타(+/-) |
| `balance_after` | INT | NOT NULL | 트랜잭션 시점 스냅샷(내역 화면 렌더링용, `member.credit_balance`와 같은 트랜잭션에서 기록) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

제약: **`UNIQUE(member_id, dedupe_key)`** — **이것이 중복 지급·중복 차감 방지의 유일한 안전장치**입니다. 같은 사유로 두 번째 INSERT가 시도되면 제약 위반으로 실패하고, 애플리케이션은 이를 "이미 처리됨"으로 해석해 조용히 무시합니다(예: `guest_trial` 중복 수령 방어, 카페24 배치 재실행 시 `order:<order_id>` 중복 지급 방어).
인덱스: `(member_id, created_at DESC)` — W-10 B "받은 내역" 커서 페이지네이션.

### 2.9 `custom_prompt_log` — 커스텀 입력 로그

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | UUID | PK | |
| `member_id` | UUID | FK → `member.id`, NOT NULL | |
| `raw_text` | TEXT | NOT NULL | |
| `normalized_text` | TEXT | NOT NULL | 빈도 집계용(W-11 승격 후보) |
| `moderation` | JSONB | NOT NULL | `{input_filter_blocked: bool, reason}` |
| `job_id` | UUID | FK → `generation_job.id`, NULL | 필터 통과해 실제 생성으로 이어진 경우만 |
| `promoted_style_id` | BIGINT | FK → `style.id`, NULL | W-11에서 프리셋으로 승격된 경우 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### 2.10 `metric_event` — 지표 이벤트

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `event_type` | TEXT | NOT NULL | 예: `result_view`, `share_click`, `shop_exit_click`, `calculator_exit_click` |
| `member_id` | UUID | FK → `member.id`, NOT NULL | |
| `style_id` | BIGINT | FK → `style.id`, NULL | |
| `job_id` | UUID | FK → `generation_job.id`, NULL | |
| `meta` | JSONB | NOT NULL DEFAULT `{}` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

인덱스: `(style_id, created_at)`(W-11 "선택률×공유율×쇼핑몰 클릭률" 집계), `(event_type, created_at)`.
보존: **90일** 후 삭제 배치(NFR-PRIV-02, §4).

### 2.11 `cafe24_oauth_token` — 몰 단위 Admin API 토큰

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `mall_id` | TEXT | **UNIQUE, NOT NULL** | 단일 행 — 몰 하나당 토큰 하나(06-architecture §6.1) |
| `access_token` / `refresh_token` | TEXT | NOT NULL | |
| `expires_at` | TIMESTAMPTZ | NOT NULL | |
| `last_synced_at` | TIMESTAMPTZ | NULL | **워터마크** — 주문 동기화 배치 진행점(`member.order_reward_cutoff`와는 다른 개념, §2.1 참고) |
| `last_refresh_error` | TEXT | NULL | 갱신 실패 사유(관리자 알림 트리거) |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

동시성: refresh 시 해당 행 `SELECT ... FOR UPDATE`로 갱신 직렬화(06-architecture §6.1).

### 2.12 `admin_user` — 관리자 계정

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `id` | BIGSERIAL | PK | |
| `email` | TEXT | UNIQUE, NOT NULL | |
| `password_hash` | TEXT | NOT NULL | |
| `role` | TEXT | NOT NULL DEFAULT `'admin'` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### 2.13 `app_setting` — 운영 조정값 (key-value)

| 컬럼 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `key` | TEXT | PK | |
| `value` | JSONB | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

예시 키: `human_face_policy`(`block`/`warn`/`allow`, `07-decisions.md#Q6`), `custom_prompt_credit_cost`(기본 2), `daily_free_amount`(기본 1), `follow_ig_amount`(기본 2), `link_account_amount`(기본 3), `order_reward_amount`(기본 20), `catalog_search_threshold`(기본 100, W-02 검색 부활 모니터링 임계). **주의**: `order_reward_cutoff`는 여기 없음 — 회원별 값이라 `member.order_reward_cutoff` 컬럼에 있음(§2.1). 이름이 비슷해 혼동하기 쉬우므로 명시.

---

## 3. 크레딧 원장 세부 규약

### 3.1 `dedupe_key` 값 규약

| 값 | 의미 |
|---|---|
| `guest_trial` | 게스트 무료 체험 1장 |
| `link_account` | 쇼핑몰 계정 연동(+3, 최초 1회) |
| `follow_ig` | 인스타 팔로우(+2, 1회 한정) |
| `daily:<date>` | 매일 무료(+1, 하루 1회) — `<date>`는 `YYYY-MM-DD` |
| `order:<order_id>` | 주문 보상(+20, 카페24 주문 ID) |
| `clawback:<order_id>` | 주문 취소 회수(음수, 같은 주문 ID) |
| `job:<uuid>` | 생성 차감(음수, `generation_job.id`) |
| `refund:<uuid>` | 생성 실패/안전필터 차단 반환(양수, `generation_job.id`) |

### 3.2 `reason` 값과 `dedupe_key` 매핑

| `reason` | `dedupe_key` 패턴 | `amount` 부호 |
|---|---|---|
| `generation_charge` | `job:<uuid>` | 음수 |
| `generation_refund` | `refund:<uuid>` | 양수 |
| `safety_block_refund` | `refund:<uuid>` | 양수 (모델 오류 반환과 dedupe_key 패턴은 같으나 사유로 구분) |
| `guest_trial` | `guest_trial` | 양수 |
| `link_account` | `link_account` | 양수 |
| `follow_ig` | `follow_ig` | 양수 |
| `daily_free` | `daily:<date>` | 양수 |
| `order_reward` | `order:<order_id>` | 양수 |
| `order_clawback` | `clawback:<order_id>` | 음수 |

### 3.3 음수 잔액 허용

`member.credit_balance`에 하한 CHECK를 두지 않습니다. 회수(`order_clawback`)는 전액을 그대로 차감하며, 그 결과 잔액이 음수가 되어도 허용합니다.

- **표시**: 화면에는 `max(0, credit_balance)`.
- **차감 판정(새 생성 시도)**: `credit_balance >= cost`. 음수 상태에서는 항상 이 조건이 거짓이므로 자연히 신규 생성이 막힙니다.
- **효과**: 다음 지급(매일 무료 등)이 음수를 자동으로 상환하므로, "보상 받고 취소" 반복 어뷰징이 클램프 없이도 구조적으로 차단됩니다(`07-decisions.md#Q3`, UC-09 A1).

---

## 4. 보존 정책

| 대상 | 보존 기간 | 처리 |
|---|---|---|
| `metric_event` | 90일 | 배치가 주기적으로 만료 행을 물리 삭제 |
| `source_image` (게스트) | `member.guest_expires_at`(30일)과 동일 시점 | 만료 시 정리 배치 대상(회원 승격 시 이관되어 해당 없음) |
| `source_image` (회원) | 무기한(`expires_at = NULL`) | 보관함(W-09)에 남아있는 한 보존, 삭제는 사용자 요청 시에만 |
| `generation_result` (삭제 요청) | 즉시 `deleted_at` SET(논리삭제) | 배치가 지연 후 R2 실제 삭제 → CDN 캐시 퍼지(06-architecture §4) |
| 게스트 `member` 행(미병합) | `guest_expires_at` 경과 | 정리 배치 대상(자산이 이미 만료·이관되지 않은 경우) |

---

## 5. Tortoise ORM 표현 노트

- **`CharEnumField` = `varchar`**: `status`, `kind`, `reason` 등 CHECK 제약 열거값은 Tortoise `CharEnumField`(Python `Enum` 기반)로 선언 — DB 레벨은 `varchar` + 애플리케이션 검증이며 네이티브 `ENUM` 타입은 쓰지 않습니다(마이그레이션 시 열거값 추가가 `ALTER TYPE`보다 단순해짐).
- **`unique_together`**: `UNIQUE(member_id, idempotency_key)`, `UNIQUE(member_id, dedupe_key)`, `UNIQUE(style_id, version)`, `UNIQUE(job_id, seq)`는 모델의 `Meta.unique_together`로 선언.
- **`JSONField`**: `quality_check`, `breed_estimate`, `moderation`, `meta`, `fit_tags`, `example_keys`, `model_config`, `app_setting.value`는 Tortoise `JSONField`(Postgres `jsonb`).
- **부분 유니크 인덱스 회피**: `member.cafe24_member_id`/`kakao_id`처럼 NULL이 흔한 컬럼의 UNIQUE는 Postgres가 NULL을 중복으로 취급하지 않는 기본 동작을 그대로 사용 — Tortoise가 조건부(partial) UNIQUE 인덱스를 직접 지원하지 않으므로 별도 `WHERE` 조건 인덱스를 만들지 않고 표준 UNIQUE로 충분합니다.
- **`prefetch_related`**: W-10 B 내역 조회처럼 `credit_ledger` → `generation_job` → `style` 연쇄 조인이 필요한 화면은 N+1을 피하기 위해 `prefetch_related`(또는 §6 예시처럼 raw SQL JOIN)를 사용합니다.

---

## 6. 화면 → 테이블 커버리지

11개 화면의 모든 표시 데이터가 어느 테이블·컬럼에서 오는지 매핑합니다. 빈칸 없음.

| 화면 | 표시 데이터 | 테이블.컬럼 |
|---|---|---|
| W-01 랜딩 (`#p01`) | before/after 히어로 | 정적 자산(테이블 없음) |
| | 인기 스타일 프리뷰 | `style.name/section/example_keys/credit_cost` |
| W-02 카탈로그 (`#p02`) | 크레딧 배지 | `member.credit_balance` |
| | 섹션·스타일 카드·개수 | `style.section/name/example_keys/credit_cost/sort_order`, 섹션별 COUNT |
| | 전체 개수 | `style` COUNT(WHERE status='public') |
| W-03 상세 (`#p03`) | 예시 캐러셀 6장 | `style.example_keys` |
| | 적합도 태그 | `style.fit_tags` |
| | 소요시간·산출장수 | `style.avg_seconds`, `style.output_count` |
| W-04 업로드 (`#p04`) | 저장된 강아지 목록 | `pet_profile.name/thumbnail_key` |
| | 품질 경고 | `source_image.quality_check` |
| | 견종 추정 | `source_image.breed_estimate` |
| W-05 대기 (`#p05`) | 진행률·잔여초 | `generation_job.status/queued_at/started_at`(서버 계산, 저장 컬럼 아님) |
| | 진행 문구 | `style.progress_message` |
| W-06 결과 (`#p06`) | 결과 1장·서명 | `generation_result.storage_key/seq/signature_variant` |
| | 선택 상태 | `generation_result.is_selected` |
| | 계산기 배너 견종 | `pet_profile.breed_code/breed_label` 또는 `source_image.breed_estimate` |
| | 계정 연동 지급 | `credit_ledger`(`reason=link_account`) |
| W-07 계산기 연결 (`#p07`) | 프리필 URL 파라미터 | `pet_profile.breed_code/name` 또는 `source_image.breed_estimate` |
| W-08 크리에이티브 (`#p08`) | 문장틀 입력 | `custom_prompt_log.raw_text/normalized_text` |
| | 필터 결과 | `custom_prompt_log.moderation` |
| | 생성 연결 | `custom_prompt_log.job_id` → `generation_job` |
| W-09 보관함 (`#p09`) | 강아지 필터 | `pet_profile.id/name` |
| | 월별 그룹 | `generation_result.created_at`(또는 `generation_job.finished_at`) |
| | 원본 대조 | `source_image.storage_key` |
| W-10 A 크레딧 받기 (`#p10`) | 잔액 | `member.credit_balance` |
| | 4개 획득 행 상태 | `credit_ledger`(각 `dedupe_key` 존재 여부로 `link_account`/`follow_ig` 완료 판정, `daily:<오늘날짜>` 존재 여부로 "내일 다시" 판정), `app_setting`(지급액) |
| W-10 B 받은 내역 (`#p10`) | 내역/구분/일시/증감 | `credit_ledger.reason/ref_id/created_at/amount`(§6 예시 쿼리) |
| W-11 콘솔 (`#p11`, 관리자) | 스타일 테이블 | `style.*` + `metric_event` 집계(선택률/공유율/쇼핑몰클릭률) |
| | 커스텀 입력 상위 | `custom_prompt_log.normalized_text` GROUP BY + COUNT |
| | 프롬프트 버전·A/B | `style_prompt_version.*` |
| | 관리자 인증 | `admin_user.*` |
| | 모델 설정 | `style_prompt_version.model_config` |
| 상태·엣지 (`#states`) | 카페24 토큰 만료 알림 | `cafe24_oauth_token.last_refresh_error/last_synced_at` |
| | 사람 얼굴 정책 | `app_setting`(`human_face_policy`) |
| | 안전필터 차단 반환 | `credit_ledger`(`reason=safety_block_refund`), `generation_job.error_code` |

---

## 7. 예시 쿼리 — W-10 B "받은 내역"

와이어프레임 예시 5행(생성 −1 / 주문확인 +20 / 실패반환 +2 / 계정연동 +3 / 매일무료 +1)을 그대로 재현하는 조회.

```sql
SELECT
  cl.reason,
  CASE
    WHEN cl.reason IN ('generation_charge', 'generation_refund', 'safety_block_refund')
      THEN s.name                    -- 예: '레고', '지브리'
    WHEN cl.reason = 'order_reward'
      THEN '#' || cl.ref_id          -- 예: '#20260802'
    ELSE NULL                        -- link_account/daily_free는 구분값 없음("—")
  END AS ref_label,
  cl.created_at::date AS occurred_on,
  cl.amount
FROM credit_ledger cl
LEFT JOIN generation_job gj
  ON gj.id::text = cl.ref_id
 AND cl.reason IN ('generation_charge', 'generation_refund', 'safety_block_refund')
LEFT JOIN style s ON s.id = gj.style_id
WHERE cl.member_id = $1
ORDER BY cl.created_at DESC
LIMIT 20;
```

결과 예시(스펙 W-10 B와 동일 순서):

| reason | ref_label | occurred_on | amount |
|---|---|---|---|
| generation_charge | 레고 | 2026-08-03 | −1 |
| order_reward | #20260802 | 2026-08-02 | +20 |
| generation_refund | 지브리 | 2026-08-02 | +2 |
| link_account | (—) | 2026-07-28 | +3 |
| daily_free | (—) | 2026-07-28 | +1 |
