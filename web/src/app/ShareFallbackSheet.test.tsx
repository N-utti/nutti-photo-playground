/**
 * 자체 공유 시트 (app/ShareFallbackSheet.tsx) — 브라우저별로 어떤 항목이 서는지.
 *
 * 화면 테스트(W06Result.test.tsx)는 데스크톱과 카톡 Android 두 갈래만 봅니다. 여기서는
 * 나머지 — 인스타 Android 의 인텐트, 이름 모를 Android 웹뷰, 복사 실패 갈래 — 를 봅니다.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShareFallbackSheet from './ShareFallbackSheet'
import { androidIntentUrl, kakaoExternalOpenUrl } from './inAppBrowser'

const URL_ = 'https://img.nutti.co.kr/results/a.jpg'
const UA_ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 NAVER(inapp; search; 1000; 12.0.0)'

function withUserAgent(ua: string): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ShareFallbackSheet', () => {
  it('데스크톱: 인스타그램 열기 + 링크 복사, 외부 브라우저 항목은 없고 닫기 버튼', () => {
    render(<ShareFallbackSheet imageUrl={URL_} inAppBrowser={null} onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: /인스타그램 열기/ })).toHaveAttribute(
      'href',
      'https://www.instagram.com/',
    )
    expect(screen.queryByRole('link', { name: /외부 브라우저/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이미지 링크 복사' })).toBeInTheDocument()
    // 배경(바깥 눌러 닫기)도 aria-label 이 «닫기» 라 창 안으로 좁혀 봅니다.
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' })).toBeInTheDocument()
  })

  it('카톡 웹뷰: 맨 위가 카카오 스킴(이미지 URL), 인스타 링크는 없다', () => {
    render(<ShareFallbackSheet imageUrl={URL_} inAppBrowser="kakaotalk" onClose={vi.fn()} />)

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', kakaoExternalOpenUrl(URL_))
    expect(screen.queryByRole('link', { name: /인스타그램 열기/ })).not.toBeInTheDocument()
  })

  it('인스타 Android 웹뷰: 인텐트 URL 로 나간다', () => {
    withUserAgent(UA_ANDROID_WEBVIEW)
    render(<ShareFallbackSheet imageUrl={URL_} inAppBrowser="instagram" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: /외부 브라우저에서 이미지 열기/ })).toHaveAttribute(
      'href',
      androidIntentUrl(URL_),
    )
  })

  it('이름 모를 Android 웹뷰(네이버앱 등)도 인텐트로 나간다', () => {
    withUserAgent(UA_ANDROID_WEBVIEW)
    render(<ShareFallbackSheet imageUrl={URL_} inAppBrowser="webview" onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: /외부 브라우저에서 이미지 열기/ })).toHaveAttribute(
      'href',
      androidIntentUrl(URL_),
    )
  })

  it('링크 복사 — 되면 «복사했어요», 클립보드가 막힌 웹뷰면 링크를 그대로 보여 준다', async () => {
    const user = userEvent.setup()
    render(<ShareFallbackSheet imageUrl={URL_} inAppBrowser={null} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '이미지 링크 복사' }))
    expect(await screen.findByRole('button', { name: '링크를 복사했어요' })).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe(URL_)

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('blocked')) },
    })
    await user.click(screen.getByRole('button', { name: '링크를 복사했어요' }))
    expect(await screen.findByRole('button', { name: /복사하지 못했어요/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(URL_)
  })
})
