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

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createTestQueryClient } from '../test/render'
import DesktopNav from './DesktopNav'

/**
 * GNB 는 라우트의 `handle.title` 을 읽으므로(useMatches) 데이터 라우터 안에 세워야
 * 합니다. 화면 컴포넌트는 필요 없어서 제목만 가진 빈 라우트로 실제 표의 모양을 흉내
 * 냅니다 — 홈은 제목 없음, W-03 시트는 제목 없는 자식.
 */
function renderAt(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        element: <DesktopNav />,
        children: [
          { path: '/', element: null, children: [{ path: 'styles/:styleId', element: null }] },
          { path: '/upload', element: null, handle: { title: '사진 올리기' } },
          { path: '/credits', element: null, handle: { title: '크레딧 받기' } },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  )
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('데스크톱 GNB · 최소 내비', () => {
  it('로고가 홈(/)으로 간다', () => {
    renderAt('/upload')

    // 로고(BrandLockup)가 GNB 에서 홈으로 가는 유일한 링크입니다.
    const homeLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/')
    expect(homeLinks.length).toBeGreaterThan(0)
  })

  it('가운데 탭 목록과 누띠샵을 걷어냈다', () => {
    renderAt('/')

    for (const label of ['홈', '만들기', '보관함', '스타일', '누띠샵']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
    // 탐색 랜드마크였던 «주요 메뉴» nav 자체가 사라졌습니다.
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
  })

  it('로고 옆에 지금 화면의 이름이 h1 으로 선다 — 라우트 표의 제목과 같은 값', () => {
    renderAt('/credits')

    expect(screen.getByRole('heading', { level: 1, name: '크레딧 받기' })).toBeInTheDocument()
    // 이름은 로고 링크 밖입니다 — 이름을 눌러 홈으로 가면 «누른 게 뭔지» 가 흐려집니다.
    const home = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/')
    expect(home).not.toHaveTextContent('크레딧 받기')
    // 구분 기호는 장식입니다 — 읽히면 «누띠 놀이터 슬래시 크레딧 받기».
    expect(screen.getByText('/')).toHaveAttribute('aria-hidden')
  })

  it('홈에서는 로고 혼자 선다 — 스타일 시트가 위에 떠도 마찬가지', () => {
    renderAt('/')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()

    renderAt('/styles/lego')
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })
})
