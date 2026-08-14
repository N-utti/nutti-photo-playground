/**
 * W-01 랜딩 (screens/W01Landing.tsx) — 지금은 **탭바가 붙어 있는가** 한 가지만 봅니다.
 *
 * 탭바는 라우트가 아니라 화면이 직접 붙입니다(app/TabBar.tsx 주석). 그 규칙의 대가가
 * 이것입니다 — 빠뜨려도 아무 데서도 안 걸립니다. 랜딩은 탭바의 «홈» 이 가리키는
 * 목적지라 여기서 빠지면 탭을 누른 순간 나머지 탭이 통째로 사라집니다.
 */

import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import W01Landing from './W01Landing'

describe('W-01 랜딩', () => {
  it('하단 탭바를 단다 — 홈 탭의 목적지이기 때문', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const tabbar = await screen.findByRole('navigation', { name: '주요 메뉴' })
    expect(tabbar).toBeInTheDocument()
  })
})
