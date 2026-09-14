/**
 * 인스타 DM 링크 코드의 자동 소진 (app/InstagramCodeRedeem.tsx).
 *
 * `?ig=` 는 부팅 시 localStorage 에 들어가고(app/instagramCode.ts), 링크를 누른 사람은 대개
 * 게스트라 그 자리에서는 못 씁니다. 로그인 뒤 **어느 화면에서든** 자동으로 넣어 주지 않으면
 * «링크 눌렀는데 아무 일도 없네» 가 됩니다 — 예전엔 W-10 을 열어야만 돌았습니다.
 *
 * RootLayout 의 FloatingStatus 를 그대로 렌더합니다 — 훅과 실패 카드가 그 안에서 만나므로
 * 여기서 따로 조립하면 배선 자체는 검사하지 못합니다. 목 핸들러는 기본 그대로입니다:
 * `NUTTI2026` 만 유효, 그 외 404.
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { queryKeys } from '../api/queries'
import { mockAsMember } from '../mocks/handlers'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { peekInstagramCode } from './instagramCode'
import { FloatingStatus } from './RootLayout'

const CODE_KEY = 'nutti.instagram.code'

describe('InstagramCodeRedeem', () => {
  afterEach(() => localStorage.removeItem(CODE_KEY))

  it('회원이면 저장된 코드를 한 번 소진하고 지운다 — 크레딧 화면을 열지 않아도, 말없이', async () => {
    mockAsMember()
    localStorage.setItem(CODE_KEY, 'NUTTI2026')
    const sent: unknown[] = []
    server.use(
      http.post('*/v1/credits/redeem-instagram', async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json({ balance: 13, amount_granted: 2 })
      }),
    )
    renderWithProviders(<FloatingStatus />)

    await waitFor(() => expect(sent).toEqual([{ code: 'NUTTI2026' }]))
    await waitFor(() => expect(peekInstagramCode()).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('게스트면 아무것도 보내지 않고 코드를 남겨 둔다 — 로그인 뒤에 쓸 것', async () => {
    localStorage.setItem(CODE_KEY, 'K7M2P9QX')
    let sent = 0
    server.use(
      http.post('*/v1/credits/redeem-instagram', () => {
        sent += 1
        return HttpResponse.json({ balance: 13, amount_granted: 2 })
      }),
    )
    const { queryClient } = renderWithProviders(<FloatingStatus />)

    // «안 보냈다» 를 시간으로 재지 않습니다 — /me 가 게스트로 도착한 뒤에도 안 보냈으면 안 보낸 것입니다.
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.me)).toBeDefined())
    expect(sent).toBe(0)
    expect(peekInstagramCode()).toBe('K7M2P9QX')
  })

  it('실패하면 코드를 지우고 이유를 아래 카드로 말한다 — 닫으면 사라진다', async () => {
    mockAsMember()
    localStorage.setItem(CODE_KEY, 'WRONG404')
    renderWithProviders(<FloatingStatus />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('코드가 올바르지 않거나 만료됐어요')
    expect(peekInstagramCode()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '안내 닫기' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
