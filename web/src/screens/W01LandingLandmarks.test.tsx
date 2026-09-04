/**
 * W-01 랜딩의 **탐색 랜드마크** (screens/W01Landing.tsx).
 *
 * 막으려는 결함: 헤더의 로그인 칩이 `<nav aria-label="주요">` 안에 들어 있었습니다
 * (2026-09-03 play.nutti.co.kr 실측). 스크린리더의 랜드마크 목록에 «주요» 라는 탐색
 * 구역이 하나 더 서는데, 그 안에 있는 건 계정으로 가는 문 하나뿐이고 세션 응답이
 * 오기 전에는 **아무것도 없습니다** — 열었더니 빈 구역입니다. 라벨도 «주요» 로 끊겨
 * 무엇의 주요인지 말하지 않았습니다.
 *
 * 눈으로 보는 QA 로는 영영 안 걸립니다. 화면에는 로그인 칩이 그대로 보이고, 달라지는
 * 것은 랜드마크 목록뿐이라서 단언으로 잡아 둡니다.
 */

import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import W01Landing from './W01Landing'

describe('W-01 홈 · 탐색 랜드마크', () => {
  it('탐색 구역은 카테고리 필터 하나뿐이다 — 탭바를 걷어냈다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    // 카테고리 배지가 유일한 탐색 구역입니다(carat 식 필터). 하단 탭바는 없어졌고,
    // 계정 칩 같은 «빈 이름 구역» 이 하나라도 더 서면 이 개수가 어긋납니다.
    await screen.findByRole('navigation', { name: '스타일 카테고리' })
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
  })

  it('로그인 칩을 탐색 구역으로 감싸지 않는다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    // 칩이 뜬 뒤에 봐야 «감싸지 않았다» 가 «아직 안 그렸다» 와 구분됩니다.
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('navigation', { name: '주요' })).not.toBeInTheDocument(),
    )
  })
})
