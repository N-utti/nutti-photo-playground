/**
 * W-01 홈 (원페이지 갤러리) — 옛 랜딩 + 카탈로그를 합친 화면.
 *
 * 여기서 지키는 것:
 *   1. 하단 탭바가 붙는다 — 라우트가 아니라 화면이 직접 답니다(app/TabBar.tsx). 빠뜨려도
 *      아무 데서도 안 걸리는데, 탭을 누른 순간 나머지 탭이 사라집니다.
 *   2. 카테고리 배지가 그리드를 필터한다 — carat 식 중앙 배지. 「전체」가 기본.
 *   3. 카드의 «이름 인쇄» 배지·비용 표기 — 옛 W-02 에서 이어받은 계약(백엔드 #111).
 */

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import W01Landing from './W01Landing'

describe('W-01 홈 · 탭바', () => {
  it('하단 탭바를 단다 — 홈 탭의 목적지이기 때문', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const tabbar = await screen.findByRole('navigation', { name: '주요 메뉴' })
    expect(tabbar).toBeInTheDocument()
  })
})

/**
 * 카테고리 배지는 앵커 점프가 아니라 **필터**입니다 — 누르면 그 섹션만 남습니다.
 * 시드 섹션은 피규어·장난감 / 컨셉 사진관 / 아트 / 일상 유머 넷이고, 「전체」가 그 앞에
 * 하나 더 섭니다.
 */
describe('W-01 홈 · 카테고리 필터 배지', () => {
  it('「전체」가 기본이라 모든 섹션의 스타일이 한 그리드에 뜬다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const nav = await screen.findByRole('navigation', { name: '스타일 카테고리' })
    const all = within(nav).getByRole('button', { name: '전체' })
    expect(all).toHaveAttribute('aria-pressed', 'true')

    // 서로 다른 섹션의 카드가 동시에 보입니다(레고=피규어·장난감).
    expect(await screen.findByRole('link', { name: /레고/ })).toBeInTheDocument()
  })

  it('카테고리를 누르면 그 섹션만 남는다', async () => {
    const user = userEvent.setup()
    renderWithProviders(<W01Landing />, { route: '/' })

    const nav = await screen.findByRole('navigation', { name: '스타일 카테고리' })
    // 레고는 「피규어·장난감」 섹션 카드입니다. 다른 섹션으로 필터하면 사라져야 합니다.
    await screen.findByRole('link', { name: /레고/ })

    const 아트 = within(nav).getByRole('button', { name: '아트' })
    await user.click(아트)

    expect(아트).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('link', { name: /레고/ })).not.toBeInTheDocument()
  })
})

/**
 * 카드의 «이름 인쇄» 배지 (서버 `uses_pet_name` · 백엔드 #111). 목을 덮지 않고 기본
 * 픽스처 그대로 셉니다 — 픽스처 플래그가 프롬프트 원문과 대조돼 있어(mocks/fixtures.test.ts)
 * 프롬프트가 바뀌는 날 한 줄에서 같이 걸립니다.
 */
describe('W-01 홈 · 카드 이름 인쇄 배지', () => {
  it('플래그가 켜진 스타일에만, 그 수만큼 붙는다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    // 시드 39종 중 `[pet name]` 을 쓰는 것은 3D_피규어·식빵 둘입니다.
    const badges = await screen.findAllByText('이름 인쇄')
    expect(badges).toHaveLength(2)

    const labelled = badges.map((badge) => badge.closest('a')?.textContent ?? '')
    expect(labelled.some((text) => text.includes('3D 피규어'))).toBe(true)
    expect(labelled.some((text) => text.includes('식빵'))).toBe(true)
  })

  it('플래그가 꺼진 카드에는 아무것도 안 붙는다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const lego = await screen.findByRole('link', { name: /레고/ })
    expect(within(lego).queryByText('이름 인쇄')).not.toBeInTheDocument()
  })
})

/**
 * 카드의 비용 표기 — 기호(◆)는 눈으로만, 읽어 주는 말은 `sr-only` 로 «N 크레딧».
 */
describe('W-01 홈 · 카드 비용 표기', () => {
  it('비용이 «N 크레딧» 으로 읽히고 기호는 안 읽힌다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const lego = await screen.findByRole('link', { name: /레고/ })
    expect(lego).toHaveAccessibleName(/1 크레딧/)
    expect(lego).not.toHaveAccessibleName(/◆/)
  })
})
