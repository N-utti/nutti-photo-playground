/**
 * 결과 이미지 저장 (app/saveImage.ts · 이슈 #77 · PR #78).
 *
 * 이 파일이 지키는 건 **실패의 갈래**입니다. 저장은 fetch → blob → `download` 앵커로
 * 하는데(교차 출처에서 `download` 가 무시되기 때문), 그 fetch 가 실패하는 이유는 둘로
 * 갈리고 물러설 곳이 서로 다릅니다:
 *
 *   - 응답이 아예 없음(CORS 차단 · 오프라인) → 이미지 자체는 멀쩡할 수 있으니 새 탭
 *   - 서버가 «못 준다» 고 답함(404 · 403 · 만료된 서명) → 새 탭도 같은 오류 페이지
 *
 * 예전에는 둘을 한 `catch` 로 묶어서 뒤엣것에도 새 탭을 열었고, 화면은 «길게 눌러
 * 저장하세요» 라고 안내했습니다 — 사용자는 시키는 대로 하다가 저장할 게 없다는 걸
 * 알게 됩니다. 눈으로는 못 잡는 종류입니다: 목·로컬에서는 이미지가 늘 200 이라
 * 이 갈래 자체가 안 밟힙니다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFromNewTabHint, saveImage } from './saveImage'

const URL_ = 'https://cdn.example.test/nutti.jpg'

/*
  앵커 클릭을 가로챕니다. 안 막으면 jsdom 이 실제 내비게이션을 시도하고(구현돼 있지
  않아 콘솔만 더럽힙니다), 무엇보다 «몇 번, 어떤 속성으로 눌렀는가» 가 이 테스트의
  단언 대상입니다 — 404 에서 새 탭이 열리지 **않는다**는 것까지 봐야 합니다.
*/
function interceptAnchors(): HTMLAnchorElement[] {
  const clicked: HTMLAnchorElement[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this)
  })
  return clicked
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveImage', () => {
  it('받아지면 blob 으로 저장한다', async () => {
    const clicked = interceptAnchors()
    Object.assign(URL, { createObjectURL: () => 'blob:nutti', revokeObjectURL: () => {} })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }),
    )

    expect(await saveImage(URL_, 'nutti.jpg')).toBe('saved')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('nutti.jpg')
    // blob 경로에서 새 탭을 켜면 저장 대신 탭이 열리는 브라우저가 있습니다.
    expect(clicked[0].target).toBe('')
  })

  it('캐시를 건너뛴다 — 그러지 않으면 라이브에서 늘 실패한다', async () => {
    /*
      **이 옵션을 지우지 마세요.** 결과 `<img>` 는 `crossOrigin` 없이 로드하므로 브라우저가
      `Origin` 을 안 보내고, R2 는 매칭되는 CORS 규칙이 없어 `Access-Control-Allow-Origin`
      과 `Vary: Origin` 이 **둘 다 없는** 응답을 돌려줍니다. `Vary` 가 없으니 그 캐시
      엔트리가 같은 URL 의 모든 후속 요청에 매칭되고, 여기 fetch(mode: cors)가 그걸
      재사용해 ACAO 부재로 죽습니다 — 라이브에서 저장·공유가 **항상** 실패하던 원인이고
      PR #215 가 고친 것입니다.

      단언이 여기 있는 이유: MSW 도 jsdom 도 HTTP 캐시가 없어 `cache` 옵션을 **무시합니다.**
      화면 테스트로는 이 한 줄을 지워도 전부 초록이라, 다음 사람에게는 «아무것도 안 하는
      옵션» 으로 보입니다. 이 파일이 그 오해를 막는 유일한 자리입니다.
    */
    interceptAnchors()
    Object.assign(URL, { createObjectURL: () => 'blob:nutti', revokeObjectURL: () => {} })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }))

    await saveImage(URL_, 'nutti.jpg')

    expect(fetchSpy).toHaveBeenCalledWith(URL_, { cache: 'no-store' })
  })

  it('서버가 못 준다고 답하면 새 탭을 열지 않는다', async () => {
    const clicked = interceptAnchors()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))

    expect(await saveImage(URL_, 'nutti.jpg')).toBe('failed')
    // **이 파일의 핵심.** 열어 봐야 같은 404 라, 여는 순간 화면의 안내가 거짓이 됩니다.
    expect(clicked).toHaveLength(0)
  })

  it('응답 자체가 없으면 예전처럼 새 탭으로 연다', async () => {
    /*
      CORS 차단은 브라우저가 사유를 숨겨서 오프라인과 구분되지 않습니다. CORS 쪽이면
      이미지는 멀쩡하고 길게 눌러 저장할 수 있으므로, 되는 쪽에 겁니다 — PR #78 이
      문서에 박아 둔 그 폴백입니다.
    */
    const clicked = interceptAnchors()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    expect(await saveImage(URL_, 'nutti.jpg')).toBe('opened')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].target).toBe('_blank')
    expect(clicked[0].href).toBe(URL_)
  })
})

/**
 * 새 탭으로 물러선 뒤의 «그래서 어떻게 저장하나» (`saveFromNewTabHint`).
 *
 * 여기서 틀리면 저장이 실패하는 게 아니라 **안내가 거짓말**이 됩니다 — 마우스로 온
 * 사람이 «길게 눌러 저장해 주세요» 를 읽고 이미지를 누르고 있으면, 아무 일도 안
 * 일어나는 화면 앞에서 앱이 고장 난 줄 압니다. 저장 실패보다 알아채기 어렵습니다.
 *
 * 두 갈래를 다 세는 이유: jsdom 의 matchMedia 대역은 `(hover: hover)` 에 false 로
 * 답하므로(test/setup.ts) 아무것도 꾸미지 않으면 **마우스 갈래가 영영 안 밟힙니다.**
 */
describe('saveFromNewTabHint', () => {
  /** 이 질의에만 답을 정하고 나머지(min-width 등)는 setup 의 대역에 그대로 넘깁니다. */
  function stubHover(matches: boolean) {
    const real = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query === '(hover: hover)'
        ? ({ media: query, matches } as unknown as MediaQueryList)
        : real(query),
    )
  }

  it('마우스에는 오른쪽 클릭을 안내한다', () => {
    stubHover(true)

    expect(saveFromNewTabHint()).toBe('사진을 오른쪽 클릭해서 저장해 주세요.')
  })

  it('손가락에는 길게 누르기를 안내한다', () => {
    stubHover(false)

    expect(saveFromNewTabHint()).toBe('사진을 길게 눌러 저장해 주세요.')
  })
})
