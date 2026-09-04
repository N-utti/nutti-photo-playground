/**
 * 앱이 스스로 못 고치는 세션 상태를 사용자에게 말합니다 (app/sessionStatus.ts).
 *
 * **남은 건 둘뿐입니다.** 게스트 세션이 끊긴 경우는 client.ts 가 조용히 갈아 끼우고,
 * 회원이 끊긴 경우는 sessionRecovery 가 로그아웃 상태로 내려앉힙니다 — 둘 다 사용자가
 * 할 일이 없어서 말하지 않습니다. 여기 남은 둘은 반대입니다: 서버가 **발급 자체를**
 * 막아 둔 상태라 코드로 넘어갈 방법이 없고, 알리지 않으면 사용자는 원인 없이 전부
 * 고장난 화면만 보게 됩니다.
 *
 * **왜 상단바가 아닌가.** 예전에는 화면 맨 위 전폭 배너였습니다. 그 자리의 대가는
 * 뜨는 순간 아래 내용이 통째로 밀려 사용자가 보던 자리를 잃는 것인데, 정작 가장 자주
 * 뜨던 계기(세션 만료)는 지금 여기 오지도 않습니다. 드물게 뜨는 것에 화면 맨 윗줄을
 * 상시로 내줄 이유가 없어서 job 상태 바와 같은 자리(아래 떠 있는 카드)로 옮겼습니다.
 * 같은 규칙으로 닫을 수도 있습니다 — 눌러 없앨 수 없는 줄은 안내가 아니라 방해라는
 * 판단은 저쪽(app/JobStatusBar.tsx)과 같습니다.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ensureSession, isApiError, retryMemberRotation, session } from '../api/client'
import { formatRetryAfter } from './retryAfter'
import { clearSessionStatus, useSessionStatus, type SessionNoticeKind } from './sessionStatus'

export default function SessionNotice({ notice }: { notice: SessionNoticeKind }) {
  const { retryAfter, refreshRetryAfter } = useSessionStatus()
  const client = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  if (dismissed) return null

  const throttled = notice === 'refresh-throttled'
  const copy = message(notice, throttled ? refreshRetryAfter : retryAfter)

  async function retry() {
    setRetrying(true)
    setFailed(null)
    /*
      두 복구는 **절대 같은 동작이면 안 됩니다** (client.ts `retryMemberRotation` 주석).
      갱신 제한은 세션이 멀쩡한 상태라, 여기서 `session.clear()` 를 하면 아직 30일이
      남은 리프레시를 버려 «기다리면 될 일» 을 «재로그인해야 할 일» 로 만듭니다.
    */
    if (throttled) {
      if (await retryMemberRotation()) {
        clearSessionStatus()
        void client.resetQueries()
        return
      }
      setFailed('아직 풀리지 않았어요.')
      setRetrying(false)
      return
    }

    try {
      session.clear() // 거절된 토큰이 남아 있으면 ensureSession 이 그냥 반환합니다.
      await ensureSession()
      clearSessionStatus()
      // 토큰이 없는 동안 실패해 둔 화면들을 여기서 한 번에 다시 세웁니다. 새 세션은
      // 새 member_id 라 옛 응답을 물려받으면 안 되므로 리셋입니다.
      void client.resetQueries()
    } catch (error) {
      setFailed(
        isApiError(error, 'RATE_LIMITED')
          ? `아직 제한이 풀리지 않았어요. ${formatRetryAfter(error.retryAfter)} 다시 눌러 주세요.`
          : '다시 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      )
      setRetrying(false)
    }
  }

  return (
    // 자리와 z 는 job 상태 바와 같습니다 — 탭바(z-20) 위, 시트·모달(z-30) 아래.
    // 그 근거는 저쪽 주석에 있고, 여기서 다른 값을 쓰면 둘이 자리를 나눠 쓴다는
    // 전제가 깨집니다.
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 px-5 desktop:px-7 desktop:bottom-5">
      <div
        role="alert"
        className="mx-auto w-full max-w-md rounded-xl border border-rule-strong bg-surface p-4 shadow-md"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{copy.title}</p>
            <p className="mt-1 text-sm text-ink-2">{copy.body}</p>
            {/* 실패해도 문구를 새로 만들지 않습니다 — 서버가 새 Retry-After 를 주면 위
                문장의 시간이 이미 갱신돼 있고, 여기서 또 말하면 서로 다른 두 숫자가
                같이 보입니다. */}
            {failed && <p className="mt-1 text-sm text-danger">{failed}</p>}
          </div>
          <button
            type="button"
            aria-label="안내 닫기"
            onClick={() => setDismissed(true)}
            className="grid size-8 shrink-0 place-items-center rounded-xl text-ink-3 hover:bg-brand-soft hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="mt-3 w-full rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
        >
          {retrying ? copy.pending : '다시 시도'}
        </button>
      </div>
    </div>
  )
}

/**
 * 둘이 말해야 할 것은 다릅니다. 갱신 제한 쪽은 «잃은 게 없다» 를 먼저 말합니다 —
 * 로그인은 그대로 살아 있고 지금 상태는 잠시 새로고침이 안 되는 것뿐이라, 여기서
 * «데이터가 사라진다» 같은 말을 하면 없는 손실을 통보하는 셈입니다.
 */
function message(
  notice: SessionNoticeKind,
  seconds: number | null,
): { title: string; body: string; pending: string } {
  if (notice === 'guest-blocked') {
    return {
      title: '지금은 새로 시작할 수 없어요',
      // 서버가 Retry-After 를 함께 내려줍니다(PR #21) — 언제 풀리는지 말해 주면
      // 사용자가 무한정 새로고침하지 않습니다.
      body: `같은 네트워크에서 새 세션을 너무 자주 만들었어요. ${formatRetryAfter(seconds)} 다시 시도하면 됩니다.`,
      pending: '시작하는 중…',
    }
  }
  return {
    title: '지금은 로그인을 갱신할 수 없어요',
    body: `같은 네트워크에서 갱신 요청이 너무 많았어요. 로그인은 그대로 살아 있으니 ${formatRetryAfter(seconds)} 다시 시도하면 이어서 쓸 수 있어요.`,
    pending: '시도하는 중…',
  }
}
