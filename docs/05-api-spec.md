# API 명세

> 기준: wireframe-spec v0.5 / cebb865
> 상태: **1패스 완료, 2패스 대기** (§3 JSON 예시·에러 코드 상세는 2패스에서 채웁니다)

---

## §0 문서 수명 규칙

이 문서는 2층 구조입니다.

- **§1(공통 규약) · §2(화면-API 매핑) · §4(시나리오)**: 장수명. API가 존재하는 한 유지·갱신합니다.
- **§3(엔드포인트 스키마)**: 소모성. **구현 착수 시 §3은 삭제하고 실제 OpenAPI/`/docs`(FastAPI 자동 생성 문서) 링크로 대체합니다.** 손으로 쓴 스펙과 구현이 어긋나는 것을 막기 위함입니다.

---

## §1 공통 규약

- **베이스 URL**: `/v1`
- **인증**: `Authorization: Bearer <JWT>`. 게스트와 회원이 **동일한 JWT 형식**을 사용합니다 — 게스트는 `POST /v1/auth/guest`로 발급받은 토큰을 그대로 쓰다가, 로그인 시 회원 토큰으로 교체합니다(§4 시나리오 1 참고).
- **에러 포맷**: 모든 실패 응답은 단일 포맷을 따릅니다.
  ```
  { "error": { "code": "...", "message": "...", "detail": {} } }
  ```
  `code`는 아래 에러 코드 표의 값 중 하나. `detail`은 코드별 부가 정보(선택적, 예: `INSUFFICIENT_CREDITS`의 `required`/`balance`).

  | 코드 | 의미 | 출처 |
  |---|---|---|
  | `VALIDATION_ERROR` | 요청 필드 누락·형식 오류 | 공통 |
  | `UNAUTHORIZED` | 토큰 없음/만료 | 공통 |
  | `NOT_FOUND` | 대상 리소스 없음 | 공통 |
  | `RATE_LIMITED` | 요청 빈도 초과 | 공통 |
  | `INSUFFICIENT_CREDITS` | 크레딧 부족 | [#states](wireframe-spec-v0.5.html#states) — 크레딧 부족 |
  | `GENERATION_FAILED` | 모델 생성 오류 | [#states](wireframe-spec-v0.5.html#states) — 생성 실패(모델 오류) |
  | `SAFETY_BLOCKED` | 생성 후 안전 필터 차단(`safety_blocked`, 미차감 보장) | [#states](wireframe-spec-v0.5.html#states) — 부적절한 커스텀 프롬프트 |
  | `NO_DOG_DETECTED` | 업로드 사진에서 강아지 미검출 | [#states](wireframe-spec-v0.5.html#states) — 강아지가 없는 사진 |
  | `NOT_A_DOG` | 고양이 등 강아지 아닌 대상 감지 | [#states](wireframe-spec-v0.5.html#states) — 고양이 사진 업로드 |
  | `UPLOAD_QUALITY_WARN` | 흐림/저조도/다중피사체 경고(차단 아님, 진행 가능) | [#states](wireframe-spec-v0.5.html#states) |

  이 표는 1패스 기준 초안입니다. 전건 확정(타임아웃·카페24 토큰 만료 등 서버 내부 코드 포함 여부, HTTP 상태코드 매핑)은 2패스에서 완성합니다.
- **페이지네이션**: 커서 방식. 목록 응답은 `{"items": [...], "next_cursor": "..."}` — `next_cursor`가 `null`이면 마지막 페이지.
- **Idempotency-Key**: 생성 계열 POST(`POST /v1/jobs` 등)는 요청 헤더 `Idempotency-Key: <클라이언트 생성 UUID>`가 필수입니다.
  - 같은 키로 재요청하면 새 작업을 만들지 않고 **원래 job을 그대로 반환**합니다(409 아님). 네트워크 재시도·중복 탭 대응.
  - **"다시 만들기" 버튼(W-06)은 반드시 새 UUID를 발급**해 새 job을 만듭니다 — 같은 키를 재사용하면 안 됩니다.
- **Rate limit**: IP/세션 단위로 생성 계열 엔드포인트에 제한을 둡니다(구체 임계치는 구현 시 결정, 2패스에서 기본값 제안 예정). 초과 시 에러 코드 `RATE_LIMITED`.

---

## §2 화면-API 매핑

각 화면(W-01~W-11)의 UI 요소가 어느 엔드포인트·필드에서 오는지 정리합니다. "정적"으로 표기된 요소는 API 호출 없이 클라이언트에 고정된 콘텐츠입니다.

### W-01 · 랜딩 ([wireframe-spec-v0.5.html#p01](wireframe-spec-v0.5.html#p01))

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
| 섹션별 스타일 카드 그리드(이름·결과예시 이미지·비용) | `GET /v1/styles` → `sections[].styles[]`(id, name, thumbnail_url, cost) |
| 하단 "전체 68개" | `GET /v1/styles` → `total_count` |
| ETag 캐싱 | `GET /v1/styles` 응답 헤더 `ETag`, 클라이언트 `If-None-Match` → 변경 없으면 304 |

### W-03 · 스타일 상세(바텀시트) ([#p03](wireframe-spec-v0.5.html#p03))

| UI 요소 | 데이터 출처 |
|---|---|
| 적용 예시 캐러셀(6장) | `GET /v1/styles/{style_id}` → `examples[]` |
| 타이틀·크레딧 비용 | `GET /v1/styles/{style_id}` → `name`, `cost` |
| 적합도 태그 칩(소형견◎/대형견◎/검은털△) | `GET /v1/styles/{style_id}` → `fit_tags[]` |
| "평균 24초 · 4장 생성" | `GET /v1/styles/{style_id}` → `avg_duration_seconds`, `output_count` |
| "이 스타일로 만들기" | 네비게이션(W-04로), 생성 자체는 `POST /v1/jobs` |

### W-04 · 사진 업로드 · 품질 체크 ([#p04](wireframe-spec-v0.5.html#p04))

| UI 요소 | 데이터 출처 |
|---|---|
| "저장된 강아지" 프로필 목록 | `GET /v1/pets` |
| 업로드 영역 | `POST /v1/uploads`(파일 전송) |
| 품질 경고("얼굴이 조금 어두워요" 등) | `POST /v1/uploads` 응답 → `warnings[]`(blur/dark/multi_subject 등 감지 결과) |
| 실패 유형 감지(강아지 없음/고양이/사람 얼굴 포함) | `POST /v1/uploads` 응답 → `detections`(no_dog, cat, human_face, multi_subject) |
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
| 비교 슬라이더(원본/변환) + 서명 | `GET /v1/jobs/{job_id}` → `source_image_url`, `results[].image_url`(서명은 이미지 자체에 합성되어 저장됨, 별도 필드 아님) |
| 썸네일 4장·"4장 중 N번" | `GET /v1/jobs/{job_id}` → `results[]`(4개), `selected_index` |
| 결과 선택 | `POST /v1/jobs/{job_id}/select` → `{result_index}` |
| 저장(보관함) | 로그인 회원은 결과가 자동으로 보관함에 남음(`GET /v1/library`에서 조회). 게스트는 W-06 B 계정 연동 필요 |
| 인스타 공유 | `POST /v1/jobs/{job_id}/share` (공유 이벤트 기록, 공유용 이미지 URL 반환) |
| "다시 만들기 · 1 크레딧" | `POST /v1/jobs`(**새 Idempotency-Key** 필수) |
| 계산기 배너 | `GET /v1/calculator-link?pet_id=` 또는 `?job_id=`(§2 W-07 참고) |
| 쇼핑몰 행(썸네일·배송안내) | 정적 콘텐츠(운영이 갱신하는 설정값, API 비대상) |
| "이 사진으로 다른 스타일" | `GET /v1/styles?section=popular&limit=3` |
| W-06 B 계정 연동 바텀시트 | "누띠 쇼핑몰 계정으로 로그인" → `GET /v1/auth/cafe24/authorize`, "카카오로 계속하기" → `POST /v1/auth/kakao` |

### W-07 · 계산기로 넘기기 ([#p07](wireframe-spec-v0.5.html#p07))

| UI 요소 | 데이터 출처 |
|---|---|
| 계산기 배너 문구("사진에서 푸들로 봤어요") + URL | `GET /v1/calculator-link?pet_id=` → `{breed_code, breed_label, size_label, calculator_url}` |
| URL 표기(`calculator.html?name=…&breed=…&size=…`) | 위 응답의 `calculator_url`을 그대로 사용(서버가 완성된 URL 반환 — 클라이언트가 쿼리 조립 안 함) |

**계약 노트**: `breed_code`의 값 도메인은 계산기 측 **견종 42종 코드표**와 일치해야 합니다(놀이터 저장소 밖의 계산기 자산과 공유하는 계약, 2패스 또는 07-decisions에서 코드표 출처 확정). 견종 추정 실패(믹스견 등 매칭 불가) 시 `breed_code`는 "믹스견" 폴백값으로 반환하고, 완전 실패 시 `breed_code: null` → 계산기 1단계부터 시작(URL에 breed 파라미터 생략).

### W-08 · 크리에이티브 모드 ([#p08](wireframe-spec-v0.5.html#p08))

| UI 요소 | 데이터 출처 |
|---|---|
| 예시 칩("눈 오는 날 산책" 등) | 정적 콘텐츠(고정 예시 목록) |
| "만들기 · 2 크레딧" | `POST /v1/jobs`(`custom_prompt` 필드 포함, `cost=2`) |
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
| A · 4개 획득 행(주문+20/연동+3/팔로우+2/오늘의무료+1)과 각 행의 상태(가능/완료/내일 다시) | `GET /v1/credits` → `earn_actions[]`(action, amount, status, cta) — 4개 행의 현재 상태를 서버가 계산해 한 번에 반환 |
| "쇼핑몰 →" (주문하기) | 정적 링크(쇼핑몰 이동), 지급 자체는 카페24 주문 동기화 배치가 처리(사용자 액션 아님) |
| 각 획득 CTA(연동 완료/받기) | `POST /v1/credits/claim` → `{action: "link_account" \| "follow_ig" \| "daily"}`("order"는 배치 자동 지급이라 이 엔드포인트로 클레임하지 않음) |
| B · 받은 내역 테이블 | `GET /v1/credits/ledger?cursor=`(커서 페이지네이션) → `{reason, ref, occurred_at, amount}` |

### W-11 · 프롬프트 운영 콘솔(내부/관리자) ([#p11](wireframe-spec-v0.5.html#p11))

관리자 전용 화면으로, 사용자 대면 API와 인증·권한 경계가 다릅니다. 엔드포인트 상세는 §3에서 다루지 않고 **§4로 위임**합니다(운영 콘솔은 1패스 우선순위인 프론트 핸드오프 범위 밖 — 스타일 CRUD·A/B·지표 집계용 별도 관리자 API 그룹으로 후속 설계).

---

## §3 엔드포인트 시그니처

메서드·경로·요청/응답 필드 목록만 정리합니다. JSON 예시와 전체 에러 코드 표는 2패스에서 채웁니다.

### 인증

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `POST /v1/auth/guest` | 게스트 세션 발급 | (본문 없음) | `{token, member_id}` |
| `GET /v1/auth/cafe24/authorize` | 카페24 OAuth 시작 | - | 302 리다이렉트 |
| `GET /v1/auth/cafe24/callback` | 카페24 OAuth 콜백 | `code`, `state` | `{token, member_id, merged: bool}` |
| `POST /v1/auth/kakao` | 카카오 보조 로그인 | `{kakao_token}` | `{token, member_id, merged: bool}` |
| `GET /v1/auth/me` | 현재 사용자 정보 | - | `{member_id, kind(guest\|member), credit_balance}` |
| `POST /v1/auth/logout` | 로그아웃 | - | `{}` |

### 스타일

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `GET /v1/styles` | 전체 스타일 목록(섹션 구획, ETag) | 쿼리: `section?`, `limit?` | `{sections: [{name, count, styles: [{id, name, thumbnail_url, cost}]}], total_count}` |
| `GET /v1/styles/{style_id}` | 스타일 상세 | - | `{id, name, cost, examples[], fit_tags[], avg_duration_seconds, output_count}` |

### 업로드

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `POST /v1/uploads` | 사진 업로드 + 품질 체크 + 견종 추정 | multipart 파일, `pet_id?` | `{upload_id, image_url, warnings[](blur, dark, multi_subject), detections{no_dog, cat, human_face}, breed_estimate{code, label, confidence}}` |

### 펫 CRUD

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `GET /v1/pets` | 저장된 강아지 목록 | - | `{items: [{id, name, thumbnail_url}]}` |
| `POST /v1/pets` | 강아지 프로필 생성 | `{name, upload_id}` | `{id, name, thumbnail_url}` |
| `PATCH /v1/pets/{pet_id}` | 강아지 프로필 수정 | `{name?}` | `{id, name, thumbnail_url}` |
| `DELETE /v1/pets/{pet_id}` | 강아지 프로필 삭제 | - | `{}` |

### 생성 job

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `POST /v1/jobs` | 생성 작업 시작 | 헤더 `Idempotency-Key`, 본문 `{style_id, upload_id, pet_id?, custom_prompt?}` | 202 `{job_id, status: "queued"}` |
| `GET /v1/jobs/{job_id}` | 생성 상태 폴링 | - | `{job_id, status(queued\|processing\|completed\|failed), progress, eta_seconds, status_message, source_image_url, results[](완료 시), selected_index, error_code(실패 시)}` |
| `POST /v1/jobs/{job_id}/select` | 결과 4장 중 선택 | `{result_index}` | `{job_id, selected_index}` |
| `POST /v1/jobs/{job_id}/share` | 공유 이벤트 기록 | `{channel}` | `{share_image_url}` |

### 계산기 연결

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `GET /v1/calculator-link` | 계산기 프리필 URL 생성 | 쿼리 `pet_id?` 또는 `job_id?` | `{breed_code, breed_label, size_label, calculator_url}` |

### 보관함

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `GET /v1/library` | 보관함 목록(월별 그룹) | 쿼리 `pet_id?`, `cursor?` | `{months: [{label, items[]}], next_cursor}` |
| `DELETE /v1/library` | 일괄 삭제 | `{ids: []}` | `{}` |

### 크레딧

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `GET /v1/credits` | 잔액 + 4개 획득 행 상태 | - | `{balance, earn_actions: [{action, amount, status(available\|done\|tomorrow), cta}]}` |
| `POST /v1/credits/claim` | 획득 행 수동 클레임 | `{action: "link_account" \| "follow_ig" \| "daily"}` | `{balance, amount_granted}` |
| `GET /v1/credits/ledger` | 받은 내역 | 쿼리 `cursor?` | `{items: [{reason, ref, occurred_at, amount}], next_cursor}` |

### 이벤트 비콘

| 엔드포인트 | 설명 | 요청 | 응답 |
|---|---|---|---|
| `POST /v1/events` | 클라이언트 측 지표 이벤트 기록 | `{event_type, properties}` | `{}` |

### 관리자

§4에서 시나리오 수준으로만 언급. 엔드포인트 스키마는 이 문서 범위 밖(별도 관리자 API 트랙, 후속 설계).

---

## §4 시나리오

### 시나리오 1 · 게스트 → 로그인 승격

1. 첫 방문 시 클라이언트가 `POST /v1/auth/guest` 호출 → 게스트 JWT 발급, 이후 모든 요청에 `Bearer <게스트 토큰>` 사용.
2. 게스트 상태로 업로드·생성·결과 확인까지 자유롭게 진행(`POST /v1/uploads`, `POST /v1/jobs`, `GET /v1/jobs/{id}` 등).
3. W-06 B 바텀시트에서 "누띠 쇼핑몰 계정으로 로그인" 선택 → `GET /v1/auth/cafe24/authorize` → 카페24 로그인 → `GET /v1/auth/cafe24/callback`.
4. 서버 처리: 콜백된 카페24 회원이 기존에 이 서비스를 쓴 적이 있으면(기존 `member` 행 존재) 게스트 세션의 자산(pet/source_image/job/custom_prompt_log/metric_event)을 기존 회원 행으로 이관하고 게스트 행에는 `merged_into_id`를 기록. 게스트 시절 받은 `guest_trial` 크레딧은 병합 대상 회원이 이미 `guest_trial`을 받았다면 **dedupe_key 충돌로 스킵**(무료 1장 반복 수령 방지).
5. 응답으로 회원 JWT를 반환 — 클라이언트는 게스트 토큰을 즉시 이 토큰으로 교체.
6. `GET /v1/credits`를 재조회해 병합된 크레딧 잔액을 반영.

### 시나리오 2 · 생성 폴링 흐름

1. `POST /v1/jobs`(헤더 `Idempotency-Key: <새 UUID>`) → 202, `{job_id, status: "queued"}`.
2. 클라이언트는 `GET /v1/jobs/{job_id}`를 **2초 간격, 지수 백오프(2s → 4s → 8s …)**로 폴링. 서버는 큐 길이 기반으로 `eta_seconds`·`progress`를 계산해 반환.
3. `status`가 `processing`으로 전환되고 60초를 넘겨도 실패가 아님 — W-05 "알림 받고 나가기"로 이탈 가능. 서버는 계속 처리하고, 사용자가 나중에 같은 `job_id`로 재조회하면 상태가 그대로 복원됨.
4. `status: "completed"` → `results[]`(4장) 포함해 반환, 화면은 W-06으로 전환.
5. `status: "failed"` → `error_code` 포함(예: 모델 오류, 또는 안전 필터 차단 시 `safety_blocked`). 두 경우 모두 **크레딧 자동 반환**(원장에 `refund:<job_uuid>` 기록) — 사용자는 별도 요청 없이 `GET /v1/credits`에서 반환된 잔액을 확인.

### 시나리오 3 · 크레딧 부족 인라인 흐름

1. 생성 시도 전 또는 `POST /v1/jobs` 응답이 크레딧 부족을 나타내면(에러 코드는 2패스에서 확정, 잠정 `INSUFFICIENT_CREDITS`) 화면이 job을 만들지 않고 크레딧 부족 상태로 전환.
2. 클라이언트는 "크레딧 받기" 시트를 **인라인 오버레이**로 띄우고 `GET /v1/credits`를 호출해 잔액과 4개 획득 행을 표시(주문 보상이 최상단·최대치).
3. 사용자가 획득 행 중 하나를 클레임 — `POST /v1/credits/claim`(`follow_ig`/`daily`/`link_account`; `order`는 카페24 동기화 배치 자동 지급이라 이 경로로 들어오지 않음).
4. 클레임 성공 시 갱신된 `balance`를 즉시 반영, 시트 닫고 `POST /v1/jobs`를 **동일 Idempotency-Key로 재시도**(아직 job이 생성되지 않았으므로 새 키가 아니라 원래 시도의 키를 그대로 사용).
