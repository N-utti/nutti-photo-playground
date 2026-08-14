/**
 * node 쪽 MSW 서버 — **브라우저와 같은 핸들러를 씁니다**(mocks/handlers.ts).
 *
 * 핸들러를 두 벌로 두면 목이 계약을 대변하지 못합니다. 브라우저에서 손으로 밟아 본
 * 그 응답과 테스트가 보는 응답이 갈라지는 순간, 테스트를 통과시키려고 목을 고치는
 * 일이 생기고 그때부터 목은 서버가 아니라 테스트를 따라갑니다.
 *
 * handlers.ts 의 `state`(크레딧 잔액 · job 진행 · 펫 목록 · 로그인 여부)는 모듈 수준이라
 * 그냥 두면 테스트 사이로 흘러갑니다. 그래서 `src/test/setup.ts` 의 `afterEach` 가
 * `resetMockState()` 로 매번 되돌립니다 — 상태를 바꾸는 테스트(클레임 · 삭제 · 생성)를
 * 순서 걱정 없이 붙일 수 있습니다.
 *
 * 그것과 별개로 **특정 응답**이 필요할 때는 여전히 `server.use(...)` 로 덮어쓰세요
 * (afterEach 의 `resetHandlers` 가 걷어냅니다). 둘은 다른 층입니다 — 리셋은 데이터를,
 * `use` 는 핸들러를 되돌립니다.
 */

import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'

export const server = setupServer(...handlers)
