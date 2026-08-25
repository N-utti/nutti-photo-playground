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
npm run test     # vitest — 컴포넌트 회귀 테스트
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
| 게스트·로그인·연동·탈퇴 | `/auth/*` | 구현 (`DELETE /auth/me` 포함 — 2026-08-21 실측) |
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

**목을 끄기 전에 백엔드를 최신으로 맞춥니다.** 띄워 둔 채로 며칠 지난 uvicorn 은 그때의
라우팅을 그대로 서빙합니다 — 2026-08-21 에 `DELETE /v1/auth/me` 가 **405** 로 돌아왔는데
프론트 문제가 아니라 8/14 에 뜬 서버라 그 라우트가 아예 없던 것이었습니다(`curl -s
localhost:8000/openapi.json` 의 `paths['/v1/auth/me']` 키로 확인됩니다). 서버를 새로 띄우면
이번엔 스키마가 뒤처져 `column "input_fields" does not exist` 로 500 이 납니다. 백엔드를
당긴 뒤에는 `python -m uv run aerich upgrade` 를 먼저 돌립니다.

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
localStorage.setItem('nutti.mock.scenario', 'credit:custom-cost-3') // 커스텀 비용이 2가 아닌 서버(app_setting, 이슈 #149) — W-02·W-04 링크와 W-08 버튼이 요청 전에 «3 크레딧»을 말하고, 잔액 1이라 402까지 이어짐
localStorage.setItem('nutti.mock.scenario', 'styles:no-images') // 예시 이미지가 없는 스타일 — 자리표시자·캐러셀 생략(기본 목은 시드가 채운 실서버 그대로 1장)
localStorage.setItem('nutti.mock.scenario', 'styles:rich')      // 운영이 예시를 더 올리고 궁합 태그를 채운 뒤 — 캐러셀 페이저·궁합 칩
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

**지운 결과의 `/jobs/{job_id}` 주소는 목에서 404 입니다.** 논리삭제된 결과가 조회에서
빠지는 게 계약이고(`06-architecture` §4 삭제 경로), 지금 서버는 그 필터가 없어서 지운
사진이 그대로 열립니다 — 백엔드 이슈 #152. 목이 그 결함까지 흉내 내면 «지우고 나서 그
주소로 돌아온 사람» 을 화면에서 밟을 수 없으므로 계약 쪽을 그립니다. 그 화면(«삭제한
결과입니다»)은 지운 게 이 브라우저일 때만 뜹니다(`app/deletedResults.ts`, 키는
`nutti.deleted-jobs` — 지우면 «결과를 찾을 수 없습니다» 로 돌아갑니다).

로컬 로그인 목: 비밀번호 `nutti1234`만 성공(그 외 401 `INVALID_CREDENTIALS`), 이메일
`taken@nutti.co.kr`로 가입하면 409 `EMAIL_TAKEN`. 소셜·카페24 `authorize`는 프로바이더
대신 **우리 콜백 라우트로 되돌려** 왕복 전체를 로컬에서 밟을 수 있게 합니다.

회원 전용 경로(PR #58): 게스트로 보면 W-10 획득 목록 4행이 전부 `login_required` + "로그인"
이고, 그 상태로 `POST /v1/credits/claim`·카페24 `authorize`를 부르면 **403 `MEMBER_ONLY`**
입니다(401 아님 — 게스트 세션은 살아남습니다). 로그인하면 원래 상태로 돌아옵니다.

커스텀 프롬프트는 **두 겹**으로 막힙니다: 화면 필터(`app/promptFilter.ts`)와 서버 필터
(목은 `SERVER_PROMPT_BLOCKLIST`). 목록이 달라서 화면을 통과하고 서버에서 막히는 문장이
있습니다 — "색깔만 바꿔줘"로 400 `input_filter_blocked` 안내를 밟아 볼 수 있습니다.

## 테스트

`npm run test` (watch 는 `npm run test:watch`). vitest + @testing-library/react + jsdom이고,
설정은 `vite.config.ts`의 `test` 블록입니다 — 별도 번들러 설정을 두지 않아 테스트가 앱과
같은 방식으로 모듈을 풉니다. 목은 **브라우저와 같은 핸들러**를 node에서 재사용합니다
(`src/test/server.ts` → `src/mocks/handlers.ts`).

목표는 커버리지 숫자가 아니라 **조용히 깨지는 것들의 회귀 방지**입니다(이슈 #94). 아래 표를
읽는 방법: 왼쪽이 파일, 오른쪽이 **그 파일이 없으면 다시 일어날 일**입니다.

구현된 화면은 모두 회귀 테스트를 갖췄습니다. 새 테스트를 붙일 때 알아 둘 두 가지:

- **게스트/회원 분기**는 `/auth/me`만 덮으면 부족합니다 — `/credits` 핸들러가 응답을 만들 때 목
  **내부의** 로그인 상태를 보고 획득 목록을 전부 `login_required`로 갈아 끼웁니다(`guestAware`).
- **`AuthCallback`은 테스트마다 고유한 `state` 문자열**이 필요합니다. 같은 `provider:state`를
  하나로 묶는 `inFlight` Map이 모듈 수준이라, 값을 재사용하면 앞 테스트의 promise를 물려받습니다.

| 파일 | 막는 것 |
|---|---|
| `app/modalContract.test.ts` | `role="dialog"`를 선언해 놓고 가둠을 안 거는 것 — **소스를 직접 훑습니다** |
| `app/useModalDialog.test.tsx` | 시트가 떠 있는데 Tab이 **뒤 화면 버튼**으로 나가는 것 (로그인 시트·402 오버레이·확인 창) |
| `screens/W03StyleDetail.test.tsx` | W-03 시트가 부모의 `inert` 없이는 못 서게 되는 것 · 예시 0장을 세는 것 |
| `app/BackButton.test.tsx` | ←가 화면마다 다른 곳으로 가는 것 · 탭 영역 확장이 떨어져 나가는 것 |
| `app/routes.test.tsx` | 새 라우트를 추가하며 `handle.title`을 빠뜨리는 것 |
| `app/RootLayout.test.tsx` | 제목 해석 규칙(가장 깊은 매치부터 거슬러 올라가기)이 깨지는 것 |
| `test/mockReset.test.ts` | 목 상태가 테스트 사이로 새는 것 — **다른 테스트가 서 있는 바닥** |
| `api/idempotency.test.ts` | 402 재시도가 새 키를 쓰는 것(이중 차감) · 「다시 만들기」가 같은 키를 쓰는 것(안 바뀜) |
| `api/uploadDraft.test.ts` | 크레딧 받고 돌아왔을 때 사진을 다시 올리게 되는 것 |
| `api/calculatorLink.test.ts` | W-06 배너와 W-07 화면이 같은 추정을 두고 다른 말을 하는 것 |
| `app/ledgerFormat.test.ts` | 서버가 사유를 늘렸을 때 내역 표에 **영문 코드**가 찍히는 것 |
| `app/promptFilter.test.ts` | 결제 전 관문이 넓어져 «검은 턱시도»가 막히는 것 · 좁아져 품종 변경이 새는 것 |
| `app/retryAfter.test.ts` | 같은 429를 두고 화면마다 다른 시간을 말하는 것 |
| `app/reuseFromJob.test.ts` | 재사용 맥락이 끊겨 같은 사진을 다시 올리게 되는 것(다섯 화면 공유) |
| `screens/W10Ledger.test.tsx` | 위 `ledgerFormat` 규칙이 **화면에 실제로 닿는지** |
| `screens/JobUnavailable.test.tsx` | 일시적 오류에 "이 결과는 돌아오지 않아요"를 띄워 사고를 과장하는 것 |
| `screens/W05Waiting.test.tsx` | 5xx 한 번에 화면을 헐어 **살아 있는 작업**을 포기시키는 것 · 1분을 넘겨 놓고 "거의 다 됐어요"라고 하는 것 |
| `screens/W06Result.test.tsx` | 문서에 없는 `error_code` 하나에 결과 화면이 통째로 죽는 것(실측 이력) |
| `screens/W06RegenerateInputs.test.tsx` | 「다시 만들기」가 화면에 적어 놓은 옵션을 요청에서 빼는 것 — 같은 버튼·같은 크레딧으로 **다른 그림**이 나오는 것(이슈 #127) |
| `screens/W04Upload.test.tsx` | 그림에 **글자로 박히는 것**(이름·견종)을 크레딧 쓰기 전에 말하지 않는 것 — 폴백 «우리 아이»를 예고만 하고 통과시키는 것 · 추정 못 한 견종을 말해 «토이푸들»을 기대하게 하는 것 · 반대로 아는 견종을 안 말해 #131 이전으로 조용히 되돌아가는 것 |
| `screens/W07Calculator.test.tsx` | 견종을 모르는데 안다고 해서 **남의 강아지 기준 간식량**을 넘기는 것 |
| `screens/EarnActionList.test.tsx` | 매출 직결 줄이 응답 순서에 밀리는 것 · 게스트에게 받지 못할 보상을 약속하는 것 |
| `screens/W08Creative.test.tsx` | 서버가 막은 문구에 **서버 원문**을 띄워 무엇을 고칠지 모르게 하는 것 · 안내만 띄우고 버튼은 열어 두는 것 |
| `screens/W09Library.test.tsx` | 필터를 바꿔도 선택이 남아 **화면에 없는 사진이 삭제**되는 것 · 지워진 강아지 필터를 결과 없음으로 오해시키는 것 · 지운 사진이 목록에 그대로 남아 한 번 더 누르게 하는 것 |
| `app/deletedResults.test.ts` | 저장소에 남은 이상한 값 하나가 **보관함 삭제 성공 콜백 한가운데서** 터지는 것 |
| `screens/W10Credits.test.tsx` | 못 불러온 잔액을 0으로 적어 "크레딧이 없다"고 단정하는 것(ADR-02) |
| `screens/W12MyPage.test.tsx` | 히스토리 `state.from`을 믿고 「뒤로」가 **외부 사이트**로 나가는 것 · 부가 정보 실패에 계정 경고를 띄우는 것 |
| `screens/AccountSheet.test.tsx` | 429에 "잠시 뒤"로 뭉개 사용자가 30초마다 다시 누르게 하는 것 · 모드를 바꿔도 앞의 오류가 남는 것 |
| `screens/AuthCallback.test.tsx` | 콜백이 두 번 나가 **방금 받은 코드**가 만료됐다고 하는 것(1회용 nonce) |

### 시트를 새로 만들 때

**확인 창은 `app/ConfirmDialog.tsx`를 쓰세요.** 포커스 가둠·Escape·스크롤 잠금이 이미 들어
있습니다. 제목과 «취소»만 껍데기가 갖고, 확인 버튼은 `children`으로 넘깁니다(문구도 색도
화면마다 다릅니다).

껍데기가 안 맞아 직접 `role="dialog"`를 그린다면 `useModalDialog`를 달고 그 엘리먼트에
`tabIndex={-1}`을 주세요. 빠뜨리면 `modalContract.test.ts`가 잡습니다 — 이 파일은 등록을
기다리지 않고 `src` 전체를 훑으므로, 새 시트가 어디에 생기든 대상이 됩니다.

동작까지 보려면 `useModalDialog.test.tsx`의 `CASES`에 한 줄 더합니다. 다만 **거기 적는 건
사람 몫이라 믿을 게 못 됩니다** — PR #93이 그 규칙을 남긴 뒤 생긴 확인 창 셋(로그아웃·보관함
삭제·펫 프로필)은 전부 등록되지 않았고 전부 `aria-modal="true"`만 선언한 채 아무것도 가두지
않았습니다. 마우스로는 차이가 없어 화면은 멀쩡해 보이고 키보드에서만 드러납니다. 그래서
소스를 훑는 검사를 한 겹 더 두었습니다.

`CASES`에 못 들어가는 시트도 있습니다. W-03은 `onClose`가 아니라 `navigate`로 닫히고
`useParams()`를 읽어 라우트 매칭이 필요해서, 같은 검사를 자기 테스트 파일에서 따로 합니다.

### jsdom이 답해 주지 않는 것

- **레이아웃이 없습니다.** `getBoundingClientRect()`가 전부 0이고 Tailwind 클래스도 적용되지
  않습니다. 그래서 탭 타깃 46×45px 같은 **실제 치수는 여기서 잴 수 없고**, 넓히는 장치가
  붙어 있는지까지만 봅니다. 픽셀 확인은 여전히 브라우저 몫입니다.
- **`offsetParent`가 항상 null입니다.** 포커스 가둠이 «보이는 것»을 이걸로 거르므로
  `src/test/setup.ts`에서 «붙어 있으면 보인다»로 근사합니다. 안 그러면 탭 대상 목록이 늘
  비어서, 순환 경로를 한 번도 밟지 않은 채 통과합니다.
- **목 상태는 매 테스트 뒤에 되돌아갑니다** — `src/test/setup.ts`의 `afterEach`가
  `resetMockState()`를 부릅니다(`mocks/handlers.ts`). 잔액·job·펫·로그인 여부를 **바꾸는**
  테스트를 순서 걱정 없이 붙일 수 있습니다. 다만 `server.use(...)`는 여전히 쓰세요 —
  둘은 다른 층입니다. 리셋은 **데이터**를, `resetHandlers`는 **핸들러**를 되돌립니다.
  `fixtures.ts`의 `petList`·`libraryItems`도 리셋 대상입니다(핸들러가 제자리에서 고칩니다).

E2E(playwright)는 아직 없습니다. 위 항목들이 브라우저를 요구하므로 언젠가 필요하지만,
도입·유지 비용이 따로라 이슈 #94 범위에서 뺐습니다.

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
  mocks/            MSW — 프로덕션 번들에서 완전히 제외됨
  test/             vitest 준비 코드. 테스트는 대상 파일 옆에 `*.test.tsx` 로 둡니다
    setup.ts        jest-dom · MSW 수명 · jsdom 이 답 못 하는 지점 메우기
    server.ts       node 쪽 MSW — 브라우저와 **같은** 핸들러를 씁니다
    render.tsx      QueryClient + 라우터를 두른 렌더 (시트는 혼자 서지 못합니다)
  screens/          화면. 구현된 것만 개별 파일, 나머지는 placeholders.tsx
  app/
    routes.tsx      11개 화면 라우트 테이블 (W-03 은 W-02 의 자식 = 시트)
    useModalDialog.ts  `aria-modal` 을 **실제** 모달로 — 포커스 가둠·Escape·스크롤 잠금
    ConfirmDialog.tsx  되돌릴 수 없는 동작의 확인 창 껍데기. 위 훅이 이미 들어 있습니다
    TabBar.tsx      하단 탭바 4칸. W-02·W-09 **두 화면만** 붙입니다 (그 근거는 파일 주석)
    reuseFromJob.ts `?from_job=` — "이 사진으로 다른 스타일"의 재사용 맥락 (W-02·W-03·W-04·W-08).
                    재생성 재료(`contextFromJob`)도 여기 — job 응답 하나가 전부 답합니다
    styleInputs.ts  스타일별 입력값의 초기화·검증 — 서버 `_resolve_input_values` 의 사본
    StyleInputForm.tsx  그 칸을 그리는 폼. **두 화면이 같이 씁니다** (W-04 만들기 · W-06 다시 만들기)
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
| [#9](https://github.com/N-utti/nutti-photo-playground/issues/9) | job/펫 응답에 `style_id`·`upload_id` 참조 없음 | W-06 다시 만들기·다른 스타일, W-04 펫 스킵 | 해결. `GET /jobs/{id}`가 `style_id`·`upload_id`를, `GET /pets`가 `latest_upload_id`를 실제로 답합니다. 남아 있던 `customPrompt` 용도는 #81 이 닫았고, `api/jobContext.ts` 로컬 색인은 **삭제됐습니다** |
| [#10](https://github.com/N-utti/nutti-photo-playground/issues/10) | 카카오 `kakao_token` 획득 경로 미정 | W-06 B 계정 연동 | 해결 (ADR-11 A안 → PR #21, `POST /v1/auth/kakao` 삭제) |
| [#14](https://github.com/N-utti/nutti-photo-playground/issues/14) | `authorize` 가 헤더를 요구하는 302 라 브라우저 이동 불가 | 로그인 시트·콜백 전부 | 해결 (PR #21 — 200 `{authorize_url}`) |
| [#17](https://github.com/N-utti/nutti-photo-playground/issues/17) | 로컬 계정 복구 불가(비밀번호 재설정·이메일 인증 없음) · 로그인 수단 추가 미지원 | 로컬 가입 | 해결 (PR #21 — 409 `ALREADY_MEMBER`·복구 불가 명시·검증 정책). **가입 시트의 사전 고지는 그대로 둡니다** — 계약이 명시됐을 뿐 비밀번호 재설정이 생긴 건 아닙니다 |
| [#22](https://github.com/N-utti/nutti-photo-playground/issues/22) | 회원 탈퇴 — `DELETE /v1/auth/me` 와 데이터 파기 정책 미설계 | W-12 탈퇴 버튼 | 해결 (PR #120 → 프론트 PR #126, 이슈 #123). 파기 범위가 정해져서 확인 창이 **고지**할 말이 생겼습니다 — 자리만 잡고 있던 FR-W12-06 이 실제 동작입니다. 204 를 받은 뒤에만 로컬을 비우고(실패는 삼키지 않습니다 — 계정이 살아 있는데 «탈퇴됨»으로 믿게 두지 않으려고), 흔적·캐시까지 지우고 새 게스트로 섭니다 |
| [#33](https://github.com/N-utti/nutti-photo-playground/issues/33) | 보관함 항목 `pet_id` 가 `null` 일 수 있는지 §3 에 없음 | W-09 강아지 필터 | 해결 (PR #51 — §3 에 `pet_id: uuid \| null` 명시). 삭제된 펫과 «펫 없이 만든 결과»를 클라이언트가 구분하지 않는 것도 확정이고, **삭제된 펫을 가리키는 `?pet_id=` 조회는 404 가 아니라 빈 목록**이라 W-09 는 그 필터를 «전체»로 걷습니다 |
| [#41](https://github.com/N-utti/nutti-photo-playground/issues/41) | job 응답에 시작 시각(`created_at`) 없음 | W-05 FR-EDGE-02 판정 | 해결. 응답이 `queued_at`·`started_at`을 답하고 W-05가 **서버 우선**으로 잽니다(`useStartedAt`). 워커가 재시도할 때도 최초 `started_at`을 유지하므로 판정 기준이 재시도마다 리셋되지 않습니다(`app/worker.py` `lease_job`) |
| [#71](https://github.com/N-utti/nutti-photo-playground/issues/71) | 스타일·펫 썸네일 URL이 `public_url()` 을 안 거쳐 로컬에서 404 | W-02 카탈로그·W-04 펫 목록 (목을 끈 로컬 한정) | 해결 (PR #74). 프론트는 무변경(`/media` dev proxy 는 PR #72 로 이미 있음) |
| [#77](https://github.com/N-utti/nutti-photo-playground/issues/77) | 결과 이미지 스토리지에 CORS 헤더 없음 | `CDN_BASE_URL` 을 채우는 배포 시점 | 대기 — **코드로 닫히지 않습니다**(R2/CDN 운영 설정). 프론트는 `app/saveImage.ts` 로 fetch→blob 저장하고 CORS 가 없으면 새 탭 폴백. **CORS 가 열려도 그 우회는 걷어내지 않습니다**(PR #80) |
| [#81](https://github.com/N-utti/nutti-photo-playground/issues/81) | job 응답에 `custom_prompt`·`credit_cost` 없음 | W-06 «다시 만들기» — W-08 커스텀 job 한정 | 해결 (PR #83). 커스텀 결과를 **다른 기기·링크로 열어도** 같은 문구·같은 비용으로 다시 만듭니다. 이 필드가 로컬 색인의 마지막 존재 이유였어서 `api/jobContext.ts` 를 호출부째 삭제했고, 맥락 조립은 `app/reuseFromJob.ts` `contextFromJob` 하나로 모였습니다. `credit_cost` 덕에 W-06 이 비용을 알아내려 스타일 상세를 따로 부르던 조회도 없어졌습니다 |
| [#127](https://github.com/N-utti/nutti-photo-playground/issues/127) | job 응답에 `input_values` 없음 | W-06 «다시 만들기» — `input_fields` 를 가진 24종 한정 | 대기 — **지난 값 되살리기**는 계약이 와야 합니다(로컬 색인으로 메우는 건 #81 이 지운 후퇴라 하지 않습니다). 다만 «말없이 기본값으로 바꾸는» 절반은 계약 없이 닫았습니다: W-06 이 스타일 스키마(`input_fields`)를 읽어 **다시 만들 때 쓸 값**을 접힌 줄로 보여 주고, 거기서 고친 값이 그대로 `inputs` 로 나갑니다(`screens/W06Result.tsx` `Regenerate`). 접힌 줄 아래 «기본값으로 시작해요» 한 줄이 그 값이 지난번 선택이 아님을 말합니다. 계약이 오면 `initialInputValues(...)` 자리에 `job.inputs` 를 넣고 그 한 줄을 지우면 됩니다 — 폼과 요청 조립은 그대로입니다. 스키마 변경 뒤 재생성(400 `unknown_inputs`)을 서버가 흡수할지 프론트가 거를지는 그때 함께 확정됩니다 |
| [#131](https://github.com/N-utti/nutti-photo-playground/issues/131) | 워커의 `[breed]` 치환이 항상 «강아지» 로 떨어짐 | W-04 확인 단계의 **견종** 예고 | 해결 (A안 → 백엔드 PR #137). 워커가 `breed_label` → `source_image.breed_estimate["label"]` → «강아지» 로 한 단계 더 내려갑니다 — 이제 실제로 인쇄됩니다. **다만 예고는 W-04 에서만 합니다.** 견종은 사용자가 넣는 값이 아니라 사진에서 **추정**한 값이고 비전이 확신 못 하면 빈 채로 오므로(PR #59), 업로드 전인 W-02·W-03 은 무엇이 박힐지 모릅니다 — 거기서 예고하면 보장할 수 없는 걸 약속하게 됩니다. `uses_pet_name` 과 갈리는 지점이 정확히 여기입니다(이름은 우리가 받아서 넣으니 예고가 곧 약속). 그래서 사진이 손에 들어온 뒤, 추정값이 **실제로 있을 때만**, 출처를 밝히고 말합니다(`screens/W04Upload.tsx` `BreedPrintNotice`). 없으면 침묵합니다 — «견종은 안 들어가요» 는 다음 사진에서 틀립니다. 재사용 경로(다른 스타일·저장된 강아지)도 조용합니다: `GET /v1/jobs/{id}`·`GET /v1/pets` 가 추정값을 안 줘서 프론트가 모릅니다(서버는 알아서 그림에는 정상 인쇄됩니다) |
| [#149](https://github.com/N-utti/nutti-photo-playground/issues/149) | 커스텀 프롬프트 비용(`app_setting.custom_prompt_credit_cost`)을 읽을 경로 없음 | W-02 하단 링크·W-04 업로드 후 링크·W-08 만들기 버튼 | 해결 (A안 → PR #151). `GET /v1/credits` 가 `custom_prompt_credit_cost` 를 답합니다. 프론트가 지어내던 상수(`CUSTOM_PROMPT_COST_ESTIMATE = 2`)는 삭제했고, 세 화면이 같은 쿼리에서 읽습니다(`app/customPromptCost.ts` — 잔액 배지가 이미 구독 중이라 왕복은 그대로 0). **모르는 동안은 숫자를 감춥니다** — 로딩 중에 2 를 그리면 화면이 먼저 단정하고 나중에 정정합니다. 402 의 `required` 는 여전히 정책값을 덮습니다(화면을 열어 둔 사이 운영이 값을 바꾼 경우) |

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
4. **W-02는 전체를 한 페이지에** 받습니다(카탈로그 페이지네이션 없음 — 시드 기준
   39개, PR #95). 썸네일 `loading="lazy"`는 옵션이 아니라 필수입니다.
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
13. **스타일 입력은 만드는 입구가 둘입니다.** `input_fields` 를 가진 24종은 W-04 «이대로
   만들기» 와 W-06 «다시 만들기» **양쪽에서** 값을 골라 보낼 수 있어야 합니다. 한쪽에만
   폼을 두면 다른 쪽은 서버가 `default` 로 채우고, 사용자는 같은 버튼·같은 크레딧으로
   다른 그림을 받습니다(이슈 #114 가 고친 결함이 #127 로 재현된 경로). 그래서 폼은
   `app/StyleInputForm.tsx` 한 벌이고 검증은 `app/styleInputs.ts` 한 곳입니다 — 새 입구를
   만들 때(예: 보관함에서 재생성) 폼을 다시 그리지 말고 이 둘을 그대로 쓰세요.
