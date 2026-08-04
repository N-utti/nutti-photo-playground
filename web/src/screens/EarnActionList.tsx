/**
 * 크레딧 획득 경로 목록 (docs/wireframe-spec-v0.5.html#p10 A · FR-W10-01~05).
 *
 * W-10 전체 화면과 402 오버레이가 **같은 목록**을 씁니다. 05-api-spec §4 시나리오3 은
 * 크레딧 부족 시 화면을 이동하지 말고 인라인 오버레이에서 바로 받으라고 규정하는데,
 * 목록을 두 벌로 만들면 "여기선 받을 수 있고 저기선 없는" 상태가 반드시 생깁니다.
 *
 * 행 순서는 서버 배열 순서가 아니라 **여기서 고정**합니다(ACTION_ORDER). 노트2 —
 * 주문 보상이 최상단·최대치인 게 이 화면의 설계이고, 그 배치가 응답 순서에
 * 좌우되면 안 됩니다. 이 화면에서 유일하게 매출로 직결되는 줄입니다.
 */

import { useState } from 'react'
import { useLocation } from 'react-router'
import { isApiError } from '../api/client'
import { events } from '../api/endpoints'
import { useAuthorizeRedirect, useClaimCredit, useCredits, useMe } from '../api/queries'
import { rememberAuthReturn } from '../app/authReturn'
import {
  NUTTI_INSTAGRAM_HANDLE,
  NUTTI_INSTAGRAM_URL,
  NUTTI_SHOP_URL,
} from '../app/externalLinks'
import type { ClaimableAction, EarnAction, EarnActionRow } from '../api/types'
import AccountSheet from './AccountSheet'

const ACTION_ORDER: EarnAction[] = ['order', 'link_account', 'follow_ig', 'daily']

const EARN_COPY: Record<EarnAction, { title: string; note: string }> = {
  order: { title: '누띠 주문하기', note: '주문 1건당 · 자동 확인' },
  link_account: { title: '쇼핑몰 계정 연동', note: '최초 1회' },
  follow_ig: { title: '인스타 팔로우', note: NUTTI_INSTAGRAM_HANDLE },
  daily: { title: '오늘의 무료', note: '매일 자정 충전' },
}

/** 이 경로만 `POST /v1/credits/claim` 대상입니다(§2 W-10). */
function isClaimable(action: EarnAction): action is ClaimableAction {
  return action === 'follow_ig' || action === 'daily'
}

export default function EarnActionList() {
  const location = useLocation()
  const { data: credits, isPending, isError, error, refetch } = useCredits()
  const { data: me } = useMe()
  const claim = useClaimCredit()
  const authorize = useAuthorizeRedirect()
  const [granted, setGranted] = useState<{ action: EarnAction; amount: number } | null>(null)
  const [loginSheet, setLoginSheet] = useState(false)

  /**
   * 연동 +3 은 두 단계입니다 — 카페24 연동은 **회원 전용**이라(ADR-11) 게스트는 먼저
   * 로그인해야 합니다. 게스트에게 곧바로 연동을 걸면 authorize 가 401 이므로, 같은
   * 버튼이 상태에 따라 다른 일을 합니다(§2 W-10 "게스트에게는 로그인 유도").
   */
  function startLinkAccount() {
    if (me?.kind !== 'member') {
      setLoginSheet(true)
      return
    }
    rememberAuthReturn(`${location.pathname}${location.search}`)
    authorize.mutate('cafe24')
  }

  if (isPending) {
    return (
      <ul className="space-y-2">
        {ACTION_ORDER.map((action) => (
          <li key={action} className="h-16 animate-pulse rounded-xl bg-rule/60" />
        ))}
      </ul>
    )
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-rule bg-surface px-3 py-4 text-center">
        <p className="text-sm text-ink-2">받을 수 있는 크레딧을 불러오지 못했어요.</p>
        <p className="mt-1 font-mono text-xs text-ink-3">{error.message}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm"
        >
          다시 시도
        </button>
      </div>
    )
  }

  const rows = [...credits.earn_actions].sort(
    (a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action),
  )

  function handleClaim(action: ClaimableAction) {
    setGranted(null)
    claim.mutate(action, {
      onSuccess: ({ amount_granted }) => setGranted({ action, amount: amount_granted }),
    })
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.action}>
            <EarnRow
              row={row}
              claiming={claim.isPending && claim.variables === row.action}
              onClaim={handleClaim}
              onLinkAccount={startLinkAccount}
              linking={authorize.isPending}
              memberKnown={me !== undefined}
            />
          </li>
        ))}
      </ul>

      {authorize.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          연동 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}

      {granted && (
        <p role="status" className="mt-2 text-center text-sm font-semibold text-good">
          {EARN_COPY[granted.action]?.title ?? '크레딧'} · +{granted.amount} 크레딧을 받았어요
        </p>
      )}

      {claim.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {isApiError(claim.error, 'ALREADY_CLAIMED')
            ? '이미 받은 크레딧이에요.'
            : claim.error.message}
        </p>
      )}

      {loginSheet && (
        <AccountSheet
          onClose={() => setLoginSheet(false)}
          title="먼저 로그인해 주세요"
          description="쇼핑몰 계정 연동은 회원만 할 수 있어요. 로그인 후 연동하면 +3 크레딧을 받아요."
        />
      )}
    </>
  )
}

interface EarnRowProps {
  row: EarnActionRow
  claiming: boolean
  onClaim: (action: ClaimableAction) => void
  onLinkAccount: () => void
  linking: boolean
  /** `/me` 가 아직 안 왔으면 연동 버튼이 로그인/연동 중 무엇을 할지 모릅니다. */
  memberKnown: boolean
}

function EarnRow({ row, claiming, onClaim, onLinkAccount, linking, memberKnown }: EarnRowProps) {
  const copy = EARN_COPY[row.action] ?? { title: row.action, note: '' }
  const best = row.action === 'order'

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 ${
        best ? 'border-ink bg-surface' : 'border-rule bg-surface'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {copy.title}{' '}
          <span className={best ? 'font-bold text-good' : 'text-ink-2'}>+{row.amount}</span>
        </p>
        <p className="truncate text-xs text-ink-3">{copy.note}</p>
      </div>
      <EarnCta
        row={row}
        claiming={claiming}
        onClaim={onClaim}
        onLinkAccount={onLinkAccount}
        linking={linking}
        memberKnown={memberKnown}
      />
    </div>
  )
}

function EarnCta({ row, claiming, onClaim, onLinkAccount, linking, memberKnown }: EarnRowProps) {
  // 노트2 — 주문 보상은 클레임이 아니라 **자동 지급**입니다(카페24 주문 동기화 배치).
  // 이 줄이 하는 일은 쇼핑몰로 보내는 것뿐이라 상태와 무관하게 링크입니다.
  if (row.action === 'order') {
    return (
      <a
        href={NUTTI_SHOP_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() => void events.track({ event_type: 'shop_exit_click', properties: { from: 'W-10' } })}
        className="shrink-0 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-paper"
      >
        {row.cta ?? '쇼핑몰 →'}
      </a>
    )
  }

  if (row.status === 'done') {
    return <span className="shrink-0 text-xs font-semibold text-ink-3">완료</span>
  }

  /*
    연동(+3)은 클레임이 아니라 **카페24 콜백이 지급**합니다(§2 W-10) — 그래서 이 버튼은
    POST /credits/claim 이 아니라 authorize 로 갑니다. PR #21 이 authorize 를 200
    `{authorize_url}` 로 바꾸면서 비로소 배선이 성립했습니다(그전에는 302 + 헤더 요구라
    브라우저 이동으로는 무조건 401).

    게스트에게는 연동 대신 로그인을 띄웁니다 — 연동은 회원 전용입니다.
  */
  if (row.action === 'link_account') {
    return (
      <button
        type="button"
        onClick={onLinkAccount}
        disabled={linking || !memberKnown}
        className="shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        {linking ? '여는 중…' : (row.cta ?? '연동하기')}
      </button>
    )
  }

  // 노트4 — daily 는 오늘 이미 받았으면 '내일 다시'. 받을 수 있는 척하면 안 됩니다.
  if (row.status === 'tomorrow') {
    return <span className="shrink-0 text-xs text-ink-3">{row.cta ?? '내일 다시'}</span>
  }

  if (!isClaimable(row.action)) return null

  const action = row.action

  return (
    <div className="flex shrink-0 items-center gap-2">
      {/* 노트3 — 팔로우 여부는 검증하지 않습니다(자율 신고). 그래도 팔로우 유도가
          목적이므로 계정으로 나가는 길은 열어 둡니다. */}
      {action === 'follow_ig' && (
        <a
          href={NUTTI_INSTAGRAM_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-3 underline"
        >
          열기
        </a>
      )}
      <button
        type="button"
        onClick={() => onClaim(action)}
        disabled={claiming}
        className="rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold disabled:opacity-50"
      >
        {claiming ? '받는 중…' : (row.cta ?? '받기')}
      </button>
    </div>
  )
}
