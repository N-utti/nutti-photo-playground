/**
 * W-10 A · 크레딧 받기 (screens/W10Credits.tsx · FR-W10-01).
 *
 * 화면 본문은 `EarnActionList` 가 지고 있어(같은 목록을 402 오버레이도 씁니다) 여기
 * 남은 건 잔액 표시와 «결제 UI 가 없다» 는 사실뿐입니다. 그 둘이 각각 조용히 틀립니다.
 *
 * 잔액은 **미상과 0 을 구분**해야 합니다(ADR-02 · app/CreditBadge 와 같은 규칙).
 * 못 불러온 상태를 0 으로 적으면 화면이 «크레딧이 없다» 고 단정하는데, 실제로는 있는데
 * 못 읽은 것일 수 있습니다. 그걸 보고 사용자는 받으러 나가거나 만들기를 포기합니다.
 *
 * 결제 문구는 이 화면 설계의 반전 그 자체입니다 — v0.3 에서 크레딧은 수익원이 아니라
 * 미끼라 **결제 UI 가 하나도 없어야** 합니다. 없다는 사실을 말해 주지 않으면 사용자는
 * 없는 결제창을 찾습니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W10Credits from './W10Credits'

/** 잔액 칸만 좁혀 읽습니다 — 획득 목록에도 숫자가 많아 화면 전체에서 세면 헷갈립니다. */
function balanceText(): string {
  return screen.getByText('보유 크레딧').parentElement?.querySelector('span:last-child')?.textContent ?? ''
}

describe('W-10 A · 크레딧 받기', () => {
  it('잔액을 보여 준다', async () => {
    renderWithProviders(<W10Credits />)

    await screen.findByText('누띠 주문하기')
    expect(balanceText()).toBe('11')
  })

  it('못 불러왔을 때 0 이라고 하지 않는다', async () => {
    /*
      **이 파일의 핵심입니다.** 실패를 0 으로 적으면 «크레딧이 없다» 가 되는데 그건
      사실이 아닐 수 있습니다 — 있는데 못 읽은 것일 수도 있습니다. 그 차이를 «—» 하나로
      말합니다(ADR-02).
    */
    server.use(
      http.get('*/v1/credits', () => HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 500 })),
    )
    renderWithProviders(<W10Credits />)

    // 획득 목록 쪽이 먼저 실패를 말합니다 — 그때까지 기다립니다.
    await screen.findByText('받을 수 있는 크레딧을 불러오지 못했어요.')
    expect(balanceText()).toBe('—')
    expect(balanceText()).not.toBe('0')
  })

  it('결제하지 않는다는 사실을 말해 준다', async () => {
    /*
      노트1 — 결제창을 뺐다는 것 자체를 말해야 사용자가 결제를 찾지 않습니다. 이 문구가
      사라지면 화면은 «크레딧을 파는데 살 방법이 없는» 것처럼 보입니다.
    */
    renderWithProviders(<W10Credits />)

    expect(await screen.findByText('크레딧은 판매하지 않아요. 아래로 받으세요.')).toBeInTheDocument()
  })

  it('받은 내역으로 가는 길이 있다', async () => {
    renderWithProviders(<W10Credits />)

    expect(await screen.findByRole('link', { name: '받은 내역 보기' })).toHaveAttribute(
      'href',
      '/credits/ledger',
    )
  })
})
