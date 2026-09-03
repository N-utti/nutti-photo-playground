/**
 * 세션 핸드오프 (app/handoff.ts) — 주소를 어떻게 만들고, 도착해서 어떻게 소진하는지.
 */
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { session } from '../api/client'
import { server } from '../test/server'
import { arrivedToShare, handoffUrl, redeemHandoffFromUrl, takeHandoffCode } from './handoff'

afterEach(() => {
  session.clear()
  window.history.replaceState(null, '', '/')
})

describe('handoff', () => {
  it('handoffUrl — 결과 화면 + 코드 + 공유 의도', () => {
    const url = new URL(handoffUrl('abc.def', 'job-1'))
    expect(url.origin).toBe(window.location.origin)
    expect(url.pathname).toBe('/jobs/job-1')
    expect(url.searchParams.get('handoff')).toBe('abc.def')
    expect(url.searchParams.get('share')).toBe('1')
  })

  it('코드가 있으면 소진해 세션으로 삼고 주소에서 코드를 지운다(share 는 남긴다)', async () => {
    server.use(
      http.post('*/v1/auth/handoff/redeem', async ({ request }) => {
        const { code } = (await request.json()) as { code: string }
        if (code !== 'good') return HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
        return HttpResponse.json({ token: 'jwt-from-handoff', refresh_token: null, member_id: 'm', kind: 'guest' })
      }),
    )
    window.history.replaceState(null, '', '/jobs/job-1?handoff=good&share=1')

    expect(await redeemHandoffFromUrl()).toBe(true)

    expect(session.token).toBe('jwt-from-handoff')
    expect(session.kind).toBe('guest')
    expect(window.location.search).toBe('?share=1')
    expect(arrivedToShare()).toBe(true)
  })

  it('코드가 거절되면(재사용·만료) false — 그래도 주소의 코드는 지운다', async () => {
    server.use(
      http.post('*/v1/auth/handoff/redeem', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    )
    window.history.replaceState(null, '', '/jobs/job-1?handoff=stale&share=1')

    expect(await redeemHandoffFromUrl()).toBe(false)

    expect(session.token).toBeNull()
    expect(new URL(window.location.href).searchParams.get('handoff')).toBeNull()
  })

  it('이미 회원이 로그인된 브라우저에서는 코드를 소진하지 않는다 — 링크로 남의 세션을 덮어쓰지 못하게', async () => {
    let redeems = 0
    server.use(
      http.post('*/v1/auth/handoff/redeem', () => {
        redeems += 1
        return HttpResponse.json({ token: 'x', refresh_token: null, member_id: 'm', kind: 'guest' })
      }),
    )
    session.set('member-jwt', 'member', 'member-refresh')
    window.history.replaceState(null, '', '/jobs/job-1?handoff=good&share=1')

    expect(await redeemHandoffFromUrl()).toBe(false)

    expect(redeems).toBe(0)
    expect(session.token).toBe('member-jwt')
    // 코드는 그래도 주소에서 지운다.
    expect(new URL(window.location.href).searchParams.get('handoff')).toBeNull()
  })

  it('takeHandoffCode 는 동기로 코드를 집어 내고 주소에서 지운다 — GA4 보다 먼저 부를 수 있게', () => {
    window.history.replaceState(null, '', '/jobs/job-1?handoff=abc&share=1')
    expect(takeHandoffCode()).toBe('abc')
    expect(window.location.search).toBe('?share=1')
    expect(takeHandoffCode()).toBeNull()
  })

  it('코드가 없으면 아무것도 하지 않는다', async () => {
    expect(await redeemHandoffFromUrl()).toBe(false)
    expect(arrivedToShare()).toBe(false)
  })
})
