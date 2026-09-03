/**
 * 없는 주소로 들어왔을 때 (screens/placeholders.tsx `NotFound` · routes.tsx `path: '*'`).
 *
 * 막으려는 결함: 이 화면이 제목 한 줄뿐이라 **나갈 길이 없었습니다**(2026-09-03
 * play.nutti.co.kr 실측). 탭바는 목적지 네 화면이 각자 붙이는 것이라 이 라우트에는
 * 없고, 앱바도 없습니다. 링크를 타고 처음 들어온 사람은 브라우저 뒤로가기를 눌러도
 * 우리 화면이 아닌 곳으로 나갑니다.
 *
 * 그래서 «왜 이렇게 됐는지»(설명)와 «어디로 가면 되는지»(CTA) 둘을 함께 지킵니다 —
 * 제목만 남기고 둘 중 하나를 지우면 다시 막다른 골목이 됩니다.
 */

import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { NotFound } from './placeholders'

describe('없는 주소', () => {
  it('무슨 일이 났는지 말한다', () => {
    renderWithProviders(<NotFound />, { route: '/nope-404' })

    expect(screen.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeInTheDocument()
    // 제목만 있으면 «주소가 틀렸나 서비스가 죽었나» 를 사용자가 짐작해야 합니다.
    expect(screen.getByText(/주소가 잘못됐거나/)).toBeInTheDocument()
  })

  it('나갈 길을 준다 — 탭바가 있는 화면으로', () => {
    renderWithProviders(<NotFound />, { route: '/nope-404' })

    const out = screen.getByRole('link', { name: '스타일 보러 가기' })
    /*
      목적지가 `/styles` 인 것까지 검사합니다. 이 화면에는 탭바가 없어서 «어딘가로
      보내기만 하면 된다» 가 아니라 **탭바가 있는 화면**으로 보내야 그 다음이 열립니다
      (탭바를 붙이는 화면은 W-01·W-02·W-04·W-09 넷뿐입니다).
    */
    expect(out).toHaveAttribute('href', '/styles')
  })
})
