/**
 * 세션이 끊긴 두 가지 경우를 화면이 알 수 있게 합니다 (PR #8 인증 구현 대응).
 *
 * 게스트 재발급으로 조용히 회복되는 만료(→ app/guestSession.ts)와 달리, 여기 둘은
 * **회복이 안 되는 상태**라 사용자에게 말하고 행동을 받아야 합니다.
 *
 * - lost: 재발급으로 안 풀리는 401. 서버가 만료(TOKEN_EXPIRED)와 그 외 무효를 구분해
 *   내려주는데(app/auth.py), 병합된 게스트 토큰·kind 불일치가 후자입니다.
 * - rateLimited: 게스트 발급이 IP 당 시간당 제한에 걸림. 토큰이 아예 없으므로 이후
 *   모든 요청이 실패하고, 알리지 않으면 사용자는 원인 없는 고장만 보게 됩니다.
 *
 * 리스너를 모듈 로드 시점에 다는 이유는 guestSession.ts 와 같습니다 — 두 이벤트 모두
 * 화면이 마운트되기 전(부팅 중 첫 요청)에 발생할 수 있습니다.
 */

import { useEffect, useState } from 'react'
import {
  GUEST_RATE_LIMITED_EVENT,
  SESSION_LOST_EVENT,
  type GuestRateLimitedDetail,
} from '../api/client'

export interface SessionStatus {
  lost: boolean
  rateLimited: boolean
  /** 429 의 `Retry-After`(초). 헤더가 없으면 null — 화면은 "잠시 뒤"로 폴백합니다. */
  retryAfter: number | null
}

let state: SessionStatus = { lost: false, rateLimited: false, retryAfter: null }
const subscribers = new Set<(status: SessionStatus) => void>()

function update(patch: Partial<SessionStatus>): void {
  state = { ...state, ...patch }
  for (const notify of subscribers) notify(state)
}

window.addEventListener(SESSION_LOST_EVENT, () => update({ lost: true }))
window.addEventListener(GUEST_RATE_LIMITED_EVENT, (event) => {
  const detail = (event as CustomEvent<GuestRateLimitedDetail>).detail
  update({ rateLimited: true, retryAfter: detail?.retryAfter ?? null })
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
  update({ lost: false, rateLimited: false, retryAfter: null })
}
