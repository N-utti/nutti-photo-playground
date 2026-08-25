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
    /*
      서버가 URL 을 조립하며 인코딩합니다(`urlencode`) — 디코딩은 URLSearchParams 몫입니다.
      Q9 확정 뒤로는 `breed` 값도 한글이라 여기도 인코딩된 채로 옵니다(=토이푸들).
    */
    expect(
      petNameFromLink({
        calculator_url:
          'https://nutti.co.kr/calculator.html?name=%EC%BD%A9%EC%9D%B4&breed=%ED%86%A0%EC%9D%B4%ED%91%B8%EB%93%A4',
      }),
    ).toBe('콩이')
  })

  it('상대 경로도 읽는다', () => {
    // 서버가 상대 경로를 줄 수 있어 `location.origin` 을 기준으로 풉니다.
    expect(petNameFromLink({ calculator_url: '/calculator.html?name=두부' })).toBe('두부')
  })

  it('name 이 없으면 null', () => {
    expect(petNameFromLink({ calculator_url: 'https://nutti.co.kr/calculator.html?breed=토이푸들' })).toBeNull()
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
      값어치가 1단계(40종 그리드)를 건너뛰는 것이므로 `prefilled` 가 함께 참이어야 합니다.

      값은 실제 계약의 것입니다(Q9 확정 · PR #122) — 견종은 한글명, 크기는 소형·중형·
      대형 셋 중 하나. 예전 «소형견» 같은 임의값을 두면 조사 판단이 실제와 어긋납니다.
    */
    expect(estimateSummary({ breed_label: '토이푸들', size_label: '소형' })).toEqual({
      text: '사진에서 토이푸들 · 소형으로 봤어요 · 2단계부터 시작',
      prefilled: true,
      kind: 'matched',
    })
  })

  it('믹스견이면 사진에서 봤다고 하지 않는다 (FR-EDGE-11)', () => {
    /*
      이 값은 **폴백일 수 있습니다** — 비전이 «골든두들» 이라고 했는데 계산기 40종에
      없어서 서버가 대신 넣은 값이면, "사진에서 믹스견으로 봤어요" 는 사진에 대한
      거짓말입니다. 반대로 진짜 믹스견이었을 수도 있어 "목록에 없어서" 라고 단정하는
      것도 틀립니다(응답만으로는 구분 불가). 둘 다에 대해 참인 말만 남깁니다.

      그래도 `prefilled` 는 참입니다 — 계산기는 실제로 2단계부터 시작합니다.
    */
    expect(estimateSummary({ breed_label: '믹스견', size_label: '중형' })).toEqual({
      text: '견종을 하나로 좁히지 못해 믹스견 · 중형으로 넘겨요 · 2단계부터 시작',
      prefilled: true,
      kind: 'mixed',
    })
  })

  it('크기를 모르면 조사를 붙이지 않고 견종만 말한다', () => {
    /*
      서버는 견종과 크기를 함께 채우므로(`app/routers/results.py`) 오늘 이 조합은
      오지 않습니다. 그래도 갈래를 두는 이유는 조사입니다 — "…으로" 는 앞에 크기
      (소형·중형·대형, 모두 받침 ㅇ)가 올 때만 성립하고, 견종 이름이 오면 «토이푸들으로»
      처럼 깨집니다. 구분점(·)만 남아 "토이푸들 · 으로 봤어요" 가 되어서도 안 됩니다.
    */
    expect(estimateSummary({ breed_label: '토이푸들', size_label: null })).toEqual({
      text: '사진에서 본 견종 · 토이푸들 · 2단계부터 시작',
      prefilled: true,
      kind: 'matched',
    })
  })

  it('견종을 모르면 1단계부터 시작한다', () => {
    /*
      FR-EDGE-10 — URL 에 breed 가 아예 없는 경우입니다. 이때 `prefilled: false` 가
      핵심입니다. 참이면 화면은 «건너뛴다» 고 말해 놓고 실제로는 40종 그리드를
      처음부터 보여 주게 됩니다.
    */
    expect(estimateSummary({ breed_label: null, size_label: null })).toEqual({
      text: '견종을 확인하지 못했어요 · 1단계부터 시작',
      prefilled: false,
      kind: 'unknown',
    })
  })

  it('견종 라벨이 빈 문자열이어도 «확인하지 못했어요» 로 본다', () => {
    // 서버가 빈 문자열을 줄 때 "사진에서 으로 봤어요" 가 되지 않아야 합니다.
    expect(estimateSummary({ breed_label: '', size_label: '소형' }).prefilled).toBe(false)
  })
})
