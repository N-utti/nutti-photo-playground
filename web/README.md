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

백엔드 전 엔드포인트가 501 스텁이므로(PR #2) 기본값은 **목 켜짐**입니다.
로컬 백엔드에 붙이려면 `.env.development`의 `VITE_ENABLE_MOCKS=false` — `vite.config.ts`의
dev proxy가 `/v1`을 `localhost:8000`으로 넘깁니다.

### 목 시나리오 강제

브라우저 콘솔에서:

```js
localStorage.setItem('nutti.mock.scenario', 'upload:warn')  // 품질 경고(비차단)
localStorage.setItem('nutti.mock.scenario', 'upload:block') // 고양이 감지(차단)
localStorage.setItem('nutti.mock.scenario', 'job:fail')     // GENERATION_FAILED + 크레딧 반환
localStorage.setItem('nutti.mock.scenario', 'job:safety')   // SAFETY_BLOCKED
localStorage.setItem('nutti.mock.scenario', 'credit:empty') // 잔액 0에서 시작 → 402 → 시트에서 받고 재시도
localStorage.setItem('nutti.mock.scenario', 'session:expired') // 게스트 토큰 만료 → 재발급 → 404 (복원 실패 안내)
localStorage.setItem('nutti.mock.scenario', 'auth:statefail')  // 소셜 콜백 state 검증 실패(401)
localStorage.setItem('nutti.mock.scenario', 'cafe24:linked')   // 카페24 연동 409 CAFE24_ALREADY_LINKED
localStorage.removeItem('nutti.mock.scenario')              // 정상
```

보관함에서 지운 결과는 `nutti.mock.library-deleted` 에 남습니다(새로고침해도 유지).
시드를 되돌리려면 `localStorage.removeItem('nutti.mock.library-deleted')`.

로컬 로그인 목: 비밀번호 `nutti1234`만 성공(그 외 401 `INVALID_CREDENTIALS`), 이메일
`taken@nutti.co.kr`로 가입하면 409 `EMAIL_TAKEN`. 소셜·카페24 `authorize`는 프로바이더
대신 **우리 콜백 라우트로 되돌려** 왕복 전체를 로컬에서 밟을 수 있게 합니다.

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
    jobContext.ts   job_id → {style_id, upload_id} 로컬 색인. 응답에 없어서 필요 (이슈 #9)
  mocks/            MSW — 프로덕션 번들에서 완전히 제외됨
  screens/          화면. 구현된 것만 개별 파일, 나머지는 placeholders.tsx
  app/
    routes.tsx      11개 화면 라우트 테이블 (W-03 은 W-02 의 자식 = 시트)
    TabBar.tsx      하단 탭바 4칸. W-02·W-09 **두 화면만** 붙입니다 (그 근거는 파일 주석)
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
| [#9](https://github.com/N-utti/nutti-photo-playground/issues/9) | job/펫 응답에 `style_id`·`upload_id` 참조 없음 | W-06 다시 만들기·다른 스타일, W-04 펫 스킵 | 대기 (localStorage 색인으로 우회 중) |
| [#10](https://github.com/N-utti/nutti-photo-playground/issues/10) | 카카오 `kakao_token` 획득 경로 미정 | W-06 B 계정 연동 | 해결 (ADR-11 A안 → PR #21, `POST /v1/auth/kakao` 삭제) |
| [#14](https://github.com/N-utti/nutti-photo-playground/issues/14) | `authorize` 가 헤더를 요구하는 302 라 브라우저 이동 불가 | 로그인 시트·콜백 전부 | 해결 (PR #21 — 200 `{authorize_url}`) |
| [#17](https://github.com/N-utti/nutti-photo-playground/issues/17) | 로컬 계정 복구 불가(비밀번호 재설정·이메일 인증 없음) · 로그인 수단 추가 미지원 | 로컬 가입 | 대기 (가입 시트에 사전 고지로 대응) |

## 미확정

- **비주얼 디자인이 없습니다.** 와이어프레임은 회색 박스이고 브랜드 색·서체가 어느
  문서에도 없습니다. `src/index.css`의 `@theme` 블록이 중립 플레이스홀더이며, 화면 코드에
  색을 하드코딩하지 않으면 확정 시 그 블록만 교체하면 됩니다.
- **W-01 히어로 이미지가 자리표시자입니다.** `public/hero/before.svg`·`after.svg`는
  비교 슬라이더가 동작한다는 것만 보여 주는 도형이고 실제 사진·생성 결과가 아닙니다.
  "내 애가 유지된다"를 첫 3초에 증명하는 게 이 화면의 임무(#p01 노트1)이므로,
  **같은 강아지의 원본/변환 한 쌍**이 나오면 같은 경로에 그대로 교체하세요.
- **`fit_tags[].score` 값 도메인** — §3 예시에 `good`/`caution` 둘만 등장하고 전체 목록이
  없습니다. 세 번째 등급이 있는지 확인 필요.
- **보관함 `pet_id` 의 null 여부** — 펫 삭제는 FK 를 NULL 로 만들고 결과물은 남긴다고
  확정됐는데(이슈 #12 결정4) §3 예시에는 값이 있는 경우만 나옵니다. 프론트는 `null`
  가능으로 보고 그 항목을 «전체»에서만 그립니다(`api/types.ts` 주석). 백엔드 구현 시
  확인이 필요합니다.
- **보관함 일괄 저장은 같은 출처에서만 «저장»입니다.** `<a download>` 는 교차 출처
  URL 에서 무시돼서, 결과 이미지가 다른 도메인 CDN 이면 저장 대신 새 탭으로 열립니다.
  제대로 받게 하려면 CDN 이 CORS 를 열거나 서버가 묶어서 내려줘야 합니다
  (`screens/W09Library.tsx` 의 `saveAll`).

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
9. **job 폴링은 에러에서 멈춰야 합니다.** TanStack Query는 에러 상태여도 `refetchInterval`을
   멈추지 않아, 404인 job 주소에서 폴링이 영원히 돕니다(`useJobPolling` 주석 참고).
