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
localStorage.setItem('nutti.mock.scenario', 'credit:empty') // 402 INSUFFICIENT_CREDIT
localStorage.removeItem('nutti.mock.scenario')              // 정상
```

## 구조

```
src/
  api/
    types.ts        05-api-spec §3 수기 타입 (openapi-typescript 로 교체 예정)
    client.ts       fetch 래퍼 — 토큰·에러포맷·게스트 재발급을 여기만
    endpoints.ts    엔드포인트별 얇은 래퍼
    queries.ts      TanStack Query — 캐시 키·폴링 정책·무효화 지점
    idempotency.ts  Idempotency-Key 수명 (규칙이 두 방향으로 갈리는 지점)
  mocks/            MSW — 프로덕션 번들에서 완전히 제외됨
  screens/          화면. 구현된 것만 개별 파일, 나머지는 placeholders.tsx
  app/routes.tsx    11개 화면 라우트 테이블
```

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 0 | 스택 확정 · `web/` 배치 · 백엔드 차단 이슈 등록 | 완료 |
| Phase 1 | 목 서버 · API 클라이언트 · 라우팅 골격 | 완료 |
| Phase 2 | 핵심 플로우 W-01→W-02→W-03→W-04→W-05→W-06 | W-02만 완료 |
| Phase 3 | 출구 3갈래 + 크레딧 (W-06 공유/쇼핑몰, W-07, W-10, 402 흐름) | 미착수 |
| Phase 4 | 계정·보관함 (W-06 B 로그인 시트, 콜백, W-09) | 미착수 |
| Phase 5 | W-08 크리에이티브 · W-11 운영 콘솔(번들 분리) | 미착수 |
| Phase 6 | GA4 크로스도메인 · UTM · 이벤트 비콘 | 미착수 |

## 백엔드 대기 중 (이슈)

| # | 내용 | 막히는 시점 |
|---|---|---|
| [#3](https://github.com/N-utti/nutti-photo-playground/issues/3) | `CORSMiddleware` 미배선 | 실서버 연결 시작 즉시 |
| [#4](https://github.com/N-utti/nutti-photo-playground/issues/4) | `response_model` 없이 §3 삭제 금지 | 타입 생성으로 전환할 때 |
| [#5](https://github.com/N-utti/nutti-photo-playground/issues/5) | Q7 게스트 결과 복원이 성립하지 않음 | Phase 2 (W-05/W-06) |

## 미확정

- **비주얼 디자인이 없습니다.** 와이어프레임은 회색 박스이고 브랜드 색·서체가 어느
  문서에도 없습니다. `src/index.css`의 `@theme` 블록이 중립 플레이스홀더이며, 화면 코드에
  색을 하드코딩하지 않으면 확정 시 그 블록만 교체하면 됩니다.
- **`fit_tags[].score` 값 도메인** — §3 예시에 `good`/`caution` 둘만 등장하고 전체 목록이
  없습니다. 세 번째 등급이 있는지 확인 필요.

## 실수하기 쉬운 지점

1. **`blocking_issue`는 HTTP 에러가 아닙니다.** 고양이 감지도 200입니다(§1 코드표).
   에러 인터셉터로 잡지 말고 화면이 분기해야 합니다.
2. **Idempotency-Key** — 402 재시도는 같은 키, "다시 만들기"는 새 키.
   `api/idempotency.ts`만 거치면 틀리지 않습니다.
3. **크레딧 배지 무효화** — job 종료(성공·실패 둘 다), claim 성공, 로그인 후 병합.
   `invalidateAfterJobSettled`를 job이 종료 상태에 닿는 곳에서 반드시 호출하세요.
4. **W-02는 68개를 한 페이지에** 받습니다(카탈로그 페이지네이션 없음). 썸네일
   `loading="lazy"`는 옵션이 아니라 필수입니다.
