/**
 * 인앱 브라우저 감지와 탈출 주소 (app/inAppBrowser.ts).
 *
 * 여기서는 UA 인식과 URL 빌더만 봅니다. 화면 쪽 배선(저장 → 외부 브라우저로 이미지 열기
 * / 안내줄, 자체 공유 시트의 항목)은 screens/W06Result.test.tsx · screens/W09Library.test.tsx
 * · app/ShareFallbackSheet.test.tsx 가 봅니다. 실제 UA 에서 따온 값으로 고정합니다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  androidIntentUrl,
  detectInAppBrowser,
  externalOpenUrl,
  kakaoExternalOpenUrl,
} from './inAppBrowser'

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

  it('androidIntentUrl 은 host·path·query 를 인텐트 형식에 싣고 fallback 을 인코딩한다', () => {
    const target = 'https://img.nutti.co.kr/results/a.jpg?x=1'
    expect(androidIntentUrl(target)).toBe(
      'intent://img.nutti.co.kr/results/a.jpg?x=1' +
        '#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;' +
        `S.browser_fallback_url=${encodeURIComponent(target)};end`,
    )
  })

  it('externalOpenUrl — 카톡은 공식 스킴, 인스타 Android 는 인텐트, 인스타 iOS 는 null(탈출 불가)', () => {
    const target = 'https://img.nutti.co.kr/results/a.jpg'
    withUserAgent('Mozilla/5.0 (Linux; Android 14; wv) Chrome/124.0 Mobile Instagram 334.0.0.42.95 Android')
    expect(externalOpenUrl('kakaotalk', target)).toBe(kakaoExternalOpenUrl(target))
    expect(externalOpenUrl('instagram', target)).toBe(androidIntentUrl(target))
    withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 334.0.0.42.95')
    expect(externalOpenUrl('instagram', target)).toBeNull()
  })

  it('이름 모를 Android 웹뷰는 "; wv)" 표식으로 알아본다 — 네이버앱·라인·페이스북', () => {
    withUserAgent(
      'Mozilla/5.0 (Linux; Android 14; SM-S911N Build/UP1A.231005.007; wv) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0.0)',
    )
    expect(detectInAppBrowser()).toBe('webview')
  })

  it('상대 경로(로컬 /media/…)도 절대 주소로 만들어 싣는다 — new URL 이 던지지 않게', () => {
    withUserAgent('Mozilla/5.0 (Linux; Android 14; wv) Instagram 334.0.0.42.95 Android')
    const abs = new URL('/media/results/a.jpg', window.location.href).href
    expect(externalOpenUrl('instagram', '/media/results/a.jpg')).toBe(androidIntentUrl(abs))
    expect(kakaoExternalOpenUrl('/media/results/a.jpg')).toBe(
      `kakaotalk://web/openExternal?url=${encodeURIComponent(abs)}`,
    )
  })

  it('일반 브라우저는 null — 오탐이면 멀쩡한 저장 경로를 안내로 바꿔 버린다', () => {
    withUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
    )
    expect(detectInAppBrowser()).toBeNull()
  })
})
