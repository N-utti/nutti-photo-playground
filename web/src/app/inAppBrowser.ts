/**
 * 인앱 브라우저(카카오톡·인스타그램 웹뷰) 감지와 저장 안내.
 *
 * 이 웹뷰들은 Web Share API 가 없고(iOS WKWebView·Android WebView) blob 다운로드도
 * 조용히 버려서, «이미지 저장» 이 성공한 척만 하게 됩니다 — 카톡 링크·인스타 프로필
 * 링크로 들어온 사용자의 실측 제보(2026-09-02). 웹이 할 수 있는 일은 저장이 되는
 * 곳(외부 브라우저)으로 내보내는 것뿐입니다. 카카오톡은 공식 스킴이 있어 버튼 한 번이면
 * 되고, 인스타그램은 스킴이 없어 메뉴 경로를 말로 안내합니다.
 *
 * UA 스니핑이지만 이 둘은 UA 에 자기 이름을 명시적으로 싣는 쪽이라(KAKAOTALK ·
 * Instagram) 오탐보다 미탐이 문제인 자리입니다 — 미탐이면 예전처럼 조용히 실패할 뿐
 * 새로 깨지는 건 없습니다.
 */
export type InAppBrowser = 'kakaotalk' | 'instagram'

export function detectInAppBrowser(): InAppBrowser | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk'
  if (/Instagram/i.test(ua)) return 'instagram'
  return null
}
