/**
 * 「팔로우하러 가기」의 **탭 영역** (screens/EarnActionList.tsx).
 *
 * 막으려는 결함: 글자 상자가 84×16px 이라 WCAG 2.5.8(AA)의 최소 24×24 를 세로로 못
 * 넘겼습니다(2026-09-03 play.nutti.co.kr 실측 · 로그인 상태 /credits).
 *
 * 이 줄에서만 유독 아픈 이유는 순서 때문입니다 — 서버가 «열고 나서 받았는지» 를
 * 열기 이벤트 시각으로 판정하므로(`app/routers/credits.py` `_verify_follow_ig`),
 * 이 링크를 먼저 못 누르면 옆의 「받기」는 400 FOLLOW_IG_NOT_OPENED 로 끝납니다.
 * 손이 큰 사람에게는 크레딧을 받는 길이 통째로 막히는 셈입니다.
 *
 * 검사가 클래스인 이유: 탭 영역은 `::after` 로 넓히는데(글자를 키우거나 padding 을
 * 주면 «제목 첫 줄에 맞춘다» 는 배치가 깨집니다) jsdom 에는 레이아웃이 없어서
 * getBoundingClientRect 로는 0 만 나옵니다. `app/BackButton.test.tsx` 가 같은 수를
 * 같은 방식으로 지키고 있고, 실제 크기는 브라우저에서 잽니다(84×28 · localhost:5191).
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import EarnActionList from './EarnActionList'

/**
 * 회원 상태로 봅니다 — 게스트에게는 이 자리가 「로그인」이라 링크 자체가 없습니다
 * (`EarnActionList.test.tsx` asMember 와 같은 이유로 두 응답을 함께 세웁니다).
 */
function asMember() {
  server.use(
    http.get('*/v1/auth/me', () =>
      HttpResponse.json({ kind: 'member', nickname: '콩이엄마', providers: ['kakao'] }),
    ),
    http.get('*/v1/credits', () =>
      HttpResponse.json({
        balance: 11,
        earn_actions: [{ action: 'follow_ig', amount: 2, status: 'available', cta: '받기' }],
      }),
    ),
  )
}

describe('EarnActionList · 팔로우 링크 탭 영역 (WCAG 2.5.8)', () => {
  it('글자 상자 밖으로 세로 탭 영역을 넓혀 둔다', async () => {
    asMember()
    renderWithProviders(<EarnActionList />)

    const link = await screen.findByRole('link', { name: '팔로우하러 가기' })

    /*
      네 조각이 모두 있어야 넓어집니다: 기준 상자(relative) · 그려지는 가짜
      요소(content-['']) · 띄우기(absolute) · 세로 확장(-inset-y-1.5 → 위아래 6px).
      하나만 빠져도 탭 영역은 원래의 84×16 으로 돌아갑니다.
    */
    expect(link).toHaveClass('relative')
    expect(link).toHaveClass("after:content-['']")
    expect(link).toHaveClass('after:absolute')
    expect(link).toHaveClass('after:-inset-y-1.5')
    // 가로는 이미 84px 이라 넓힐 필요가 없습니다 — 옆줄 버튼을 덮지 않게 0 으로 둡니다.
    expect(link).toHaveClass('after:inset-x-0')
  })
})
