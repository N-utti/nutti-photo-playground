/**
 * OAuth 왕복 동안 "어디서 로그인을 눌렀는지"를 기억합니다 (PR #21).
 *
 * 로그인은 `window.location` 으로 프로바이더에 나갔다가 `/auth/callback/{provider}` 로
 * 돌아오는 **전체 페이지 이동**이라 React state 가 전부 날아갑니다. 돌아온 뒤 랜딩으로
 * 떨구면 결과 화면에서 저장을 누른 사용자가 자기 결과를 다시 찾아가야 합니다.
 *
 * sessionStorage 를 쓰는 이유: 탭 단위 수명이 왕복 1회와 정확히 맞고, 탭을 닫으면
 * 자동으로 사라져 오래된 복귀 주소가 남지 않습니다.
 */

const RETURN_KEY = 'nutti.auth.return'

/**
 * 앱 내부 경로만 저장합니다.
 *
 * 돌아온 뒤 이 값으로 이동하므로 외부 URL 을 그대로 넣으면 오픈 리다이렉트가 됩니다.
 * `//evil.com` 처럼 스킴 없는 절대 URL 도 브라우저는 외부로 해석하므로 함께 막습니다.
 */
function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//')
}

export function rememberAuthReturn(path: string): void {
  if (!isInternalPath(path)) return
  sessionStorage.setItem(RETURN_KEY, path)
}

/** 한 번만 씁니다 — 읽으면서 지웁니다. 남겨 두면 다음 로그인이 엉뚱한 곳으로 갑니다. */
export function takeAuthReturn(fallback = '/'): string {
  const stored = sessionStorage.getItem(RETURN_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  return stored && isInternalPath(stored) ? stored : fallback
}
