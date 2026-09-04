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
import { SESSION_LOST_EVENT, openWhenSessionReady, request, session } from './client'

const BASE = '*/v1'

function apiError(status: number, code: string) {
  return HttpResponse.json({ error: { code, message: '', detail: {} } }, { status })
}

/** 테스트가 단 리스너를 걷는 정리 목록 — 새는 리스너는 다음 테스트의 집계를 오염시킵니다. */
const listeners: Array<() => void> = []

/**
 * SESSION_LOST 를 셉니다 — «지웠는가» 만큼 «알렸는가» 도 계약입니다.
 *
 * 이 이벤트는 이제 **회원 전용**이고, 받는 쪽이 하는 일은 안내가 아니라 게스트로
 * 내려앉히는 복구입니다(app/sessionRecovery.tsx). 그래서 «몇 번 났는가» 가 곧
 * «복구를 몇 번 트리거했는가» 입니다.
 */
function collectSessionLost(): Event[] {
  const seen: Event[] = []
  const listener = (event: Event) => {
    seen.push(event)
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
  it('지금 회원 세션의 401 이면 세션을 접고 복구를 부른다', async () => {
    server.use(http.get(`${BASE}/credits`, () => apiError(401, 'UNAUTHORIZED')))
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    await expect(request('/credits')).rejects.toThrow()

    expect(session.token).toBeNull()
    expect(lost).toHaveLength(1)
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
    // 사용자가 스스로 끝낸 세션을 두고 복구가 또 돌지 않습니다.
    expect(lost).toHaveLength(0)
  })

  it('같은 세션의 401 이 여러 갈래로 와도 한 번만 부른다', async () => {
    server.use(http.get(`${BASE}/credits`, () => apiError(401, 'UNAUTHORIZED')))
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    const all = [request('/credits'), request('/credits'), request('/credits')]

    await Promise.allSettled(all)

    expect(session.token).toBeNull()
    expect(lost).toHaveLength(1)
  })
})

/**
 * 게스트의 401 — **사용자를 세워 놓지 않는다**.
 *
 * 예전에는 게스트도 회원과 같이 세션 상실로 알려서, 화면 맨 위에 「세션이 만료됐어요 ·
 * 새로 시작하기」 배너가 떴습니다. 그 배너가 물은 건 선택지가 하나뿐인 질문이었습니다 —
 * 거절당한 토큰으로는 이전 결과를 어차피 못 열고, 되찾을 다른 길도 없어서 누를 수 있는
 * 버튼이 하나였습니다. 그래서 지금은 요청 계층이 조용히 갈아 끼웁니다.
 *
 * 조용해진 만큼 깨져도 티가 안 납니다. 누가 이 경로를 되돌리거나 재시도 한도를 빼도
 * 화면은 «불러오지 못했어요» 하나로 똑같이 보입니다 — 그래서 **요청이 몇 번 나갔고
 * 어떤 토큰을 달고 나갔는지**를 여기서 셉니다.
 */
describe('게스트 401 자동 복구', () => {
  /** 새 게스트를 내주는 발급 엔드포인트. 몇 번 불렸는지가 곧 «몇 명 태어났는가» 입니다. */
  function guestIssuer(token: string) {
    const issued: string[] = []
    server.use(
      http.post(`${BASE}/auth/guest`, () => {
        issued.push(token)
        return HttpResponse.json({ token, member_id: 'm-new', kind: 'guest' })
      }),
    )
    return issued
  }

  it('갈아 끼운 새 게스트로 원요청을 다시 보내고, 사용자에게 말하지 않는다', async () => {
    const sent: Array<string | null> = []
    server.use(
      http.get(`${BASE}/credits`, ({ request: sentRequest }) => {
        const auth = sentRequest.headers.get('Authorization')
        sent.push(auth)
        // 죽은 토큰에만 401. 새 토큰으로 다시 오면 정상 응답입니다.
        return auth === 'Bearer guest-dead'
          ? apiError(401, 'UNAUTHORIZED')
          : HttpResponse.json({ balance: 3 })
      }),
    )
    const issued = guestIssuer('guest-fresh')
    const lost = collectSessionLost()
    session.set('guest-dead', 'guest')

    await expect(request('/credits')).resolves.toEqual({ balance: 3 })

    // 원요청이 죽은 토큰 → 새 토큰 순으로 두 번 나갔습니다. 재시도를 빼면 여기가
    // 한 줄로 줄고, 화면은 이유 없이 «불러오지 못했어요» 가 됩니다.
    expect(sent).toEqual(['Bearer guest-dead', 'Bearer guest-fresh'])
    expect(issued).toHaveLength(1)
    expect(session.token).toBe('guest-fresh')
    // 사용자에게 물어볼 것이 없으므로 상실을 알리지 않습니다.
    expect(lost).toHaveLength(0)
  })

  it('그 사이 로그인이 끝났으면 새 게스트로 덮어쓰지 않는다', async () => {
    server.use(http.get(`${BASE}/credits`, () => apiError(401, 'UNAUTHORIZED')))
    const issued = guestIssuer('guest-fresh')
    session.set('guest-dead', 'guest')

    // 요청이 날아가는 사이 사용자가 로그인을 마친 상태.
    const inFlight = request('/credits')
    session.set('member-token', 'member', 'member-refresh')

    await expect(inFlight).rejects.toThrow()

    // 방금 로그인한 사람이 이유 없이 게스트로 내려앉으면 안 됩니다.
    expect(issued).toHaveLength(0)
    expect(session.token).toBe('member-token')
  })

  it('갓 받은 토큰까지 거절당하면 되풀이하지 않고 접는다', async () => {
    let hits = 0
    server.use(
      http.get(`${BASE}/credits`, () => {
        hits += 1
        return apiError(401, 'UNAUTHORIZED')
      }),
    )
    const issued = guestIssuer('guest-fresh')
    session.set('guest-dead', 'guest')

    await expect(request('/credits')).rejects.toThrow()

    // 세션 문제가 아니라 서버 쪽 고장입니다 — 여기서 또 발급받으면 한 번의 조회가
    // IP 당 시간당 한도(30회)를 계속 태웁니다.
    expect(hits).toBe(2)
    expect(issued).toHaveLength(1)
    // 죽은 토큰을 남겨 두면 `ensureSession()` 이 «이미 있다» 며 지나가서 새로고침해도
    // 같은 401 입니다.
    expect(session.token).toBeNull()
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
    expect(lost).toHaveLength(0)
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
    expect(lost).toHaveLength(0)
  })

  it('회전이 진짜로 거절되면 세션을 접고 복구를 부른다', async () => {
    server.use(
      http.get(`${BASE}/credits`, () => apiError(401, 'TOKEN_EXPIRED')),
      http.post(`${BASE}/auth/refresh`, () => apiError(401, 'UNAUTHORIZED')),
    )
    const lost = collectSessionLost()
    session.set('member-token', 'member', 'member-refresh')

    await expect(request('/credits')).rejects.toThrow()

    expect(session.token).toBeNull()
    expect(lost).toHaveLength(1)
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
    // 도는 로딩만 보입니다 — 401 을 받고 안내로 사유를 듣는 편이 낫습니다.
    openWhenSessionReady(Promise.reject(new Error('RATE_LIMITED')))

    await expect(request('/credits')).resolves.toBeTruthy()
  })
})
