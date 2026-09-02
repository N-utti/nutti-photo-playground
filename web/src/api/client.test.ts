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
import {
  SESSION_LOST_EVENT,
  openWhenSessionReady,
  request,
  session,
  type SessionLostDetail,
} from './client'

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

/**
 * 위 첫 테스트가 이미 증명한 것: 401 `UNAUTHORIZED` 는 세션을 접습니다. `/admin/*` 의
 * 401 이 정확히 그 코드라(백엔드 PR #181 — admin 토큰과 사용자 토큰은 상호 배타)
 * 콘솔을 이 클라이언트에 얹으면 **호출 한 번이 사용자를 로그아웃시킵니다.** 그래서
 * 여기서 막는 것은 401 처리가 아니라 **요청이 나가는 것 자체**입니다.
 */
describe('/admin/* 차단', () => {
  it('세션을 죽일 401 핸들러가 있어도 요청이 거기 닿지 않는다', async () => {
    let hits = 0
    server.use(
      http.get(`${BASE}/admin/styles`, () => {
        hits += 1
        return apiError(401, 'UNAUTHORIZED')
      }),
    )
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    await expect(request('/admin/styles')).rejects.toThrow(/별도 클라이언트/)

    // 닿았다면 위 «지금 세션의 401» 테스트와 같은 결말이었습니다.
    expect(hits).toBe(0)
    expect(session.token).toBe('member-token')
    expect(lost).toEqual([])
  })

  it('로그인·쓰기 경로도 같이 막는다', async () => {
    session.set('member-token', 'member', 'member-refresh')

    await expect(
      request('/admin/login', { method: 'POST', json: { email: 'a@b.c', password: 'x' } }),
    ).rejects.toThrow(/별도 클라이언트/)
    await expect(request('/admin/styles/1', { method: 'PATCH', json: {} })).rejects.toThrow()

    expect(session.token).toBe('member-token')
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

/**
 * 부팅 관문 — **첫 페인트를 인증에서 떼어 놓은 대가를 누가 치르는가**.
 *
 * 예전에는 `main.tsx` 가 `await ensureSession()` 한 뒤에 렌더했습니다. 토큰 없이 나간
 * 요청이 401 로 돌아오는 걸 막는 방법이었는데, 그 대가로 게스트 발급이 왕복하는 내내
 * 화면이 비어 있었습니다. 지금은 렌더가 먼저 나가고 **요청**이 관문 앞에서 기다립니다.
 *
 * 이 맞바꿈은 조용히 되돌아갑니다. 누가 `request()` 의 관문 한 줄을 지우거나
 * `main.tsx` 에서 `openWhenSessionReady()` 를 빼도 화면은 멀쩡히 뜨고, 목 위에서는
 * 발급이 워낙 빨라 경합이 거의 안 납니다 — 실서버 모바일 회선에서 첫 방문자만
 * 401 을 받습니다. 그래서 화면이 아니라 **요청이 나간 시점**을 여기서 셉니다.
 */
describe('부팅 관문', () => {
  /** 관문을 손으로 여는 테스트라, 열지 못한 채 끝나면 다음 테스트가 통째로 멈춥니다. */
  afterEach(async () => {
    openWhenSessionReady(Promise.resolve())
    await Promise.resolve()
  })

  /** 목 요청이 실제로 나갈 틈을 줍니다 — 마이크로태스크 한 바퀴로는 부족합니다. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('관문이 열리기 전에는 요청이 나가지 않는다', async () => {
    const sent: Array<string | null> = []
    server.use(
      http.get(`${BASE}/credits`, ({ request: sentRequest }) => {
        sent.push(sentRequest.headers.get('Authorization'))
        return HttpResponse.json({ balance: 0 })
      }),
    )

    let openGate!: () => void
    openWhenSessionReady(
      new Promise<void>((resolve) => {
        openGate = resolve
      }),
    )

    // 아직 토큰이 없는 상태. 관문이 없으면 여기서 헤더 없이 나가 401 을 받습니다.
    const inFlight = request('/credits')
    await settle()
    expect(sent, '관문이 닫혀 있는데 요청이 나갔습니다').toEqual([])

    // 부팅이 끝나는 순간 = 토큰이 서고 관문이 열리는 순간.
    session.set('guest-token', 'guest')
    openGate()
    await inFlight

    // 기다린 보람은 헤더에 있습니다 — 관문을 지우면 여기가 `[null]` 이 됩니다.
    expect(sent).toEqual(['Bearer guest-token'])
  })

  it('발급이 실패해도 관문은 열린다', async () => {
    server.use(http.get(`${BASE}/credits`, () => HttpResponse.json({ balance: 0 })))

    // 429 로 발급이 막힌 경우. 여기서 관문이 닫힌 채 남으면 사용자에게는 영원히
    // 도는 로딩만 보입니다 — 401 을 받고 배너로 사유를 듣는 편이 낫습니다.
    openWhenSessionReady(Promise.reject(new Error('RATE_LIMITED')))

    await expect(request('/credits')).resolves.toBeTruthy()
  })
})
