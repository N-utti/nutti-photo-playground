/**
 * W-01 홈 (원페이지 갤러리) — 옛 랜딩 + 카탈로그를 합친 화면.
 *
 * 여기서 지키는 것:
 *   1. 하단 탭바가 없다 — 통째로 걷어냈습니다(보관함은 마이페이지로).
 *   2. 카테고리 배지가 그리드를 필터한다 — carat 식 중앙 배지. 「전체」가 기본.
 *   3. 카드의 «이름 인쇄» 배지·비용 표기 — 옛 W-02 에서 이어받은 계약(백엔드 #111).
 *   4. 누띠샵 유입구가 게스트에게도 보이고, 재사용 흐름에서는 숨는다.
 *   5. 배지 아래 진열대(「인기 스타일로 시작하기」) — 「전체」일 때만, 서버에 따로 물어서.
 */

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { POPULAR_CODES, styleCatalog } from '../mocks/fixtures'
import { renderWithProviders } from '../test/render'
import W01Landing from './W01Landing'

/**
 * 카드를 **전체 그리드 안에서만** 셉니다.
 *
 * 진열대(화면 위 「인기 스타일로 시작하기」)에 걸린 스타일은 아래 그리드에도 그대로
 * 있습니다 — 「전체 스타일」이 말 그대로 전부여야 하기 때문입니다. 그래서 화면 전체에서
 * 「거울셀카」를 찾으면 링크가 둘입니다.
 *
 * 더 나쁜 건 그게 **경합**이라는 점입니다: 진열대와 카탈로그는 별개 요청이라, 화면 전체를
 * 세면 «먼저 도착한 쪽만 그려진 순간» 을 잡아 숫자가 그때그때 달라집니다. 목록을 지정하면
 * 그 순간이 사라집니다.
 */
const styleGrid = () => screen.findByRole('list', { name: '스타일 목록' })

describe('W-01 홈 · 내비', () => {
  it('하단 탭바가 없다 — 통째로 걷어냈다(보관함은 마이페이지로)', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    // 카테고리 필터가 뜬 뒤에 봐야 «없다» 가 «아직 안 그렸다» 와 구분됩니다.
    await screen.findByRole('navigation', { name: '스타일 카테고리' })
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
  })
})

/**
 * 누띠샵 유입구. 마이페이지 링크는 회원만 보므로, 게스트가 대다수인 이 놀이터에서
 * 게스트도 보이는 자리가 홈입니다. 재사용 흐름에서는 앱 밖으로 나가는 문을 열지 않게 숨깁니다.
 */
describe('W-01 홈 · 누띠샵 유입구', () => {
  it('게스트에게도 보이고, 새 탭·utm_content=home 으로 나간다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const shop = await screen.findByRole('link', { name: /누띠 수제간식 보러가기/ })
    expect(shop).toHaveAttribute('target', '_blank')
    // GA4 가 마이페이지 유입(utm_content=mypage)과 갈라 셀 수 있어야 합니다.
    expect(shop.getAttribute('href')).toContain('utm_content=home')
  })

  it('재사용 흐름(from_job)에서는 숨긴다', async () => {
    renderWithProviders(<W01Landing />, { route: '/?from_job=job-1' })

    // 카테고리 필터가 뜬 뒤에 봐야 «숨김» 이 «아직 안 그렸다» 와 구분됩니다.
    await screen.findByRole('navigation', { name: '스타일 카테고리' })
    expect(screen.queryByRole('link', { name: /누띠 수제간식 보러가기/ })).not.toBeInTheDocument()
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
    expect(await within(await styleGrid()).findByRole('link', { name: /레고/ })).toBeInTheDocument()
  })

  it('카테고리를 누르면 그 섹션만 남는다', async () => {
    const user = userEvent.setup()
    renderWithProviders(<W01Landing />, { route: '/' })

    const nav = await screen.findByRole('navigation', { name: '스타일 카테고리' })
    // 레고는 「피규어·장난감」 섹션 카드입니다. 다른 섹션으로 필터하면 사라져야 합니다.
    await within(await styleGrid()).findByRole('link', { name: /레고/ })

    const 아트 = within(nav).getByRole('button', { name: '아트' })
    await user.click(아트)

    expect(아트).toHaveAttribute('aria-pressed', 'true')
    expect(within(await styleGrid()).queryByRole('link', { name: /레고/ })).not.toBeInTheDocument()
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
    const badges = await within(await styleGrid()).findAllByText('이름 인쇄')
    expect(badges).toHaveLength(2)

    const labelled = badges.map((badge) => badge.closest('a')?.textContent ?? '')
    expect(labelled.some((text) => text.includes('3D 피규어'))).toBe(true)
    expect(labelled.some((text) => text.includes('식빵'))).toBe(true)
  })

  it('플래그가 꺼진 카드에는 아무것도 안 붙는다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const lego = await within(await styleGrid()).findByRole('link', { name: /레고/ })
    expect(within(lego).queryByText('이름 인쇄')).not.toBeInTheDocument()
  })
})

/**
 * 카드의 비용 표기 — 기호(◆)는 눈으로만, 읽어 주는 말은 `sr-only` 로 «N 크레딧».
 */
describe('W-01 홈 · 카드 비용 표기', () => {
  it('비용이 «N 크레딧» 으로 읽히고 기호는 안 읽힌다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const lego = await within(await styleGrid()).findByRole('link', { name: /레고/ })
    expect(lego).toHaveAccessibleName(/1 크레딧/)
    expect(lego).not.toHaveAccessibleName(/◆/)
  })
})

/**
 * 「인기 스타일로 시작하기」 진열대 — 배지와 전체 그리드 사이에 세 장.
 *
 * 여기서 지키는 것은 문구가 아니라 **어디서 온 데이터인가** 입니다. 이미 받아 둔
 * 카탈로그의 앞 세 개를 잘라 쓰면 그건 «첫 번째 섹션의 상위» 라서 실서버가 주는 «전체의
 * 상위» 와 다릅니다 — 목이 그 차이를 재현하도록 `section=popular` 을 따로 다루고,
 * 돌려주는 세 장(`POPULAR_CODES`)도 **서로 다른 섹션에서** 고릅니다.
 */
describe('W-01 홈 · 진열대(인기 스타일)', () => {
  it('배지 아래에 서버가 준 세 장이 선다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const shelf = await screen.findByRole('list', { name: '인기 스타일' })
    const picked = await within(shelf).findAllByRole('link')
    expect(picked).toHaveLength(POPULAR_CODES.length)

    const labels = picked.map((link) => link.textContent ?? '')
    for (const code of POPULAR_CODES) {
      expect(labels.some((label) => label.includes(code.replace(/_/g, ' ')))).toBe(true)
    }
  })

  it('진열대에 올라간 카드도 전체 그리드에서 사라지지 않는다', async () => {
    // 「전체 스타일 39」는 말 그대로 전부입니다 — 진열대에 걸렸다고 목록에서 빼면
    // 그 스타일을 찾던 사람이 «전체» 에서 못 찾습니다.
    renderWithProviders(<W01Landing />, { route: '/' })

    const grid = await styleGrid()
    expect(within(grid).getAllByRole('link')).toHaveLength(styleCatalog.total_count)
    expect(within(grid).getByRole('link', { name: /거울셀카/ })).toBeInTheDocument()
  })

  it('카테고리를 고르면 접힌다 — 안 그러면 필터가 거짓말이 된다', async () => {
    const user = userEvent.setup()
    renderWithProviders(<W01Landing />, { route: '/' })

    const nav = await screen.findByRole('navigation', { name: '스타일 카테고리' })
    await screen.findByRole('list', { name: '인기 스타일' })

    await user.click(within(nav).getByRole('button', { name: '아트' }))

    expect(screen.queryByRole('list', { name: '인기 스타일' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: '인기 스타일로 시작하기' }),
    ).not.toBeInTheDocument()

    // 「전체」로 돌아오면 다시 섭니다.
    await user.click(within(nav).getByRole('button', { name: '전체' }))
    expect(await screen.findByRole('list', { name: '인기 스타일' })).toBeInTheDocument()
  })

  it('카탈로그를 자른 게 아니라 서버에 따로 물은 결과를 그린다', async () => {
    /*
      **이 한 건이 «잘라 쓰는 구현» 을 막습니다.** 진열대가 받아 둔 카탈로그의 앞 세 개를
      slice 해서 쓰면 첫 섹션(피규어·장난감)의 3D 피규어·레고·프라모델이 나옵니다. 목이
      돌려주는 인기 세 장은 서로 다른 섹션에서 골랐으므로(`POPULAR_CODES`) 두 구현이
      화면에서 갈립니다 — 목을 덮어쓰지 않고도 검사할 수 있는 이유입니다.

      실서버에서 둘이 갈리는 조건이 바로 이것입니다: 정렬 상위가 여러 섹션에 흩어져
      있을 때. 목이 그 조건을 재현하지 않으면 여기서만 통과하고 실서버에서 다른 카드가
      뜹니다.
    */
    renderWithProviders(<W01Landing />, { route: '/' })

    const shelf = await screen.findByRole('list', { name: '인기 스타일' })
    const names = within(shelf)
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
    // 카탈로그 앞 세 개(첫 섹션 = 피규어·장난감)는 진열대에 없어야 합니다.
    for (const sliced of ['3D 피규어', '레고', '프라모델']) {
      expect(names.some((name) => name.includes(sliced))).toBe(false)
    }
  })

  it('재사용 흐름에서는 진열대 카드도 from_job 을 이어받는다', async () => {
    renderWithProviders(<W01Landing />, { route: '/?from_job=job-1' })

    const shelf = await screen.findByRole('list', { name: '인기 스타일' })
    const first = within(shelf).getAllByRole('link')[0]
    // 안 이어받으면 방금 쓴 사진을 다시 올리게 됩니다(app/reuseFromJob.ts).
    expect(first.getAttribute('href')).toContain('from_job=job-1')
  })
})
