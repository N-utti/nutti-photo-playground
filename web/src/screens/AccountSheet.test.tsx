/**
 * 로그인 시트의 오류 문구와 모드 전환 (screens/AccountSheet.tsx).
 *
 * 포커스 가둠은 `app/useModalDialog.test.tsx` 가 이미 봅니다. 여기서는 **사용자가 막혔을
 * 때 무엇을 읽는가**만 봅니다.
 *
 * 서버 오류 코드를 그대로 흘리면 영문 메시지가 시트에 뜨고, 사용자는 자기가 뭘 잘못했는지
 * 알 수 없습니다. 특히 `RATE_LIMITED` 는 «얼마나 기다려야 하는가» 가 답의 전부인데 그
 * 숫자는 `Retry-After` 헤더에만 있습니다 — 문구 조립이 어긋나면 "잠시 뒤"로 뭉개져
 * 사용자가 30초마다 다시 눌러 보게 됩니다.
 *
 * 브라우저로 재현하기 가장 나쁜 종류이기도 합니다. 실제로 막히려면 요청을 수십 번 보내야
 * 하고, 확인하고 나면 다음 시도까지 15분을 기다려야 합니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, delay, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import AccountSheet from './AccountSheet'

/** 이메일·비밀번호를 채우고 제출합니다. 기본값은 클라이언트 검증을 통과하는 값입니다. */
async function submitForm(
  user: ReturnType<typeof userEvent.setup>,
  { email = 'kong@nutti.co.kr', password = 'password123' } = {},
) {
  await user.type(screen.getByLabelText('이메일'), email)
  await user.type(screen.getByLabelText(/비밀번호/), password)
  // 제출 버튼 문구는 모드에 따라 «로그인» / «가입하고 시작하기» 로 갈립니다.
  await user.click(screen.getByRole('button', { name: /^(로그인|가입하고 시작하기)$/ }))
}

describe('AccountSheet · 오류 문구', () => {
  it('레이트리밋은 얼마나 기다려야 하는지 말한다', async () => {
    /*
      **이 파일의 핵심입니다.** 「잠시 뒤」로 뭉개면 사용자는 30초마다 다시 눌러 보고,
      그때마다 같은 429 를 맞습니다. 서버가 초를 내려줄 때는 그걸 사람 말로 옮겨야
      합니다(app/retryAfter.ts — 900초 → «약 15분 뒤»).
    */
    server.use(
      http.post('*/v1/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'too many requests' } },
          { status: 429, headers: { 'Retry-After': '900' } },
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await submitForm(user)

    const alert = await screen.findByText(/로그인 시도가 너무 많았어요/)
    expect(alert).toHaveTextContent('약 15분 뒤')
    // 서버 영문 메시지가 새어 나가면 안 됩니다.
    expect(alert).not.toHaveTextContent('too many requests')
  })

  it('비밀번호가 틀리면 무엇이 틀렸는지만 말한다', async () => {
    /*
      «이메일 또는 비밀번호» 로 뭉치는 건 의도입니다 — 어느 쪽이 틀렸는지 알려 주면
      가입 여부를 확인하는 통로가 됩니다.
    */
    server.use(
      http.post('*/v1/auth/login', () =>
        HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS' } }, { status: 401 }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await submitForm(user)

    expect(await screen.findByText('이메일 또는 비밀번호가 맞지 않아요.')).toBeInTheDocument()
  })

  it('이미 가입된 이메일이면 로그인으로 가라고 안내한다', async () => {
    // 막고 끝내면 사용자는 다른 이메일로 계정을 하나 더 만듭니다 — 계정 중복의 전형입니다.
    server.use(
      http.post('*/v1/auth/register', () =>
        HttpResponse.json({ error: { code: 'EMAIL_TAKEN' } }, { status: 409 }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: '가입' }))
    await submitForm(user)

    expect(await screen.findByText(/이미 가입된 이메일이에요/)).toBeInTheDocument()
  })
})

describe('AccountSheet · 입력 검증', () => {
  it('짧은 비밀번호는 서버에 보내지 않는다', async () => {
    /*
      왕복 한 번을 아끼는 것보다, **레이트리밋을 소진하지 않는 것**이 중요합니다.
      8자 미만이 확실히 거절될 요청이라면 그걸로 시도 횟수를 쓸 이유가 없습니다.
    */
    const sent = vi.fn()
    server.use(
      http.post('*/v1/auth/login', () => {
        sent()
        return HttpResponse.json({})
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await submitForm(user, { password: 'short' })

    expect(await screen.findByText(/비밀번호는 8~/)).toBeInTheDocument()
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('AccountSheet · 소셜 진행 표시', () => {
  it('카카오를 누르면 네이버는 눌린 것처럼 보이지 않는다', async () => {
    /*
      두 버튼이 `useAuthorizeRedirect()` mutation 하나를 공유합니다. 예전에는 그
      `isPending` 을 두 버튼 모두의 `disabled:opacity-50` 이 받아서, 카카오를 누르면
      **네이버까지 같이 흐려졌습니다** — 폰에서 두 개가 같이 눌린 것처럼 보인 원인입니다.

      프로바이더로 나가는 동안 다른 쪽을 못 누르게 막는 것(`disabled`)은 맞습니다.
      OAuth 를 두 번 시작하면 안 되니까요. 여기서 가르는 것은 **못 누른다는 사실과
      «내가 이걸 눌렀다»는 표시를 같은 색으로 말하지 않는가** 입니다.
    */
    server.use(
      http.get('*/v1/auth/:provider/authorize', async () => {
        // 응답을 영원히 붙잡아 «이동 중» 상태를 관찰 가능한 시간 동안 고정합니다.
        await delay('infinite')
        return HttpResponse.json({ authorize_url: 'https://example.test/oauth' })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '카카오로 계속하기' }))

    const kakao = await screen.findByRole('button', { name: '이동 중…' })
    expect(kakao).toHaveAttribute('aria-busy', 'true')
    expect(kakao.className).toMatch(/opacity-50/)

    // 안 누른 쪽: 못 누르게는 하되 생김새는 그대로여야 합니다.
    const naver = screen.getByRole('button', { name: '네이버로 계속하기' })
    expect(naver).toBeDisabled()
    expect(naver).toHaveAttribute('aria-busy', 'false')
    expect(naver.className).not.toMatch(/opacity-50/)
  })
})

describe('AccountSheet · 모드 전환', () => {
  it('가입으로 넘어가도 쓰던 이메일이 남는다', async () => {
    /*
      탭이 아니라 «한 폼 + 모드 전환» 인 이유입니다. 여기서 이메일이 지워지면 사용자는
      로그인에 실패한 뒤 가입으로 넘어가면서 방금 친 주소를 다시 칩니다.
    */
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('이메일'), 'kong@nutti.co.kr')
    await user.click(screen.getByRole('tab', { name: '가입' }))

    expect(screen.getByLabelText('이메일')).toHaveValue('kong@nutti.co.kr')
    expect(screen.getByRole('tab', { name: '가입' })).toHaveAttribute('aria-selected', 'true')
  })

  it('모드를 바꾸면 앞의 오류는 걷힌다', async () => {
    /*
      로그인 실패 문구가 가입 화면에 남아 있으면, 아직 눌러 보지도 않은 동작이 이미
      실패한 것처럼 보입니다.
    */
    server.use(
      http.post('*/v1/auth/login', () =>
        HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS' } }, { status: 401 }),
      ),
    )
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await submitForm(user)
    await screen.findByText('이메일 또는 비밀번호가 맞지 않아요.')

    await user.click(screen.getByRole('tab', { name: '가입' }))

    expect(screen.queryByText('이메일 또는 비밀번호가 맞지 않아요.')).not.toBeInTheDocument()
  })
})

describe('AccountSheet · 병합하면 게스트 크레딧이 사라진다', () => {
  it('로그인 전에는 크레딧을 약속하지 않는다', async () => {
    /*
      로그인은 두 경로로 갈립니다. **승격**(기존 회원 없음)은 게스트 행 자체가 회원이 되어
      잔액이 남고, **병합**(기존 계정으로 로그인)은 자산 다섯 종만 옮기고 `credit_balance`
      는 안 옮깁니다 — 게스트 크레딧이 사라집니다. 이 시트는 **로그인 전**에 뜨므로 어느
      쪽일지 모릅니다.

      그래서 두 경로 모두에서 참인 말만 합니다. 이 단언이 있는 이유는 「크레딧을 이어서
      쓰세요」가 **네 곳**에 있었고(기본값 + AccountEntry·W01Landing·W12MyPage) 그 중
      하나도 테스트가 잡지 않았기 때문입니다. 되돌려 놓아도 아무도 모릅니다.

      아래 두 테스트가 그 «사라짐» 을 실제로 밟습니다.
    */
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    const sheet = screen.getByRole('dialog')

    expect(sheet).toHaveTextContent('만든 결과를 보관함에 저장하고 다른 기기에서도 열어 보세요.')
    expect(sheet).not.toHaveTextContent(/크레딧/)
  })

  it('기존 계정으로 로그인하면 그 계정 본인 잔액이 뜬다 — 게스트 잔액이 아니라', async () => {
    /*
      **목이 오래도록 이걸 가려 왔습니다.**

      서버가 병합에서 옮기는 건 자산 다섯 종(펫·업로드·job·커스텀 프롬프트·계측)뿐이고
      `credit_balance` 는 안 옮깁니다(`app/routers/auth.py` 병합 분기). 게스트 잔액은 죽은
      행에 남고 응답은 기존 회원 본인 값입니다. 그런데 목의 `promoteToMember` 는 게스트
      잔액을 그대로 돌려줘서, 「크레딧을 이어서 쓰세요」라는 우리 문구가 브라우저에서
      **항상 참으로 보였습니다** — 목이 계약이 아니라 우리 문구를 대변하고 있었습니다.

      승격(가입, 기존 회원 없음)은 **같은 행**이 회원이 되는 것이라 잔액이 따라갑니다.
      한 시트에서 두 경로가 갈리는 게 이 결함의 핵심이라 둘을 나란히 봅니다.

      목을 그대로 지나갑니다(`server.use` 로 응답을 지어내지 않음). 지어내면 화면이
      숫자를 그리는지만 확인되고, 정작 「목이 그 상태를 만들 수 있는가」는 그대로 남습니다.
    */
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await submitForm(user, { password: 'nutti1234' })

    expect(await screen.findByText('로그인됐어요')).toBeInTheDocument()
    // 게스트 기본 잔액은 11 입니다(fixtures `initialCredits`). 병합이면 그 값이 아니어야 합니다.
    expect(screen.getByText('보유 크레딧 3개')).toBeInTheDocument()
    expect(screen.queryByText('보유 크레딧 11개')).not.toBeInTheDocument()
  })

  it('가입은 승격이라 게스트 잔액이 그대로 따라온다', async () => {
    // 같은 행이 회원이 되는 것이라 크레딧이 살아남습니다 — 위와 갈리는 유일한 지점입니다.
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: '가입' }))
    await submitForm(user, { email: 'new@nutti.co.kr' })

    expect(await screen.findByText('로그인됐어요')).toBeInTheDocument()
    expect(screen.getByText('보유 크레딧 11개')).toBeInTheDocument()
  })
})
