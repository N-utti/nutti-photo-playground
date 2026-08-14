/**
 * 계산기 링크에서 뽑는 화면 문구 (api/calculatorLink.ts · FR-EDGE-10/11).
 *
 * 막으려는 것은 **W-06 배너와 W-07 화면이 다른 말을 하는 것**입니다. 둘은 같은 응답
 * 하나를 놓고 각자 문장을 만드는데, 한쪽만 "푸들로 봤어요" 라고 하고 다른 쪽이
 * "확인하지 못했어요" 라고 하면 같은 추정을 두고 앱이 스스로를 반박합니다. 규칙을
 * 이 파일 하나에 모아 둔 이유가 그것이라, 규칙이 바뀌면 여기가 먼저 걸려야 합니다.
 *
 * 눈으로 잡기 어려운 종류이기도 합니다 — 세 갈래(정상 · 믹스견 폴백 · 완전 실패)를
 * 브라우저에서 다 보려면 목 시나리오를 바꿔 가며 두 화면을 오가야 하는데, 여기서는
 * 입력 한 줄이면 됩니다.
 */

import { describe, expect, it } from 'vitest'
import { calculatorHeadline, estimateSummary, petNameFromLink } from './calculatorLink'

describe('petNameFromLink', () => {
  it('URL 의 name 파라미터에서 이름을 읽는다', () => {
    // 이름은 응답 필드에 없고 여기에만 있습니다(§3 예시).
    expect(petNameFromLink({ calculator_url: 'https://nutti.co.kr/calculator.html?name=콩이' })).toBe(
      '콩이',
    )
  })

  it('퍼센트 인코딩된 한글도 읽는다', () => {
    // 서버가 URL 을 조립하며 인코딩합니다 — 디코딩은 URLSearchParams 몫입니다.
    expect(
      petNameFromLink({
        calculator_url: 'https://nutti.co.kr/calculator.html?name=%EC%BD%A9%EC%9D%B4&breed=poodle',
      }),
    ).toBe('콩이')
  })

  it('상대 경로도 읽는다', () => {
    // 서버가 상대 경로를 줄 수 있어 `location.origin` 을 기준으로 풉니다.
    expect(petNameFromLink({ calculator_url: '/calculator.html?name=두부' })).toBe('두부')
  })

  it('name 이 없으면 null', () => {
    expect(petNameFromLink({ calculator_url: 'https://nutti.co.kr/calculator.html?breed=poodle' })).toBeNull()
  })

  it('name 이 공백뿐이면 null', () => {
    /*
      빈 문자열이 아니라 **공백**입니다. 이걸 안 걸러내면 헤드라인이 "   는 하루 몇
      g까지 괜찮을까?" 가 되어, 이름을 모른다는 사실보다 더 이상하게 보입니다.
    */
    expect(petNameFromLink({ calculator_url: 'https://nutti.co.kr/calculator.html?name=%20%20' })).toBeNull()
  })

  it('URL 이 아니면 조용히 null', () => {
    // 파싱 실패로 화면이 통째로 죽는 것보다, 이름만 없는 편이 낫습니다.
    expect(petNameFromLink({ calculator_url: 'not a url ::::' })).toBeNull()
  })
})

describe('calculatorHeadline', () => {
  it('이름을 알면 그 이름으로 묻는다', () => {
    expect(calculatorHeadline({ calculator_url: '/calculator.html?name=콩이' })).toBe(
      '콩이는 하루 몇 g까지 괜찮을까?',
    )
  })

  it('이름을 모르면 «우리 아이»', () => {
    // 이름 자리를 비우거나 문장을 통째로 바꾸지 않습니다 — 같은 질문을 그대로 합니다.
    expect(calculatorHeadline({ calculator_url: '/calculator.html' })).toBe(
      '우리 아이는 하루 몇 g까지 괜찮을까?',
    )
  })
})

describe('estimateSummary', () => {
  it('견종과 크기를 알면 출처를 밝히고 2단계부터 시작한다', () => {
    /*
      "사진에서" 로 시작하는 게 노트4 입니다 — 단정하지 않고 출처를 밝힙니다. 이 출구의
      값어치가 1단계(42종 그리드)를 건너뛰는 것이므로 `prefilled` 가 함께 참이어야 합니다.
    */
    expect(estimateSummary({ breed_label: '푸들', size_label: '소형견' })).toEqual({
      text: '사진에서 푸들 · 소형견으로 봤어요 · 2단계부터 시작',
      prefilled: true,
    })
  })

  it('크기를 모르면 견종만 말한다', () => {
    // 구분점(·)만 남아 "푸들 · 으로 봤어요" 가 되면 안 됩니다.
    expect(estimateSummary({ breed_label: '푸들', size_label: null })).toEqual({
      text: '사진에서 푸들으로 봤어요 · 2단계부터 시작',
      prefilled: true,
    })
  })

  it('견종을 모르면 1단계부터 시작한다', () => {
    /*
      FR-EDGE-10 — URL 에 breed 가 아예 없는 경우입니다. 이때 `prefilled: false` 가
      핵심입니다. 참이면 화면은 «건너뛴다» 고 말해 놓고 실제로는 42종 그리드를
      처음부터 보여 주게 됩니다.
    */
    expect(estimateSummary({ breed_label: null, size_label: null })).toEqual({
      text: '견종을 확인하지 못했어요 · 1단계부터 시작',
      prefilled: false,
    })
  })

  it('견종 라벨이 빈 문자열이어도 «확인하지 못했어요» 로 본다', () => {
    // 서버가 빈 문자열을 줄 때 "사진에서 으로 봤어요" 가 되지 않아야 합니다.
    expect(estimateSummary({ breed_label: '', size_label: '소형견' }).prefilled).toBe(false)
  })
})
