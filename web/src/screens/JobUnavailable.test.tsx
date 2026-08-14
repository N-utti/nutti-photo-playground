/**
 * 결과를 못 불러왔을 때의 안내 (screens/JobUnavailable.tsx · 이슈 #5 · FR-EDGE-12).
 *
 * W-05 와 W-06 이 공유하는 화면입니다. 셋 중 무엇이 일어났는지에 따라 **말이 달라야**
 * 하는데, 세 경우 모두 사용자 눈에는 "결과가 안 나온다" 로 똑같이 보입니다:
 *
 *   guest-reset : 게스트 세션이 만료됨 — 이 브라우저에서 30일이 지났거나 초기화됨
 *   not-found   : 주소가 틀렸거나 다른 기기에서 만든 결과
 *   error       : 서버가 일시적으로 답을 못 함
 *
 * 가장 조심할 곳은 **로그인 유도를 언제 하느냐**입니다. 앞의 둘은 로그인이 «다음부터»
 * 를 바꾸지만, 일시적 오류에까지 "지금 로그인해도 이 결과는 돌아오지 않아요" 를 띄우면
 * 잠시 뒤 새로고침하면 될 일을 영구 손실로 오해하게 만듭니다 — 사고를 과장하는 쪽이
 * 안내를 안 하는 것보다 나쁩니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { session } from '../api/client'
import { renderWithProviders } from '../test/render'
import JobUnavailable from './JobUnavailable'

/** 로그인 유도 문구의 첫 구절. 세 케이스에서 있고 없음을 가르는 기준입니다. */
const LOGIN_NUDGE = /지금 로그인해도 이 결과는 돌아오지 않아요/

afterEach(() => {
  // `session` 은 localStorage 를 보는 모듈 상태라 테스트 사이로 샙니다.
  session.clear()
})

describe('JobUnavailable', () => {
  it('게스트 세션 만료는 그 사실과 30일 한계를 말한다', () => {
    renderWithProviders(<JobUnavailable reason="guest-reset" />)

    expect(screen.getByRole('heading', { name: '결과를 불러올 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByText(/30일 동안만 열립니다/)).toBeInTheDocument()
  })

  it('못 찾은 경우는 다른 기기 가능성을 말한다', () => {
    renderWithProviders(<JobUnavailable reason="not-found" />)

    expect(screen.getByRole('heading', { name: '결과를 찾을 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByText(/다른 기기·브라우저에서 만든 결과일 수 있어요/)).toBeInTheDocument()
  })

  it('어느 경우든 새로 만들 길을 준다', () => {
    // 막다른 화면으로 두지 않습니다 — 여기서 나갈 곳이 없으면 앱을 닫게 됩니다.
    renderWithProviders(<JobUnavailable reason="error" />)

    expect(screen.getByRole('link', { name: '새로 만들기' })).toHaveAttribute('href', '/styles')
  })

  it('일시적 오류에는 로그인을 권하지 않는다', () => {
    /*
      이 파일의 핵심입니다. `error` 는 잠시 뒤 다시 하면 될 일인데, 여기에 "지금
      로그인해도 이 결과는 돌아오지 않아요" 를 붙이면 **없는 손실을 알리는** 셈입니다.
      사용자는 돌아오면 있을 결과를 포기합니다.
    */
    renderWithProviders(<JobUnavailable reason="error" />)

    expect(screen.queryByText(LOGIN_NUDGE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '로그인하기' })).not.toBeInTheDocument()
  })

  it('게스트에게는 «다음부터» 로 안내하고 로그인 시트를 연다', async () => {
    const user = userEvent.setup()
    renderWithProviders(<JobUnavailable reason="guest-reset" />)

    // "복구" 가 아니라 "앞으로" 입니다 — 과장하면 로그인한 뒤 두 번 실망합니다.
    expect(screen.getByText(LOGIN_NUDGE)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '로그인하기' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('회원에게는 로그인을 권하지 않는다', () => {
    /*
      이미 로그인한 사람에게 로그인을 권하면 안내가 아니라 잡음입니다. 판정에 `/me` 가
      아니라 로컬 `session.kind` 를 쓰는 것도 의도인데, 이 화면이 뜨는 상황 자체가
      세션이 깨진 때라 `/me` 도 401 로 떨어질 수 있기 때문입니다.
    */
    session.set('member-token', 'member', 'refresh-token')

    renderWithProviders(<JobUnavailable reason="not-found" />)

    expect(screen.queryByText(LOGIN_NUDGE)).not.toBeInTheDocument()
  })

  it('원인 문자열은 사용자 문구를 대체하지 않고 덧붙는다', () => {
    // 서버 메시지가 안내문을 밀어내면 사용자는 무슨 일인지 모른 채 영문 문장만 봅니다.
    renderWithProviders(<JobUnavailable reason="error" detail="HTTP 503" />)

    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()
  })
})
