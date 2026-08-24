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
import { saveImage } from './saveImage'

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
