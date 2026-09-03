/**
 * 앱바 크레딧 배지 (app/CreditBadge.tsx).
 *
 * 막으려는 결함이 둘입니다.
 *
 * **읽히지 않는 배지.** 배지는 값을 `◆ 11` 처럼 기호와 숫자로만 그리고, 사람 말은
 * `aria-label` 에 담고 있었습니다 — 그런데 `<span>` 은 role 이 없는 generic 이고 ARIA 는
 * generic 에 이름 붙이는 것을 금지합니다. 그래서 그 라벨은 접근성 트리에서 버려졌고,
 * 스크린리더에는 기호와 숫자만 남았습니다. 값이 «—» 일 때가 특히 나쁩니다. 규칙
 * 2(잔액을 모르면 0 이 아니라 «—»)는 «모른다» 를 «없다» 로 바꾸지 않으려고 있는데,
 * 읽어 주는 말이 사라지면 그 규칙이 눈에만 존재하고 소리에는 대시 하나만 남습니다.
 *
 * **눌러도 아무 데도 안 가는 배지.** 잔액을 보고 «적네» 라고 생각한 사람이 그 자리에서
 * 할 수 있는 게 있어야 합니다. 그래서 배지는 크레딧 받기(W-10 A)로 가는 링크이고,
 * 아래는 그게 **링크로서** 성립하는지 — 이름이 목적지까지 말하는지, 그리고 이미 그
 * 화면에 있을 때는 링크를 도로 떼는지 — 를 셉니다. 자기 자신으로 가는 링크는 눌러도
 * 아무 일이 없어서, 누를 수 있게 생긴 것이 안 움직이는 그 상태가 됩니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { CreditBadge } from './CreditBadge'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'

/** 잔액을 아는 상태로 고정합니다 — 모르는 쪽(«—»)은 아래에서 따로 셉니다. */
function balanceIs(balance: number) {
  server.use(http.get('*/v1/credits', () => HttpResponse.json({ balance, earn_actions: [] })))
}

describe('크레딧 배지', () => {
  it('잔액을 알면 «보유 크레딧 N개» 로 읽힌다', async () => {
    balanceIs(7)
    renderWithProviders(<CreditBadge />)

    expect(await screen.findByRole('link', { name: '보유 크레딧 7개, 크레딧 받기' })).toBeInTheDocument()
    // 기호는 장식입니다 — 읽히면 «검은 다이아몬드 7» 이 됩니다.
    expect(screen.getByText('◆ 7')).toHaveAttribute('aria-hidden')
  })

  it('못 불러오면 «모른다» 가 그대로 읽힌다 — 대시만 남기지 않는다', async () => {
    server.use(http.get('*/v1/credits', () => new HttpResponse(null, { status: 500 })))
    renderWithProviders(<CreditBadge />)

    expect(
      await screen.findByRole('link', { name: '보유 크레딧을 불러오지 못했습니다, 크레딧 받기' }),
    ).toBeInTheDocument()
    // 규칙 2 — 모르는 잔액을 0 으로 적으면 «크레딧이 없다» 가 됩니다.
    expect(screen.queryByText(/보유 크레딧 0개/)).not.toBeInTheDocument()
  })

  it('누르면 크레딧 받기 화면으로 간다', async () => {
    balanceIs(7)
    renderWithProviders(<CreditBadge />)

    /*
      예전에는 아바타 → 마이페이지 → 「크레딧 받기」로 세 번 눌러야 나왔습니다.
      목적지가 `/credits/ledger`(받은 내역)로 새면 잔액을 늘리러 온 사람이 지난 기록만
      보게 되므로, 주소를 그대로 셉니다.
    */
    expect(await screen.findByRole('link', { name: /보유 크레딧/ })).toHaveAttribute(
      'href',
      '/credits',
    )
  })

  it('크레딧 화면 위에서는 링크가 아니다 — 자기 자신으로 가는 문을 만들지 않는다', async () => {
    balanceIs(7)
    // 데스크톱 GNB 는 모든 화면에 붙습니다(app/DesktopNav.tsx) — 크레딧 화면 위에도.
    renderWithProviders(<CreditBadge />, { route: '/credits' })

    expect(await screen.findByText('보유 크레딧 7개')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // 이름에서 «크레딧 받기» 도 같이 빠져야 합니다 — 안 가는 곳을 이름으로 말하면
    // 스크린리더 쪽에는 링크가 그대로 남아 있는 셈입니다.
    expect(screen.queryByText(/크레딧 받기/)).not.toBeInTheDocument()
  })
})
