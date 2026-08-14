/**
 * 주소가 바뀌면 `document.title` 도 바뀌는지 (app/RootLayout.tsx `DocumentTitle` · PR #93).
 *
 * 라우트 표가 제목을 **선언했는지** 는 routes.test.tsx 가 봅니다. 여기서는 그 선언이
 * 실제로 탭 제목이 되는지 — 그리고 자식이 제목을 안 가졌을 때 부모 제목이 남는지를
 * 봅니다. 두 파일이 갈라져 있는 이유는 고장 나는 지점이 다르기 때문입니다: 표는
 * «적는 걸 깜빡해서», 여기는 «해석 규칙을 건드려서» 깨집니다.
 *
 * 실제 화면(W-01~W-12)을 렌더하지 않는 이유는 열두 화면이 저마다 데이터를 읽어
 * 제목과 무관한 실패로 이 테스트가 붉어지기 때문입니다. 규칙을 보는 데는 제목만
 * 다른 빈 화면 두 개면 충분합니다.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import RootLayout from './RootLayout'

const SITE_NAME = '누띠 사진 놀이터'

/** RootLayout 이 껍데기 라우트라 실제 앱과 같은 모양(부모 element + children)으로 세웁니다. */
function renderAt(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        element: <RootLayout />,
        children: [
          // 랜딩과 같은 자리 — 제목을 일부러 두지 않습니다.
          { path: '/', element: <p>랜딩</p> },
          { path: '/library', element: <p>보관함 화면</p>, handle: { title: '보관함' } },
          {
            path: '/styles',
            element: <p>카탈로그 화면</p>,
            handle: { title: '스타일' },
            // W-03 시트와 같은 배치 — 자식이 제목을 갖지 않습니다.
            children: [{ path: ':styleId', element: <p>스타일 시트</p> }],
          },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  )

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('document.title', () => {
  it('제목을 선언한 라우트는 "제목 · 브랜드" 가 된다', async () => {
    renderAt('/library')

    await waitFor(() => expect(document.title).toBe(`보관함 · ${SITE_NAME}`))
  })

  it('제목이 없는 라우트는 브랜드 이름만 쓴다', async () => {
    renderAt('/')

    // "누띠 사진 놀이터 · 누띠 사진 놀이터" 가 되면 안 됩니다.
    await waitFor(() => expect(document.title).toBe(SITE_NAME))
  })

  it('자식이 제목을 갖지 않으면 부모 제목이 남는다', async () => {
    renderAt('/styles/101')

    // 시트가 떠도 뒤의 카탈로그가 살아 있으므로 «다른 화면으로 갔다» 고 말하지 않습니다.
    await waitFor(() => expect(document.title).toBe(`스타일 · ${SITE_NAME}`))
  })

  it('화면이 다르면 제목도 다르다', async () => {
    renderAt('/library')
    await waitFor(() => expect(document.title).toBe(`보관함 · ${SITE_NAME}`))
    const library = document.title

    // 원 결함은 «열두 화면이 전부 같은 제목» 이었습니다 — 두 화면만 비교해도 드러납니다.
    renderAt('/styles')
    await waitFor(() => expect(document.title).toBe(`스타일 · ${SITE_NAME}`))

    expect(document.title).not.toBe(library)
  })
})
