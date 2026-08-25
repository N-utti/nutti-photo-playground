/**
 * 요청 계층의 401 처리 — **세션을 언제 버리고 언제 안 버리는가**.
 *
 * 화면 테스트로는 세울 수 없는 것만 여기 둡니다. 여기서 다루는 건 응답의 내용이 아니라
 * **요청 사이의 순서**라 목 핸들러로는 재현되지 않습니다(mocks/handlers.ts 의 logout 주석).
 *
 * 백엔드 PR #119(이슈 #11 M6)로 로그아웃이 `member.token_version` 을 올려 발급된 액세스를
 * 즉시 전부 무효화하면서, 「한 번 유효했던 토큰이 남은 수명 안에 401 이 되는」 창이
 * 처음 생겼습니다. 그래서 «뒤늦게 도착한 401» 이 정상 경로가 됐고, 그걸 지금 세션의
 * 소식으로 오해하면 로그아웃 한 번이 앱을 토큰 없는 상태로 멈춰 세웁니다.
 */

import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { SESSION_LOST_EVENT, request, session, type SessionLostDetail } from './client'

const BASE = '*/v1'

function apiError(status: number, code: string) {
  return HttpResponse.json({ error: { code, message: '', detail: {} } }, { status })
}

/** 테스트가 단 리스너를 걷는 정리 목록 — 새는 리스너는 다음 테스트의 집계를 오염시킵니다. */
const listeners: Array<() => void> = []

/** SESSION_LOST 를 모아 둡니다 — «지웠는가» 만큼 «알렸는가» 도 계약입니다. */
function collectSessionLost(): SessionLostDetail[] {
  const seen: SessionLostDetail[] = []
  const listener = (event: Event) => {
    seen.push((event as CustomEvent<SessionLostDetail>).detail)
  }
  window.addEventListener(SESSION_LOST_EVENT, listener)
  listeners.push(() => window.removeEventListener(SESSION_LOST_EVENT, listener))
  return seen
}

beforeEach(() => {
  session.clear()
})

afterEach(() => {
  for (const off of listeners.splice(0)) off()
  session.clear()
})

describe('401 UNAUTHORIZED', () => {
  it('지금 세션의 401 이면 세션을 접고 화면에 알린다', async () => {
    server.use(http.get(`${BASE}/credits`, () => apiError(401, 'UNAUTHORIZED')))
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    await expect(request('/credits')).rejects.toThrow()

    expect(session.token).toBeNull()
    expect(lost).toEqual([{ kind: 'member' }])
  })

  it('로그아웃으로 갈린 뒤 도착한 401 은 새 게스트를 지우지 않는다', async () => {
    server.use(http.get(`${BASE}/credits`, () => apiError(401, 'UNAUTHORIZED')))
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    // 조회를 띄운 **직후** 로그아웃이 끝나 새 게스트가 선 상태
    // (api/queries.ts `useLogout` = 서버 폐기 → session.clear() → ensureSession()).
    const inFlight = request('/credits')
    session.set('guest-token', 'guest')

    await expect(inFlight).rejects.toThrow()

    // 죽은 건 member-token 이고, 저장소의 guest-token 은 그 401 과 무관합니다.
    expect(session.token).toBe('guest-token')
    expect(session.kind).toBe('guest')
    // 사용자가 스스로 끝낸 세션을 두고 «로그인이 만료됐어요» 를 띄우지 않습니다.
    expect(lost).toEqual([])
  })

  it('같은 세션의 401 이 여러 갈래로 와도 한 번만 알린다', async () => {
    server.use(http.get(`${BASE}/credits`, () => apiError(401, 'UNAUTHORIZED')))
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    const all = [request('/credits'), request('/credits'), request('/credits')]

    await Promise.allSettled(all)

    expect(session.token).toBeNull()
    expect(lost).toEqual([{ kind: 'member' }])
  })
})

describe('리프레시 회전', () => {
  it('회전 중에 로그아웃이 끝났으면 회전 실패로 새 게스트를 지우지 않는다', async () => {
    server.use(
      http.get(`${BASE}/credits`, () => apiError(401, 'TOKEN_EXPIRED')),
      /*
        회전이 서버에 가 있는 사이 사용자가 로그아웃을 마친 상황입니다. 로그아웃이
        리프레시를 폐기했으므로 이 회전은 401 로 끝나는데, 그때 저장소에는 이미 새
        게스트가 서 있습니다 — 핸들러 안에서 갈아 끼워 그 사이를 재현합니다.
      */
      http.post(`${BASE}/auth/refresh`, () => {
        session.set('guest-token', 'guest')
        return apiError(401, 'UNAUTHORIZED')
      }),
    )
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    await expect(request('/credits')).rejects.toThrow()

    expect(session.token).toBe('guest-token')
    expect(lost).toEqual([])
  })

  it('회전이 진짜로 거절되면 세션을 접고 재로그인을 알린다', async () => {
    server.use(
      http.get(`${BASE}/credits`, () => apiError(401, 'TOKEN_EXPIRED')),
      http.post(`${BASE}/auth/refresh`, () => apiError(401, 'UNAUTHORIZED')),
    )
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    await expect(request('/credits')).rejects.toThrow()

    expect(session.token).toBeNull()
    expect(lost).toEqual([{ kind: 'member' }])
  })
})
