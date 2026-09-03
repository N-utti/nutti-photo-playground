/**
 * 인앱 브라우저 감지 (app/inAppBrowser.tsx).
 *
 * 지키는 건 UA 문자열 두 개의 인식뿐입니다 — 화면 쪽 배선(저장 대신 안내)은 얇은
 * 이른 반환이라 여기 감지가 무너지면 같이 무너집니다. 실제 UA 에서 따온 값으로
 * 고정합니다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectInAppBrowser, kakaoExternalOpenUrl } from './inAppBrowser'

function withUserAgent(ua: string): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('detectInAppBrowser', () => {
  it('카카오톡 웹뷰를 알아본다', () => {
    withUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.8.0',
    )
    expect(detectInAppBrowser()).toBe('kakaotalk')
  })

  it('인스타그램 웹뷰를 알아본다', () => {
    withUserAgent(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Instagram 334.0.0.42.95 Android',
    )
    expect(detectInAppBrowser()).toBe('instagram')
  })

  it('kakaoExternalOpenUrl 은 대상 URL 을 인코딩해 공식 스킴에 싣는다', () => {
    // 쿼리가 있는 URL 을 인코딩 없이 실으면 스킴의 url= 파라미터가 거기서 끊깁니다.
    const target = 'https://img.nutti.co.kr/results/a.jpg?x=1&y=2'
    expect(kakaoExternalOpenUrl(target)).toBe(
      `kakaotalk://web/openExternal?url=${encodeURIComponent(target)}`,
    )
  })

  it('일반 브라우저는 null — 오탐이면 멀쩡한 저장 경로를 안내로 바꿔 버린다', () => {
    withUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    )
    expect(detectInAppBrowser()).toBeNull()
  })
})
