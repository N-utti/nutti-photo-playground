/**
 * W-12 · 마이페이지 (screens/W12MyPage.tsx · 이슈 #12).
 *
 * 다섯 섹션짜리 화면이라 전부 훑지 않고 **틀렸을 때 조용한 것** 둘만 좁게 봅니다.
 *
 * 하나는 뒤로가기 목적지입니다. 이 화면은 진입점이 둘이라(앱바 아바타 · W-04 「저장된
 * 강아지 · 관리」) `state.from` 으로 돌아갈 곳을 받는데, **히스토리 state 는 신뢰할 수
 * 없는 입력**입니다. 걸러내지 않으면 «뒤로» 가 외부 사이트로 나가는 길이 됩니다.
 *
 * 다른 하나는 받은 내역 미리보기가 실패했을 때입니다. 잔액과 강아지 목록이 함께 있는
 * 화면에서 부가 정보 하나 때문에 빨간 경고를 띄우면 계정에 문제가 생긴 것처럼 읽힙니다.
 * 조용히 접는 게 결정인데, 리팩터링에 가장 잘 날아가는 종류입니다 — «에러 처리가 없네» 로
 * 보여서 친절하게 추가되기 쉽습니다.
 *
 * 게스트/회원 분기는 목 **내부** 상태(`state.me`)가 정하므로 응답을 덮어씁니다. 실제로
 * 로그인시키면 그 상태가 남아 뒤따르는 테스트가 회원으로 시작합니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W12MyPage from './W12MyPage'

function asMember() {
  server.use(
    http.get('*/v1/auth/me', () =>
      HttpResponse.json({
        member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
        kind: 'member',
        email: 'kong@nutti.co.kr',
        nickname: '콩이엄마',
        providers: ['kakao'],
        cafe24_linked: false,
        credit_balance: 11,
      }),
    ),
  )
}

/**
 * `state.from` 을 실은 채로 세우고 ← 를 누릅니다.
 *
 * ← 는 링크가 아니라 버튼이라(app/BackButton.tsx) 목적지를 속성으로 읽을 수 없습니다.
 * 눌러서 **어디에 도착하는지**로 확인하는 게 실제 동작에 더 가깝기도 합니다.
 *
 * `MemoryRouter` 에는 히스토리가 하나뿐이라 BackButton 이 «뒤에 우리 화면이 없다» 로
 * 판정하고 `fallback` 을 씁니다 — 그 `fallback` 이 곧 `useBackTarget()` 의 결과입니다.
 */
async function pressBackFrom(from: unknown): Promise<void> {
  const user = userEvent.setup()
  renderWithProviders(
    <Routes>
      <Route path="/me" element={<W12MyPage />} />
      <Route path="/upload" element={<h1>업로드 화면</h1>} />
      <Route path="/styles" element={<h1>스타일 카탈로그</h1>} />
    </Routes>,
    { route: { pathname: '/me', state: { from } } },
  )

  await user.click(await screen.findByRole('button', { name: '뒤로' }))
}

describe('W-12 · 뒤로가기 목적지', () => {
  it('앱 안의 주소면 그리로 돌아간다', async () => {
    /*
      W-04 「저장된 강아지 · 관리」로 들어온 경우입니다. 고르던 스타일(`?style_id=`)이
      붙은 주소로 돌려보내야 하던 작업을 이어갑니다.
    */
    asMember()
    await pressBackFrom('/upload?style_id=8')

    expect(await screen.findByRole('heading', { name: '업로드 화면' })).toBeInTheDocument()
  })

  it('외부 주소는 무시하고 앱 안으로 돌려보낸다', async () => {
    /*
      **이 파일의 핵심입니다.** 히스토리 state 는 우리가 넣은 값이라는 보장이 없습니다.
      그대로 믿고 이동하면 「뒤로」가 외부 사이트로 나가는 길이 됩니다 — 그 사이트가
      우리 화면을 흉내 내면 사용자는 나갔다는 것도 모릅니다.
    */
    asMember()
    await pressBackFrom('https://evil.example')

    expect(await screen.findByRole('heading', { name: '스타일 카탈로그' })).toBeInTheDocument()
  })

  it('스킴 없는 외부 주소(//)도 막는다', async () => {
    /*
      `//evil.example` 은 스킴 없는 절대 URL 입니다. «`/` 로 시작하는가» 만 보는 검사는
      이걸 통과시키므로 따로 셉니다 — 앱 내부 경로 판정에서 가장 흔히 새는 형태입니다.
    */
    asMember()
    await pressBackFrom('//evil.example')

    expect(await screen.findByRole('heading', { name: '스타일 카탈로그' })).toBeInTheDocument()
  })

  it('값이 문자열이 아니어도 넘어가지 않는다', async () => {
    // 히스토리 state 는 임의의 값이 올 수 있습니다 — 타입만 믿고 쓰면 여기서 터집니다.
    asMember()
    await pressBackFrom({ nested: 'object' })

    expect(await screen.findByRole('heading', { name: '스타일 카탈로그' })).toBeInTheDocument()
  })
})

describe('W-12 · 받은 내역 미리보기', () => {
  it('불러오면 최근 줄을 보여 준다', async () => {
    asMember()
    renderWithProviders(
      <Routes>
        <Route path="/me" element={<W12MyPage />} />
      </Routes>,
      { route: '/me' },
    )

    // 사유 라벨은 W-10 B 와 같은 규칙을 씁니다(app/ledgerFormat).
    expect(await screen.findByText('주문 확인')).toBeInTheDocument()
  })

  it('실패하면 빨간 경고 대신 조용히 접는다', async () => {
    /*
      잔액·강아지 목록과 나란히 있는 자리라, 부가 정보 하나가 실패했다고 경고를 띄우면
      계정 자체에 문제가 생긴 것처럼 읽힙니다. 「전체 보기」가 살아 있어 막다른 길도
      아닙니다 — 재시도 버튼이 필요한 자리는 W-10 B 입니다.
    */
    asMember()
    server.use(
      http.get('*/v1/credits/ledger', () =>
        HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 500 }),
      ),
    )
    renderWithProviders(
      <Routes>
        <Route path="/me" element={<W12MyPage />} />
      </Routes>,
      { route: '/me' },
    )

    // 화면 자체는 정상적으로 서 있어야 합니다.
    expect(await screen.findByText('보유 크레딧')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '전체 보기' })).toBeInTheDocument()
    // 내역 실패를 알리는 경고는 없습니다.
    expect(screen.queryByText(/내역을 불러오지 못했어요/)).not.toBeInTheDocument()
  })
})

describe('W-12 · 게스트', () => {
  it('게스트에게는 관리 대신 로그인 한 걸음을 제안한다', async () => {
    /*
      앱바 진입점은 게스트에게 아바타를 보여주지 않지만 URL 은 막을 수 없습니다.
      «잃는 것» 이 아니라 «이어 쓰는 것» 으로 말합니다 — 게스트도 크레딧과 결과를
      이미 갖고 있고, 로그인하면 병합됩니다(UC-07).
    */
    renderWithProviders(
      <Routes>
        <Route path="/me" element={<W12MyPage />} />
      </Routes>,
      { route: '/me' },
    )

    expect(await screen.findByText('아직 로그인 전이에요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인하고 이어서 쓰기' })).toBeInTheDocument()
    // 게스트에게 로그아웃·펫 관리를 보여 주면 없는 계정을 있는 것처럼 말하게 됩니다.
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
  })
})
