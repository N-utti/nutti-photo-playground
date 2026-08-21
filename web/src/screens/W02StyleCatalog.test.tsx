/**
 * W-02 카탈로그 앵커바 (screens/W02StyleCatalog.tsx).
 *
 * 막으려는 결함: 칩의 `href` 와 섹션의 `id` 를 각각 `` `section-${섹션명}` `` 으로
 * 만들었더니, 이름에 공백·탭·개행이 섞인 섹션에서 **두 값이 갈라졌습니다**. `href` 는
 * URL 이라 브라우저가 정규화하고 `id` 는 그대로 남기 때문입니다(screens/sectionAnchor.ts).
 * 그러면 클릭이 아무 데로도 가지 않고 화면은 보던 자리에 머무릅니다 — 오류도 콘솔도
 * 없이, 사용자에게는 «다른 섹션이 나왔다» 로만 보입니다.
 *
 * 여기서는 링크가 **실제로 가리키는 요소가 있는지**를 렌더된 DOM 에서 확인합니다.
 * `a.href` 는 IDL 속성이라 jsdom 이 이미 브라우저와 같은 URL 정규화를 마친 값을
 * 돌려줍니다 — 즉 이 단언이 보는 문자열이 브라우저가 `getElementById` 에 넘기는 바로
 * 그 문자열입니다. 스크롤 자체는 jsdom 이 하지 않으므로 거기까지는 보지 않습니다.
 */

import { screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W02StyleCatalog from './W02StyleCatalog'

/** 운영이 이름을 어디선가 복사해 붙이면 언제든 들어올 수 있는 꼴들. */
const SECTION_NAMES = ['피규어·장난감', '여름 ', '가을\t한정', '컨셉 사진관']

function mockCatalog(names: readonly string[]) {
  let nextId = 1
  const sections = names.map((name) => {
    const id = nextId++
    return {
      name,
      count: 1,
      styles: [{ id, code: `style-${id}`, name: `스타일 ${id}`, thumbnail_url: null, credit_cost: 1 }],
    }
  })
  server.use(
    http.get('*/v1/styles', () =>
      HttpResponse.json({ sections, total_count: sections.length }),
    ),
  )
}

describe('W-02 앵커바', () => {
  it('칩이 가리키는 섹션이 실제로 존재한다 — 이름에 공백이 섞여도', async () => {
    mockCatalog(SECTION_NAMES)
    renderWithProviders(<W02StyleCatalog />, { route: '/styles' })

    const bar = await screen.findByRole('navigation', { name: '섹션 바로가기' })
    const chips = within(bar).getAllByRole('link')
    expect(chips).toHaveLength(SECTION_NAMES.length)

    for (const [index, chip] of chips.entries()) {
      // 브라우저가 프래그먼트를 퍼센트 디코드한 뒤 id 와 맞춥니다.
      const fragment = decodeURIComponent(new URL((chip as HTMLAnchorElement).href).hash.slice(1))
      const target = document.getElementById(fragment)

      expect(target, `«${SECTION_NAMES[index]}» 칩이 가리키는 섹션이 없습니다`).not.toBeNull()
      // 칩 순서와 섹션 순서가 어긋나면 «한 칸씩 밀리는» 그 증상이 됩니다.
      expect(target?.dataset.section).toBe(SECTION_NAMES[index])
    }
  })

  it('공백을 접은 뒤 겹치는 이름도 서로 다른 섹션으로 간다', async () => {
    const names = ['여름 한정', '여름  한정']
    mockCatalog(names)
    renderWithProviders(<W02StyleCatalog />, { route: '/styles' })

    const bar = await screen.findByRole('navigation', { name: '섹션 바로가기' })
    const targets = within(bar)
      .getAllByRole('link')
      .map((chip) =>
        document.getElementById(
          decodeURIComponent(new URL((chip as HTMLAnchorElement).href).hash.slice(1)),
        ),
      )

    expect(targets.map((element) => element?.dataset.section)).toEqual(names)
  })
})

/**
 * 카드의 «이름 인쇄» 배지 (서버 `uses_pet_name` · 백엔드 #111).
 *
 * 막으려는 결함: 이 플래그를 프론트가 **하드코딩 목록**으로 들고 있던 시절에 #110 이
 * 이모티콘 프롬프트를 교체하며 `[pet name]` 을 뺐고, 목록만 남아 화면이 조용히
 * 틀렸습니다. 그래서 여기서는 목을 덮지 않고 **기본 픽스처 그대로** 셉니다 —
 * 픽스처의 플래그는 `seeds/prompts/*.txt` 원문과 대조돼 있고(mocks/fixtures.test.ts),
 * 그 대조에 이 화면을 이어 붙이면 프롬프트가 바뀌는 날 한 줄에서 같이 걸립니다.
 */
describe('W-02 카드 · 이름 인쇄 배지', () => {
  it('플래그가 켜진 스타일에만, 그 수만큼 붙는다', async () => {
    renderWithProviders(<W02StyleCatalog />, { route: '/styles' })

    // 시드 39종 중 `[pet name]` 을 쓰는 것은 3D_피규어·식빵 둘입니다.
    const badges = await screen.findAllByText('이름 인쇄')
    expect(badges).toHaveLength(2)

    const labelled = badges.map((badge) => badge.closest('a')?.textContent ?? '')
    expect(labelled.some((text) => text.includes('3D 피규어'))).toBe(true)
    expect(labelled.some((text) => text.includes('식빵'))).toBe(true)
  })

  it('플래그가 꺼진 카드에는 아무것도 안 붙는다', async () => {
    renderWithProviders(<W02StyleCatalog />, { route: '/styles' })

    /*
      «레고» 는 같은 섹션의 이웃 카드입니다 — 배지를 카드가 아니라 섹션이나 그리드에
      걸어 버리면 39칸 전부에 뜨는데, 위 개수 단언만으로는 그 실수를 못 잡습니다.
    */
    const lego = await screen.findByRole('link', { name: /레고/ })
    expect(within(lego).queryByText('이름 인쇄')).not.toBeInTheDocument()
  })
})
