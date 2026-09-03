/**
 * OS 공유 시트가 없는 브라우저의 「공유」 — 데스크톱, 그리고 Android 앱 안 웹뷰(카카오톡·
 * 인스타그램·네이버앱 …).
 *
 * 예전에는 이 자리가 «인스타그램 열기» 링크였습니다. 그러면 같은 화면이 브라우저마다
 * 다른 버튼을 보여 줘서, 카톡으로 받은 링크에서 연 사람은 «공유가 왜 없냐» 가 됩니다
 * (2026-09-03 갤럭시 카톡 실측 제보). 결정: **어디서든 「이미지 저장」+「공유」 두 버튼**,
 * 공유는 그 브라우저가 할 수 있는 최선으로 — OS 시트(파일) → OS 시트(링크) → 이 시트.
 *
 * 여기서 다루는 건 이미지 **링크**입니다(`share_image_url`, 인증 없는 공개 URL). 파일을
 * 다른 앱에 넘기는 건 Web Share 없이는 불가능해서, 파일이 필요한 인스타 게시는
 * 「이미지 저장 → 인스타그램 열기」 두 걸음이 됩니다 — 그 링크는 **데스크톱에서만** 둡니다.
 * 웹뷰 안에서는 instagram.com 이 같은 웹뷰 안에 열릴 뿐이라(인스타 안의 인스타) 되레
 * 오동작으로 읽힙니다. 웹뷰에서 실제로 되는 건 «외부 브라우저에서 이미지 열기» 와 «링크
 * 복사» 둘이고, 크롬/사파리로 나가면 거기서는 OS 시트(파일)까지 다 됩니다.
 *
 * 카카오톡 보내기가 **없는** 이유: SDK 없이 쓰던 sharer.kakao.com 주소는 앱 키 없이
 * 401(InvalidAppKeyError, 2026-09-03 실측)이고, 모바일 kakaolink:// 스킴도 앱 키로 만든
 * 템플릿이 필요합니다. 붙이려면 카카오 JS SDK + JavaScript 키 + 도메인 등록이 필요해
 * 별건입니다.
 *
 * iOS 는 여기 오지 않습니다(WKWebView 는 iOS 12.2+ 부터 `navigator.share` 가 있음) —
 * 그래서 인스타 iOS 메뉴 안내는 이 시트가 아니라 W-06 의 저장 안내줄에 있습니다.
 *
 * 껍데기는 `ConfirmDialog` 를 씁니다 — 포커스 가둠·Escape·바깥 눌러 닫기가 이미 들어
 * 있고, 직접 dialog 를 그리면 modalContract 테스트가 잡습니다.
 */
import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { externalOpenUrl, type InAppBrowser } from './inAppBrowser'

const ITEM =
  'block w-full rounded-xl border border-rule-strong bg-surface px-4 py-3 text-center text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]'

export default function ShareFallbackSheet({
  imageUrl,
  inAppBrowser,
  onClose,
}: {
  imageUrl: string
  inAppBrowser: InAppBrowser | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null)
  const external = inAppBrowser === null ? null : externalOpenUrl(inAppBrowser, imageUrl)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(imageUrl)
      setCopied('done')
    } catch {
      // 클립보드가 막힌 웹뷰 — 링크를 보여 주면 직접 복사할 수 있습니다.
      setCopied('failed')
    }
  }

  return (
    <ConfirmDialog title="공유" titleId="share-fallback-title" onClose={onClose} closeLabel="닫기">
      <div className="mt-3 space-y-2">
        {external !== null && (
          <a href={external} className={ITEM}>
            외부 브라우저에서 이미지 열기 — 길게 눌러 저장하거나 브라우저 메뉴로 공유해요
          </a>
        )}
        {inAppBrowser === null && (
          <a href="https://www.instagram.com/" target="_blank" rel="noreferrer" className={ITEM}>
            인스타그램 열기 — 저장한 사진으로 올리기
          </a>
        )}
        <button type="button" onClick={() => void copyLink()} className={ITEM}>
          {copied === 'done'
            ? '링크를 복사했어요'
            : copied === 'failed'
              ? '복사하지 못했어요 — 아래 링크를 직접 복사해 주세요'
              : '이미지 링크 복사'}
        </button>
        {copied === 'failed' && (
          <p className="break-all text-center text-xs text-ink-3" role="status">
            {imageUrl}
          </p>
        )}
      </div>
    </ConfirmDialog>
  )
}
