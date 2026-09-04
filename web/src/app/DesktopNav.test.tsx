/**
 * 데스크톱 상단 GNB (app/DesktopNav.tsx).
 *
 * jsdom 은 미디어 쿼리를 계산하지 않아 `desktop:block` 은 여기서 볼 수 없습니다 —
 * 폭에 따라 보이는지는 브라우저에서만 확인됩니다. 이 파일이 지키는 건 «보일 때 무엇을
 * 담고 있는가» 입니다.
 *
 * GNB 는 이제 **로고 | 크레딧 · 계정** 뿐입니다. 가운데 탭 목록(홈·만들기·보관함)과
 * 누띠샵을 걷어냈고(홈은 로고가 겸함, 보관함은 마이페이지로, 누띠샵도 마이페이지 링크로),
 * 모바일 하단 탭바는 통째로 없앴습니다. 여기서 지키는 건 그 «걷어냄» 이 되돌아오지
 * 않는 것입니다 — 링크가 하나라도 되살아나면 빨간불이 됩니다.
 */

import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import DesktopNav from './DesktopNav'

describe('데스크톱 GNB · 최소 내비', () => {
  it('로고가 홈(/)으로 간다', () => {
    renderWithProviders(<DesktopNav />, { route: '/upload' })

    // 로고(BrandLockup)가 GNB 에서 홈으로 가는 유일한 링크입니다.
    const homeLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/')
    expect(homeLinks.length).toBeGreaterThan(0)
  })

  it('가운데 탭 목록과 누띠샵을 걷어냈다', () => {
    renderWithProviders(<DesktopNav />, { route: '/' })

    for (const label of ['홈', '만들기', '보관함', '스타일', '누띠샵']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
    // 탐색 랜드마크였던 «주요 메뉴» nav 자체가 사라졌습니다.
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
  })
})
