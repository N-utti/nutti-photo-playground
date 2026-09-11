/**
 * 인스타 DM 링크 코드의 자동 소진 (app/InstagramCodeRedeem.tsx).
 *
 * `?ig=` 는 부팅 시 localStorage 에 들어가고(app/instagramCode.ts), 링크를 누른 사람은 대개
 * 게스트라 그 자리에서는 못 씁니다. 로그인 뒤 **어느 화면에서든** 자동으로 넣어 주지 않으면
 * «링크 눌렀는데 아무 일도 없네» 가 됩니다 — 예전엔 W-10 을 열어야만 돌았습니다.
 */

import { waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { peekInstagramCode } from './instagramCode'
import InstagramCodeRedeem from './InstagramCodeRedeem'

function me(kind: 'guest' | 'member') {
  return {
    member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
    kind,
    email: kind === 'member' ? 'member@nutti.co.kr' : null,
    nickname: kind === 'member' ? '콩이엄마' : null,
    providers: kind === 'member' ? ['kakao'] : [],
    cafe24_linked: false,
    credit_balance: 11,
  }
}

describe('InstagramCodeRedeem', () => {
  afterEach(() => localStorage.removeItem('nutti.instagram.code'))

  it('회원이면 저장된 코드를 한 번 소진하고 지운다 — 크레딧 화면을 열지 않아도', async () => {
    localStorage.setItem('nutti.instagram.code', 'K7M2P9QX')
    const sent: unknown[] = []
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(me('member'))),
      http.post('*/v1/credits/redeem-instagram', async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ balance: 13, amount_granted: 2 })
      }),
    )
    renderWithProviders(<InstagramCodeRedeem />)

    await waitFor(() => expect(sent).toEqual([{ code: 'K7M2P9QX' }]))
    await waitFor(() => expect(peekInstagramCode()).toBeNull())
  })

  it('게스트면 아무것도 보내지 않고 코드를 남겨 둔다 — 로그인 뒤에 쓸 것', async () => {
    localStorage.setItem('nutti.instagram.code', 'K7M2P9QX')
    let sent = 0
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(me('guest'))),
      http.post('*/v1/credits/redeem-instagram', () => {
        sent += 1
        return HttpResponse.json({ balance: 13, amount_granted: 2 })
      }),
    )
    renderWithProviders(<InstagramCodeRedeem />)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent).toBe(0)
    expect(peekInstagramCode()).toBe('K7M2P9QX')
  })
})
