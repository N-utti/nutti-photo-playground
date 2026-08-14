/**
 * 앱바 ← (app/BackButton.tsx · PR #88 · PR #93).
 *
 * 두 가지를 봅니다 — **어디로 가는가**와 **손가락으로 누를 수 있는가**.
 *
 * 앞엣것은 여섯 화면(W-04·W-07·W-08·W-10 A/B·W-12)이 같은 자리의 같은 화살표를 쓰는데
 * 목적지가 화면마다 달랐던 결함입니다. 규칙을 «히스토리 한 칸 뒤» 하나로 접었고,
 * 예외는 «돌아갈 우리 화면이 없을 때» 뿐입니다.
 *
 * 뒤엣것은 탭 타깃 14×25px 이 WCAG 2.5.8(AA)의 24×24 에 못 미쳤던 건입니다.
 * ⚠️ 이 크기는 **jsdom 에서 잴 수 없습니다** — jsdom 은 레이아웃을 계산하지 않아
 * `getBoundingClientRect()` 가 전부 0 을 돌려주고, Tailwind 클래스도 적용되지 않습니다.
 * 그래서 여기서는 «넓히는 장치가 붙어 있는가» 까지만 봅니다. 실제 픽셀 확인은
 * 브라우저가 필요합니다(현재는 수동 QA — 이슈 #94 는 E2E 를 범위에서 뺐습니다).
 * 이 테스트가 막는 건 리팩터링하다 확장을 통째로 떨어뜨리는 경우입니다.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BackButton from './BackButton'

/**
 * `hasAppHistory()` 는 react-router 가 히스토리 항목마다 찍는 `idx` 를 읽습니다.
 * 메모리 라우터는 `window.history` 를 건드리지 않으므로 여기서 직접 세웁니다 —
 * 판정이 보는 값이 정확히 이것입니다.
 */
function setHistoryIndex(idx: number) {
  window.history.replaceState({ idx }, '')
}

const originalState = window.history.state as unknown

beforeEach(() => {
  setHistoryIndex(0)
})

afterEach(() => {
  window.history.replaceState(originalState, '')
})

/**
 * ← 하나만 놓인 화면(`/upload`)과 갈 수 있는 두 목적지로 세웁니다.
 * 도착지 글자로 «히스토리 한 칸 뒤» 와 «fallback» 을 구분합니다.
 */
function renderBackButton(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      { path: '/styles', element: <p>스타일 카탈로그</p> },
      { path: '/library', element: <p>보관함</p> },
      { path: '/upload', element: <BackButton fallback="/styles" /> },
    ],
    { initialEntries },
  )
  return render(<RouterProvider router={router} />)
}

describe('앱바 ←', () => {
  it('뒤에 우리 화면이 있으면 직전 페이지로 간다', async () => {
    const user = userEvent.setup()
    // 이 탭에서 우리가 직접 쌓은 항목이 뒤에 있다는 표시.
    setHistoryIndex(1)
    renderBackButton(['/library', '/upload'])

    await user.click(screen.getByRole('button', { name: '뒤로' }))

    // fallback('/styles')이 아니라 **직전 항목**('/library')이어야 합니다.
    expect(await screen.findByText('보관함')).toBeInTheDocument()
  })

  it('돌아갈 우리 화면이 없으면 fallback 으로 간다', async () => {
    const user = userEvent.setup()
    // 공유 링크·주소 직접 입력·OAuth 복귀 — 첫 항목이라 idx 가 0 입니다.
    setHistoryIndex(0)
    renderBackButton(['/upload'])

    await user.click(screen.getByRole('button', { name: '뒤로' }))

    // navigate(-1) 이었다면 앱 밖(또는 아무 데도 아닌 곳)으로 나갑니다.
    expect(await screen.findByText('스타일 카탈로그')).toBeInTheDocument()
  })

  it('보이는 글리프 밖으로 탭 영역을 넓혀 둔다 (WCAG 2.5.8)', () => {
    renderBackButton(['/upload'])

    /*
      ::after 로 넓힙니다 — 글리프를 키우거나 padding 을 주면 앱바 제목이 통째로
      밀리기 때문입니다. 그래서 확인할 것도 세 조각입니다: 기준 상자(relative) ·
      실제로 그려지는 가짜 요소(content-['']) · 상하좌우 확장(-inset-*).
      셋 중 하나만 빠져도 탭 영역은 원래의 14×25 로 돌아갑니다.
    */
    const back = screen.getByRole('button', { name: '뒤로' })
    expect(back).toHaveClass('relative')
    expect(back).toHaveClass("after:content-['']")
    expect(back).toHaveClass('after:absolute')
    expect(back).toHaveClass('after:-inset-x-4')
    expect(back).toHaveClass('after:-inset-y-2.5')
  })

  it('스크린리더가 읽을 이름을 갖는다', () => {
    renderBackButton(['/upload'])

    // 버튼 내용이 «←» 글리프뿐이라 aria-label 이 없으면 무명 버튼이 됩니다.
    expect(screen.getByRole('button', { name: '뒤로' })).toBeInTheDocument()
  })
})
