/**
 * 세션이 평소와 다른 상태에 들어간 것을 앱이 알 수 있게 합니다 (PR #8).
 *
 * **세 상태가 하는 일이 서로 다릅니다.** 하나는 복구를 부르는 신호고, 둘은 사용자에게
 * 말해야 하는 상태입니다. 갈라 두는 이유는 «끊겼다» 를 전부 안내로 바꾸면, 앱이 알아서
 * 넘길 수 있는 일까지 사용자를 세워 놓고 통보하게 되기 때문입니다.
 *
 * - lost: **회원** 세션이 재발급·회전으로 안 풀리는 401 을 받음. 만료·위조·이미 쓴
 *   토큰, 그리고 **다른 기기 로그인**(회원당 리프레시 1개라 이전 세션이 무효화됩니다).
 *   → 안내가 아니라 **복구 신호**입니다. app/sessionRecovery.tsx 가 게스트로 내려앉히고,
 *   사용자는 로그아웃된 앱을 봅니다. 결과·크레딧은 서버에 그대로 있습니다.
 * - rateLimited: 게스트 발급이 IP 당 시간당 제한에 걸림. → **말해야 합니다.** 토큰을
 *   아예 못 받아 이후 모든 요청이 실패하는데, 이건 앱이 스스로 못 고칩니다.
 * - refreshThrottled: 회원 액세스 갱신이 429 로 막힘(이슈 #11 R3). → **말해야 합니다.**
 *   위 둘과 달리 **세션은 살아 있고** 기다리면 저절로 풀립니다. lost 와 묶으면
 *   «재로그인» 을 권하게 되는데, 그 행동은 아무것도 고치지 못하면서 아직 30일이 남은
 *   리프레시만 버립니다.
 *
 * 게스트 세션이 끊긴 경우는 여기 아예 없습니다 — 만료든 무효든 client.ts 가 새
 * 게스트로 갈아 끼우고 원요청을 다시 보냅니다(그 사실은 app/guestSession.ts 가
 * 화면별 안내로 나릅니다).
 *
 * 리스너를 모듈 로드 시점에 다는 이유는 guestSession.ts 와 같습니다 — 세 이벤트 모두
 * 화면이 마운트되기 전(부팅 중 첫 요청)에 발생할 수 있습니다.
 */

import { useEffect, useState } from 'react'
import {
  GUEST_RATE_LIMITED_EVENT,
  MEMBER_REFRESH_THROTTLED_EVENT,
  SESSION_LOST_EVENT,
  type GuestRateLimitedDetail,
  type MemberRefreshThrottledDetail,
} from '../api/client'

export interface SessionStatus {
  /** 회원 세션이 끊김. 안내가 아니라 복구 신호입니다 — 위 주석 참고. */
  lost: boolean
  rateLimited: boolean
  /** 429 의 `Retry-After`(초). 헤더가 없으면 null — 화면은 "잠시 뒤"로 폴백합니다. */
  retryAfter: number | null
  /** 회원 액세스 갱신이 429 로 막힘 (이슈 #11 R3). 세션은 그대로 살아 있습니다. */
  refreshThrottled: boolean
  /**
   * 갱신 제한이 풀리기까지 남은 초. `retryAfter` 와 **합치지 않습니다** — 둘은 서로
   * 다른 429(게스트 발급 / 회원 갱신)이고 배너 문구도 따로라, 한 칸을 나눠 쓰면
   * 한쪽 숫자가 다른 쪽 문장에 실려 나갈 수 있습니다.
   */
  refreshRetryAfter: number | null
}

let state: SessionStatus = {
  lost: false,
  rateLimited: false,
  retryAfter: null,
  refreshThrottled: false,
  refreshRetryAfter: null,
}
const subscribers = new Set<(status: SessionStatus) => void>()

function update(patch: Partial<SessionStatus>): void {
  state = { ...state, ...patch }
  for (const notify of subscribers) notify(state)
}

window.addEventListener(SESSION_LOST_EVENT, () => {
  update({ lost: true })
})
window.addEventListener(GUEST_RATE_LIMITED_EVENT, (event) => {
  const detail = (event as CustomEvent<GuestRateLimitedDetail>).detail
  update({ rateLimited: true, retryAfter: detail?.retryAfter ?? null })
})
/*
  회전이 다시 성공하면 같은 이벤트가 `throttled: false` 로 옵니다. 켜기만 하고 끄지
  않으면, 제한이 풀려 앱이 멀쩡히 돌아가는 동안에도 «지금은 갱신할 수 없어요» 가
  화면 위에 남습니다 — 실제와 다른 경고는 다음번 진짜 경고까지 못 믿게 만듭니다.
*/
window.addEventListener(MEMBER_REFRESH_THROTTLED_EVENT, (event) => {
  const detail = (event as CustomEvent<MemberRefreshThrottledDetail>).detail
  const throttled = detail?.throttled ?? false
  update({
    refreshThrottled: throttled,
    refreshRetryAfter: throttled ? (detail?.retryAfter ?? null) : null,
  })
})

export function useSessionStatus(): SessionStatus {
  const [status, setStatus] = useState<SessionStatus>(state)

  useEffect(() => {
    setStatus(state) // 마운트 전에 이미 발생했을 수 있습니다.
    subscribers.add(setStatus)
    return () => {
      subscribers.delete(setStatus)
    }
  }, [])

  return status
}

/** 사용자가 새 세션을 받아 복구에 성공했을 때 안내를 내립니다. */
export function clearSessionStatus(): void {
  update({
    lost: false,
    rateLimited: false,
    retryAfter: null,
    refreshThrottled: false,
    refreshRetryAfter: null,
  })
}

/**
 * 지금 사용자에게 **말해야 할** 것 하나. 없으면 null 입니다 — 평소가 여기입니다.
 *
 * `lost` 는 여기 없습니다. 그건 앱이 스스로 처리하는 신호라(sessionRecovery)
 * 사용자가 할 일이 없고, 할 일이 없는데 띄우는 알림은 다음번 진짜 알림까지
 * 못 믿게 만듭니다.
 *
 * 둘을 한 값으로 좁혀 두는 이유는 «동시에 두 개가 뜨는» 경우를 화면이 다시 판단하지
 * 않게 하려는 것입니다. 우선순위도 여기 한 곳에만 있습니다: 토큰을 아예 못 받은
 * 쪽이 먼저입니다 — 그쪽은 앱이 통째로 멈춰 있습니다.
 */
export type SessionNoticeKind = 'guest-blocked' | 'refresh-throttled'

export function useSessionNotice(): SessionNoticeKind | null {
  const { rateLimited, refreshThrottled } = useSessionStatus()

  if (rateLimited) return 'guest-blocked'
  if (refreshThrottled) return 'refresh-throttled'
  return null
}
