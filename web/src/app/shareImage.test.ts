/**
 * 결과 이미지를 공유 시트로 넘기기 (app/shareImage.ts · PR #203 · #215).
 *
 * 이 파일이 지키는 건 **한 줄짜리 옵션과 갈래 하나**입니다. 둘 다 화면 테스트로는
 * 지워도 초록이라 여기서만 잡힙니다.
 *
 *   - `cache: 'no-store'` — MSW 도 jsdom 도 HTTP 캐시가 없어 이 옵션을 무시합니다.
 *     라이브에서만 재발하는 종류라, 잠가 두지 않으면 「아무것도 안 하는 옵션」으로 보여
 *     다음 사람이 지웁니다.
 *   - `'expired'` — 활성화 창 만료를 `'failed'` 와 갈라 두는 것. 뭉뚱그리면 다시 누르면
 *     될 사람을 「저장한 뒤 올리기」로 보내고, 계측에서 CORS 실패와 섞입니다.
 *
 * 「받아 온 파일을 재사용하면 두 번째 탭이 즉시 뜬다」는 쪽은 화면 몫이라
 * `screens/W06Result.test.tsx` 가 봅니다 — 파일을 들고 있는 게 이 모듈이 아니라
 * 그 컴포넌트라서입니다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchShareFile, shareImage } from './shareImage'

const URL_ = 'https://cdn.example.test/nutti.jpg'

/** 시트가 이렇게 끝났다고 브라우저가 답한 상황을 만듭니다. */
function withShare(behaviour: () => void): void {
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async () => behaviour(),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (navigator as { share?: unknown }).share
})

describe('fetchShareFile', () => {
  it('캐시를 건너뛴다 — 그러지 않으면 라이브에서 늘 실패한다', async () => {
    /*
      **이 옵션을 지우지 마세요.** 결과 `<img>` 는 `crossOrigin` 없이 로드하므로 브라우저가
      `Origin` 을 안 보내고, R2 는 매칭되는 CORS 규칙이 없어 `Access-Control-Allow-Origin`
      과 `Vary: Origin` 이 **둘 다 없는** 응답을 돌려줍니다. `Vary` 가 없으니 그 캐시
      엔트리가 같은 URL 의 모든 후속 요청에 매칭되고, 여기 fetch(mode: cors)가 그걸
      재사용해 ACAO 부재로 죽습니다 — PR #215 가 고친 그 버그입니다.
    */
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['x'], { type: 'image/jpeg' }), { status: 200 }))

    await fetchShareFile(URL_, 'nutti.jpg')

    expect(fetchSpy).toHaveBeenCalledWith(URL_, { cache: 'no-store' })
  })

  it('받아지면 이름·타입이 붙은 File 로 준다', async () => {
    // URL 만 넘기면 인스타그램은 공유 대상에 아예 뜨지 않습니다 — File 이어야 합니다.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['x']), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    )

    const file = await fetchShareFile(URL_, 'nutti.jpg')

    expect(file).toBeInstanceOf(File)
    expect(file?.name).toBe('nutti.jpg')
    expect(file?.type).toBe('image/jpeg')
  })

  it('타입을 안 알려주면 JPEG 으로 친다', async () => {
    /*
      결과물은 항상 JPEG 입니다(`app/worker.py` `save_bytes(..., "image/jpeg")`). 빈
      타입으로 File 을 만들면 안드로이드 공유 시트가 인스타그램을 후보에서 빼는 일이
      있어서, 모르는 채로 넘기지 않고 아는 값을 적습니다.
    */
    /*
      `new Response(blob)` 으로는 이 상태를 못 만듭니다 — 생성자가 `text/plain` 을 기본으로
      붙여 버려서 빈 타입이 나오지 않습니다. `Content-Type` 없이 온 실제 응답을 직접
      세웁니다. 결과값을 적어 두면 이 갈래는 영영 안 밟힙니다.
    */
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => new Blob([]),
    } as unknown as Response)

    expect((await fetchShareFile(URL_, 'nutti.jpg'))?.type).toBe('image/jpeg')
  })

  it('서버가 못 준다고 답하거나 응답이 없으면 null 이다', async () => {
    /*
      둘을 안 나눕니다 — `saveImage` 와 달리 여기서는 호출부가 할 일이 같습니다(공유는
      새 탭으로 물러날 데가 없음). 화면은 이 null 을 «저장한 뒤 올리기» 로 안내합니다.
    */
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    expect(await fetchShareFile(URL_, 'nutti.jpg')).toBeNull()

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchShareFile(URL_, 'nutti.jpg')).toBeNull()
  })
})

describe('shareImage', () => {
  const file = new File([new Uint8Array([255, 216, 255])], 'nutti.jpg', { type: 'image/jpeg' })

  it('시트가 받아 가면 shared', async () => {
    withShare(() => undefined)
    expect(await shareImage(file, '우리 아이')).toBe('shared')
  })

  it('사용자가 닫은 것은 실패가 아니라 cancelled', async () => {
    withShare(() => {
      throw new DOMException('canceled', 'AbortError')
    })
    expect(await shareImage(file, '우리 아이')).toBe('cancelled')
  })

  it('활성화 창이 지났으면 expired — failed 와 갈라야 안내가 갈린다', async () => {
    /*
      WebKit 이 사용자 제스처 창 밖의 `navigator.share()` 를 거절하는 이름입니다. 이걸
      `'failed'` 로 접으면 화면은 「저장한 뒤 올려 주세요」라고 말하는데, 사진은 이미
      호출부 손에 있고 한 번 더 누르기만 하면 됩니다 — 물러설 곳이 정반대입니다.
    */
    withShare(() => {
      throw new DOMException('user gesture required', 'NotAllowedError')
    })
    expect(await shareImage(file, '우리 아이')).toBe('expired')
  })

  it('그 밖의 거절은 failed', async () => {
    withShare(() => {
      throw new DOMException('cannot share', 'NotSupportedError')
    })
    expect(await shareImage(file, '우리 아이')).toBe('failed')

    // DOMException 이 아닌 것(예: share 자체가 없는 브라우저)도 여기로 옵니다.
    delete (navigator as { share?: unknown }).share
    expect(await shareImage(file, '우리 아이')).toBe('failed')
  })
})
