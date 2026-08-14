/**
 * node 쪽 MSW 서버 — **브라우저와 같은 핸들러를 씁니다**(mocks/handlers.ts).
 *
 * 핸들러를 두 벌로 두면 목이 계약을 대변하지 못합니다. 브라우저에서 손으로 밟아 본
 * 그 응답과 테스트가 보는 응답이 갈라지는 순간, 테스트를 통과시키려고 목을 고치는
 * 일이 생기고 그때부터 목은 서버가 아니라 테스트를 따라갑니다.
 *
 * 알려진 제약: handlers.ts 의 `state`(크레딧 잔액 · job 진행 · 펫 목록)는 모듈 수준
 * 이라 **테스트 사이에 초기화되지 않습니다.** 지금 붙은 회귀 테스트는 잔액을 읽기만
 * 해서 문제가 없지만, 클레임·생성처럼 상태를 바꾸는 테스트를 붙일 때는 handlers.ts
 * 에 초기화 진입점을 먼저 내야 합니다. 그 전까지는 `server.use(...)` 로 해당 테스트가
 * 쓸 응답을 직접 덮어쓰는 쪽이 안전합니다(afterEach 의 `resetHandlers` 가 걷어냅니다).
 */

import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'

export const server = setupServer(...handlers)
