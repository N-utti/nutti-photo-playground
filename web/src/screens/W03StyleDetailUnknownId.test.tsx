/**
 * W-03 시트가 **주소의 스타일 번호를 못 읽었을 때** (screens/W03StyleDetail.tsx).
 *
 * 막으려는 결함: `/styles/lego` · `/styles/0` · `/styles/-1` 로 들어오면 시트가
 * 스켈레톤에 영원히 멈춰 있었습니다(2026-09-03 play.nutti.co.kr 실측). 화면은 «곧
 * 뜬다» 고 말하는데 요청은 아예 나가지 않아서, 기다려도 아무 일도 안 일어납니다.
 *
 * 원인은 두 조각이 어긋난 것입니다 — 번호를 못 읽으면 `useStyleDetail(null)` 이
 * `enabled: false` 로 요청을 막는데, react-query 는 그 «안 보냄» 상태도 `isPending`
 * 으로 내려 줍니다. 화면이 isPending 만 보고 스켈레톤을 그리면 둘의 뜻이 갈립니다.
 *
 * 서버가 없는 번호에 404 를 줄 때와 사용자가 겪는 일은 같으므로(고를 수 없는 스타일)
 * 같은 자리로 보냅니다. 그 문구는 이미 있었고, 이 경로에서만 못 닿고 있었습니다.
 */

import { screen, waitFor } from '@testing-library/react'
import { http, passthrough } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W03StyleDetail from './W03StyleDetail'

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/styles/:styleId" element={<W03StyleDetail />} />
    </Routes>,
    { route },
  )
}

/** 목록 밖 번호는 «없는 스타일» 이지 «못 읽은 주소» 가 아닙니다 — 갈래를 갈라 둡니다. */
const NOT_A_STYLE_ID = ['/styles/lego', '/styles/0', '/styles/-1', '/styles/1.5']

describe('W-03 · 주소의 스타일 번호를 못 읽었을 때', () => {
  it.each(NOT_A_STYLE_ID)('%s 는 스켈레톤이 아니라 못 고른다고 말한다', async (route) => {
    renderAt(route)

    expect(await screen.findByText('지금은 고를 수 없는 스타일이에요.')).toBeInTheDocument()
    // 스켈레톤이 같이 남아 있으면 «로딩 중이면서 실패» 라는 앞뒤 안 맞는 화면입니다.
    expect(screen.queryByText('스타일 정보를 불러오는 중')).not.toBeInTheDocument()
    // 닫는 길이 없으면 시트에 갇힙니다.
    expect(screen.getByRole('button', { name: '다른 스타일 보기' })).toBeInTheDocument()
  })

  it('읽을 수 없는 번호로는 서버를 부르지 않는다', async () => {
    const called = vi.fn()
    server.use(
      http.get('*/v1/styles/:styleId', ({ params }) => {
        called(params.styleId)
        return passthrough()
      }),
    )

    renderAt('/styles/lego')

    await screen.findByText('지금은 고를 수 없는 스타일이에요.')
    // 문구가 뜬 뒤에 뒤늦게 나가는 요청까지 잡습니다.
    await waitFor(() => expect(called).not.toHaveBeenCalled())
  })

  it('제대로 읽히는 번호는 종전대로 서버 응답을 그린다', async () => {
    renderAt('/styles/1')

    expect(await screen.findByRole('link', { name: '이 스타일로 만들기' })).toBeInTheDocument()
    expect(screen.queryByText('지금은 고를 수 없는 스타일이에요.')).not.toBeInTheDocument()
  })
})
