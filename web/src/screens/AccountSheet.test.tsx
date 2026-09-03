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

/**
 * 이메일 폼을 펼칩니다.
 *
 * 시트는 소셜 버튼 둘 + 「이메일로 계속하기」로 시작하고 폼은 접혀 있습니다. 이미 펼쳐져
 * 있으면(모드 전환 테스트처럼 한 번 펼친 뒤 계속 쓰는 경우) 아무것도 하지 않습니다 —
 * 펼침은 한 번뿐이라 버튼이 사라져 있습니다.
 */
async function openEmail(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.queryByRole('button', { name: '이메일로 계속하기' })
  if (trigger) await user.click(trigger)
}

/** 이메일·비밀번호를 채우고 제출합니다. 기본값은 클라이언트 검증을 통과하는 값입니다. */
async function submitForm(
  user: ReturnType<typeof userEvent.setup>,
  { email = 'kong@nutti.co.kr', password = 'password123' } = {},
) {
  await openEmail(user)
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

    await openEmail(user)
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

describe('AccountSheet · 이메일은 접혀서 시작한다', () => {
  it('열자마자 보이는 건 수단 세 개뿐이고, 눌러야 폼이 선다', async () => {
    /*
      접는 이유는 **주 경로가 소셜**이기 때문입니다. 예전에는 탭 둘 + 입력 둘 + 제출
      버튼이 항상 펼쳐져 있어서 시트의 절반 넘게를 이메일이 먹었습니다.

      되돌아가기 쉬운 종류라 여기서 잡습니다 — 폼을 항상 그리도록 고쳐도 다른 테스트는
      전부 통과합니다(`openEmail` 이 버튼이 없으면 그냥 넘어가므로). 그러니 «처음에는
      없다» 를 명시적으로 봅니다.

      펼친 뒤 포커스가 이메일 칸에 있는지도 같이 봅니다. 펼침 버튼이 사라지는 구조라
      `aria-expanded` 를 쓸 수 없어서, 새로 생긴 것을 스크린리더에 알리는 방법이
      포커스 이동뿐입니다(AccountSheet 의 `autoFocus` 주석).
    */
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    expect(screen.queryByLabelText('이메일')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '가입' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '이메일로 계속하기' }))

    const field = screen.getByLabelText('이메일')
    expect(field).toBeInTheDocument()
    expect(field).toHaveFocus()
    // 펼침은 한 번뿐입니다 — 버튼이 남아 있으면 폼 위에 죽은 버튼이 서 있게 됩니다.
    expect(screen.queryByRole('button', { name: '이메일로 계속하기' })).not.toBeInTheDocument()
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

    await openEmail(user)
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

    await openEmail(user)
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

      지금은 시트 머리가 로고뿐이라 기본 문구 자체가 없습니다 — 그래서 이 단언은 「기본값이
      다시 생기지 않는가」를 봅니다. 문구가 되살아나 크레딧을 약속하면 여기서 걸립니다.

      로고로 바꾸면서 제목 글자가 `sr-only` 로 들어갔으므로, 대화상자를 **이름으로** 집어
      접근 가능한 이름이 남아 있는지도 같이 봅니다 — 이름을 잃으면 스크린리더에는 「대화상자」
      하나만 뜹니다.

      아래 두 테스트가 그 «사라짐» 을 실제로 밟습니다.
    */
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    const sheet = screen.getByRole('dialog', { name: '누띠 놀이터 계정으로 이어서' })

    expect(sheet).not.toHaveTextContent(/크레딧/)
  })

  it('머리가 「누띠」에서 끊기지 않는다 — 누띠는 쇼핑몰 이름이다', () => {
    /*
      한동안 시트 머리는 워드마크 혼자였습니다. 「누띠」는 쇼핑몰 이름이고 여기 뜨는 계정은
      놀이터의 것이라(마이페이지의 「쇼핑몰 연동」이 그 증거) 이름이 거기서 끊기면 시트가
      쇼핑몰 로그인으로 읽힙니다.

      **보는 쪽과 읽히는 쪽을 둘 다** 셉니다. 잠금 문구는 장식이라(`aria-hidden` — 아래
      `<h2>` 가 이름을 답니다) 눈에 보이는 「놀이터」만 확인하면 스크린리더 쪽이 「누띠
      계정」으로 되돌아가도 초록불입니다. 그 반대도 마찬가지고요.
    */
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    expect(screen.getByText('놀이터')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleName('누띠 놀이터 계정으로 이어서')
  })

  it('이메일 폼을 펼쳤을 때만 쇼핑몰 계정과 별개라고 말한다', async () => {
    /*
      쇼핑몰 비밀번호를 실제로 **넣게 되는** 자리는 이메일 폼뿐입니다. 소셜 둘은 계정이
      자동으로 갈려서 오해해도 손해가 없고(카카오로 들어오면 그냥 놀이터 계정이 생깁니다),
      이메일만 「로그인하지 못했어요」로 끝납니다 — 그 사람은 자기가 비밀번호를 틀렸다고
      생각하지 다른 서비스에 로그인하려 했다고는 생각하지 않습니다.

      «펼치기 전에는 없다» 를 같이 세는 이유: 이 줄이 시트 머리로 올라가면 진입점 일곱 곳
      모두에서 늘 보이는 문구가 하나 더 늘고, 그건 #257 이 걷어낸 반복으로 돌아가는 것입니다.
    */
    const user = userEvent.setup()
    renderWithProviders(<AccountSheet onClose={vi.fn()} />)

    expect(screen.queryByText(/쇼핑몰 계정과는 별개/)).not.toBeInTheDocument()

    await openEmail(user)

    expect(screen.getByText('누띠 쇼핑몰 계정과는 별개예요.')).toBeInTheDocument()
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

    await openEmail(user)
    await user.click(screen.getByRole('tab', { name: '가입' }))
    await submitForm(user, { email: 'new@nutti.co.kr' })

    expect(await screen.findByText('로그인됐어요')).toBeInTheDocument()
    expect(screen.getByText('보유 크레딧 11개')).toBeInTheDocument()
  })
})
