/** «이미지 저장» 을 눌렀을 때 인앱 브라우저에서 대신 띄우는 안내 줄 — 배경은 app/inAppBrowser.ts */
import { kakaoExternalOpenUrl, type InAppBrowser } from './inAppBrowser'

export function InAppSaveGuide({ browser }: { browser: InAppBrowser }) {
  if (browser === 'kakaotalk') {
    return (
      <p role="status" className="mt-2 text-center text-xs text-ink-3">
        카카오톡 브라우저에서는 갤러리 저장이 막혀 있어요.{' '}
        <a
          href={kakaoExternalOpenUrl(window.location.href)}
          className="underline hover:text-brand"
        >
          외부 브라우저로 열기
        </a>
      </p>
    )
  }
  return (
    <p role="status" className="mt-2 text-center text-xs text-ink-3">
      인스타그램 브라우저에서는 갤러리 저장이 막혀 있어요 — 메뉴(⋯)에서 「외부
      브라우저에서 열기」를 누른 뒤 저장해 주세요.
    </p>
  )
}
