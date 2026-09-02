/**
 * 획득 보상 금액이 **문장 안에서도** 서버값인지 (app/earnAmount.ts).
 *
 * 목의 `link_account_amount` 가 3 이라, 화면이 리터럴 「+3」을 그려도 기존 테스트는 전부
 * 통과합니다 — 셀렉터가 `'연동하고 +3 받기'` 라서 배선이 있든 없든 같은 글자가 나옵니다.
 * 그래서 여기서는 **3 이 아닌 서버**를 세웁니다. 그게 이 배선을 밟는 유일한 방법입니다.
 *
 * 왜 이제 필요한가: `app_setting` 은 시드도 마이그레이션도 건드리지 않아 그동안 사실상
 * 상수였습니다. 백엔드 PR #186 의 `PATCH /v1/admin/settings/{key}` 가 이 테이블의 첫 쓰기
 * 경로라, 오늘부터 운영이 이 숫자를 바꿉니다. 값이 갈리는 순간 목록 줄은 서버값이고
 * 시트·마이페이지만 옛 숫자를 말하는데, 둘은 **같은 흐름 안에서 연달아 보이는 화면**이라
 * 사용자에게는 한 화면이 자기 자신을 반박하는 것으로 보입니다.
 *
 * 마지막 케이스는 반대쪽입니다 — 모르는 동안 숫자를 지어내지 않는지. 응답 전에 3 을
 * 그려 두면 화면이 먼저 단정하고 나중에 정정하는데, 「받을 금액」에서 정정은 약속 파기로
 * 읽힙니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import EarnActionList from '../screens/EarnActionList'
import W12MyPage from '../screens/W12MyPage'

/** 운영이 연동 +5 · 주문 +30 으로 올려 둔 서버. */
function withAmounts({ link = 5, order = 30 }: { link?: number; order?: number } = {}) {
  server.use(
    http.get('*/v1/credits', () =>
      HttpResponse.json({
        balance: 11,
        custom_prompt_credit_cost: 2,
        earn_actions: [
          { action: 'order', amount: order, status: 'available', cta: '쇼핑몰 →' },
          { action: 'link_account', amount: link, status: 'available', cta: '연동하기' },
          { action: 'follow_ig', amount: 2, status: 'available', cta: '받기' },
          { action: 'daily', amount: 1, status: 'tomorrow', cta: '내일 다시' },
        ],
      }),
    ),
  )
}

function asMember({ cafe24Linked = false }: { cafe24Linked?: boolean } = {}) {
  server.use(
    http.get('*/v1/auth/me', () =>
      HttpResponse.json({
        member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
        kind: 'member',
        email: 'kong@nutti.co.kr',
        nickname: '콩이엄마',
        providers: ['kakao'],
        cafe24_linked: cafe24Linked,
        credit_balance: 11,
      }),
    ),
  )
}

describe('W-10 · 연동 흐름의 금액은 한 출처에서 나온다', () => {
  it('목록 줄과 연동 시트가 같은 금액을 말한다', async () => {
    asMember()
    withAmounts()
    server.use(
      http.post('*/v1/auth/cafe24/link/request', () =>
        HttpResponse.json({ sent: true, expires_in: 300 }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<EarnActionList />)

    // 목록 줄 — 여기는 전부터 서버값이었습니다(`+{row.amount}`).
    expect(await screen.findByText(/쇼핑몰 계정 연동/)).toHaveTextContent('+5')

    await user.click(screen.getByRole('button', { name: '연동하기' }))
    await user.type(screen.getByLabelText('쇼핑몰 가입 휴대폰 번호'), '01057731879')
    await user.click(screen.getByRole('button', { name: '인증번호 받기' }))

    // 시트의 제출 버튼 — 리터럴이던 자리. 「+3」이 남아 있으면 여기서 걸립니다.
    expect(await screen.findByRole('button', { name: '연동하고 +5 받기' })).toBeInTheDocument()
  })

  it('로그인 시트도 서버가 말한 금액을 약속한다', async () => {
    /*
      `loginSheet === 'link'` 는 좁은 갈래입니다 — 서버 목록은 「연동하기」(회원 목록이
      캐시에 남음)인데 `/auth/me` 는 게스트인, 화면과 서버가 어긋난 순간뿐입니다
      (EarnActionList 의 MEMBER_ONLY 주석과 같은 상황). 목이 그 어긋남을 만들 수 있어서
      밟을 수 있고, 여기가 금액을 문장 안에 넣는 자리라 같이 봅니다.
    */
    withAmounts({ link: 5 })
    const user = userEvent.setup()
    renderWithProviders(<EarnActionList />)

    await user.click(await screen.findByRole('button', { name: '연동하기' }))

    expect(
      screen.getByText('쇼핑몰 계정 연동은 회원만 할 수 있어요. 로그인 후 연동하면 +5 크레딧을 받아요.'),
    ).toBeInTheDocument()
  })
})

describe('W-12 · 마이페이지도 같은 값을 읽는다', () => {
  it('미연동이면 연동 보상과 주문 보상 둘 다 서버값이다', async () => {
    asMember()
    withAmounts()
    renderWithProviders(<W12MyPage />, { route: { pathname: '/me' } })

    expect(
      await screen.findByText('연동하면 +5 크레딧을 받고, 이후 주문은 +30씩 자동으로 쌓여요.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '연동하고 +5 받기' })).toBeInTheDocument()
  })

  it('연동된 회원에게는 주문 보상을 서버값으로 말한다', async () => {
    asMember({ cafe24Linked: true })
    withAmounts()
    renderWithProviders(<W12MyPage />, { route: { pathname: '/me' } })

    expect(await screen.findByText(/누띠에서 주문하면 \+30 크레딧이 자동으로 들어와요\./)).toBeInTheDocument()
  })

  it('아직 모르는 동안에는 숫자를 적지 않는다', async () => {
    /*
      금액이 빠진 문장은 「얼마인지 아직 모른다」로 읽히지만, 틀린 금액은 거짓말로
      읽힙니다. 버튼 폴백이 「연동하기」가 아닌 이유는 그게 W-10 목록 줄의 서버 CTA 와
      같은 글자여서, 시트가 열린 동안 같은 이름의 버튼이 둘이 되기 때문입니다.
    */
    asMember()
    server.use(http.get('*/v1/credits', async () => { await delay('infinite') }))
    renderWithProviders(<W12MyPage />, { route: { pathname: '/me' } })

    expect(
      await screen.findByText('연동하면 크레딧을 받고, 이후 주문에도 자동으로 쌓여요.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '쇼핑몰 계정 연동하기' })).toBeInTheDocument()
  })
})
