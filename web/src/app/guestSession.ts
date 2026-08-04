/**
 * 게스트 세션이 초기화된 사실을 화면이 알 수 있게 합니다 (이슈 #5).
 *
 * 게스트 토큰이 만료되면 client.ts 가 새 게스트로 재발급받는데, 그건 복구가 아니라
 * **다른 사람이 되는 것**입니다 — 이전 job 은 그 순간부터 404 입니다. 같은 404 라도
 * "주소가 틀렸다"와 "세션이 만료돼 접근 권한을 잃었다"는 사용자가 할 수 있는 일이
 * 다르므로 안내를 구분해야 합니다.
 *
 * 리스너를 모듈 로드 시점에 달아 두는 이유: 재발급은 화면이 마운트되기 전(앱 부팅 중
 * 첫 요청)에도 일어날 수 있어, 훅 안에서만 구독하면 그 한 번을 놓칩니다.
 */

import { useEffect, useState } from 'react'
import { GUEST_SESSION_RESET_EVENT } from '../api/client'

let didReset = false
window.addEventListener(GUEST_SESSION_RESET_EVENT, () => {
  didReset = true
})

export function useGuestSessionReset(): boolean {
  const [reset, setReset] = useState(didReset)

  useEffect(() => {
    if (didReset) setReset(true)
    const onReset = () => setReset(true)
    window.addEventListener(GUEST_SESSION_RESET_EVENT, onReset)
    return () => window.removeEventListener(GUEST_SESSION_RESET_EVENT, onReset)
  }, [])

  return reset
}
