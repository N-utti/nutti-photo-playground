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
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { styleCatalog } from '../mocks/fixtures'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W01Landing from './W01Landing'

/**
 * 카드를 **전체 그리드 안에서만** 셉니다.
 *
 * 진열대(화면 위 「인기 스타일로 시작하기」)와 전체 그리드는 같은 카드를 겹쳐 그립니다 —
 * 의도된 겹침이라(W01Landing.tsx `PickedShelf`) 화면 전체에서 「레고」를 찾으면 링크가 둘이고,
 * 「이름 인쇄」 배지도 3D 피규어 몫이 두 번 세어집니다. 더 나쁜 건 그게 **경합**이라는
 * 점입니다: 진열대와 카탈로그는 별개 요청이라, 화면 전체를 세면 «먼저 도착한 쪽만
 * 그려진 순간» 을 잡아 숫자가 그때그때 달라집니다. 목록을 지정하면 그 순간이 사라집니다.
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
 * 상위» 와 다릅니다 — 목이 그 차이를 재현하도록 `section=popular` 을 따로 다룹니다
 * (mocks/handlers.ts). 시드 정렬 상위 3 은 3D_피규어 · 레고 · 프라모델입니다.
 */
describe('W-01 홈 · 진열대(인기 스타일)', () => {
  it('배지 아래에 세 장이 서고, 전체 그리드와 겹쳐도 각각 제 목록에 있다', async () => {
    renderWithProviders(<W01Landing />, { route: '/' })

    const shelf = await screen.findByRole('list', { name: '인기 스타일' })
    const picked = await within(shelf).findAllByRole('link')
    expect(picked).toHaveLength(3)
    expect(picked.map((link) => link.textContent ?? '').some((t) => t.includes('레고'))).toBe(true)

    // 겹침은 의도입니다 — 진열대에 있어도 전체 그리드에서 사라지지 않아야 합니다.
    expect(await within(await styleGrid()).findByRole('link', { name: /레고/ })).toBeInTheDocument()
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
      이 한 건이 없으면 위 테스트들은 **잘라 쓰는 구현도 통과시킵니다.** 목의 기본
      `popular` 응답이 마침 카탈로그 앞 3개와 같아서(둘 다 시드 정렬 상위) 화면이
      구별되지 않기 때문입니다. 그래서 `section=popular` 응답만 카탈로그 **뒤쪽**으로
      바꿔 둘을 갈라 세웁니다 — 진열대가 카탈로그를 자르고 있으면 여기서 빨간불이 뜹니다.

      실서버에서 둘이 갈리는 조건은 «정렬 상위가 여러 섹션에 흩어져 있을 때» 입니다.
      지금 시드는 섹션이 통째로 이어 붙어 있어 그 조건을 못 만듭니다.
    */
    const tail = styleCatalog.sections[styleCatalog.sections.length - 1].styles.slice(0, 3)
    server.use(
      http.get('*/v1/styles', ({ request }) => {
        // 카탈로그 요청은 건드리지 않습니다 — 아무것도 반환하지 않으면 원래 핸들러로 넘어갑니다.
        if (new URL(request.url).searchParams.get('section') !== 'popular') return
        return HttpResponse.json({
          sections: [{ name: '인기', count: tail.length, styles: tail }],
          total_count: styleCatalog.total_count,
        })
      }),
    )

    renderWithProviders(<W01Landing />, { route: '/' })

    const shelf = await screen.findByRole('list', { name: '인기 스타일' })
    const names = within(shelf)
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
    expect(names.some((name) => name.includes(tail[0].name))).toBe(true)
    // 카탈로그 앞쪽(피규어·장난감)은 진열대에 없어야 합니다.
    expect(names.some((name) => name.includes('레고'))).toBe(false)
  })

  it('재사용 흐름에서는 진열대 카드도 from_job 을 이어받는다', async () => {
    renderWithProviders(<W01Landing />, { route: '/?from_job=job-1' })

    const shelf = await screen.findByRole('list', { name: '인기 스타일' })
    const first = within(shelf).getAllByRole('link')[0]
    // 안 이어받으면 방금 쓴 사진을 다시 올리게 됩니다(app/reuseFromJob.ts).
    expect(first.getAttribute('href')).toContain('from_job=job-1')
  })
})
