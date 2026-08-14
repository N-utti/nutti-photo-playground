/**
 * 목 상태가 테스트 사이로 새지 않는지 (mocks/handlers.ts `resetMockState`).
 *
 * 이 파일은 «기능» 을 검사하지 않습니다. 검사하는 건 **다른 모든 테스트가 서 있는
 * 바닥**입니다. `handlers.ts` 의 `state` 는 모듈 수준이라 그냥 두면 파일 안의 테스트
 * 사이를 그대로 흘러가고, 그러면 결과가 실행 순서에 달립니다 — 혼자 돌리면 통과하고
 * 전체를 돌리면 깨지는(또는 그 반대인) 종류라, 원인을 찾는 데 드는 시간이 테스트를
 * 붙여서 아낀 시간을 넘깁니다.
 *
 * 그래서 `src/test/setup.ts` 의 `afterEach` 가 매번 되돌리는데, **되돌리는 코드 자체가
 * 조용히 깨질 수 있습니다.** state 에 필드가 하나 늘었는데 리셋에 안 적히는 식으로요.
 * 그때 드러나는 곳은 여기가 아니라 «왜 이 테스트만 순서를 타지» 하는 엉뚱한 파일이라,
 * 바닥이 무너진 걸 바닥에서 알 수 있게 이 파일을 둡니다.
 *
 * **아래 두 테스트는 순서에 의존합니다.** 보통은 피해야 할 모양이지만 여기서는 그게
 * 검사 대상입니다 — 첫 테스트가 일부러 상태를 어지럽히고, 둘째가 그게 안 넘어왔음을
 * 확인합니다. 순서를 바꾸면 아무것도 검사하지 않게 되니 옮기지 마세요.
 */

import { describe, expect, it } from 'vitest'

/**
 * `vite.config.ts` 의 `test.env` 가 넣어 주는 절대 URL 과 같은 곳.
 *
 * 상대 경로(`/v1`)를 쓰지 않는 건 node 의 fetch(undici)가 그걸 파싱하지 못해 요청이
 * 나가기도 전에 던지기 때문입니다. MSW 핸들러는 오리진을 와일드카드로 선언해
 * (handlers.ts 의 `BASE`) 호스트가 무엇이든 받습니다.
 */
const BASE = 'http://localhost/v1'

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE}${path}`)
  return (await response.json()) as Record<string, unknown>
}

describe('목 상태 격리', () => {
  it('로그인하고 크레딧을 받으면 그 자리에서는 반영된다', async () => {
    // 먼저 아무것도 안 한 상태인지 봅니다 — 여기가 이미 오염돼 있으면 아래가 무의미합니다.
    const before = await getJson('/auth/me')
    expect(before.kind).toBe('guest')
    const startingBalance = before.credit_balance as number

    // 목의 소셜 콜백은 프로바이더 없이 회원으로 승격시킵니다(handlers.ts `promoteToMember`).
    const loggedIn = await getJson('/auth/kakao/callback')
    expect(loggedIn.kind).toBe('member')

    /*
      `follow_ig` 를 고른 건 초기 픽스처에서 이것이 `available` 이기 때문입니다
      (fixtures.ts `initialCredits`). `daily` 는 처음부터 `tomorrow` 라 409 로 막힙니다 —
      "오늘 몫은 이미 받은 상태"가 목의 기본값입니다.

      클레임은 회원만 됩니다(403 MEMBER_ONLY). 위 로그인이 실제로 먹었는지도 겸해 봅니다.
    */
    const claim = await fetch(`${BASE}/credits/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'follow_ig' }),
    })
    expect(claim.status).toBe(200)

    const granted = (await claim.json()) as { balance: number; amount_granted: number }
    expect(granted.amount_granted).toBeGreaterThan(0)
    expect(granted.balance).toBe(startingBalance + granted.amount_granted)
  })

  it('다음 테스트는 앞의 로그인도 잔액도 물려받지 않는다', async () => {
    const me = await getJson('/auth/me')

    // 앞 테스트가 회원으로 만들어 놓고 끝났습니다. 리셋이 없으면 여기가 'member' 입니다.
    expect(me.kind).toBe('guest')
    expect(me.providers).toEqual([])

    const credits = await getJson('/credits')

    /*
      잔액과 획득 목록이 **둘 다** 돌아와야 합니다. 잔액만 되돌리고 `earn_actions` 의
      상태를 남기면 «받을 수 있는데 이미 받았다고 나오는» 목이 되어, 화면의 CTA 분기를
      테스트가 한 번도 못 밟습니다.

      앞 테스트가 `follow_ig` 를 받아 `done` 으로 만들어 놓고 끝났습니다. 게스트에게는
      모든 행이 `login_required` 로 나가므로(handlers.ts `guestAware`) 그것도 아님을
      함께 봅니다 — `done` 이 남아 있으면 리셋이 목록을 안 되돌린 것입니다.
    */
    const followIg = (credits.earn_actions as { action: string; status: string }[]).find(
      (row) => row.action === 'follow_ig',
    )
    expect(followIg?.status).toBe('login_required')
  })

  it('시나리오 강제도 다음 테스트로 넘어가지 않는다', async () => {
    /*
      시나리오는 localStorage 한 줄이라 리셋 목록에서 빠뜨리기 가장 쉽습니다. 넘어가면
      `job:fail` 을 세운 테스트 하나가 뒤따르는 job 테스트를 전부 실패 응답으로
      끌고 갑니다 — 그때 실패하는 건 원인을 만든 테스트가 아니라 애먼 뒷 테스트입니다.
    */
    expect(localStorage.getItem('nutti.mock.scenario')).toBeNull()
  })
})
