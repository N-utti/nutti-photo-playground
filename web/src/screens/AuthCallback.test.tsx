/**
 * OAuth 복귀 지점 (screens/AuthCallback.tsx).
 *
 * 여기서 가장 조용히 깨지는 건 **콜백이 두 번 나가는 것**입니다. `state` 는 1회용
 * nonce 라 두 번째 요청은 무조건 401 이고, React 의 개발 모드 이중 마운트만으로도
 * 그 상황이 만들어집니다. 사용자에게는 «로그인 정보가 만료됐어요» 로 보이는데 실제로는
 * 방금 받은 코드입니다 — 다시 시도해도 같은 결과라 로그인 자체가 막힙니다.
 *
 * 그래서 `inFlight` Map 이 같은 `provider:state` 요청을 하나로 묶습니다. 이 파일은
 * 그 묶음이 살아 있는지 봅니다.
 *
 * **테스트마다 `state` 문자열이 달라야 합니다.** 그 Map 은 모듈 수준이라 같은 값을
 * 재사용하면 앞 테스트의 promise 를 그대로 물려받습니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import AuthCallback from './AuthCallback'

function renderCallback(provider: string, search: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/auth/callback/:provider" element={<AuthCallback />} />
      <Route path="/styles" element={<h1>스타일 카탈로그</h1>} />
      <Route path="/credits" element={<h1>크레딧 받기</h1>} />
    </Routes>,
    { route: `/auth/callback/${provider}${search}` },
  )
}

describe('AuthCallback', () => {
  it('소셜 로그인 성공을 알린다', async () => {
    renderCallback('kakao', '?code=mock-code&state=nonce-social-ok')

    expect(await screen.findByText('로그인됐어요')).toBeInTheDocument()
  })

  it('같은 콜백을 두 번 그려도 요청은 한 번만 나간다', async () => {
    /*
      **이 파일의 핵심입니다.** `state` 는 1회용이라 두 번째 요청은 무조건 401 이고,
      사용자에게는 «로그인 정보가 만료됐어요» 로 보입니다 — 방금 받은 코드인데도요.
      개발 모드의 이중 마운트가 그 상황을 그대로 만듭니다.

      여기서는 같은 주소를 두 번 렌더해 흉내 냅니다. `inFlight` 가 살아 있으면 두 번째는
      앞의 promise 를 물려받아 요청을 새로 내지 않습니다.
    */
    const sent = vi.fn()
    server.use(
      http.get('*/v1/auth/kakao/callback', () => {
        sent()
        return HttpResponse.json({
          token: 'mock-jwt',
          refresh_token: 'mock-refresh',
          member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
          kind: 'member',
          merged: false,
          credit_balance: 11,
        })
      }),
    )

    const search = '?code=mock-code&state=nonce-double-mount'
    renderCallback('kakao', search)
    renderCallback('kakao', search)

    await screen.findAllByText('로그인됐어요')
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it('사용자가 취소하고 돌아오면 실패로 몰지 않는다', async () => {
    /*
      프로바이더 화면에서 «취소» 를 누르면 `?error=` 를 달고 돌아옵니다. 이건 오류가
      아니라 선택이라, 빨간 실패 화면을 띄우면 사용자가 뭘 잘못한 것처럼 됩니다.
    */
    renderCallback('kakao', '?error=access_denied&state=nonce-denied')

    expect(await screen.findByText(/로그인을 취소했어요/)).toBeInTheDocument()
  })

  it('알 수 없는 프로바이더면 요청하지 않는다', async () => {
    // 주소를 손으로 고쳐 들어온 경우입니다. 서버에 물어볼 것이 없습니다.
    renderCallback('unknown', '?code=mock-code&state=nonce-unknown-provider')

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('로그인됐어요')).not.toBeInTheDocument()
  })

  it('nonce 가 만료됐으면 처음부터 다시 하라고 안내한다', async () => {
    /*
      재시도 버튼을 주지 않는 것이 의도입니다 — 소비된 nonce 라 다시 눌러도 같은 401 이고,
      회복 경로는 «처음부터 다시 로그인» 뿐입니다.
    */
    server.use(
      http.get('*/v1/auth/kakao/callback', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    )
    renderCallback('kakao', '?code=mock-code&state=nonce-expired')

    expect(await screen.findByText(/로그인 정보가 만료됐어요/)).toBeInTheDocument()
  })
})
