/**
 * 모든 테스트 파일 앞에 한 번씩 도는 준비 코드 (vite.config.ts `test.setupFiles`).
 *
 * 여기서 하는 일은 넷입니다 — jest-dom 단언 등록 · MSW 서버 수명 · 렌더 정리 ·
 * jsdom 이 브라우저와 다르게 답하는 지점 하나를 메우는 것.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { resetMockState } from '../mocks/handlers'
import { server } from './server'

/*
  `offsetParent` 는 jsdom 에서 **언제나 null** 입니다 — jsdom 이 레이아웃을 계산하지
  않기 때문입니다. 그런데 포커스 가둠(app/useModalDialog.ts)은 탭 대상 목록을 만들 때
  `element.offsetParent !== null` 로 «화면에 실제로 보이는 것» 만 남깁니다. 메우지
  않으면 그 목록이 항상 비고, 훅은 «탭 대상이 하나도 없는 시트» 분기로만 돌아
  first ↔ last 순환을 영영 안 밟습니다 — 통과는 하는데 정작 검증하려던 길이 아닙니다.

  그래서 «붙어 있으면 보인다» 로 근사합니다. 이 근사가 못 보는 것은 CSS 로 숨긴
  요소(`display:none` 클래스 등)의 제외인데, jsdom 은 스타일시트를 적용하지 않으므로
  어차피 어떤 방법으로도 여기서는 검증할 수 없습니다. 인라인 `display:none` 과
  `hidden` 속성만 흉내 냅니다.
*/
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement): Element | null {
    if (this.hidden) return null
    if (this.style.display === 'none') return null
    return this.parentElement
  },
})

beforeAll(() => {
  /*
    `error` 로 둡니다. 핸들러가 없는 요청이 조용히 실서버로 나가면(bypass) 테스트가
    네트워크에 의존하게 되고, 브라우저 개발(mocks/browser.ts)에서 bypass 를 쓰는
    이유인 «백엔드가 하나씩 구현돼 간다» 는 테스트에 해당하지 않습니다.
  */
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  /*
    목의 데이터도 되돌립니다(mocks/handlers.ts `resetMockState`).

    `resetHandlers` 는 `server.use(...)` 로 덮어쓴 **핸들러**만 걷어낼 뿐, 핸들러들이
    함께 읽고 쓰는 `state`(잔액 · job · 펫 · 로그인 여부)는 건드리지 않습니다. 그래서
    크레딧을 받는 테스트 다음에 잔액을 세는 테스트가 오면 그 순서에서만 깨집니다.
  */
  resetMockState()
})

afterAll(() => {
  server.close()
})
