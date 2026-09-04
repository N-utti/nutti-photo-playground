/**
 * 회원 세션이 끊겼을 때 **말없이** 로그아웃된 상태로 내려앉힙니다.
 *
 * 예전에는 이 자리에 화면 맨 위 전폭 배너가 떴습니다 — 「로그인이 만료됐어요 ·
 * 계속하기」. 그 배너가 있어야 했던 이유는 안내가 아니라 배선이었습니다: 401 을 받은
 * `client.ts` 가 저장소를 비우는데, 그 페이지에서는 아무도 토큰을 다시 발급하지
 * 않아서(`ensureSession()` 은 부팅 때 한 번 지나갔습니다) 버튼을 눌러 주지 않으면
 * 모든 화면이 이유 없이 실패한 채 남았습니다. 즉 사용자에게 **앱의 배선을 대신
 * 눌러 달라고** 부탁하고 있었던 셈입니다.
 *
 * 그 부탁을 여기서 코드가 대신합니다. 그러고 나면 배너에 남는 말은 「로그인이
 * 풀렸다」 하나인데, 그건 상단의 계정 자리가 다시 «로그인» 으로 돌아가는 것으로
 * 이미 보입니다 — 대부분의 서비스가 로그인 화면으로 튕겨 보내며 하는 말과 같습니다.
 *
 * **캐시를 왜 다시 세우는가.** 새 토큰은 게스트고, 화면에 떠 있는 값들(잔액·보관함·
 * 마이페이지)은 방금 죽은 회원의 것입니다. 그대로 두면 로그아웃된 앱이 남의 숫자를
 * 계속 보여 줍니다. 토큰을 세운 **뒤에** 리셋하는 순서가 중요합니다 — 뒤집으면
 * 다시 가져오는 요청이 토큰 없이 나가 401 한 바퀴를 더 돕니다.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ensureSession } from '../api/client'
import { clearSessionStatus, useSessionStatus } from './sessionStatus'

export default function SessionRecovery() {
  const { lost } = useSessionStatus()
  const client = useQueryClient()

  useEffect(() => {
    if (!lost) return
    let cancelled = false

    void (async () => {
      try {
        await ensureSession()
      } catch {
        /*
          발급까지 429 로 막힌 경우입니다. 여기서 되풀이하면 서버의 시간당 카운터만
          더 태워 잠긴 시간이 길어집니다 — 그 상태는 `rateLimited` 로 따로 올라가
          app/SessionNotice.tsx 가 «언제 풀리는지» 와 함께 말합니다.
        */
        return
      }
      if (cancelled) return
      clearSessionStatus()
      // 회원 것으로 채워진 캐시를 게스트가 물려받으면 안 됩니다. `clear()` 가 아니라
      // `resetQueries()` 인 이유는 지금 화면에 떠 있는 쿼리를 **다시 가져와야** 하기
      // 때문입니다 — 비우기만 하면 화면이 빈 채로 멈춥니다.
      void client.resetQueries()
    })()

    return () => {
      cancelled = true
    }
  }, [lost, client])

  return null
}
