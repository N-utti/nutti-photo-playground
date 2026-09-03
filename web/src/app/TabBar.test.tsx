/**
 * 하단 탭바 (app/TabBar.tsx).
 *
 * 여기서 지키는 건 «홈» 탭 하나입니다. 나머지 네 칸은 와이어프레임에 그려진 것이라
 * 실수로 지워질 일이 적지만, 홈은 두 군데가 조용히 깨질 수 있습니다:
 *
 *   1. **활성 판정.** `isActive` 가 접두사도 보므로, 홈을 다른 탭과 똑같이 다루면
 *      `/` 가 모든 경로의 접두사라 어느 화면에서나 홈이 켜져 있게 됩니다. 지금은
 *      붙여 만든 접두사가 `//` 라 저절로 비껴가는데, «저절로» 는 리팩터링 한 번에
 *      사라집니다.
 *   2. **목적지.** 홈이 가리키는 W-01 은 탭바를 **직접** 붙이는 화면이라(화면이
 *      붙이는 규칙 — TabBar.tsx 주석) 랜딩에서 `<TabBar />` 가 빠지면 탭을 누른
 *      순간 나머지 탭이 사라집니다. 그건 W01Landing 쪽에서 봅니다.
 */

import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { TabBar } from './TabBar'

/** 탭바 안에서만 찾습니다 — 화면 본문에도 같은 이름의 링크가 있을 수 있습니다. */
function tabbar() {
  return within(screen.getByRole('navigation', { name: '주요 메뉴' }))
}

describe('하단 탭바', () => {
  it('홈 탭이 랜딩(/)으로 간다', () => {
    renderWithProviders(<TabBar />, { route: '/styles' })

    expect(tabbar().getByRole('link', { name: '홈' })).toHaveAttribute('href', '/')
  })

  it('랜딩에서는 홈이 현재 위치로 표시된다', () => {
    renderWithProviders(<TabBar />, { route: '/' })

    // aria-current="page" 가 «지금 여기» 를 스크린리더에 알리는 유일한 신호입니다.
    expect(tabbar().getByRole('link', { name: '홈' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/styles', '/styles/101', '/library', '/upload'])(
    '%s 에서는 홈이 켜지지 않는다',
    (route) => {
      renderWithProviders(<TabBar />, { route })

      // 접두사 판정이 홈까지 삼키면 여기가 전부 'page' 가 됩니다.
      expect(tabbar().getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current')
    },
  )

  it('«스타일» 탭은 없다 — 홈이 곧 갤러리라 따로 들어갈 탭이 없어졌다', () => {
    renderWithProviders(<TabBar />, { route: '/' })

    expect(tabbar().queryByRole('link', { name: '스타일' })).not.toBeInTheDocument()
  })
})
