/**
 * 회원 탈퇴 (screens/WithdrawConfirm.tsx · W-12 E 섹션 · 이슈 #123).
 *
 * 이 앱에서 **가장 되돌릴 수 없는 동작**이라, 여기서 틀리면 되돌릴 방법이 없습니다.
 * 그래서 «버튼이 눌리는가» 가 아니라 다음 세 가지를 못 박습니다:
 *
 *   1. 고지 3건이 실제로 화면에 있는가 — 파기·크레딧 소멸·쇼핑몰 무관(PO 결정의
 *      고지 의무). 이건 «없어도 화면이 멀쩡해 보이는» 종류라 눈으로는 안 걸립니다
 *   2. 실패했을 때 **로컬 토큰이 남아 있는가** — 서버가 실패하면 계정은 살아 있으므로
 *      로컬도 살아 있어야 합니다. 여기서 토큰을 지워 버리면 사용자는 «탈퇴됐다» 고
 *      믿는데 계정과 사진은 그대로인, 화면이 할 수 있는 가장 나쁜 거짓말이 됩니다
 *   3. 성공했을 때 이 브라우저의 흔적이 지워지는가 — 초안이 남으면 «즉시 파기» 고지
 *      직후에 방금 그 사진이 새 게스트 화면에 되살아납니다
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
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

function asGuest() {
  server.use(
    http.get('*/v1/auth/me', () =>
      HttpResponse.json({
        member_id: '1c2d3e4f-0000-4000-8000-00000000beef',
        kind: 'guest',
        email: null,
        nickname: null,
        providers: [],
        cafe24_linked: false,
        credit_balance: 1,
      }),
    ),
  )
}

function renderMyPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/me" element={<W12MyPage />} />
      <Route path="/" element={<h1>랜딩</h1>} />
    </Routes>,
    { route: '/me' },
  )
}

/** 마이페이지 → 「회원 탈퇴」 → 확인 창까지. */
async function openWithdraw() {
  asMember()
  renderMyPage()
  await userEvent.click(await screen.findByRole('button', { name: '회원 탈퇴' }))
  return screen.findByRole('dialog', { name: '정말 탈퇴할까요?' })
}

describe('W-12 · 회원 탈퇴', () => {
  beforeEach(() => {
    localStorage.setItem('nutti.session.token', 'member-token')
    localStorage.setItem('nutti.session.kind', 'member')
  })

  it('게스트에게는 탈퇴 진입점을 보여 주지 않는다', async () => {
    /*
      서버도 403 `MEMBER_ONLY` 로 막습니다(이슈 #123). 그럼에도 화면에서 먼저 감추는
      이유는, 눌러도 거절될 버튼은 로그인 유도로도 안 읽히고 «내 계정에 문제가 있나» 로
      읽히기 때문입니다. 게스트의 다음 걸음은 로그인이지 탈퇴가 아닙니다.
    */
    asGuest()
    renderMyPage()

    // 게스트 패널이 떴는지 먼저 확인 — 안 그러면 «아직 로딩 중» 을 통과로 셉니다.
    await screen.findByRole('heading', { level: 1, name: '마이페이지' })
    await waitFor(() => expect(screen.queryByRole('button', { name: '로그아웃' })).toBeNull())
    expect(screen.queryByRole('button', { name: '회원 탈퇴' })).toBeNull()
  })

  it('확인 창이 고지 3건을 말한다', async () => {
    await openWithdraw()

    // 1 · 파기
    expect(screen.getByText(/올린 사진과 만든 결과물이 즉시 지워져요/)).toBeInTheDocument()
    // 2 · 크레딧 소멸 — 지금 잔액을 숫자로 말합니다(목 기본 11).
    expect(screen.getByText(/크레딧 11개가 사라져요/)).toBeInTheDocument()
    expect(screen.getByText(/같은 이메일로 다시 가입해도 돌아오지 않아요/)).toBeInTheDocument()
    // 3 · 쇼핑몰 무관 (이슈 #22 PO 결정의 고지 의무)
    expect(screen.getByText(/누띠 쇼핑몰 회원은 그대로예요/)).toBeInTheDocument()
  })

  it('탈퇴하면 DELETE 를 보내고 랜딩으로 나간다', async () => {
    let called = 0
    server.use(
      http.delete('*/v1/auth/me', () => {
        called += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await openWithdraw()

    await userEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))

    expect(await screen.findByRole('heading', { name: '랜딩' })).toBeInTheDocument()
    expect(called).toBe(1)
  })

  it('성공하면 이 브라우저에 남은 흔적까지 지운다', async () => {
    /*
      토큰만 지우면 부족합니다 — 업로드 초안은 sessionStorage 에 남아서(api/uploadDraft.ts)
      새 게스트로 선 다음 화면에서 **방금 파기된 사진**이 확인 단계에 되살아납니다.
      고지가 그 자리에서 거짓이 되는 경로라, 여기서 못 박습니다.
    */
    sessionStorage.setItem('nutti.upload-draft', JSON.stringify({ styleId: 7, petId: null }))
    sessionStorage.setItem('nutti.active-job', 'job_01HQZX')
    server.use(http.delete('*/v1/auth/me', () => new HttpResponse(null, { status: 204 })))
    await openWithdraw()

    await userEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))
    await screen.findByRole('heading', { name: '랜딩' })

    expect(sessionStorage.getItem('nutti.upload-draft')).toBeNull()
    expect(sessionStorage.getItem('nutti.active-job')).toBeNull()
  })

  it('탈퇴한 뒤에는 회원이 아니라 새 게스트로 서 있다', async () => {
    /*
      토큰을 지운 채로 두면 이후 모든 요청이 401 이라 앱이 통째로 멎습니다 — 이 앱에는
      «로그인 화면으로 보낸다» 는 선택지가 없습니다(api/queries.ts `useWithdraw`).
      탈퇴한 사람도 놀이터는 계속 쓸 수 있어야 하고, 그건 완전 신규 게스트입니다.
    */
    server.use(http.delete('*/v1/auth/me', () => new HttpResponse(null, { status: 204 })))
    await openWithdraw()

    await userEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))
    await screen.findByRole('heading', { name: '랜딩' })

    await waitFor(() => expect(localStorage.getItem('nutti.session.kind')).toBe('guest'))
    expect(localStorage.getItem('nutti.session.token')).not.toBe('member-token')
  })

  it('실패하면 계정이 그대로라고 말하고, 로컬 토큰도 남긴다', async () => {
    /*
      **이 파일의 핵심입니다.** 로그아웃은 서버 실패를 삼키고 로컬을 비우는 게 맞지만
      (사용자가 원한 건 이 브라우저에서 나가는 것) 탈퇴는 정반대입니다. 서버가 실패한
      채로 로컬만 비우면 화면은 «탈퇴됨» 으로 보이는데 계정·사진·크레딧은 전부 살아
      있습니다. 되돌릴 수 없는 동작에서 그 착각은 사용자가 영영 모릅니다.
    */
    server.use(
      http.delete('*/v1/auth/me', () =>
        HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 500 }),
      ),
    )
    await openWithdraw()

    await userEvent.click(screen.getByRole('button', { name: '탈퇴하기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/계정은 그대로 있으니/)
    // 랜딩으로 넘어가지 않았습니다 — 아직 회원입니다.
    expect(screen.queryByRole('heading', { name: '랜딩' })).toBeNull()
    expect(localStorage.getItem('nutti.session.token')).toBe('member-token')
    expect(localStorage.getItem('nutti.session.kind')).toBe('member')
  })
})
