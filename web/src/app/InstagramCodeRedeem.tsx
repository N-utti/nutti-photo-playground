/**
 * 인스타 DM 링크(`?ig=CODE`)로 들어온 사람이 로그인하면 **어느 화면에 있든** 코드를 소진해
 * 팔로우 크레딧을 바로 넣습니다.
 *
 * 코드는 서버가 팔로우를 API 로 확인한 사람에게만 발급하므로(app/instagram.py) 아이디 입력이나
 * 「팔로우하러 가기」 대기 없이 곧장 지급됩니다(`POST /credits/redeem-instagram`). 예전에는 이
 * 배선이 W-10 획득 목록 안에 있어서 홈에서 로그인만 하고 크레딧 화면을 안 연 사람은 받지
 * 못했습니다 — 세션 복구(sessionRecovery.tsx)와 같은 이유로 여기 RootLayout 에 둡니다.
 *
 * 그리는 것은 없습니다. 지급되면 크레딧 캐시가 무효화돼 앱바 배지와 W-10 팔로우 행(완료)이
 * 바뀝니다. ponytail: 별도 알림 카드 없음 — DM 문구가 이미 「로그인하면 자동으로 들어가요」.
 * 성공·실패 어느 쪽이든 코드는 지웁니다(다시 넣어도 404/409 로 결과가 같음).
 */

import { useEffect, useRef } from 'react'
import { useMe, useRedeemInstagramCode } from '../api/queries'
import { clearInstagramCode, peekInstagramCode } from './instagramCode'

export default function InstagramCodeRedeem() {
  const { data: me } = useMe()
  const redeem = useRedeemInstagramCode()
  const fired = useRef(false)
  const code = peekInstagramCode()

  useEffect(() => {
    if (!code || me?.kind !== 'member' || fired.current) return
    fired.current = true
    redeem.mutate(code, { onSettled: () => clearInstagramCode() })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 코드와 회원 상태가 갖춰진 순간 한 번
  }, [code, me?.kind])

  return null
}
