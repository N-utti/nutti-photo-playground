/**
 * W-09 보관함 «저장» 을 인앱 브라우저에서 눌렀을 때 대신 띄우는 안내 줄 — 배경은
 * app/inAppBrowser.ts. 여는 건 **보관함 페이지**라(여러 장을 하나씩 밖으로 열 수는 없음)
 * 외부 브라우저에서는 로그인이 한 번 더 필요합니다 — 그걸 숨기지 않고 말합니다.
 */
import { externalOpenUrl, type InAppBrowser } from './inAppBrowser'

const NAME: Record<InAppBrowser, string> = {
  kakaotalk: '카카오톡',
  instagram: '인스타그램',
  webview: '이 앱 안의',
}

export function InAppSaveGuide({ browser }: { browser: InAppBrowser }) {
  const href = externalOpenUrl(browser, window.location.href)
  if (href !== null) {
    return (
      <p role="status" className="mt-2 text-center text-xs text-ink-3">
        {NAME[browser]} 브라우저에서는 갤러리 저장이 막혀 있어요.{' '}
        <a href={href} className="underline hover:text-brand">
          외부 브라우저에서 보관함 열기
        </a>{' '}
        — 로그인이 한 번 더 필요해요.
      </p>
    )
  }
  return (
    <p role="status" className="mt-2 text-center text-xs text-ink-3">
      {NAME[browser]} 브라우저에서는 갤러리 저장이 막혀 있어요 — 오른쪽 위 메뉴(⋯)에서 「외부
      브라우저에서 열기」를 누른 뒤 다시 로그인해 저장해 주세요.
    </p>
  )
}
