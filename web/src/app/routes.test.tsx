/**
 * 라우트 표가 화면마다 이름을 갖는지 (app/routes.tsx · PR #93).
 *
 * 원래 결함은 SPA 라 index.html 의 `<title>` 한 줄이 끝까지 가서 **열두 화면이 전부
 * "누띠 사진 놀이터"** 였던 것입니다. 고친 방식은 제목을 라우트에 붙이는 것인데
 * (`handle.title`), 그러면 새 결함 하나가 생깁니다 — **새 라우트를 추가하며 제목을
 * 빠뜨려도 아무 데서도 티가 안 납니다.** 앞 화면 제목을 그대로 달고 다닐 뿐이고,
 * 그건 화면을 보고 있는 사람에게는 보이지 않습니다.
 *
 * 그래서 여기서는 화면을 띄우지 않고 **표 자체**를 셉니다. 렌더 동작은
 * RootLayout.test.tsx 가 봅니다.
 */

import { describe, expect, it } from 'vitest'
import { routes } from './routes'

type TitleHandle = { title?: string }

type Entry = { path: string; title?: string }

/** 표를 훑어 «경로를 가진 라우트» 만 모읍니다. 껍데기 라우트(경로 없음)는 화면이 아닙니다. */
function collect(nodes: typeof routes, parent = ''): Entry[] {
  return nodes.flatMap((node) => {
    const path = node.path ? `${parent}/${node.path}`.replace(/\/+/g, '/') : parent
    const self: Entry[] = node.path ? [{ path, title: (node.handle as TitleHandle | undefined)?.title }] : []
    return [...self, ...collect(node.children ?? [], node.path ? path : parent)]
  })
}

/**
 * 제목이 **없는 게 맞는** 경로. 새 라우트를 추가하며 제목을 빠뜨렸다면 여기에
 * 넣는 게 아니라 `routes.tsx` 에 제목을 적어야 합니다 — 이유가 적힌 두 건뿐입니다.
 */
const INTENTIONALLY_UNTITLED: Record<string, string> = {
  '/': '홈(원페이지 갤러리)은 브랜드 이름 하나로 둡니다 — "누띠 사진 놀이터 · 누띠 사진 놀이터" 가 되지 않도록.',
  '/styles': '옛 카탈로그 주소 — 홈으로 넘기는 리다이렉트라 화면이 없습니다(제목을 그릴 자리가 없음).',
  '/styles/:styleId':
    'W-03 시트는 뒤의 갤러리가 그대로 살아 있으므로, 탭 제목까지 바뀌면 «다른 화면으로 갔다» 는 잘못된 신호가 됩니다.',
}

const entries = collect(routes)

describe('라우트 표', () => {
  it('화면이 하나 이상 잡혀 있다', () => {
    // collect() 가 조용히 빈 배열을 돌려주면 아래 검사들이 전부 공회전합니다.
    expect(entries.length).toBeGreaterThan(10)
  })

  it.each(entries.filter((entry) => !(entry.path in INTENTIONALLY_UNTITLED)))(
    '$path 가 제목을 선언한다',
    ({ title }) => {
      expect(title).toBeTruthy()
    },
  )

  it.each(Object.entries(INTENTIONALLY_UNTITLED))('%s 는 의도적으로 제목이 없다', (path) => {
    const entry = entries.find((candidate) => candidate.path === path)

    // 경로 자체가 사라졌다면 위 예외 목록이 낡은 것입니다 — 그것도 잡아야 합니다.
    expect(entry, `${path} 가 라우트 표에서 사라졌습니다. 예외 목록을 정리하세요.`).toBeDefined()
    expect(entry?.title).toBeUndefined()
  })

  it('제목이 서로 겹치지 않는다', () => {
    const titles = entries.map((entry) => entry.title).filter((title): title is string => Boolean(title))

    // 원 결함이 «전부 같은 제목» 이었으므로, 둘만 같아져도 그 방향으로 돌아가는 중입니다.
    expect(new Set(titles).size).toBe(titles.length)
  })
})
