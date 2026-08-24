/**
 * 앱바 크레딧 배지 (app/CreditBadge.tsx).
 *
 * 막으려는 결함은 «읽히지 않는 배지» 입니다. 배지는 값을 `◆ 11` 처럼 기호와 숫자로만
 * 그리고, 사람 말은 `aria-label` 에 담고 있었습니다 — 그런데 `<span>` 은 role 이 없는
 * generic 이고 ARIA 는 generic 에 이름 붙이는 것을 금지합니다. 그래서 그 라벨은
 * 접근성 트리에서 버려졌고, 스크린리더에는 기호와 숫자만 남았습니다.
 *
 * 값이 «—» 일 때가 특히 나쁩니다. 규칙 2(잔액을 모르면 0 이 아니라 «—»)는 «모른다» 를
 * «없다» 로 바꾸지 않으려고 있는데, 읽어 주는 말이 사라지면 그 규칙이 눈에만 존재하고
 * 소리에는 대시 하나만 남습니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { CreditBadge } from './CreditBadge'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'

describe('크레딧 배지', () => {
  it('잔액을 알면 «보유 크레딧 N개» 로 읽힌다', async () => {
    server.use(
      http.get('*/v1/credits', () => HttpResponse.json({ balance: 7, earn_actions: [] })),
    )
    renderWithProviders(<CreditBadge />)

    expect(await screen.findByText('보유 크레딧 7개')).toBeInTheDocument()
    // 기호는 장식입니다 — 읽히면 «검은 다이아몬드 7» 이 됩니다.
    expect(screen.getByText('◆ 7')).toHaveAttribute('aria-hidden')
  })

  it('못 불러오면 «모른다» 가 그대로 읽힌다 — 대시만 남기지 않는다', async () => {
    server.use(http.get('*/v1/credits', () => new HttpResponse(null, { status: 500 })))
    renderWithProviders(<CreditBadge />)

    expect(await screen.findByText('보유 크레딧을 불러오지 못했습니다')).toBeInTheDocument()
    // 규칙 2 — 모르는 잔액을 0 으로 적으면 «크레딧이 없다» 가 됩니다.
    expect(screen.queryByText(/보유 크레딧 0개/)).not.toBeInTheDocument()
  })
})
