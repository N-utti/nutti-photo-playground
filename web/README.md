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

### 실서버로 지금 밟을 수 있는 범위 (2026-08-26 실측)

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
| 공유 이미지 | `POST /jobs/{id}/share` | 구현 (PR #73) |
| 계산기 연결 | `GET /calculator-link` | 구현 (PR #122 — 2026-08-19) |
| 보관함 | `GET·DELETE /library` | 구현 (PR #156·#157 — 2026-08-26). **회원 전용** — 게스트는 403 `MEMBER_ONLY` |
| 이벤트 비콘 | `POST /events` | 구현 |
| 운영 콘솔 | `/admin/*` | 구현 (PR #181~#187 — 08-28~31). **막는 건 화면뿐** — 아래 W-11 절 |

이 표는 `app/routers/*.py` 에서 `not_implemented()` 를 찾으면 그 자리에서 검산됩니다 —
2026-08-31 기준 **한 자리도 남지 않았습니다**. 501 은 이 표에서 사라진 상태고, 이제
「못 밟는 화면」은 백엔드가 아니라 프론트가 안 만든 것뿐입니다. **표가 «501» 이라고 적혀
있다는 이유로 목을 계속 믿지 마세요**: 공유는 08-12 이전, 계산기 연결은 08-19 에
구현됐는데 이 표는 08-25 까지 둘 다 501 이라고 말하고 있었습니다.

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
localStorage.setItem('nutti.mock.scenario', 'upload:warn')  // 품질 경고(비차단) · 견종은 계산기 목록 밖(→ 믹스견 폴백)
localStorage.setItem('nutti.mock.scenario', 'upload:nodog') // 강아지 미검출 경고(FR-EDGE-08) · 견종 추정 실패
localStorage.setItem('nutti.mock.scenario', 'upload:multi') // 여러 마리(FR-EDGE-09)
localStorage.setItem('nutti.mock.scenario', 'upload:face')  // 사람 얼굴 — policy=warn (FR-EDGE-06)
localStorage.setItem('nutti.mock.scenario', 'upload:face-block') // 사람 얼굴 — policy=block (FR-EDGE-06)
localStorage.setItem('nutti.mock.scenario', 'upload:block') // 고양이 감지(차단, FR-EDGE-07)
localStorage.setItem('nutti.mock.scenario', 'job:fail')     // GENERATION_FAILED + 크레딧 반환
localStorage.setItem('nutti.mock.scenario', 'job:safety')   // SAFETY_BLOCKED — 안전 필터 차단, 재시도 없이 즉시 실패 + 크레딧 반환(PR #70)
localStorage.setItem('nutti.mock.scenario', 'job:retries')  // MAX_RETRIES_EXCEEDED — 시도 3회를 태우며 processing↔queued 를 오간 뒤 실패
localStorage.setItem('nutti.mock.scenario', 'job:flaky')    // 생성 중 3~18초 503 → W-05가 화면을 헐지 않고 자력 복구
localStorage.setItem('nutti.mock.scenario', 'job:slow')     // 150초 job → 90초에서 W-05 지연 안내로 전환(FR-EDGE-02 · NFR-PERF-01)
localStorage.setItem('nutti.mock.scenario', 'job:queued')   // 워커가 안 집는 job — started_at=null 인 큐 대기(PR #60)
localStorage.setItem('nutti.mock.scenario', 'credit:empty') // 잔액 0에서 시작 → 402 → 시트에서 받고 재시도
localStorage.setItem('nutti.mock.scenario', 'credit:clawback') // 주문 취소 회수로 잔액이 **음수**(-9) — FR-EDGE-05 · ADR-02. 표시는 0인데 판정은 원값이라, 크레딧을 받아도 숫자가 안 움직이고 만들기도 계속 막힘
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

**보관함은 목에서도 회원 전용입니다**(백엔드 PR #156). 게스트로 W-09 를 열면 목록이
아니라 403 `MEMBER_ONLY` 가 오고 화면은 «로그인하면 여기에 모여요» 를 답니다 — 시드
8건을 보려면 먼저 로그인하세요. 커서도 실서버와 같은 keyset 이라(직전 페이지 마지막
`result_id`) 1페이지에서 지우고 «더 보기» 를 눌러도 항목이 건너뛰어지지 않습니다.
한 삭제 요청은 100개까지고, 화면이 그 앞에서 막습니다(`W09Library` `DELETE_LIMIT`).

보관함에서 지운 결과는 `nutti.mock.library-deleted` 에 남습니다(새로고침해도 유지).
시드를 되돌리려면 `localStorage.removeItem('nutti.mock.library-deleted')`.

**지운 결과의 `/jobs/{job_id}` 주소는 열립니다 — 빈 `results` 로 200 입니다**(백엔드
PR #157). 오랫동안 목은 여기서 404 를 줬는데, 그건 «논리삭제되면 이 주소도 닫힌다» 는
추측이었습니다. 백엔드가 이슈 #152 에서 갈라 정했습니다: 조회는 200 + `results: []`,
`POST /jobs/{id}/share` 만 404. job 은 살아 있고 사라지는 건 결과물뿐이라, W-06 은 제목을
«지운 사진» 으로 바꾸면서도 `style_id`·`upload_id`·`inputs` 로 **같은 설정의 다시 만들기**를
답니다. 이 갈래는 누가 지웠든 뜹니다 — 결과가 비어 있다는 사실만 보면 되니까요. 반대로
job 째로 **404** 인 경우(«삭제한 결과입니다»)는 지운 게 이 브라우저일 때만 그렇게
설명합니다(`app/deletedResults.ts`, 키는 `nutti.deleted-jobs`).

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
| Phase 5 | W-08 크리에이티브 · W-11 운영 콘솔(번들 분리) | W-08 완료 · W-11 미착수 — **백엔드는 전부 착지**(PR #181~#187), 아래 절 |
| Phase 6 | GA4 크로스도메인 · UTM · 이벤트 비콘 | **프론트 완료 · GA4 관리자 등록만 남음** — 아래 절차 |

### GA4 배선 (Phase 6)

측정 ID 는 **`G-KG0XE6F5XT`** 입니다. 지어낸 값이 아니라 `nutti.co.kr/calculator/js/ga.js`
의 `var GA_ID` 에서 실측했고, 쇼핑몰 본체(`nutti.co.kr`)도 카페24가 심은 Google Tag
컨테이너 `GT-MBH8R5DC` 를 거쳐 **같은 속성**으로 보냅니다(2026-08-26, 두 페이지의 수집
비콘 `tid` 로 확인). 크로스도메인은 한 속성 안에서만 성립하므로 이 일치가 전제입니다.
`docs/01-prd.md` §6 과 `docs/06-architecture-deployment.md` §11 이 「계산기에 이미 `ga.js`
가 붙어 있으니 같은 속성에 편입한다」고만 적어 두고 값은 비워 뒀던 자리입니다.

```
.env.production   VITE_GA4_MEASUREMENT_ID=G-KG0XE6F5XT
.env.development  VITE_GA4_MEASUREMENT_ID=          # 비움 = 완전 no-op
```

비어 있으면 `app/analytics.ts` 가 **스크립트도 안 붙이고 `dataLayer` 조차 안 만듭니다**
(계산기 `ga.js` 와 같은 규칙). 목 위에서 만든 가짜 클릭이 실제 속성에 섞이면 북극성
지표의 기준선(01-prd §6 Q1)이 처음부터 오염되기 때문입니다. 배선을 눈으로 볼 일이
있으면 진짜 ID 말고 더미(`G-TEST000000`)를 쓰세요.

**화면은 `app/analytics.ts` 의 `track()` 하나만 부릅니다.** 거기서 `metric_event`
(`POST /v1/events`, 90일, W-11 콘솔용 내부 로그)와 GA4(마케팅 기여·크로스도메인 세션)로
갈라집니다 — 01-prd §6 이 정의한 두 시스템의 경계고, 소유·보존 기간이 달라 합치지
않습니다. 대신 **부르는 자리를 하나로** 둡니다: 갈래가 둘이면 한쪽에만 이벤트를 추가하는
실수가 반드시 나고, 그러면 두 보고서가 같은 클릭을 두고 다른 수를 말합니다.

#### 도메인 간 측정 등록 절차 (남은 작업 · 관리자 계정 필요)

코드 쪽은 끝났고 **GA4 관리자 UI 작업만 남았습니다.** GA4 크로스도메인은 관리자에서만
설정합니다 — 코드의 `linker` 파라미터는 UA 시절 방식이라 여기 없습니다. 등록되면 gtag 가
그 도메인으로 나가는 링크에 `_gl` 을 자동으로 붙입니다.

1. **GA4 관리자 → 데이터 스트림 →** 웹 스트림(측정 ID `G-KG0XE6F5XT`) 선택
2. **태그 설정 구성 → 도메인 구성 →** 조건 추가
3. 두 도메인을 **각각** 넣습니다 — 조건은 OR 로 평가됩니다.

   | 일치 유형 | 도메인 |
   |---|---|
   | 다음과 같음 | `nutti.co.kr` |
   | 다음과 같음 | `play.nutti.co.kr` |

   «포함» 으로 `nutti.co.kr` 하나만 넣지 마세요. 두 도메인을 한 줄로 덮을 수 있어
   편해 보이지만, «포함» 은 `nutti.co.kr` 이 **어디에 들어 있든** 맞으므로 남이 만든
   `nutti.co.kr.example.com` 같은 주소까지 우리 세션으로 이어 붙입니다.
4. 저장. 반영은 즉시가 아닙니다 — 태그가 새 설정을 받아 가야 합니다.

**확인 — 이것만이 켜졌다는 증거입니다.** `play.nutti.co.kr` 에서 쇼핑몰·계산기 링크를
눌러 도착한 주소에 **`_gl=` 파라미터가 붙는지** 봅니다. 안 붙으면 세션이 끊긴 것이고,
보고서에서는 «쇼핑몰 방문자가 늘었는데 유입 출처가 없는» 모양으로만 보입니다.

**함께 볼 것 둘.**

- **향상된 측정 → 「브라우저 기록 이벤트 기반 페이지 변경」이 켜져 있는지.** 프론트는
  화면 전환 `page_view` 를 **일부러 안 보냅니다**(아래 ⚠️). 이게 꺼져 있으면 첫 화면만
  집계됩니다.
- **보고서에서 `nutti.co.kr` 이 «추천» 소스로 뜨는지.** 도메인 간 측정은 사용자·세션을
  잇는 설정이고, **추천 제외(unwanted referrals)는 별개 설정**입니다. 뜬다면 같은
  데이터 스트림의 「원치 않는 추천 목록」에 두 도메인을 넣습니다. 먼저 넣지 말고 —
  실제로 뜨는지 보고 나서 넣는 편이, 안 넣어도 됐을 설정을 지고 가지 않습니다.

⚠️ **화면 전환마다 `page_view` 를 쏘지 않습니다.** GA4 「향상된 측정」의 “브라우저 기록
이벤트 기반 페이지 변경”이 History API 를 이미 보고 있고(데이터 스트림 기본값), React
Router 가 그 API 를 씁니다. 여기서 또 보내면 화면 하나가 **두 번** 세어져 세션·이탈률이
통째로 틀립니다. **그 관리자 설정이 꺼져 있으면 반대로 첫 화면만 집계됩니다** — 속성을
열어 확인해야 하는 의존입니다. 「안 보낸다」는 `app/analytics.test.ts` 가 못 박고 있습니다.

⚠️ **출구 링크를 버튼 + `navigate()` 로 바꾸면 크로스도메인이 조용히 깨집니다.** 구글
문서가 못 박는 두 가지 — 사용자의 직접 클릭이 아니라 **JS 로 이동시키면** `_gl` 이 안
붙고, 중간에서 `Event.stopPropagation()` 을 하면 이벤트가 문서 노드까지 못 갑니다.
오늘 출구 넷(W-06 쇼핑몰·계산기, W-07, W-10, 탭바)은 전부 평범한 `<a href>` 입니다.

## 놀이터 도메인 — `play.nutti.co.kr` (2026-08-26 확정)

문서 세 곳이 이 값을 「예:」로만 적어 두고 기다리고 있었습니다(`docs/05` §2 redirect_uri,
`docs/06` §10 `CORS_ALLOWED_ORIGINS`·§11 GA4). **프론트 코드에는 이 도메인이 한 군데도
하드코딩돼 있지 않습니다** — 확정으로 고칠 코드는 없고, 대신 **바깥 콘솔 세 곳에 등록할
값**이 정해졌습니다. 셋 다 «등록 안 하면 조용히 안 되는» 종류라 배포 전에 함께 봅니다.

| # | 등록처 | 값 | 안 하면 |
|---|---|---|---|
| 1 | GA4 관리자 → 도메인 구성 | `play.nutti.co.kr` + `nutti.co.kr` | 도메인 넘을 때 세션이 끊김 (위 절차) |
| 2 | 카카오·네이버·카페24 개발자 콘솔 → redirect_uri | `https://play.nutti.co.kr/auth/callback/{provider}` | **로그인이 콜백에서 실패** — 프로바이더가 되돌려 보낼 주소를 모릅니다 |
| 3 | 백엔드 `CORS_ALLOWED_ORIGINS` | `https://play.nutti.co.kr` | API 호출이 전부 CORS 차단 (이슈 #3) |

2번의 경로는 **프론트 라우트**입니다(`screens/AuthCallback.tsx`, `app/routes.tsx`의
`/auth/callback/:provider`) — 그래서 **이 경로를 바꾸면 콘솔 세 곳도 같이 바꿔야 합니다.**
프로바이더는 등록된 값과 **정확히** 일치해야 받아 주므로 후행 슬래시·`http`/`https` 까지
그대로여야 합니다.

3번은 백엔드 env 라 제 몫이 아닙니다 — 배포 시 함께 넣어 주세요.

⚠️ **API 서버 호스트는 아직 미정입니다.** 확정된 건 놀이터 **프론트** 도메인 하나이고,
`web/.env.production` 의 `VITE_API_BASE_URL` 은 여전히 자리표시자
(`https://api.example.invalid/v1`)입니다. 프론트와 오리진이 다르면 3번이 필수이고,
같은 오리진에 얹으면 3번이 필요 없습니다 — 그 선택이 아직 안 됐습니다.

## 배포 전 — 계산기 프리필 **수신부** (2026-08-28 실측)

도메인 세 곳과 같은 종류의 바깥 의존이 하나 더 있습니다. 안 하면 조용히 안 되는 것도 같습니다.

**계산기는 URL 파라미터를 읽지 않습니다.** `nutti.co.kr/calculator.html?name=콩이&breed=토이푸들&size=소형`
을 직접 열어 확인했습니다 — `calculator/js/calculator.js?v=14` 안의 `URLSearchParams`·`searchParams`
세 곳은 전부 **나가는 쪽**(105·106행 추천 상품 링크 UTM, 506행 `routinebite-products.html` URL
조립)이고 `location.search` 를 읽는 코드는 없습니다. 실제 상태는 `state.breed` = 첫 카드 «말티즈»,
이름칸 빈 값, 보이는 패널 `panel0` — **1단계 견종 그리드**입니다. `07-decisions.md#Q9` 의 ⚠️(수신부
미구현, 카페24 스마트디자인 쪽 후속)가 2026-08-19 기준인데 `v=14` 에서도 그대로입니다.
(곁다리 확인: 그리드의 견종 카드가 실제로 **40개**라 `mocks/calculatorBreeds.ts` 표와 개수가 맞습니다.)

⚠️ **그래서 «2단계부터 시작» 은 지금 참이 아닙니다.** `api/calculatorLink.ts` `estimateSummary` 의
세 갈래 중 둘이 그렇게 말하고(W-06 배너·W-07 화면 공용), 사용자는 건너뛴다고 믿은 화면을 말티즈가
선택된 채로 마주합니다. 1단계 그리드가 이탈 최대 구간이라 건너뛰는 게 이 출구의 값어치였는데, 지금
이 링크의 실질은 UTM 붙은 평범한 바깥 링크 하나입니다.

**배포 직전에 다시 실측할 것** — `calculator.js` 를 받아 `location.search` 를 읽는 코드가 생겼는지
봅니다(`?v=` 가 올라가 있으면 특히). 있으면 파라미터 이름(`name`·`breed`·`size`)이 우리가 보내는
것과 같은지까지 확인하고 문구는 그대로 둡니다. **없으면 «2단계부터 시작» 꼬리표를 빼고 나갑니다**
— 지킬 수 없는 약속을 하느니 침묵이 낫습니다. 우리가 보내는 파라미터 자체는 맞으므로 프론트에
고칠 것은 그 문구뿐이고, 수신부는 카페24 스마트디자인 쪽이라 제 몫이 아닙니다.

## W-11 운영 콘솔 — 백엔드가 먼저 도착했다 (PR #181~#187)

`/admin/*` 가 3일 만에 501 을 전부 벗었습니다: 로그인(#181) · 스타일 읽기(#181) · 스타일
CRUD(#182) · 프롬프트 버전(#183) · 커스텀 프롬프트 승격(#184) · 크레딧 수동 조정(#185) ·
운영 설정(#186) · 카페24 상태(#187). **오늘 프론트가 고칠 코드는 없습니다** — W-11 화면이
없으니 부르는 자리도 없습니다. 다만 착수 전에 알아야 하는 것이 세 가지 생겼습니다.

### 1. admin 토큰은 사용자 세션과 상호 배타 — 그래서 `/admin/*` 는 막아 뒀습니다

`POST /v1/admin/login` 이 주는 JWT 는 `kind: "admin"` 이고, 회원/게스트 토큰으로 `/admin/*`
를 부르면 401, admin 토큰으로 회원 엔드포인트를 부르면 401 입니다(백엔드 `tests/test_admin.py`
가 양방향을 고정). 문제는 그 401 의 **코드가 `UNAUTHORIZED`** 라는 것입니다 —
`api/client.ts` 에서 이 코드는 `keepsSessionOn401()` 예외(`/auth/*/callback`)가 아니므로
곧장 `dropSessionIfCurrent` → `SESSION_LOST_EVENT` 로 갑니다. `TOKEN_EXPIRED` 가 아니라서
게스트 재발급 재시도도 없습니다. **공용 클라이언트로 콘솔을 한 번 부르면 보고 있던 사용자가
로그아웃됩니다.**

**그래서 요청을 보내기 전에 막습니다** — `request()` 첫 줄의 `assertNotAdminPath()` 가
`/admin` 과 `/admin/*` 를 던져서 거절합니다(`api/client.test.ts` 의 「/admin/\* 차단」:
세션을 죽일 401 핸들러를 걸어 두고 **거기 닿지 않는 것**까지 봅니다). `keepsSessionOn401()`
에 `/admin/` 을 한 줄 더하는 쪽이 짧지만, 그건 401 을 조용하게 만들 뿐 호출은 여전히
실패하고 이 파일은 계속 **사용자 토큰을 실어 보냅니다** — 관리자 토큰이 붙을 자리가 여기엔
없습니다. 「세션은 안 지워지니까 되는 것 같은」 배선을 남기는 게 W-11 을 이 클라이언트 위에
올리는 가장 빠른 길이라, 조용히 성공하는 것보다 시끄럽게 막히는 쪽을 골랐습니다.

`session.kind` 는 `'guest' | 'member'` 두 값뿐이고 저장소 키도 하나입니다. 여기에 `'admin'`
을 끼우는 것은 사용자 앱의 401·재발급·회전 갈래를 전부 다시 여는 일이라(아래 「백엔드 대기
중」의 M6 문단이 그 갈래가 얼마나 좁은지 보여 줍니다), 진행 상황 표의 **「번들 분리」는 이제 번들 크기 얘기가
아니라 토큰 저장소와 401 정책이 다른 두 앱이라는 뜻**입니다. 콘솔은 자기 토큰 저장소와 자기
클라이언트를 갖고, 401 이면 사용자 세션을 건드리지 말고 관리자 로그인 화면으로만 돌아가야
합니다. **그 클라이언트는 지금 만들지 않습니다** — 화면이 없으면 401 이벤트를 받을 곳도,
로그인 폼도 없어서 부르는 사람 없는 모듈만 남습니다(`api/jobContext.ts` 를 호출부째 지운 것과
같은 이유). 가드는 그때까지 자리를 지키다가, 콘솔이 자기 클라이언트를 들고 오면 **그대로
남습니다** — 막는 대상은 「admin 을 부르는 것」이 아니라 「**이 클라이언트로** admin 을 부르는
것」이기 때문입니다.

### 2. 스타일 성과 3지표의 출처가 확정됐습니다 — 두 개는 W-06 의 `track()` 이 유일한 경로

PR #181 이 `GET /v1/admin/styles` 를 구현하면서 05-api-spec 의 「전부 `metric_event` 집계」
가 갈라졌습니다. FR-W11-03 대시보드를 만들 때 이 차이가 그대로 화면에 나옵니다.

| 지표 | 실제 계산 | 프론트가 걸린 지점 |
|---|---|---|
| `selection_rate` | `generation_job` 테이블. 해당 스타일 job ÷ `style_id` 있는 전체 job | **비콘과 무관** — 「스타일을 골랐다」 이벤트는 보낼 필요가 없고 지금도 안 보냅니다. 분모가 `style_id IS NOT NULL` 이라 W-08 커스텀(`style_id: null`)은 분모에서 빠집니다 |
| `share_rate` | `share_click` ÷ `result_view` | `metric_event.style_id` 는 `properties.job_id` 로만 붙습니다 — `screens/W06Result.tsx` 의 `track()` 이 유일한 소스 |
| `shop_click_rate` | `shop_exit_click` ÷ `result_view` | 위와 같음. **`calculator_exit_click` 은 안 셉니다**(백엔드가 주석으로 명시) — 계산기 출구는 이 표에 아예 안 나타납니다 |

두 가지가 더 있습니다.

- **`app/TabBar.tsx` 와 `screens/EarnActionList.tsx` 의 `shop_exit_click` 은 어느 스타일에도
  안 잡힙니다.** `properties` 가 `{ from: 'tabbar' }` · `{ from: 'W-10' }` 라 `job_id` 가 없고,
  그러면 `style_id` 가 null 입니다. 스타일별 지표로는 맞는 동작이지만 이 표의 합을
  「쇼핑몰 클릭 수」로 읽으면 실제보다 작습니다.
- **`share_rate` 는 1 을 넘을 수 있습니다.** `result_view` 는 job 당 한 번으로 잠가 뒀는데
  (`viewLogged`, 지워진 결과는 아예 안 셉니다) `share_click` 에는 그런 가드가 없습니다 —
  재공유는 정상 행동이라 지표 정의상 맞는 값입니다. 콘솔에서 이걸 진행 막대나 「%」로
  그리면 100 을 넘는 칸이 나옵니다.

### 3. 관리자 조정은 사용자 원장에 그대로 나타납니다 (확인 완료 · 무변경)

`POST /v1/admin/credits/adjust`(#185)는 `credit_ledger` 에 `cs_adjustment` 로 남고,
카페24 주문 동기화 배치(#188)는 `order_reward`·`order_clawback` 으로 남습니다. 셋 다
`app/ledgerFormat.ts` 의 `REASON_LABEL` 에 이미 있어 W-10 원장·W-12 미리보기는 무변경입니다
(`reason` 은 타입도 `string` 이라 값이 늘어도 깨지지 않습니다). 관리자가 조정하면 사용자
화면에 「고객센터 조정」으로 보인다는 것만 알고 있으면 됩니다.

목(`mocks/handlers.ts`)에는 `/admin/*` 핸들러가 **하나도 없습니다** — 화면을 시작하는 첫
작업은 화면이 아니라 목입니다.

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
| [#77](https://github.com/N-utti/nutti-photo-playground/issues/77) | 결과 이미지 스토리지에 CORS 헤더 없음 | `CDN_BASE_URL` 을 채우는 배포 시점 | 대기 — 프론트 몫은 닫혔고(PR #78) 남은 건 R2/CDN 운영 설정입니다. `app/saveImage.ts` 가 fetch→blob 으로 저장하고 CORS 가 없으면 새 탭 폴백 — **CORS 가 열려도 그 우회는 걷어내지 않습니다**(PR #80). **닫는 레버는 생겼습니다**(백엔드 PR #112): R2 프로비저닝 직후 `uv run python scripts/setup_r2_cors.py --origins <웹 오리진>` 한 번(GET·HEAD 규칙, `--dry-run` 으로 미리 확인). 다만 **«스크립트가 성공» 은 닫는 근거가 아닙니다** — 규칙은 버킷에 걸리는데 프론트가 부르는 건 그 앞의 CDN 이고, 규칙 적용 전에 CDN 이 한 번이라도 캐시한 응답에는 `Access-Control-Allow-Origin` 이 없어 캐시 퍼지까지 필요합니다. 확인은 **웹 오리진에서 `CDN_BASE_URL` 의 결과 이미지를 실제로 저장**해 보는 것뿐입니다: 실패해도 화면은 조용히 새 탭으로 물러나 오류가 안 나므로(그게 #77 의 «조용히 깨짐»), 닫는 순간에도 같은 조용함이 그대로 남아 있습니다 |
| [#81](https://github.com/N-utti/nutti-photo-playground/issues/81) | job 응답에 `custom_prompt`·`credit_cost` 없음 | W-06 «다시 만들기» — W-08 커스텀 job 한정 | 해결 (PR #83). 커스텀 결과를 **다른 기기·링크로 열어도** 같은 문구·같은 비용으로 다시 만듭니다. 이 필드가 로컬 색인의 마지막 존재 이유였어서 `api/jobContext.ts` 를 호출부째 삭제했고, 맥락 조립은 `app/reuseFromJob.ts` `contextFromJob` 하나로 모였습니다. `credit_cost` 덕에 W-06 이 비용을 알아내려 스타일 상세를 따로 부르던 조회도 없어졌습니다 |
| [#127](https://github.com/N-utti/nutti-photo-playground/issues/127) | job 응답에 `input_values` 없음 | W-06 «다시 만들기» — `input_fields` 를 가진 24종 한정 | 해결 (백엔드 PR #139 → 프론트 PR #143). `GET /v1/jobs/{id}` 가 `inputs` 를 답해 **지난 값 되살리기**까지 닫혔습니다 — 그전까지 열려 있던 건 이 절반뿐이었고, «말없이 기본값으로 바꾸는» 나머지 절반은 계약 없이 먼저 닫아 둔 상태였습니다. 합치는 순서가 규칙입니다: **기본값 → 지난번 값 → 이 화면에서 고친 값**(`screens/W06Result.tsx` `Regenerate`). `inputs` 를 그대로 폼 값으로 쓰지 않는 이유가 첫 항목입니다 — `default` 가 없는 `prefill` 칸은 서버가 저장하지 않아(`_resolve_input_values` 가 `continue`) `inputs` 에 **아예 없고**, 그 칸을 비운 채 두면 이름이 인쇄되는 스타일에서 폼이 «우리 아이» 라고 잘못 말합니다. 지금 스키마에 없는 라벨은 걸러 냅니다(`app/styleInputs.ts` `restoredInputValues`) — 운영이 job 이후에 칸을 바꾸면 `inputs` 에 없어진 라벨이 남습니다. 스타일 상세는 계속 부릅니다: `inputs` 는 「무엇으로 만들었나」만 답하고 「지금 무엇을 고를 수 있나」는 스키마 쪽에만 있습니다. 접힌 줄 아래 한 줄이 **지금 값의 출처**를 밝힙니다 — 계약 이전 job(`inputs: null`)은 «지난번 값은 불러올 수 없어 기본값이에요», 되살린 경우는 «지난번에 만든 값 그대로예요», 사용자가 고친 뒤에는 아무 말도 안 합니다 |
| [#131](https://github.com/N-utti/nutti-photo-playground/issues/131) | 워커의 `[breed]` 치환이 항상 «강아지» 로 떨어짐 | W-04 확인 단계의 **견종** 예고 | 해결 (A안 → 백엔드 PR #137). 워커가 `breed_label` → `source_image.breed_estimate["label"]` → «강아지» 로 한 단계 더 내려갑니다 — 이제 실제로 인쇄됩니다. **다만 예고는 W-04 에서만 합니다.** 견종은 사용자가 넣는 값이 아니라 사진에서 **추정**한 값이고 비전이 확신 못 하면 빈 채로 오므로(PR #59), 업로드 전인 W-02·W-03 은 무엇이 박힐지 모릅니다 — 거기서 예고하면 보장할 수 없는 걸 약속하게 됩니다. `uses_pet_name` 과 갈리는 지점이 정확히 여기입니다(이름은 우리가 받아서 넣으니 예고가 곧 약속). 그래서 사진이 손에 들어온 뒤, 추정값이 **실제로 있을 때만**, 출처를 밝히고 말합니다(`screens/W04Upload.tsx` `BreedPrintNotice`). 없으면 침묵합니다 — «견종은 안 들어가요» 는 다음 사진에서 틀립니다. 재사용 경로(다른 스타일·저장된 강아지)도 조용합니다: `GET /v1/jobs/{id}`·`GET /v1/pets` 가 추정값을 안 줘서 프론트가 모릅니다(서버는 알아서 그림에는 정상 인쇄됩니다) |
| [#149](https://github.com/N-utti/nutti-photo-playground/issues/149) | 커스텀 프롬프트 비용(`app_setting.custom_prompt_credit_cost`)을 읽을 경로 없음 | W-02 하단 링크·W-04 업로드 후 링크·W-08 만들기 버튼 | 해결 (A안 → PR #151). `GET /v1/credits` 가 `custom_prompt_credit_cost` 를 답합니다. 프론트가 지어내던 상수(`CUSTOM_PROMPT_COST_ESTIMATE = 2`)는 삭제했고, 세 화면이 같은 쿼리에서 읽습니다(`app/customPromptCost.ts` — 잔액 배지가 이미 구독 중이라 왕복은 그대로 0). **모르는 동안은 숫자를 감춥니다** — 로딩 중에 2 를 그리면 화면이 먼저 단정하고 나중에 정정합니다. 402 의 `required` 는 여전히 정책값을 덮습니다(화면을 열어 둔 사이 운영이 값을 바꾼 경우) |

[#11](https://github.com/N-utti/nutti-photo-playground/issues/11)(auth 보안 후속 M3~M6·L1~L6)은 **프론트가 막히는 지점이 없어** 위 표에 넣지 않습니다 — 확인 근거는
이슈 코멘트에 남겼습니다(오픈 리다이렉트는 `app/authReturn.ts` 가 이미 막고, 동시 가입 경합을
서버가 409 로 정리하면 프론트는 무변경으로 맞는 문구가 나갑니다).

**M3·M4 는 착지했고**(백엔드 PR #115), 프론트는 무변경입니다 — 다만 «막지 않는다» 가 «아무것도
안 바뀐다» 는 아니라서 세 지점을 적어 둡니다.

**(1) 409 `ALREADY_CLAIMED` 가 이제 믿을 수 있는 말입니다.** `grant_credits` 가 `IntegrityError`
를 전부 «이미 받음» 으로 뭉개 False 를 돌려주던 걸, **dedupe 위반만** False 로 좁혔습니다. 그 False
가 곧 409 `ALREADY_CLAIMED` 라서(`app/routers/credits.py`), 종전에는 FK 위반 같은 **다른** 실패도
`POST /v1/credits/claim` 에서 «이미 받은 크레딧이에요» 로 나갔습니다. 원장에는 행이 없으니 획득
목록의 그 줄은 계속 «받기» 인 채고, 눌러도 같은 409 만 돌아오는 막다른 길이었습니다. 이제 그 경우는
500 이라 `screens/EarnActionList.tsx` 의 마지막 갈래(`claim.error.message`)로 떨어집니다 — 화면이
바뀐 건 «재시도가 의미 있는 문구» 하나뿐이지만, 그게 이 수정의 전부입니다.

**(2) 화면이 이미 하던 단정을 서버가 뒤늦게 보증합니다.** `POST /v1/auth/guest` 가 Member 생성과
`guest_trial` 1 크레딧을 한 트랜잭션으로 묶었고, cafe24 콜백의 +3 이 연동 저장과 같은 트랜잭션에
들어왔습니다. 종전에는 지급만 조용히 실패해 **«0 크레딧 게스트»·«+3 없이 연동됨»** 이 남을 수
있었습니다. 목이 `state.credits.balance = 1` 로 단정하는 것(`mocks/handlers.ts`)과
`screens/AuthCallback.tsx` 가 조건 없이 «연동 보상 +3 크레딧을 받았어요» 라고 말하는 것이, 이제야
서버가 보장하는 문장입니다. 두 갈래의 무게는 다릅니다 — 게스트는 `guest_trial` 을 다시 받을 경로가
없어 첫 화면부터 잔액 0 으로 서고, 연동은 획득 목록의 상태가 **원장 기준**이라(`credits.py` —
`dedupe_key` 가 `link_account` 인 행의 유무) 그 줄이 «받기» 인 채 남아 같은 쇼핑몰 계정으로 한 번 더
연동하면 +3 이 들어옵니다. **다만 콜백 화면은 첫 시도에서 이미 «받았어요» 라고 말한 뒤입니다** —
되돌릴 수 있어도 그 문장이 거짓이었던 건 그대로고, 사용자는 잔액이 안 늘어난 이유를 모릅니다.

**(3) 동시 승격 경합의 500 이 없어졌습니다** — 첫 문단의 «409 로 정리하면» 이 실제가 됐습니다.
`social_callback`·`register` 가 unique 위반 시 **새 트랜잭션으로 1회 재시도**해 승격 1·병합 1 로
수렴합니다. 프론트는 그대로 맞는 문구가 나갑니다: register 의 병합 경로는 409 `EMAIL_TAKEN` 이라
`screens/AccountSheet.tsx` 가 «이미 가입된 이메일이에요» 로 받고, 소셜은 200 `merged: true` 라
`AuthCallback.tsx` 의 병합 문구가 나갑니다. 목은 이걸 재현하지 않습니다 — **요청 사이의 순서**라
핸들러가 만들 수 있는 상태가 아닙니다(바로 아래 M6 과 같은 이유).

**(4) 다만 M6 은 «막지 않으면서 동작을 바꿨습니다»**(백엔드 PR #119). 로그아웃이
`member.token_version` 을 올려 **발급된 액세스 토큰을 전부 즉시 무효화**합니다 — 종전에는 서명만으로
검증돼서 «한 번 유효했던 토큰이 남은 수명 안에 401 이 되는» 일이 없었는데, 이제 생깁니다(게스트는
그대로 만료까지 수용). 새 계약이 필요한 건 없고 화면 문구도 그대로지만, **뒤늦게 도착하는 401 이
정상 경로가 됩니다**: 로그아웃 직전에 띄워 둔 조회가 로그아웃보다 늦게 돌아오면 죽은 토큰의 401 인데,
그때 저장소에는 이미 새 게스트가 서 있습니다(`api/queries.ts` `useLogout` 이 폐기 → 비우기 → 재발급을
한 동작으로 묶습니다). 그 401 로 세션을 지우면 **방금 받은 게스트를 날리고** 앱이 토큰 없는 채로
남습니다 — `ensureSession()` 은 이미 지나갔으므로 아무도 다시 발급하지 않습니다. 그래서
`api/client.ts` 가 «내가 보낸 토큰이 아직 저장소의 그 토큰인지» 로 갈라 냅니다
(`dropSessionIfCurrent`, 회전 실패도 같은 판정 — `api/client.test.ts`). 목은 이걸 재현하지 않습니다:
응답의 내용이 아니라 **요청 사이의 순서**라 핸들러가 만들 수 있는 상태가 아닙니다.

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
  길게 눌러 저장하라고 안내합니다. 백엔드 PR #112 가 그 운영 작업을 한 명령으로
  줄여 뒀지만(`scripts/setup_r2_cors.py`), **버킷에 규칙이 걸린 것과 브라우저가 저장에
  성공하는 것은 다른 사실입니다** — 사이에 CDN 캐시가 있습니다. 위 표의 #77 행에
  확인 절차를 적어 뒀습니다. **이슈 #77 이 닫혀도 이 우회는 걷어내지 않습니다** —
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
   견종은 그 job 이 쓴 업로드의 `breed_estimate` **`label`** 에서 나옵니다(서버가 매칭에
   쓰는 건 `code` 가 아닙니다 — 계산기에 코드 체계가 없어 **한글 견종명이 곧 키**이고
   목록은 40종, `app/breeds.py`). `code` 는 비전 모델 내부 식별자라 **클라이언트도
   계산기 값으로 쓰면 안 됩니다** — 우리가 알아서 지키던 규율이었는데 이제 스펙에
   적혔습니다(05-api-spec.md §3 업로드 노트, 이슈 #161 → PR #169).
   목도 job → upload 로 따라갑니다. 그래서
   «강아지를 못 찾은 사진»(`upload:nodog`)은 «견종을 확인하지 못했어요 · 1단계부터»
   (FR-EDGE-10)로, **목록 밖 견종**(`upload:warn` — 목 픽스처가 «골든두들»)은
   «견종을 하나로 좁히지 못해 믹스견 · 중형으로 넘겨요»(FR-EDGE-11)로 떨어집니다.
   폴백 문구가 «사진에서 …으로 봤어요» 가 **아닌** 이유: 그 믹스견은 사진에서 읽은 값이
   아니라 읽은 견종이 목록에 없어 대신 넣은 값일 수 있고, 응답만으로는 둘을 구분할 수
   없습니다. 이름은 **저장된 강아지가 있을 때만** 붙고(없으면 «우리 아이는»), W-06 배너와
   W-07 화면이 같은 문장을 말하는지는 `api/calculatorLink.ts` 한 곳이 보장합니다.
   목이 그 세 갈래를 **실제로 만들어 내는지**는 `mocks/calculatorLink.handler.test.ts` 가
   봅니다 — 화면 테스트는 응답을 직접 써 넣고 시작하므로 거기서는 안 보이는 자리입니다.
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
