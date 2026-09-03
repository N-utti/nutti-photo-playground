/**
 * 앱바 계정 진입점 — 마이페이지(W-12)로 가는 유일한 문 (이슈 #12 승인안).
 *
 * 탭바에 칸을 늘리지 않은 이유: 4칸(스타일 · 만들기 · 보관함 · 누띠샵) 중 뺄 게
 * 없고 5탭은 모바일에서 칸당 폭이 좁아집니다. 대신 크레딧 배지 오른쪽에 아바타를
 * 두면 역할이 깨끗하게 갈립니다 — **숫자 = 크레딧 받기(W-10), 아바타 = 계정(W-12)**.
 *
 * 게스트는 아바타 대신 "로그인" 버튼입니다. 게스트가 마이페이지를 열어 봐야 보여줄
 * 게 잔액뿐이라 빈 화면이 되고, 로그인 시트는 결과·크레딧 화면과 같은 한 벌을
 * 재사용합니다(screens/AccountSheet.tsx).
 *
 * `/me` 가 오기 전에는 아무것도 그리지 않습니다 — 게스트로 깜빡였다가 아바타로
 * 바뀌면 회원이 매 방문마다 로그아웃된 것처럼 보입니다(W-01 이 이미 쓰던 규칙).
 */

import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useMe } from '../api/queries'
import AccountSheet from '../screens/AccountSheet'
import { memberInitial, memberLabel } from './memberIdentity'

export function AccountEntry() {
  const { data: me } = useMe()
  const [loginSheet, setLoginSheet] = useState(false)
  const location = useLocation()

  if (!me) return null

  if (me.kind === 'guest') {
    return (
      <>
        <button
          type="button"
          onClick={() => setLoginSheet(true)}
          className="rounded-full border border-rule-strong px-3 py-1.5 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
        >
          로그인
        </button>
        {loginSheet && (
          <AccountSheet onClose={() => setLoginSheet(false)} />
        )}
      </>
    )
  }

  // 이미 마이페이지에 있으면 자기 자신으로 가는 링크는 의미가 없습니다.
  if (location.pathname === '/me') return null

  return (
    <Link
      to="/me"
      aria-label={`마이페이지 · ${memberLabel(me)}`}
      className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold ring-1 ring-rule-strong hover:bg-brand-soft hover:ring-brand-2"
    >
      <span aria-hidden>{memberInitial(me)}</span>
    </Link>
  )
}
