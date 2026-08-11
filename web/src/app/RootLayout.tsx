/**
 * 전 화면 공통 껍데기. 지금 하는 일은 세션 배너 하나입니다.
 *
 * 세션 상실·발급 제한은 특정 화면의 문제가 아니라 앱 전체가 요청을 못 보내는 상태라
 * 화면마다 따로 처리하면 빠지는 곳이 생깁니다. 라우트 최상단에 한 번만 답니다.
 */

import { useState } from 'react'
import { Outlet } from 'react-router'
import { ensureSession, isApiError, session } from '../api/client'
import { formatRetryAfter } from './retryAfter'
import { clearSessionStatus, useSessionStatus } from './sessionStatus'

export default function RootLayout() {
  return (
    <>
      <SessionBanner />
      <Outlet />
    </>
  )
}

function SessionBanner() {
  const { lost, lostKind, rateLimited, retryAfter } = useSessionStatus()
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  if (!lost && !rateLimited) return null

  /*
    회원과 게스트는 잃은 것이 다릅니다 (PR #57).

    게스트는 세션 = 자산이라 새로 시작하면 이전 결과가 **정말로 사라집니다**. 회원은
    서버에 그대로 있고 다시 로그인하면 돌아오므로, 같은 문구로 "이전 결과에 접근할 수
    없다"고 말하면 있지도 않은 손실을 통보하는 셈입니다.

    회원 세션이 끊기는 흔한 이유가 **다른 기기 로그인**인 것도 이때 생겼습니다 —
    서버가 회원당 리프레시를 하나만 살려 두기 때문입니다(이슈 #47 B안).
  */
  const memberLost = lost && lostKind === 'member'

  async function retry() {
    setRetrying(true)
    setRetryError(null)
    try {
      session.clear() // 거절된 토큰이 남아 있으면 ensureSession 이 그냥 반환합니다.
      await ensureSession()
      clearSessionStatus()
      // 새 member_id 로 서버 상태가 통째로 달라지므로 캐시를 들고 가지 않습니다.
      window.location.reload()
    } catch (error) {
      setRetryError(
        isApiError(error, 'RATE_LIMITED')
          ? `아직 제한이 풀리지 않았어요. ${formatRetryAfter(error.retryAfter)} 다시 눌러 주세요.`
          : '다시 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      )
      setRetrying(false)
    }
  }

  return (
    <div role="alert" className="border-b border-rule-strong bg-surface px-5 py-3 text-sm">
      <p className="font-semibold">
        {rateLimited
          ? '지금은 새로 시작할 수 없어요'
          : memberLost
            ? '로그인이 만료됐어요'
            : '세션이 만료됐어요'}
      </p>
      <p className="mt-1 text-ink-2">
        {rateLimited
          ? // 서버가 Retry-After 를 함께 내려줍니다(PR #21) — 언제 풀리는지 말해 주면
            // 사용자가 무한정 새로고침하지 않습니다.
            `같은 네트워크에서 새 세션을 너무 자주 만들었어요. ${formatRetryAfter(retryAfter)} 다시 시도하면 됩니다.`
          : memberLost
            ? '다른 기기에서 로그인했거나 로그인한 지 오래됐어요. 계정에 쌓인 결과와 크레딧은 그대로 있으니, 계속하기를 누른 뒤 다시 로그인하면 이어서 쓸 수 있어요.'
            : '로그인 없이 만든 결과는 만들었던 브라우저에서만 열립니다. 새로 시작하면 이전 결과에는 접근할 수 없어요.'}
      </p>
      {retryError && <p className="mt-1 text-danger">{retryError}</p>}
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="mt-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-paper disabled:opacity-50"
      >
        {retrying ? '시작하는 중…' : memberLost ? '계속하기' : '새로 시작하기'}
      </button>
    </div>
  )
}
