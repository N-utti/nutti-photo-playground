/**
 * 목의 쇼핑몰 연동 지급액 (mocks/handlers.ts `POST /auth/cafe24/link/verify` · 백엔드 PR #230).
 *
 * 화면 문구가 아니라 **목이 그 상태를 만들 수 있는가**를 봅니다. `EarnActionList.test.tsx`
 * 의 「지급이 없었으면 「받았어요」라고 말하지 않는다」는 `server.use` 로 `amount_granted: 0`
 * 을 지어내서 문구만 확인합니다 — 그것만 있으면 「목이 0 을 만들 줄 아는가」는 여전히
 * 아무도 안 봅니다. 브라우저 QA 에서 그 갈래를 밟으려면 목이 스스로 0 을 내려야 합니다.
 *
 * `amount_granted` 는 **정책값이 아니라 이번 요청으로 실제 지급한 값**입니다. 둘은 지급
 * 이후에 운영이 금액을 바꾸면 갈립니다(`PATCH /v1/admin/settings/{key}`).
 */

import { describe, expect, it } from 'vitest'
import { initialCredits } from './fixtures'
import { mockAsMember } from './handlers'

const BASE = 'http://localhost/v1'

type LinkResult = { cafe24_linked: boolean; credit_balance: number; amount_granted: number }

async function verify(shopMemberId: string): Promise<LinkResult> {
  const response = await fetch(`${BASE}/auth/cafe24/link/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_member_id: shopMemberId, code: '123456' }),
  })
  return (await response.json()) as LinkResult
}

const LINK_AMOUNT = initialCredits.earn_actions.find((row) => row.action === 'link_account')!.amount

describe('목 · 연동 verify 의 amount_granted', () => {
  it('첫 연동은 지급액을 돌려주고 잔액도 그만큼 는다', async () => {
    mockAsMember()
    const before = initialCredits.balance

    const result = await verify('tester123')

    expect(result.cafe24_linked).toBe(true)
    expect(result.amount_granted).toBe(LINK_AMOUNT)
    expect(result.credit_balance).toBe(before + LINK_AMOUNT)
  })

  it('두 번째 확인은 0 이다 — 화면의 «+0» 갈래를 밟을 수 있는 유일한 자리', async () => {
    /*
      이미 연동된 계정을 다시 확인하는 경우입니다. 서버도 200 + `amount_granted: 0` 을
      줍니다 — 실패가 아니라 「이번엔 지급 없음」입니다. 잔액이 **두 번 늘지 않는다**는
      것까지 봅니다: 늘어나면 목이 재연동마다 크레딧을 찍어 내는 셈이라, 화면이 그 위에서
      무슨 짓을 해도 정상으로 보입니다.
    */
    mockAsMember()
    const first = await verify('tester123')

    const second = await verify('tester123')

    expect(second.cafe24_linked).toBe(true)
    expect(second.amount_granted).toBe(0)
    expect(second.credit_balance).toBe(first.credit_balance)
  })

  it('후보를 고르는 단계는 아직 지급 전이라 0 이다', async () => {
    /*
      한 번호에 쇼핑몰 계정이 여럿이면 첫 verify 가 후보 목록만 주고 코드도 소비하지
      않습니다. 서버는 이 분기에도 필드를 내려주므로(두 분기 다 있음) 프론트 타입이
      옵셔널이 아닙니다 — 목이 빼먹으면 그 사실이 흐려집니다.
    */
    mockAsMember()
    const response = await fetch(`${BASE}/auth/cafe24/link/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: '01057731879', code: '123456' }),
    })
    const result = (await response.json()) as LinkResult & { candidates: string[] | null }

    expect(result.candidates).toHaveLength(3)
    expect(result.cafe24_linked).toBe(false)
    expect(result.amount_granted).toBe(0)
  })
})
