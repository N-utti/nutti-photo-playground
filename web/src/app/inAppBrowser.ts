/**
 * 인앱 브라우저(카카오톡·인스타그램·그 밖의 앱 안 웹뷰) 감지와 탈출 경로.
 *
 * 왜 따로 다루나 — 두 플랫폼이 다른 제품입니다(2026-09-03 조사, 출처는 PR #249):
 *   - **Android** 웹뷰(카톡·인스타·네이버앱 등 전부 Android System WebView, UA 에 `; wv)`):
 *     `navigator.share` 가 아예 없고(크로미움이 WebView 에선 일부러 안 켬, crbug 40540400),
 *     blob: 다운로드도 파일을 만들지 않습니다(카톡은 «다운로드 중» 토스트만 뜨고 끝 —
 *     카카오 공식 FAQ 2025-09). 그래서 「저장」·「공유」가 성공한 척만 하게 됩니다.
 *   - **iOS** 웹뷰(WKWebView): `navigator.share` 는 iOS 12.2+, 파일 공유는 iOS 15+ 라
 *     보통은 OS 시트 경로를 그대로 탑니다. 여기 오는 건 시트가 없는 구형뿐입니다.
 *
 * 웹이 할 수 있는 일은 저장·공유가 되는 곳(외부 브라우저)으로 내보내는 것입니다.
 * 카카오톡은 공식 스킴, Android 웹뷰는 인텐트 URL 로 나갈 수 있고, 인스타그램 iOS 는
 * 2026-04 현재 믿을 만한 프로그램적 탈출이 없어 메뉴 경로를 말로 안내합니다.
 *
 * UA 스니핑이지만 카톡·인스타는 UA 에 자기 이름을 명시적으로 싣고, 나머지 Android 웹뷰는
 * `; wv)` 가 표준 표식이라 오탐보다 미탐이 문제인 자리입니다 — 미탐이면 예전처럼 조용히
 * 실패할 뿐 새로 깨지는 건 없습니다.
 */
export type InAppBrowser = 'kakaotalk' | 'instagram' | 'webview'

export function detectInAppBrowser(): InAppBrowser | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk'
  if (/Instagram/i.test(ua)) return 'instagram'
  // 이름 모를 앱의 Android 웹뷰(네이버앱·라인·페이스북 …) — 표준 표식.
  if (/; wv\)/.test(ua)) return 'webview'
  return null
}

function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** 로컬(`/media/…` 상대 경로)에서도 스킴·인텐트에 실을 수 있게 절대 주소로. */
function absolute(target: string): string {
  return new URL(target, window.location.href).href
}

/**
 * 카카오톡 웹뷰에서 외부 브라우저(기기 기본 — 보통 크롬/사파리)로 URL 을 여는 공식 스킴.
 * Android·iOS 모두 동작.
 */
export function kakaoExternalOpenUrl(target: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(absolute(target))}`
}

/**
 * Android 인텐트 URL — 인스타그램 등 Android 웹뷰가 이 형식을 기기 기본 브라우저로 넘겨줍니다
 * (inappdebugger 2024-11 표, 2025-11 갱신된 탈출 라이브러리들이 같은 방식). `browser_fallback_url`
 * 은 처리할 앱이 없을 때 그냥 그 주소로 가라는 뜻입니다.
 */
export function androidIntentUrl(target: string): string {
  const href = absolute(target)
  const url = new URL(href)
  return (
    `intent://${url.host}${url.pathname}${url.search}` +
    '#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;' +
    `S.browser_fallback_url=${encodeURIComponent(href)};end`
  )
}

/**
 * 이 인앱 브라우저에서 `target` 을 외부 브라우저로 여는 주소. 없으면 `null` — 인스타그램
 * iOS 가 그 경우라, 화면은 메뉴(⋯) 경로를 말로 안내합니다.
 */
export function externalOpenUrl(browser: InAppBrowser, target: string): string | null {
  if (browser === 'kakaotalk') return kakaoExternalOpenUrl(target)
  return isAndroid() ? androidIntentUrl(target) : null
}
