/**
 * 카카오톡 공유 (app/kakaoShare.ts) — SDK 를 어떻게 싣고 무엇을 보내는지.
 *
 * SDK 자체는 부르지 않습니다(네트워크). 스크립트 태그의 형태(SRI·crossorigin)와 init,
 * 그리고 피드 카드의 필드가 여기서 고정됩니다 — 카카오가 카드를 거절하는 흔한 이유가
 * 링크 도메인·이미지 https 이고, 그건 실기기에서만 보이므로 여기서는 «보내는 모양» 만.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kakaoShareAvailable, loadKakao, shareToKakao, type KakaoSdk } from './kakaoShare'

const IMAGE = 'https://img.nutti.co.kr/results/a.jpg'

function fakeSdk(): KakaoSdk & { sent: Record<string, unknown>[]; initKey: string | null } {
  const sdk = {
    sent: [] as Record<string, unknown>[],
    initKey: null as string | null,
    init(key: string) {
      sdk.initKey = key
    },
    isInitialized() {
      return sdk.initKey !== null
    },
    Share: {
      sendDefault(settings: Record<string, unknown>) {
        sdk.sent.push(settings)
      },
    },
  }
  return sdk
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete window.Kakao
  document.head.querySelectorAll('script[src*="kakao_js_sdk"]').forEach((el) => el.remove())
})

describe('kakaoShare', () => {
  it('키가 없으면 그리지 않는다 — 눌러도 아무 일이 안 일어나는 버튼을 두지 않으려고', () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', '')
    expect(kakaoShareAvailable()).toBe(false)
  })

  it('SDK 를 SRI·crossorigin 붙은 스크립트로 한 번만 싣고 JavaScript 키로 init 한다', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'js-key-test')
    const sdk = fakeSdk()
    const appended: HTMLScriptElement[] = []
    vi.spyOn(document.head, 'append').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      appended.push(script)
      // 브라우저가 파일을 실행해 전역을 만든 상황을 흉내냅니다.
      window.Kakao = sdk
      script.onload?.(new Event('load'))
    })

    const first = loadKakao()
    const second = loadKakao()
    expect(await first).toBe(sdk)
    expect(await second).toBe(sdk)

    expect(appended).toHaveLength(1)
    expect(appended[0].src).toBe('https://t1.kakaocdn.net/kakao_js_sdk/2.8.2/kakao.min.js')
    expect(appended[0].integrity).toMatch(/^sha384-/)
    expect(appended[0].crossOrigin).toBe('anonymous')
    expect(sdk.initKey).toBe('js-key-test')
  })

  it('피드 카드: 결과 이미지 + 랜딩(UTM) 링크 + «나도 만들기» 버튼', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'js-key-test')
    const sdk = fakeSdk()
    window.Kakao = sdk

    expect(await shareToKakao(IMAGE)).toBe('sent')

    expect(sdk.sent).toHaveLength(1)
    const card = sdk.sent[0] as {
      objectType: string
      content: { imageUrl: string; link: { webUrl: string; mobileWebUrl: string } }
      buttons: { title: string }[]
    }
    expect(card.objectType).toBe('feed')
    expect(card.content.imageUrl).toBe(IMAGE)
    expect(card.content.link.webUrl).toBe(
      `${window.location.origin}/?utm_source=kakao&utm_medium=share&utm_campaign=result_share`,
    )
    expect(card.content.link.mobileWebUrl).toBe(card.content.link.webUrl)
    expect(card.buttons[0].title).toBe('나도 만들기')
  })

  it('SDK 를 못 실으면 failed — 화면이 안내할 수 있게', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'js-key-test')
    vi.spyOn(document.head, 'append').mockImplementation((node) => {
      ;(node as HTMLScriptElement).onerror?.(new Event('error'))
    })
    expect(await shareToKakao(IMAGE)).toBe('failed')
  })
})
