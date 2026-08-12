/**
 * 세션이 끊긴 두 가지 경우를 화면이 알 수 있게 합니다 (PR #8 인증 구현 대응).
 *
 * 게스트 재발급으로 조용히 회복되는 만료(→ app/guestSession.ts)와 달리, 여기 둘은
 * **회복이 안 되는 상태**라 사용자에게 말하고 행동을 받아야 합니다.
 *
 * - lost: 재발급·회전으로 안 풀리는 401. 서버가 만료(TOKEN_EXPIRED)와 그 외 무효를 구분해
 *   내려주는데(app/auth.py), 병합된 게스트 토큰·kind 불일치가 후자입니다. 회원은
 *   리프레시 회전까지 실패한 경우가 여기 더해집니다(PR #57) — 만료·위조·이미 쓴 토큰,
 *   그리고 **다른 기기 로그인**(회원당 리프레시 1개라 이전 세션이 무효화됩니다).
 * - rateLimited: 게스트 발급이 IP 당 시간당 제한에 걸림. 토큰이 아예 없으므로 이후
 *   모든 요청이 실패하고, 알리지 않으면 사용자는 원인 없는 고장만 보게 됩니다.
 * - refreshThrottled: 회원 액세스 갱신이 429 로 막힘(이슈 #11 R3). 위 둘과 달리
 *   **세션은 살아 있고** 기다리면 저절로 풀립니다 — 그래서 상태를 나눕니다. 하나로
 *   묶으면 «다시 시작/재로그인» 을 권하게 되는데, 여기서 그 행동은 아무것도 고치지
 *   못하면서 게스트에게는 자산을, 회원에게는 남은 리프레시를 버리게 만듭니다.
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
  type SessionLostDetail,
} from '../api/client'

export interface SessionStatus {
  lost: boolean
  /**
   * 끊긴 게 어떤 세션이었는지 (PR #57). 회원은 재로그인, 게스트는 새로 시작이라
   * 배너가 제안하는 행동 자체가 달라집니다. `lost` 가 false 면 의미 없는 값입니다.
   */
  lostKind: 'guest' | 'member' | null
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
  lostKind: null,
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

window.addEventListener(SESSION_LOST_EVENT, (event) => {
  const detail = (event as CustomEvent<SessionLostDetail>).detail
  update({ lost: true, lostKind: detail?.kind ?? null })
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

/** 사용자가 새 세션을 받아 복구에 성공했을 때 배너를 내립니다. */
export function clearSessionStatus(): void {
  update({
    lost: false,
    lostKind: null,
    rateLimited: false,
    retryAfter: null,
    refreshThrottled: false,
    refreshRetryAfter: null,
  })
}
