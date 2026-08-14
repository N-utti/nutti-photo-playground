/**
 * 429 의 `Retry-After` 를 사람 말로 (app/retryAfter.ts · PR #21).
 *
 * 레이트리밋은 게스트 발급 · 로그인 · 가입 세 곳에서 나오고 그걸 말하는 화면도 셋이라,
 * 문구를 각자 만들면 같은 상황을 두고 "잠시 뒤" 와 "1시간 뒤" 가 동시에 나옵니다.
 *
 * 브라우저로 확인하기 가장 번거로운 종류이기도 합니다 — 실제로 막히려면 요청을
 * 수십 번 보내야 하고, 그러고 나면 그 다음 확인까지 15분을 기다려야 합니다.
 */

import { describe, expect, it } from 'vitest'
import { formatRetryAfter } from './retryAfter'

describe('formatRetryAfter', () => {
  it('헤더가 없으면 «잠시 뒤»', () => {
    /*
      null 은 오류가 아니라 정상 입력입니다. 서버가 `Retry-After` 를 안 붙일 수 있고,
      그때 임의의 숫자를 지어내는 것보다 모른다고 말하는 편이 낫습니다.
    */
    expect(formatRetryAfter(null)).toBe('잠시 뒤')
  })

  it('1분 미만은 초로 말한다', () => {
    expect(formatRetryAfter(30)).toBe('30초 뒤')
  })

  it('올림한다 — 0.4초를 «0초 뒤»라고 하지 않는다', () => {
    // "0초 뒤"는 지금 되라는 말이라 다시 눌러 보게 만들고, 그게 또 429 가 됩니다.
    expect(formatRetryAfter(0.4)).toBe('1초 뒤')
  })

  it('0 과 음수도 최소 1초로 말한다', () => {
    // 이미 지난 시각이 와도 "-3초 뒤" 같은 게 나오면 안 됩니다.
    expect(formatRetryAfter(0)).toBe('1초 뒤')
    expect(formatRetryAfter(-3)).toBe('1초 뒤')
  })

  it('1분부터는 분으로 말한다', () => {
    expect(formatRetryAfter(60)).toBe('약 1분 뒤')
    expect(formatRetryAfter(61)).toBe('약 2분 뒤')
  })

  it('목이 실제로 내려주는 900초는 «약 15분 뒤»', () => {
    // handlers.ts 의 429 응답이 이 값입니다 — 브라우저에서 보는 문구와 같아야 합니다.
    expect(formatRetryAfter(900)).toBe('약 15분 뒤')
  })

  it('59.5초는 «60초 뒤» — 경계의 현재 동작', () => {
    /*
      분 단위로 넘길지(`< 60`)는 **원본 값**으로 판정하는데 표기는 올림이라, 59.5 는
      "60초 뒤"가 됩니다. "약 1분 뒤"가 더 자연스럽지만 서버가 소수 초를 주는 일이
      없어 실제로는 안 나옵니다. 고칠 때 여기가 그 결정 지점이라는 표시로 남겨 둡니다.
    */
    expect(formatRetryAfter(59.5)).toBe('60초 뒤')
  })
})
