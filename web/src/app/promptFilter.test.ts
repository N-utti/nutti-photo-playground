/**
 * 커스텀 프롬프트의 입력 단계 필터 (app/promptFilter.ts · FR-W08-03 · FR-EDGE-13 (a)).
 *
 * 2중 방어의 첫 겹이고, **크레딧이 나가기 직전의 관문**입니다. 여기서 막으면 생성이
 * 시작되지 않아 차감이 없고(UC-08 A1-a), 통과한 뒤의 결과는 서버 안전 필터가 다시
 * 봅니다. 그래서 두 방향으로 다 틀릴 수 있습니다 — 너무 좁으면 막아야 할 걸 결제
 * 뒤로 넘기고, 너무 넓으면 멀쩡한 요청을 결제 전에 돌려보냅니다.
 *
 * 특히 **허용 케이스**를 세는 게 중요합니다. "검은 턱시도를 입혀줘" 는 의상 요청이라
 * 통과해야 하는데, 색상어 하나로 잡도록 규칙이 넓어지면 이런 게 조용히 막힙니다 —
 * 막힌 사용자는 다시 시도하지 않으므로 아무도 모릅니다.
 */

import { describe, expect, it } from 'vitest'
import { promptRejectionReason } from './promptFilter'

const BREED_MESSAGE = '품종을 바꾸는 요청은 만들 수 없어요. 배경 · 의상 · 분위기로 바꿔 보세요.'
const FUR_MESSAGE = '털색을 바꾸는 요청은 만들 수 없어요. 배경 · 의상 · 분위기로 바꿔 보세요.'

describe('품종 변경 차단', () => {
  it.each([
    '우리 애를 시바견으로 만들어줘',
    '푸들처럼 보이게',
    '품종을 바꿔줘',
    '견종만 살짝',
    '웰시코기 느낌으로',
    // 강아지 앱이지만 고양이도 여기서 걸립니다 — 종을 바꾸는 요청이라 같은 범주입니다.
    '고양이로 만들어줘',
  ])('%s → 차단', (prompt) => {
    expect(promptRejectionReason(prompt)).toBe(BREED_MESSAGE)
  })
})

describe('털색 변경 차단', () => {
  it.each(['털을 하얗게', '털 검정으로', '모색을 갈색으로'])('%s → 차단', (prompt) => {
    expect(promptRejectionReason(prompt)).toBe(FUR_MESSAGE)
  })
})

describe('통과해야 하는 것', () => {
  it('색상어 단독은 막지 않는다 — 의상·배경 요청이다', () => {
    /*
      이게 이 필터의 설계 핵심입니다(모듈 주석). 색상어만으로 잡으면 W-08 이 권하는
      «배경 · 의상 · 분위기» 요청 대부분이 걸립니다 — 안내문이 시키는 대로 썼는데
      막히는 상태가 됩니다.
    */
    expect(promptRejectionReason('검은 턱시도를 입혀줘')).toBeNull()
    expect(promptRejectionReason('하얀 눈밭에서')).toBeNull()
  })

  it('털만 말하는 것도 막지 않는다', () => {
    // 색이 함께 있어야 «털색 변경» 입니다. 털 언급 자체는 묘사일 수 있습니다.
    expect(promptRejectionReason('털이 복슬복슬해 보이게')).toBeNull()
  })

  it('평범한 배경·의상·분위기 요청', () => {
    expect(promptRejectionReason('벚꽃 배경으로 만들어줘')).toBeNull()
    expect(promptRejectionReason('한복을 입혀줘')).toBeNull()
  })

  it('빈 입력은 «차단» 이 아니라 «사유 없음»', () => {
    /*
      여기서 문구를 내면 입력창에 손도 대기 전에 빨간 안내가 뜹니다. 빈 입력을 막는
      건 이 함수가 아니라 화면의 버튼 조건(`!prompt.trim()`)입니다 — 두 조건이 함께
      버튼을 잠그므로, 이 함수가 null 을 낸다고 해서 빈 채로 생성되지는 않습니다.
    */
    expect(promptRejectionReason('')).toBeNull()
    expect(promptRejectionReason('   ')).toBeNull()
  })
})

describe('알아 둘 한계', () => {
  it('두 글자 낱말을 띄우면 통과한다 — 이 필터는 정규화하지 않는다', () => {
    /*
      «모 색을 갈색으로» 는 여기를 지나갑니다. 판정이 부분 문자열이라 «모색» 이 쪼개지면
      털 언급으로 세지 않기 때문입니다(한 글자인 «털» 은 쪼갤 수 없어 그대로 걸립니다).

      이건 결함이라기보다 이 겹의 범위입니다 — 우회를 다 막는 건 서버 필터의 몫이고
      (handlers.ts `SERVER_PROMPT_BLOCKLIST`), 여기가 하는 일은 **흔한 요청을 결제 전에
      돌려보내는 것**뿐입니다.

      규칙을 정규화 쪽으로 넓히기로 하면 이 줄이 먼저 깨집니다. 그때 함께 봐야 할 것은
      위의 «통과해야 하는 것» 들이 여전히 통과하는가입니다.
    */
    expect(promptRejectionReason('모 색을 갈색으로')).toBeNull()
  })

  it('부분 문자열로 판정하므로 «고양이 카페» 도 걸린다', () => {
    /*
      의도된 과차단입니다. 좁게 잡아 놓친 요청은 서버가 다시 보지만, 여기서 잡힌
      요청은 크레딧을 쓰지 않습니다 — 두 오류의 비용이 다릅니다.
    */
    expect(promptRejectionReason('고양이 카페에서 찍은 것처럼')).toBe(BREED_MESSAGE)
  })

  it('품종이 털색보다 먼저 판정된다', () => {
    // 둘 다 걸리는 문장에서는 품종 문구가 나갑니다. 안내가 오락가락하지 않게 고정합니다.
    expect(promptRejectionReason('푸들처럼 털을 하얗게')).toBe(BREED_MESSAGE)
  })
})
