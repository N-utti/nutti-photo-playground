# 누띠 사진 놀이터 · 프론트엔드

Vite + React + TypeScript SPA. 정적 빌드를 Cloudflare Pages에 올립니다.

스펙은 `../docs/` — 화면은 `../docs/wireframe-spec-v0.5.html`(SSOT), API 계약은
`../docs/05-api-spec.md`입니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173 — MSW 목 위에서 동작
npm run build    # tsc -b && vite build
npm run lint
```

기본값은 **목 켜짐**입니다. 로컬 백엔드에 붙이려면 `.env.development`의
`VITE_ENABLE_MOCKS=false` — `vite.config.ts`의 dev proxy가 `/v1`과 `/media`를
`localhost:8000`으로 넘깁니다.

`/media`도 반드시 함께 넘어가야 합니다. 로컬 백엔드는 R2 자격증명이 없으면 파일을
`var/media/`에 쓰고 이미지 URL을 **`/media/...`로 내려주는데**(`app/storage.py`의
`public_url`), 그 경로는 응답 본문에 그대로 실려 와서 `<img src>`가 되는 순간 프론트
오리진(:5173)에 붙습니다. API는 200인데 화면에 이미지가 하나도 안 뜨는 상태가 되어
«백엔드가 아직 안 됐나»로 오진하기 쉽습니다.

### 실서버로 지금 밟을 수 있는 범위 (2026-08-12 실측)

「전 엔드포인트 501」은 옛말입니다. 다만 **부분 전환**이라 목을 끄면 못 밟는 화면이 있습니다.

| 구간 | 엔드포인트 | 상태 |
|---|---|---|
| 게스트·로그인·연동 | `/auth/*` | 구현 |
| 스타일 카탈로그·상세 | `/styles`, `/styles/{id}` | 구현 |
| 업로드(품질·비전·견종) | `POST /uploads` | 구현 |
| 펫 CRUD | `/pets*` | 구현 |
| 크레딧·클레임·원장 | `/credits*` | 구현 |
| 생성 요청·조회 | `POST /jobs`, `GET /jobs/{id}` | 구현 |
| 실제 생성(워커) | `app/worker.py` | 구현 — 별도 프로세스로 띄워야 job이 진행됩니다 |
| **보관함** | `GET·DELETE /library` | **501** — W-09 |
| **계산기 연결** | `GET /calculator-link` | **501** — W-06 배너·W-07 |
| **공유 이미지** | `POST /jobs/{id}/share` | **501** — W-06 공유 |
| **이벤트 비콘** | `POST /events` | **501** (실패를 삼키므로 화면은 안 막힘) |

비전 검사(고양이 차단·견종 추정)와 실제 이미지 생성은 `OPENAI_API_KEY`가 있어야
켜집니다. 키가 없으면 업로드는 경고 없이 통과하고, 워커는 포스터라이즈 폴백 이미지를
만듭니다 — 배선 검증에는 충분하지만 «결과물 품질»은 그 그림으로 판단할 수 없습니다.

### 목 시나리오 강제

브라우저 콘솔에서:

```js
localStorage.setItem('nutti.mock.scenario', 'upload:warn')  // 품질 경고(비차단) · 견종은 믹스견
localStorage.setItem('nutti.mock.scenario', 'upload:nodog') // 강아지 미검출 경고(FR-EDGE-08) · 견종 추정 실패
localStorage.setItem('nutti.mock.scenario', 'upload:multi') // 여러 마리(FR-EDGE-09)
localStorage.setItem('nutti.mock.scenario', 'upload:face')  // 사람 얼굴 — policy=warn (FR-EDGE-06)
localStorage.setItem('nutti.mock.scenario', 'upload:face-block') // 사람 얼굴 — policy=block (FR-EDGE-06)
localStorage.setItem('nutti.mock.scenario', 'upload:block') // 고양이 감지(차단, FR-EDGE-07)
localStorage.setItem('nutti.mock.scenario', 'job:fail')     // GENERATION_FAILED + 크레딧 반환
localStorage.setItem('nutti.mock.scenario', 'job:safety')   // SAFETY_BLOCKED — 안전 필터 차단, 재시도 없이 즉시 실패 + 크레딧 반환(PR #70)
localStorage.setItem('nutti.mock.scenario', 'job:retries')  // MAX_RETRIES_EXCEEDED — 시도 3회를 태우며 processing↔queued 를 오간 뒤 실패
localStorage.setItem('nutti.mock.scenario', 'job:flaky')    // 생성 중 3~18초 503 → W-05가 화면을 헐지 않고 자력 복구
localStorage.setItem('nutti.mock.scenario', 'job:slow')     // 150초 job → 60초에서 W-05 백그라운드 전환(FR-EDGE-02)
localStorage.setItem('nutti.mock.scenario', 'job:queued')   // 워커가 안 집는 job — started_at=null 인 큐 대기(PR #60)
localStorage.setItem('nutti.mock.scenario', 'credit:empty') // 잔액 0에서 시작 → 402 → 시트에서 받고 재시도
localStorage.setItem('nutti.mock.scenario', 'session:expired') // 액세스 만료 — 게스트는 재발급 → 404, 회원은 리프레시 회전으로 조용히 복구(PR #57)
localStorage.setItem('nutti.mock.scenario', 'refresh:fail')    // 만료 + 회전 401 — 회원 재로그인 안내(다른 기기 로그인·30일 초과와 같은 코드)
localStorage.setItem('nutti.mock.scenario', 'refresh:429')     // 만료 + 회전 429 — 공유 IP 에서 남이 태운 버킷에 걸린 회원(이슈 #11 R3). 세션은 살아 있고 기다리면 풀림
localStorage.setItem('nutti.mock.scenario', 'session:lost')    // 재발급으로 안 풀리는 401 — 앱바 크레딧이 어느 화면에서나 부름
localStorage.setItem('nutti.mock.scenario', 'guest:ratelimited') // 게스트 발급 429 (이슈 #15)
localStorage.setItem('nutti.mock.scenario', 'auth:statefail')  // 소셜 콜백 state 검증 실패(401)
localStorage.setItem('nutti.mock.scenario', 'cafe24:linked')   // 카페24 연동 409 CAFE24_ALREADY_LINKED
localStorage.removeItem('nutti.mock.scenario')              // 정상
```

보관함에서 지운 결과는 `nutti.mock.library-deleted` 에 남습니다(새로고침해도 유지).
시드를 되돌리려면 `localStorage.removeItem('nutti.mock.library-deleted')`.

로컬 로그인 목: 비밀번호 `nutti1234`만 성공(그 외 401 `INVALID_CREDENTIALS`), 이메일
`taken@nutti.co.kr`로 가입하면 409 `EMAIL_TAKEN`. 소셜·카페24 `authorize`는 프로바이더
대신 **우리 콜백 라우트로 되돌려** 왕복 전체를 로컬에서 밟을 수 있게 합니다.

회원 전용 경로(PR #58): 게스트로 보면 W-10 획득 목록 4행이 전부 `login_required` + "로그인"
이고, 그 상태로 `POST /v1/credits/claim`·카페24 `authorize`를 부르면 **403 `MEMBER_ONLY`**
입니다(401 아님 — 게스트 세션은 살아남습니다). 로그인하면 원래 상태로 돌아옵니다.

커스텀 프롬프트는 **두 겹**으로 막힙니다: 화면 필터(`app/promptFilter.ts`)와 서버 필터
(목은 `SERVER_PROMPT_BLOCKLIST`). 목록이 달라서 화면을 통과하고 서버에서 막히는 문장이
있습니다 — "색깔만 바꿔줘"로 400 `input_filter_blocked` 안내를 밟아 볼 수 있습니다.

## 구조

```
src/
  api/
    types.ts        05-api-spec §3 수기 타입 (openapi-typescript 로 교체 예정)
    client.ts       fetch 래퍼 — 토큰·에러포맷·게스트 재발급을 여기만
    endpoints.ts    엔드포인트별 얇은 래퍼
    queries.ts      TanStack Query — 캐시 키·폴링 정책·무효화 지점
    idempotency.ts  Idempotency-Key 수명 (규칙이 두 방향으로 갈리는 지점)
    uploadDraft.ts  402 후 돌아왔을 때 업로드 결과 이어받기 (sessionStorage)
    jobContext.ts   job_id → 재생성 재료 로컬 색인. 서버 우선 · 로컬 폴백.
                    남은 이유는 `custom_prompt` 하나 (이슈 #81) — PR #83 이 머지되면
                    폴백이 전부 죽은 코드가 되므로 이 파일과 호출부째 삭제
  mocks/            MSW — 프로덕션 번들에서 완전히 제외됨
  screens/          화면. 구현된 것만 개별 파일, 나머지는 placeholders.tsx
  app/
    routes.tsx      11개 화면 라우트 테이블 (W-03 은 W-02 의 자식 = 시트)
    TabBar.tsx      하단 탭바 4칸. W-02·W-09 **두 화면만** 붙입니다 (그 근거는 파일 주석)
    reuseFromJob.ts `?from_job=` — "이 사진으로 다른 스타일"의 재사용 맥락 (W-02·W-03·W-04·W-08)
    guestSession.ts 게스트 세션 초기화 감지 → 복원 실패 안내 분기 (이슈 #5)
    authReturn.ts   OAuth 왕복 동안 복귀 주소 보관 (sessionStorage, 내부 경로만)
    retryAfter.ts   429 Retry-After → 사람이 읽는 문구 (게스트 발급·로그인 공용)
```

로그인 진입점은 W-01 헤더 · W-06 저장 · W-10 연동 세 곳이고 전부 `screens/AccountSheet.tsx`
한 벌을 씁니다. OAuth 복귀 지점은 `/auth/callback/:provider` (`screens/AuthCallback.tsx`) —
**프로바이더 콘솔의 redirect_uri 가 이 주소**라 경로를 바꾸면 카카오·네이버·카페24 설정도
같이 바꿔야 합니다.

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 0 | 스택 확정 · `web/` 배치 · 백엔드 차단 이슈 등록 | 완료 |
| Phase 1 | 목 서버 · API 클라이언트 · 라우팅 골격 | 완료 |
| Phase 2 | 핵심 플로우 W-01→W-02→W-03→W-04→W-05→W-06 | 완료 |
| Phase 3 | 출구 3갈래 + 크레딧 (W-06 공유/쇼핑몰, W-07, W-10, 402 흐름) | 완료 |
| Phase 4 | 계정·보관함 (W-06 B 로그인 시트, 콜백, W-09) | 완료 |
| Phase 5 | W-08 크리에이티브 · W-11 운영 콘솔(번들 분리) | W-08 완료 · W-11 미착수 |
| Phase 6 | GA4 크로스도메인 · UTM · 이벤트 비콘 | 미착수 |

## 백엔드 대기 중 (이슈)

| # | 내용 | 막히는 시점 | 상태 |
|---|---|---|---|
| [#3](https://github.com/N-utti/nutti-photo-playground/issues/3) | `CORSMiddleware` 미배선 | 실서버 연결 시작 즉시 | 해결 (PR #6) |
| [#4](https://github.com/N-utti/nutti-photo-playground/issues/4) | `response_model` 없이 §3 삭제 금지 | 타입 생성으로 전환할 때 | 해결 (PR #6) |
| [#5](https://github.com/N-utti/nutti-photo-playground/issues/5) | Q7 게스트 결과 복원 한계 | Phase 2 (W-05/W-06) | 결정 B+A · 프론트 반영 완료 |
| [#9](https://github.com/N-utti/nutti-photo-playground/issues/9) | job/펫 응답에 `style_id`·`upload_id` 참조 없음 | W-06 다시 만들기·다른 스타일, W-04 펫 스킵 | 해결. `GET /jobs/{id}`가 `style_id`·`upload_id`를, `GET /pets`가 `latest_upload_id`를 실제로 답합니다. `api/jobContext.ts` 로컬 색인에 남은 용도는 **`customPrompt` 하나**입니다 — 커스텀 job의 문구는 응답에 없어서 «다시 만들기»가 그것만 로컬에서 가져옵니다 |
| [#10](https://github.com/N-utti/nutti-photo-playground/issues/10) | 카카오 `kakao_token` 획득 경로 미정 | W-06 B 계정 연동 | 해결 (ADR-11 A안 → PR #21, `POST /v1/auth/kakao` 삭제) |
| [#14](https://github.com/N-utti/nutti-photo-playground/issues/14) | `authorize` 가 헤더를 요구하는 302 라 브라우저 이동 불가 | 로그인 시트·콜백 전부 | 해결 (PR #21 — 200 `{authorize_url}`) |
| [#17](https://github.com/N-utti/nutti-photo-playground/issues/17) | 로컬 계정 복구 불가(비밀번호 재설정·이메일 인증 없음) · 로그인 수단 추가 미지원 | 로컬 가입 | 해결 (PR #21 — 409 `ALREADY_MEMBER`·복구 불가 명시·검증 정책). **가입 시트의 사전 고지는 그대로 둡니다** — 계약이 명시됐을 뿐 비밀번호 재설정이 생긴 건 아닙니다 |
| [#22](https://github.com/N-utti/nutti-photo-playground/issues/22) | 회원 탈퇴 — `DELETE /v1/auth/me` 와 데이터 파기 정책 미설계 | W-12 탈퇴 버튼 | 대기 (§3 에 엔드포인트 없음). FR-W12-06 이 "자리만 확보"라 화면은 막히지 않습니다 |
| [#33](https://github.com/N-utti/nutti-photo-playground/issues/33) | 보관함 항목 `pet_id` 가 `null` 일 수 있는지 §3 에 없음 | W-09 강아지 필터 | 해결 (PR #51 — §3 에 `pet_id: uuid \| null` 명시). 삭제된 펫과 «펫 없이 만든 결과»를 클라이언트가 구분하지 않는 것도 확정이고, **삭제된 펫을 가리키는 `?pet_id=` 조회는 404 가 아니라 빈 목록**이라 W-09 는 그 필터를 «전체»로 걷습니다 |
| [#41](https://github.com/N-utti/nutti-photo-playground/issues/41) | job 응답에 시작 시각(`created_at`) 없음 | W-05 FR-EDGE-02 판정 | 해결. 응답이 `queued_at`·`started_at`을 답하고 W-05가 **서버 우선**으로 잽니다(`useStartedAt`). 워커가 재시도할 때도 최초 `started_at`을 유지하므로 판정 기준이 재시도마다 리셋되지 않습니다(`app/worker.py` `lease_job`) |
| [#71](https://github.com/N-utti/nutti-photo-playground/issues/71) | 스타일·펫 썸네일 URL이 `public_url()` 을 안 거쳐 로컬에서 404 | W-02 카탈로그·W-04 펫 목록 (목을 끈 로컬 한정) | 대기 — 백엔드 PR #74 가 고쳤으나 **아직 미머지**. 프론트는 무변경(`/media` dev proxy 는 PR #72 로 이미 있음) |
| [#77](https://github.com/N-utti/nutti-photo-playground/issues/77) | 결과 이미지 스토리지에 CORS 헤더 없음 | `CDN_BASE_URL` 을 채우는 배포 시점 | 대기 — **코드로 닫히지 않습니다**(R2/CDN 운영 설정). 프론트는 `app/saveImage.ts` 로 fetch→blob 저장하고 CORS 가 없으면 새 탭 폴백. **CORS 가 열려도 그 우회는 걷어내지 않습니다**(PR #80) |
| [#81](https://github.com/N-utti/nutti-photo-playground/issues/81) | job 응답에 `custom_prompt`·`credit_cost` 없음 | W-06 «다시 만들기» — W-08 커스텀 job 한정 | 대기 — 백엔드 PR #83 이 고쳤으나 **아직 미머지**. 프론트는 **읽는 쪽만 먼저 붙였습니다**: 두 필드를 옵셔널로 두고 `resolveJobContext` 가 `custom_prompt` 를, `W06Result` 가 `credit_cost` 를 **서버 우선**으로 봅니다 — 착지하는 순간 다른 기기에서 연 커스텀 결과도 버튼이 살아납니다. 머지되면 옵셔널을 떼고 `api/jobContext.ts` 를 호출부째 삭제 |

[#11](https://github.com/N-utti/nutti-photo-playground/issues/11)(auth 보안 후속 M3~M6·L1~L6)은 **프론트가 막히는 지점이 없어** 위 표에 넣지 않습니다 — 확인 근거는
이슈 코멘트에 남겼습니다(오픈 리다이렉트는 `app/authReturn.ts` 가 이미 막고, 동시 가입 경합을
서버가 409 로 정리하면 프론트는 무변경으로 맞는 문구가 나갑니다).

## 미확정

- ~~비주얼 디자인이 없습니다.~~ **닫혔습니다**(PR #35·#36). 브랜드 색·서체가 어느 문서에도
  없던 문제는 nutti.co.kr 실측으로 풀었고, `src/index.css`의 `@theme` 블록이 이제 확정본입니다.
  폰트는 `public/fonts/`, 파비콘·로고는 `public/brand/`(출처는 같은 폴더 `NOTICE.md`).
  **OG/공유 이미지는 아직 없습니다.**
- **W-01 히어로 이미지가 자리표시자입니다.** `public/hero/before.svg`·`after.svg`는
  비교 슬라이더가 동작한다는 것만 보여 주는 도형이고 실제 사진·생성 결과가 아닙니다.
  "내 애가 유지된다"를 첫 3초에 증명하는 게 이 화면의 임무(#p01 노트1)이므로,
  **같은 강아지의 원본/변환 한 쌍**이 나오면 같은 경로에 그대로 교체하세요.
- **`fit_tags[].score` 값 도메인** — §3 예시에 `good`/`caution` 둘만 등장하고 전체 목록이
  없습니다. 세 번째 등급이 있는지 확인 필요.
- ~~**보관함 `pet_id` 의 null 여부**~~ **닫혔습니다**(PR #51). §3 이 `pet_id: uuid | null`
  을 명시했고, 펫 삭제분(이슈 #12 결정4)과 «펫 없이 만든 결과»를 클라이언트가 구분하지
  않는 것도 함께 확정됐습니다 — 둘 다 «전체»에서만 보입니다(`api/types.ts` 주석).
  삭제된 펫을 가리키는 `?pet_id=` 조회는 빈 목록이라, W-09 는 그 URL 필터를 복원하지 않고
  «전체»로 걷습니다(`screens/W09Library.tsx` 의 `petGone`).
- ~~**이미지 저장은 같은 출처에서만 «저장»입니다.**~~ **프론트 몫은 닫혔습니다**
  (이슈 #77 · PR #78). `<a download>` 가 교차 출처에서 무시되는 문제는 `app/saveImage.ts`
  가 fetch → blob → `blob:` 로 우회합니다 — W-06 «이미지 저장»과 W-09 일괄 저장 둘 다
  이 경로를 지납니다. **다만 그 우회는 이미지 응답의 `Access-Control-Allow-Origin` 에
  기댑니다.** PR #78 이 그것을 `CDN_BASE_URL` 설정 시 필수 조건으로 배포 문서에 박아
  뒀지만, 실제 R2/CDN 설정은 버킷 생성 시점의 운영 작업이라 **이슈 #77 은 열려 있습니다**.
  CORS 없이 CDN 이 붙으면 저장은 예전처럼 «새 탭에 열기»로 물러나고, 화면이 그때만
  길게 눌러 저장하라고 안내합니다. **이슈 #77 이 닫혀도 이 우회는 걷어내지 않습니다** —
  CORS 는 `fetch` 를 허용할 뿐 교차 출처에서 무시되는 `download` 속성을 되살리지 않아서,
  앵커로 되돌리면 #77 의 버그가 그대로 재발합니다.

## 실수하기 쉬운 지점

1. **`blocking_issue`는 HTTP 에러가 아닙니다.** 고양이 감지도 200입니다(§1 코드표).
   에러 인터셉터로 잡지 말고 화면이 분기해야 합니다.
2. **Idempotency-Key** — 402 재시도는 같은 키, "다시 만들기"는 새 키.
   `api/idempotency.ts`만 거치면 틀리지 않습니다.
3. **크레딧 배지 무효화** — job 종료(성공·실패 둘 다), claim 성공, 로그인 후 병합.
   `invalidateAfterJobSettled`를 job이 종료 상태에 닿는 곳에서 반드시 호출하세요.
4. **W-02는 68개를 한 페이지에** 받습니다(카탈로그 페이지네이션 없음). 썸네일
   `loading="lazy"`는 옵션이 아니라 필수입니다.
5. **완료 알림을 약속하지 마세요.** W-05 문구에서 와이어프레임의 "알림 받고 나가기 /
   완성되면 알려드릴게요"를 뺐습니다 — 알림은 MVP 제외(FR-W05-04)이고, 지킬 수 없는
   약속이 이슈 #5의 출발점이었습니다. 지금 말할 수 있는 건 "같은 브라우저에서 이 주소로
   다시 오면 결과가 남아 있다"까지입니다.
6. **W-07 은 화면이 아니라 배너입니다.** 결과에서 계산기로 넘기는 주 경로는 W-06
   배너가 **직접** `calculator_url` 로 나갑니다(UC-06 (c) · #p07 노트6 "필수 경유지가
   아님"). `/calculator` 라우트는 결과가 눈앞에 없을 때(`?pet_id=`)의 진입이고, 지금
   그리로 가는 유일한 링크는 W-09 에서 강아지 필터를 걸었을 때 나오는 줄입니다.
   추정 문구 3케이스는 `api/calculatorLink.ts` 한 곳에 있으니 배너·화면 중
   한쪽만 고치지 마세요.
7. **랜딩 CTA 는 스타일 없이 `/upload` 로 들어옵니다**(FR-W01-02 — 사진이 먼저).
   그래서 W-04 는 `style_id` 가 없는 상태를 정상 경로로 다뤄야 하고, 업로드 초안도
   `styleId: null` 로 저장됐다가 스타일을 고르고 돌아올 때 넘겨받습니다
   (`api/uploadDraft.ts`). 이 연결이 끊기면 같은 사진을 두 번 올리게 되고
   `upload_id` 가 새로 발급돼 Idempotency-Key 전제가 깨집니다.
8. **탭바를 전 화면에 깔지 마세요.** FR-W02-08 의 «[전역]» 은 "여러 화면에 반복
   등장하니 FR 을 한 번만 쓴다"는 문서 규칙이고, 와이어프레임이 실제로 탭바를 그린
   건 W-02·W-09 둘뿐입니다. W-04→W-05→W-06 은 만들기 흐름 한복판이라 이탈문을 열면
   안 되고, W-10 B·W-12 는 자기 앱바를 가진 별도 프레임입니다. «만들기» 탭이 보내는
   `/upload` 에 탭바가 없는 것도 같은 이유이며 의도된 상태입니다(`app/TabBar.tsx` 주석).
9. **`from_job` 을 떨어뜨리지 마세요.** "이 사진으로 다른 스타일"(FR-W06-07)은 W-06 이
   보여 주는 인기 3장으로 끝나지 않습니다 — 카탈로그로 나가는 순간 맥락이 끊기면
   **같은 사진을 다시 올리게 되고** `upload_id` 가 새로 발급돼 재사용이 무산됩니다
   (7번과 같은 함정). W-02·W-03·W-04·W-08 이 이 파라미터를 나르며, 새로 링크를 추가할
   때는 `withReuse()` 로 감싸세요(`app/reuseFromJob.ts`). 재료의 출처는 **서버 우선 ·
   로컬 색인 폴백**이라 백엔드가 `upload_id` 를 싣기 시작하면 다른 기기·링크 재방문에서도
   그대로 동작합니다.
10. **job 폴링은 4xx 에서만 멈춥니다.** TanStack Query는 에러 상태여도 `refetchInterval`을
   멈추지 않으므로 `useJobPolling`이 직접 판정합니다. 다만 "에러면 멈춘다"로 뭉뚱그리면
   안 됩니다 — 404·401은 job이 없다는 뜻이지만 **5xx·네트워크 단절은 job이 아니라 우리
   쪽 사정**이고, 서버는 그 사이에도 계속 그리고 있습니다. 여기서 접으면 크레딧이 이미
   나간 작업의 결과를 화면이 영영 못 받습니다. 갈라 주는 건 `isFatalJobError()` 하나이고
   `retry`·`refetchInterval`·W-05·W-06이 전부 이걸 씁니다. 목 시나리오 `job:flaky`로
   전 구간을 밟을 수 있습니다.
11. **계산기 배너 문구는 업로드가 정합니다.** `GET /v1/calculator-link` 가 돌려주는
   견종은 그 job 이 쓴 업로드의 `breed_estimate` 에서 나옵니다 — 목도 job → upload 로
   따라갑니다. 그래서 «강아지를 못 찾은 사진»(`upload:nodog`)으로 만든 결과는 배너가
   «견종을 확인하지 못했어요 · 1단계부터»(FR-EDGE-10)로, 믹스견(`upload:warn`)은
   «믹스견 · 중형»(FR-EDGE-11)으로 떨어집니다. 이름은 **저장된 강아지가 있을 때만**
   붙고(없으면 «우리 아이는»), W-06 배너와 W-07 화면이 같은 문장을 말하는지는
   `api/calculatorLink.ts` 한 곳이 보장합니다.
12. **회복 가능한 에러로 화면을 헐지 마세요.** W-05·W-06은 `error`가 있어도 이미 받아 둔
   `job`이 있고 치명적이지 않으면 `JobUnavailable`로 넘어가지 않습니다. 넘어가면 아직
   살아 있는 작업 앞에서 사용자가 보는 건 재시도 버튼이 없는 «새로 만들기»뿐이고,
   그게 곧 크레딧을 버리게 만듭니다. W-05는 대신 "연결이 잠시 불안정해요" 한 줄만 붙입니다.
