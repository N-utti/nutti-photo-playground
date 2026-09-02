/**
 * 받은 내역 한 줄의 표기 (app/ledgerFormat.ts).
 *
 * W-10 B 의 전체 표와 W-12 미리보기가 **같은 거래를 같은 말로** 보여야 해서 규칙이
 * 여기 모여 있습니다. 그러니 여기가 틀리면 두 화면이 함께 틀립니다.
 *
 * 이 파일이 잡으려는 건 이미 한 번 일어난 일입니다 — `safety_block_refund` 가 라벨
 * 표에 없어서 표에 **영문 코드가 그대로 찍혔습니다**(모듈 주석). 서버가 사유를 하나
 * 늘리면 조용히 재발하는 종류이고, 눈으로 잡으려면 그 사유가 실제로 발생한 계정으로
 * 내역을 열어 봐야 합니다.
 */

import { describe, expect, it } from 'vitest'
import { amountTone, reasonLabel, shortDate, signedAmount } from './ledgerFormat'

describe('reasonLabel', () => {
  it.each([
    ['generation_charge', '생성'],
    ['generation_refund', '실패 반환'],
    ['safety_block_refund', '안전 차단 반환'],
    ['order_reward', '주문 확인'],
    ['order_clawback', '주문 취소'],
    ['link_account', '계정 연동'],
    ['follow_ig', '인스타 팔로우'],
    ['daily_free', '매일 무료'],
    ['guest_trial', '첫 무료'],
    ['cs_adjustment', '고객센터 조정'],
    // 병합 시 게스트 잔액 이관 (백엔드 PR #235 · 이슈 #11 L6). 라벨은 그 PR 이 넣었는데
    // 이 표에만 안 들어와서, 열한 번째 사유만 «표 밖» 이 돼 있었습니다.
    ['guest_merge', '게스트 크레딧 이전'],
  ])('%s → %s', (reason, label) => {
    expect(reasonLabel(reason)).toBe(label)
  })

  it('모르는 사유는 코드를 그대로 보여 준다', () => {
    /*
      빈칸이나 «기타» 로 뭉개지 않습니다. `reason` 의 값 도메인이 명세로 닫혀 있지
      않아서(관리자 조정처럼 나중에 늘 수 있음) 모르는 코드가 오는 건 정상이고,
      그때 사용자에게 필요한 건 «왜 받았는지» 에 대한 단서입니다 — 영문이라도 있는
      편이 아무것도 없는 것보다 낫다는 판단입니다.
    */
    expect(reasonLabel('some_future_reason')).toBe('some_future_reason')
  })
})

describe('shortDate', () => {
  it('연도를 떼고 월-일만 남긴다', () => {
    // 표가 4열로 좁고, 같은 해 안에서 연도는 정보가 없습니다.
    expect(shortDate('2026-08-03')).toBe('08-03')
  })

  it('형태가 다르면 손대지 않는다', () => {
    // 자를 수 없는 값을 억지로 자르면 «08-0» 같은 게 나옵니다. 원본이 낫습니다.
    expect(shortDate('2026/08/03')).toBe('2026/08/03')
    expect(shortDate('')).toBe('')
  })
})

describe('signedAmount', () => {
  it('지급은 + 를 붙인다', () => {
    expect(signedAmount(20)).toBe('+20')
  })

  it('차감은 하이픈이 아니라 빼기 기호(U+2212)를 쓴다', () => {
    /*
      눈으로는 구별되지 않지만 `tabular-nums` 폰트에서 하이픈은 폭이 어긋나 숫자 열이
      흔들립니다. 그래서 문자 자체를 코드포인트로 못 박습니다 — 리팩터링 중에 누가
      평범한 하이픈으로 «고쳐» 놓아도 여기서 걸립니다.
    */
    const result = signedAmount(-1)

    expect(result).toBe('−1')
    expect(result.codePointAt(0)).toBe(0x2212)
  })

  it('0 은 부호 없는 0 이 아니다 — 현재 계약은 «−0»', () => {
    /*
      0 짜리 거래는 아직 없지만, 있다면 «−0» 이 찍힙니다. 바람직해 보이지는 않아도
      지금의 동작이라 적어 둡니다. 나중에 «0» 으로 바꾸기로 하면 이 줄이 그 결정을
      내렸다는 표시가 됩니다 — 모르고 바뀌는 것과 알고 바꾸는 것의 차이입니다.
    */
    expect(signedAmount(0)).toBe('−0')
  })
})

describe('amountTone', () => {
  it('차감은 danger', () => {
    expect(amountTone(-1)).toBe('text-danger')
  })

  it('지급과 반환은 good', () => {
    expect(amountTone(20)).toBe('text-good')
    // 반환도 양수라 같은 색입니다 — 돌려받은 것은 잃은 것이 아닙니다.
    expect(amountTone(1)).toBe('text-good')
  })

  it('0 은 danger 가 아니다', () => {
    expect(amountTone(0)).toBe('text-good')
  })
})
