/**
 * 데스크톱 상단 GNB (app/DesktopNav.tsx).
 *
 * jsdom 은 미디어 쿼리를 계산하지 않아 `desktop:block` / `desktop:hidden` 은 여기서
 * 볼 수 없습니다. **폭에 따라 보이는지는 브라우저에서만 확인됩니다** — 이 파일이
 * 지키는 건 그게 아니라 «보일 때 무엇을 가리키는가» 입니다.
 *
 * 지키는 것 둘:
 *
 *   1. **모바일 탭바와 같은 곳으로 간다.** 목록을 app/navTabs.ts 한 곳으로 모은 이유가
 *      이것인데, 한쪽이 자기 목록을 따로 들기 시작해도 타입은 통과합니다. 네 목적지를
 *      주소까지 박아 두면 그때 여기가 빨간불이 됩니다.
 *   2. **활성 판정이 홈을 삼키지 않는다.** 탭바와 같은 `isActive` 를 쓰므로 같은
 *      함정을 그대로 물려받습니다 — `/` 는 모든 경로의 접두사입니다.
 */

import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import DesktopNav from './DesktopNav'

function gnb() {
  return within(screen.getByRole('navigation', { name: '주요 메뉴' }))
}

describe('데스크톱 GNB', () => {
  it.each([
    ['홈', '/'],
    ['만들기', '/upload'],
    ['보관함', '/library'],
  ])('%s 은 %s 로 간다', (label, href) => {
    renderWithProviders(<DesktopNav />, { route: '/upload' })

    expect(gnb().getByRole('link', { name: label })).toHaveAttribute('href', href)
  })

  it('«스타일» 탭은 없다 — 홈이 곧 갤러리다', () => {
    renderWithProviders(<DesktopNav />, { route: '/' })

    expect(gnb().queryByRole('link', { name: '스타일' })).not.toBeInTheDocument()
  })

  it('누띠샵은 새 탭으로 나가고 GNB 출구로 표시된다', () => {
    renderWithProviders(<DesktopNav />, { route: '/' })

    const shop = gnb().getByRole('link', { name: '누띠샵' })
    expect(shop).toHaveAttribute('target', '_blank')
    // utm_content 가 탭바(tabbar)와 갈려 있어야 GA4 에서 데스크톱 출구를 셀 수 있습니다.
    expect(shop.getAttribute('href')).toContain('utm_content=gnb')
  })

  it('만들기 흐름에서도 GNB 가 그려진다', () => {
    // 하단 탭바가 일부러 빠져 있는 화면입니다(TabBar.tsx 주석). GNB 는 반대로
    // 여기에도 있어야 마우스에 남는 길이 앱바의 ← 하나로 줄지 않습니다.
    renderWithProviders(<DesktopNav />, { route: '/upload' })

    expect(gnb().getByRole('link', { name: '만들기' })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['/styles', '/upload', '/library'])('%s 에서는 홈이 켜지지 않는다', (route) => {
    renderWithProviders(<DesktopNav />, { route })

    expect(gnb().getByRole('link', { name: '홈' })).not.toHaveAttribute('aria-current')
  })
})
