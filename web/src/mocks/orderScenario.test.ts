/**
 * 목의 주문 웹훅 전이 (mocks/handlers.ts `applyOrderScenario` · 백엔드 PR #201).
 *
 * **잔액이 움직이는 순간**을 봅니다. 목의 `GET /v1/credits` 는 오래도록 정적이었고,
 * 원장 픽스처에 `order_reward`·`order_clawback` 행이 들어 있긴 했습니다 — 하지만 그건
 * **결과를 적어 둔 것**이라 라벨과 음수 표기만 확인될 뿐, 「주문하고 돌아오니 +20 이
 * 들어와 있다」와 「취소했더니 빠져나갔다」는 브라우저에서도 테스트에서도 밟을 수가
 * 없었습니다.
 *
 * 회수 쪽이 특히 밟혀야 합니다. 30분 크론이던 시절 취소는 나중에 원장에서 발견하는
 * 일이었는데 #201 의 웹훅이 이걸 **사용자가 화면을 보고 있는 수 초 안**으로 옮겼고,
 * 그래서 W-10 주문 줄에 「취소하면 회수」를 적었습니다(PR #223). 그 문장이 가리키는
 * 사건을 목이 만들 수 있어야 문장이 검증 가능해집니다.
 *
 * 화면이 아니라 목을 직접 부릅니다 — 검사 대상이 화면의 표시가 아니라 **목이 그 상태를
 * 만들 수 있는가** 이기 때문입니다.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { initialCredits } from './fixtures'

const BASE = 'http://localhost/v1'

type CreditsResponse = { balance: number; earn_actions: { action: string; amount: number }[] }
type LedgerRow = { reason: string; ref_label: string | null; amount: number; occurred_on: string }

const credits = async (): Promise<CreditsResponse> =>
  (await (await fetch(`${BASE}/credits`)).json()) as CreditsResponse

const ledger = async (): Promise<LedgerRow[]> =>
  ((await (await fetch(`${BASE}/credits/ledger`)).json()) as { items: LedgerRow[] }).items

/** 목의 잔액 조회는 **회원만** 쓰는 게 아닙니다 — 앱바 배지가 화면마다 부릅니다. */
function setScenario(name: string): void {
  localStorage.setItem('nutti.mock.scenario', name)
}

afterEach(() => {
  localStorage.removeItem('nutti.mock.scenario')
})

const ORDER_AMOUNT = initialCredits.earn_actions.find((row) => row.action === 'order')!.amount

describe('목 · 주문 결제 웹훅', () => {
  it('다음 조회에서 주문 보상이 들어와 있고, 원장이 그 이유를 말한다', async () => {
    const before = await credits()
    setScenario('order:paid')

    const after = await credits()

    expect(after.balance).toBe(before.balance + ORDER_AMOUNT)
    const [top] = await ledger()
    expect(top.reason).toBe('order_reward')
    expect(top.amount).toBe(ORDER_AMOUNT)
  })

  it('폴링해도 한 번만 들어온다', async () => {
    /*
      **이 파일의 핵심입니다.** 잔액 조회는 앱바 배지가 화면마다 부르고 창을 다시
      포커스할 때도 갱신됩니다. 매번 더하면 가만히 있어도 잔액이 불어나서, 흉내 내려던
      «주문 한 건» 이 아니라 아무 데도 없는 사건이 됩니다.
    */
    setScenario('order:paid')
    const first = await credits()

    await credits()
    const third = await credits()

    expect(third.balance).toBe(first.balance)
    expect((await ledger()).filter((row) => row.reason === 'order_reward' && row.ref_label === '#20260902')).toHaveLength(1)
  })

  it('금액은 서버가 말한 주문 보상을 따라간다', async () => {
    /*
      20 을 박아 두면 운영이 30 으로 올린 서버에서 목만 20 을 움직입니다 — 화면이
      「+30」이라고 적어 놓고 실제로는 20 이 들어오는, 스스로를 반박하는 상태입니다.
      운영이 이 값을 바꿀 수단은 백엔드 PR #186 이 열었습니다.
    */
    expect(ORDER_AMOUNT).toBeGreaterThan(0)
    setScenario('order:paid')

    const after = await credits()
    const orderRow = after.earn_actions.find((row) => row.action === 'order')!

    expect((await ledger())[0].amount).toBe(orderRow.amount)
  })
})

describe('목 · 주문 취소 웹훅', () => {
  it('다음 조회에서 회수돼 있고, 원장이 그 이유를 말한다', async () => {
    const before = await credits()
    setScenario('order:cancelled')

    const after = await credits()

    expect(after.balance).toBe(before.balance - ORDER_AMOUNT)
    const [top] = await ledger()
    expect(top.reason).toBe('order_clawback')
    expect(top.amount).toBe(-ORDER_AMOUNT)
  })

  it('받았다가 취소하면 한 주문의 일생이 원장에 두 줄로 남는다', async () => {
    /*
      번호를 맞추는 이유: 사용자가 이 표를 보러 오는 유일한 이유는 «내가 취소한 그
      주문이 맞나» 이기 때문입니다. 번호가 다르면 표는 「+20 이 들어왔고 −20 이
      나갔다」까지만 말하고, 그 둘이 같은 주문인지는 여전히 모릅니다.
    */
    setScenario('order:paid')
    await credits()
    setScenario('order:cancelled')
    const after = await credits()

    // 받았다가 도로 뺀 것이므로 처음 자리로 돌아옵니다.
    expect(after.balance).toBe(initialCredits.balance)

    const [clawback, reward] = await ledger()
    expect([clawback.reason, reward.reason]).toEqual(['order_clawback', 'order_reward'])
    expect(clawback.ref_label).toBe(reward.ref_label)
  })

  it('잔액이 음수로 내려가는 것도 막지 않는다', async () => {
    /*
      `member.credit_balance` 에 하한 CHECK 가 없어 실서버도 음수가 됩니다
      (FR-EDGE-05 · ADR-02). 목이 0 에서 멈추면 «표시는 0 인데 판정은 원값» 이라
      크레딧을 받아도 만들기가 안 풀리는 그 상태를 브라우저에서 못 봅니다.
    */
    setScenario('credit:empty')
    expect((await credits()).balance).toBe(0)

    setScenario('order:cancelled')

    expect((await credits()).balance).toBe(-ORDER_AMOUNT)
  })
})
