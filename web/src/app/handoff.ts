/**
 * 세션 핸드오프 — 인앱 웹뷰에서 크롬으로 **같은 화면을 들고** 나가기.
 *
 * Android 웹뷰(카톡·인스타·네이버앱)에는 OS 공유 시트가 없습니다(크로미움이 WebView 에선
 * Web Share 를 안 켬 — 2017년 이슈가 2025-12 까지 그대로). 「공유」가 진짜 시트를 띄우려면
 * 크롬으로 나가야 하는데, 게스트 세션이 웹뷰 localStorage 에 갇혀 있어 크롬에서 결과가
 * 안 열렸습니다. 그래서:
 *   1. 나갈 때 `POST /auth/handoff` 로 120초·1회용 코드를 받아 결과 주소에 실어 나가고
 *   2. 크롬에서 열린 이 앱이 부팅 관문보다 먼저 코드를 소진해 같은 세션의 토큰을 받습니다.
 * 코드는 URL 에 실리므로 서버가 1회용·짧은 만료·로그아웃 시 무효로 지킵니다(§3).
 *
 * 인스타 Android 웹뷰의 `intent://` 탈출은 2024-10 메타 버그 뒤 복구됐고(inapp-debugger #11),
 * 네이버앱도 같은 방식이 한국 개발자 커뮤니티에서 오래 쓰였습니다 — 그래도 앱이 안 내보내면
 * 호출부가 자체 시트로 물러납니다(`tryLeaveTo`).
 */
import { auth } from '../api/endpoints'
import { session } from '../api/client'

export const HANDOFF_PARAM = 'handoff'
/** 도착한 화면이 «여기서 공유 누르면 시트가 뜬다» 고 말할 수 있게 함께 실어 보냅니다. */
export const SHARE_INTENT_PARAM = 'share'

/** 크롬이 열 주소 — 결과 화면 + 코드 + 공유 의도. */
export function handoffUrl(code: string, jobId: string): string {
  const url = new URL(`/jobs/${jobId}`, window.location.origin)
  url.searchParams.set(HANDOFF_PARAM, code)
  url.searchParams.set(SHARE_INTENT_PARAM, '1')
  return url.href
}

/**
 * 주소에서 코드를 **집어 내고 지웁니다** — 동기, GA4 보다 먼저 불러야 합니다(main.tsx).
 * `page_location` 에 살아 있는 자격증명이 실려 제3자 로그에 남는 것을 막습니다(보안 리뷰
 * 2026-09-03). 성공·실패 무관하게 지우므로 뒤로 가기·새로고침이 다시 소진을 시도하지 않습니다.
 * `share` 는 남깁니다 — 도착 화면이 «공유 한 번이 남았다» 를 말하는 근거.
 */
export function takeHandoffCode(): string | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get(HANDOFF_PARAM)
  if (code === null) return null
  url.searchParams.delete(HANDOFF_PARAM)
  window.history.replaceState(window.history.state, '', url.href)
  return code
}

/**
 * 코드를 소진해 세션으로 삼습니다. 부팅 관문(`openWhenSessionReady`)보다 **먼저** 끝나야
 * 이후 요청이 옛 게스트가 아니라 이 세션으로 나갑니다.
 *
 * **이미 회원이 로그인된 브라우저에서는 소진하지 않습니다** — 링크 하나로 남의 세션을
 * 덮어씌우는 고정(fixation) 공격을 막습니다(보안 리뷰). 그 회원이 웹뷰의 그 회원이면
 * 결과는 어차피 열리고, 다른 사람이면 안 열리는 게 맞습니다. 게스트 자리만 이어받습니다.
 *
 * 실패(만료·재사용·위조)는 조용히 지나갑니다 — 새 게스트가 발급되고 결과는 안 열리는데,
 * 그 화면(W-06 의 404)이 «이 결과에 접근할 수 없다» 를 이미 말합니다.
 */
export async function redeemHandoff(code: string | null): Promise<boolean> {
  if (code === null) return false
  if (session.kind === 'member') return false
  try {
    const granted = await auth.redeemHandoff(code)
    session.set(granted.token, granted.kind, granted.refresh_token)
    return true
  } catch {
    return false
  }
}

/** 한 번에 — 테스트·단순 호출용. 실제 부팅은 두 단계를 나눠 부릅니다(main.tsx). */
export function redeemHandoffFromUrl(): Promise<boolean> {
  return redeemHandoff(takeHandoffCode())
}

/** 크롬에 도착한 직후인지 — 공유 의도를 실어 온 주소인지로 압니다. */
export function arrivedToShare(): boolean {
  return new URL(window.location.href).searchParams.get(SHARE_INTENT_PARAM) === '1'
}
