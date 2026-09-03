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

import { useEffect, useState } from 'react'
import { isApiError } from '../api/client'
import { track } from '../app/analytics'
import { creditAmountPhrase } from '../app/earnAmount'
import { useClaimCredit, useCredits, useMe, useRedeemInstagramCode } from '../api/queries'
import { clearInstagramCode, peekInstagramCode } from '../app/instagramCode'
import {
  NUTTI_INSTAGRAM_HANDLE,
  NUTTI_INSTAGRAM_URL,
  shopLink,
} from '../app/externalLinks'
import type { ClaimBody, ClaimableAction, EarnAction, EarnActionRow } from '../api/types'
import AccountSheet from './AccountSheet'
import ShopLinkSheet from './ShopLinkSheet'

const ACTION_ORDER: EarnAction[] = ['order', 'link_account', 'follow_ig', 'daily']

/**
 * 서버는 열기 이벤트가 **10초 이상** 지나야 팔로우 클레임을 받습니다
 * (`app/routers/credits.py` `_verify_follow_ig`, 백엔드 PR #202). 그 전에 누르면
 * `400 FOLLOW_IG_NOT_OPENED` 인데, 그때 화면이 하는 말은 「팔로우하러 가기로 …
 * 잠시 후 받기를 눌러 주세요」 — **방금 그걸 누른 사람에게** 다시 누르라고 말합니다.
 * 서버가 아는 초를 화면이 미리 세면 그 왕복이 아예 없어집니다.
 */
const FOLLOW_IG_MIN_WAIT_SECONDS = 10

const EARN_COPY: Record<EarnAction, { title: string; note: string }> = {
  /*
    「취소하면 회수」를 여기 한 자리에만 답니다. 결제 취소는 `order_clawback` 으로 −20 이
    찍히는데(app/ledgerFormat.ts) 지금까지 그 말을 **미리** 하는 데가 한 곳도 없었습니다.
    30분 배치일 때는 나중에 원장에서 발견하는 일이었지만, 백엔드 PR #201 의 웹훅이 이걸
    사용자가 화면을 보고 있는 수 초 안으로 옮겼습니다 — 이유 없이 숫자가 줄어드는 걸
    보게 됩니다. 연동 시트·마이페이지까지 같이 적지 않는 건, 아직 주문도 안 한 사람에게
    취소 얘기가 흐름 내내 따라다니면 그건 안내가 아니라 잔소리이기 때문입니다.
  */
  order: { title: '누띠 주문하기', note: '주문 1건당 · 자동 확인, 취소하면 회수' },
  link_account: { title: '쇼핑몰 계정 연동', note: '최초 1회' },
  follow_ig: { title: '인스타 팔로우', note: NUTTI_INSTAGRAM_HANDLE },
  daily: { title: '오늘의 무료', note: '매일 자정 충전' },
}

/** 이 경로만 `POST /v1/credits/claim` 대상입니다(§2 W-10). */
function isClaimable(action: EarnAction): action is ClaimableAction {
  return action === 'follow_ig' || action === 'daily'
}

export default function EarnActionList() {
  const { data: credits, isPending, isError, error, refetch } = useCredits()
  const { data: me } = useMe()
  const claim = useClaimCredit()
  const redeem = useRedeemInstagramCode()
  const [linkSheet, setLinkSheet] = useState(false)
  /*
    `balance` 까지 들고 있는 이유는 아래 안내 문구입니다 — 받은 뒤 잔액이 여전히 음수면
    화면의 «보유 크레딧» 숫자가 **안 움직입니다**(ADR-02 표시 규칙 `max(0, balance)`).
  */
  const [granted, setGranted] = useState<{
    action: EarnAction
    amount: number
    balance: number
  } | null>(null)
  /**
   * 로그인 시트를 왜 열었는지 (PR #58).
   *
   * 게스트에게는 이제 **네 줄 전부** 로그인 CTA 로 옵니다(`login_required`). 연동 줄만
   * 시트를 띄우던 때는 문구가 하나여도 됐지만, 지금은 «연동하려고 눌렀나 크레딧을
   * 받으려고 눌렀나»에 따라 시트가 다른 약속을 해야 합니다.
   */
  const [loginSheet, setLoginSheet] = useState<'link' | 'earn' | null>(null)

  /**
   * 연동 +3 은 두 단계입니다 — 카페24 연동은 **회원 전용**이라(ADR-11) 게스트는 먼저
   * 로그인해야 합니다. 게스트에게 곧바로 연동을 걸면 link/request 가 403 MEMBER_ONLY 이므로
   * (PR #58), 같은 버튼이 상태에 따라 다른 일을 합니다(§2 W-10 "게스트에게는 로그인 유도").
   * 회원이면 SMS 인증번호 2단계 시트(ShopLinkSheet)를 엽니다 — 페이지 이동이 없습니다.
   */
  function startLinkAccount() {
    if (me?.kind !== 'member') {
      setLoginSheet('link')
      return
    }
    setLinkSheet(true)
  }

  /** 인스타 DM 코드 소진 — 성공·실패 어느 쪽이든 저장된 코드는 지웁니다(재시도해도 결과가 같음). */
  function handleRedeem(code: string) {
    setGranted(null)
    redeem.mutate(code, {
      onSuccess: ({ amount_granted, balance }) =>
        setGranted({ action: 'follow_ig', amount: amount_granted, balance }),
      onSettled: () => clearInstagramCode(),
    })
  }

  /*
    DM 링크(`?ig=`)로 들어와 로그인까지 마친 사람 — 팔로우 행이 아직 available 이면 자동으로 넣어 줍니다.
    게스트는 회원 전용이라 기다리고(로그인 시트에서 로그인하면 캐시 무효화 → 이 effect 가 다시 돕니다),
    이미 done 이면 코드만 지웁니다(같은 인스타 계정이라 어차피 409).
  */
  const followRow = credits?.earn_actions.find((row) => row.action === 'follow_ig')
  const storedCode = peekInstagramCode()
  useEffect(() => {
    if (!storedCode || me?.kind !== 'member' || !followRow || redeem.isPending || redeem.isSuccess || redeem.isError) return
    if (followRow.status !== 'available') {
      clearInstagramCode()
      return
    }
    handleRedeem(storedCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 코드·회원·행 상태가 갖춰진 순간 한 번
  }, [storedCode, me?.kind, followRow?.status])

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
          className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
        >
          다시 시도
        </button>
      </div>
    )
  }

  const rows = [...credits.earn_actions].sort(
    (a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action),
  )
  // 연동 보상은 아래 로그인 시트의 **문장 안에도** 들어갑니다 — 목록 줄(`+{row.amount}`)과
  // 출처가 같아야 합니다. 운영이 바꾸는 값이 됐습니다(app/earnAmount.ts · 백엔드 PR #186).
  const linkAmount = rows.find((row) => row.action === 'link_account')?.amount ?? null

  function handleClaim(body: ClaimBody) {
    setGranted(null)
    claim.mutate(body, {
      onSuccess: ({ amount_granted, balance }) =>
        setGranted({ action: body.action, amount: amount_granted, balance }),
    })
  }


  return (
    <>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.action}>
            <EarnRow
              row={row}
              claiming={
                (claim.isPending && claim.variables?.action === row.action) ||
                (redeem.isPending && row.action === 'follow_ig')
              }
              onClaim={handleClaim}
              onRedeem={handleRedeem}
              onLinkAccount={startLinkAccount}
              onLogin={() => setLoginSheet('earn')}
              memberKnown={me !== undefined}
            />
          </li>
        ))}
      </ul>

      {granted && (
        <>
          <p role="status" className="mt-2 text-center text-sm font-semibold text-good">
            {EARN_COPY[granted.action]?.title ?? '크레딧'} · +{granted.amount} 크레딧을 받았어요
          </p>
          {/*
            **받았는데 숫자가 안 움직이는 경우**(FR-EDGE-05 · ADR-02).

            회수(`order_clawback`)로 잔액이 음수가 되면 표시는 `max(0, balance)` 라 계속
            «0» 이고, 판정은 원값이라 만들기도 계속 막힙니다. 그 상태에서 위 줄만 띄우면
            화면이 «+2 받았어요» 라고 말하면서 보유 크레딧 0 을 그대로 두는 셈이라 —
            **화면이 스스로를 반박합니다.** 사용자에게 남는 건 «받았다는데 왜 안 늘지,
            왜 아직 못 만들지» 뿐이고, 답은 원장에 이미 있는데 아무도 그리로 안 보냅니다.

            빚의 크기는 말하지 않습니다. 숨기는 게 ADR-02 의 결정이고 여기서 뒤집을 일이
            아닙니다 — 닫는 건 «말없이» 쪽 절반입니다. 원인도 단정하지 않습니다(음수를
            만드는 사유가 회수 하나라는 보장이 계약에 없습니다). 확실한 것만 말하고
            내역으로 보냅니다 — 아래 «받은 내역 보기» 가 그 줄들을 그대로 보여 줍니다.
          */}
          {granted.balance <= 0 && (
            <p className="mt-1 text-center text-xs text-ink-2">
              지난 차감이 남아 있어 보유 크레딧에는 아직 반영되지 않았어요. 아래 «받은
              내역»에서 확인할 수 있어요.
            </p>
          )}
        </>
      )}

      {redeem.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {isApiError(redeem.error, 'INSTAGRAM_CODE_INVALID')
            ? '코드가 올바르지 않거나 만료됐어요. 인스타 DM의 코드를 다시 확인해 주세요.'
            : isApiError(redeem.error, 'INSTAGRAM_ALREADY_USED')
              ? '이 인스타그램 계정으로는 이미 크레딧을 받았어요.'
              : isApiError(redeem.error, 'ALREADY_CLAIMED')
                ? '이미 받은 크레딧이에요.'
                : redeem.error.message}
        </p>
      )}

      {claim.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {isApiError(claim.error, 'ALREADY_CLAIMED')
            ? '이미 받은 크레딧이에요.'
            : isApiError(claim.error, 'FOLLOW_IG_NOT_OPENED')
              ? '「팔로우하러 가기」로 누띠 인스타그램을 팔로우한 뒤, 잠시 후 받기를 눌러 주세요.'
              : isApiError(claim.error, 'INSTAGRAM_ALREADY_USED')
                ? '이미 다른 계정에서 사용한 인스타그램 아이디예요.'
            : isApiError(claim.error, 'MEMBER_ONLY')
              ? /*
                  게스트의 claim 은 403 MEMBER_ONLY 입니다(PR #58, 이슈 #52). 게스트에게는
                  목록이 애초에 «로그인» 으로 내려오므로 여기까지 오는 건 화면과 서버가
                  어긋난 경우(로그인 직후 캐시가 아직 게스트 목록)뿐이라, 문구보다 시트를
                  띄우는 쪽이 사용자가 할 일에 가깝습니다.
                */
                '로그인하면 받을 수 있어요.'
              : claim.error.message}
        </p>
      )}

      {linkSheet && <ShopLinkSheet onClose={() => setLinkSheet(false)} />}

      {loginSheet && (
        <AccountSheet
          onClose={() => setLoginSheet(null)}
          /*
            시트 머리가 로고뿐이라, 문구를 남기는 진입점은 여기가 유일합니다 — 크레딧을
            받으려다 로그인 창을 만난 사람에게는 «회원만 할 수 있다» 는 이유가 필요합니다.
            다른 진입점의 「보관함에 쌓여요」류 일반 안내와 다른 종류의 문장입니다.
          */
          description={
            loginSheet === 'link'
              ? `쇼핑몰 계정 연동은 회원만 할 수 있어요. 로그인 후 연동하면 ${creditAmountPhrase(linkAmount)}을 받아요.`
              : '크레딧 받기는 회원만 할 수 있어요. 로그인하면 지금까지 만든 결과도 그대로 이어집니다.'
          }
        />
      )}
    </>
  )
}

interface EarnRowProps {
  row: EarnActionRow
  claiming: boolean
  onClaim: (body: ClaimBody) => void
  /** 인스타 DM 코드 소진(`POST /credits/redeem-instagram`). */
  onRedeem: (code: string) => void
  onLinkAccount: () => void
  /** `login_required` 줄이 눌렸을 때. 게스트에게는 네 줄 전부가 이 길입니다(PR #58). */
  onLogin: () => void
  /** `/me` 가 아직 안 왔으면 연동 버튼이 로그인/연동 중 무엇을 할지 모릅니다. */
  memberKnown: boolean
}

function EarnRow({ row, ...rest }: EarnRowProps) {
  const copy = EARN_COPY[row.action] ?? { title: row.action, note: '' }
  const best = row.action === 'order'

  return (
    /*
      `flex-wrap` 은 인스타 줄 하나 때문에 있습니다. 나머지 줄의 조작부는 버튼 한 개라
      제목 옆에 그대로 서지만, 인스타는 입력 두 칸 + 버튼 둘 + 링크로 이뤄진 **폼**이라
      제목 옆에 밀어 넣으면 제목 칸이 110px 로 눌려 «인스타 팔로 / 우» 처럼 단어 중간에서
      끊깁니다.

      그 조작부만 `w-full` 을 달아 아랫줄로 내려보냅니다(FollowIgCta). 여기서 action 을
      다시 보고 분기하지 않는 이유는 EarnCta 가 이미 상태별로 무엇을 그릴지 정하고
      있어서입니다 — 게스트(`login_required`)나 완료(`done`)면 그 폼 자체가 안 나오고,
      그때는 이 줄도 평소처럼 한 줄로 남습니다. 조건을 여기에 한 벌 더 두면 두 곳이
      어긋나는 날이 옵니다.
    */
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 ${
        best ? 'border-brand bg-surface' : 'border-rule bg-surface'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {copy.title}{' '}
          <span className={best ? 'font-bold text-good' : 'text-ink-2'}>+{row.amount}</span>
        </p>
        <p className="truncate text-xs text-ink-3">{copy.note}</p>
      </div>
      <EarnCta row={row} {...rest} />
    </div>
  )
}

function EarnCta({ row, claiming, onClaim, onRedeem, onLinkAccount, onLogin, memberKnown }: EarnRowProps) {
  /*
    게스트 — 서버가 네 줄 전부 `login_required` + `cta: "로그인"` 으로 내려줍니다
    (PR #58, 이슈 #52). 주문 줄까지 포함해 **먼저** 갈라내는 게 맞습니다:

    주문 보상은 연동한 회원에게 배치가 지급하므로(order_reward_cutoff 이후 주문만),
    게스트를 쇼핑몰로 그냥 보내면 받지 못할 보상을 걸어 두고 «주문 1건당 +20» 을
    약속하는 셈입니다. 쇼핑몰로 나가는 길 자체는 탭바의 «누띠샵» 이 늘 열어 두므로
    이 줄이 로그인으로 바뀐다고 매출 경로가 닫히지 않습니다.
  */
  if (row.status === 'login_required') {
    return (
      <button
        type="button"
        onClick={onLogin}
        className="shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
      >
        {row.cta ?? '로그인'}
      </button>
    )
  }

  // 노트2 — 주문 보상은 클레임이 아니라 **자동 지급**입니다(카페24 주문 동기화 배치).
  // 이 줄이 하는 일은 쇼핑몰로 보내는 것뿐이라 상태와 무관하게 링크입니다.
  if (row.action === 'order') {
    return (
      <a
        href={shopLink('w10_credits')}
        target="_blank"
        rel="noreferrer"
        onClick={() => track({ event_type: 'shop_exit_click', properties: { from: 'W-10' } })}
        className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
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
        disabled={!memberKnown}
        className="shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {row.cta ?? '연동하기'}
      </button>
    )
  }

  // 노트4 — daily 는 오늘 이미 받았으면 '내일 다시'. 받을 수 있는 척하면 안 됩니다.
  if (row.status === 'tomorrow') {
    return <span className="shrink-0 text-xs text-ink-3">{row.cta ?? '내일 다시'}</span>
  }

  if (!isClaimable(row.action)) return null

  const action = row.action
  if (action === 'follow_ig') {
    return <FollowIgCta row={row} claiming={claiming} onClaim={onClaim} onRedeem={onRedeem} />
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => onClaim({ action })}
        disabled={claiming}
        className="rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {claiming ? '받는 중…' : (row.cta ?? '받기')}
      </button>
    </div>
  )
}

/**
 * 인스타 팔로우 +2 (PR: follow-ig-hardening).
 *
 * 인스타그램은 «A가 B를 팔로우하는지» 를 제3자에게 알려 주는 API 가 없습니다(Basic Display
 * 폐지, Graph API 는 본인 비즈니스 계정 한정). 그래서 검증 대신 마찰 세 겹입니다 —
 * ① 인스타 아이디를 적게 하고(운영자가 실제 팔로워와 대조·회수, 05 §5 admin follow-ig)
 * ② 같은 아이디는 전 회원 통틀어 1회 ③ 「팔로우하러 가기」 를 눌러 누띠 계정을 연 뒤
 * 10초~30분 안에만 받기. 열기 이벤트(follow_ig_open)는 서버가 시각으로 검사합니다 —
 * 여기서 버튼을 잠그는 건 UX 이지 방어가 아닙니다.
 */
function FollowIgCta({
  row,
  claiming,
  onClaim,
  onRedeem,
}: {
  row: EarnActionRow
  claiming: boolean
  onClaim: (body: ClaimBody) => void
  onRedeem: (code: string) => void
}) {
  const [username, setUsername] = useState('')
  /*
    「팔로우하러 가기」를 누른 시각. 불리언이 아니라 시각인 건 남은 초를 **벽시계로**
    세기 위해서입니다 — 서버도 벽시계로 판정하는데, 탭이 백그라운드로 가면 타이머는
    느려집니다. 그때 카운트다운만 믿으면 화면이 서버보다 늦게 열어 줍니다.
  */
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  const [waitLeft, setWaitLeft] = useState(0)
  const [code, setCode] = useState('')
  const handle = username.trim().replace(/^@/, '')
  const valid = /^[A-Za-z0-9._]{1,30}$/.test(handle)
  const codeValid = /^[A-Za-z0-9]{6,16}$/.test(code.trim())

  useEffect(() => {
    if (openedAt === null) return
    const id = window.setInterval(() => {
      const left = Math.ceil((openedAt + FOLLOW_IG_MIN_WAIT_SECONDS * 1000 - Date.now()) / 1000)
      setWaitLeft(Math.max(0, left))
      if (left <= 0) window.clearInterval(id)
    }, 250)
    return () => window.clearInterval(id)
  }, [openedAt])

  /*
    제목 옆이 아니라 **아랫줄 전체**를 씁니다(`w-full` — EarnRow 의 `flex-wrap` 이 받습니다).

    전에는 이 폼이 제목 옆 오른쪽 칸에 세로로 쌓여 있었습니다. 그러면 세 가지가 같이
    무너집니다: 제목 칸이 110px 로 눌려 «인스타 팔로 / 우» 로 끊기고, 세 줄의 왼쪽 끝이
    입력·버튼 폭에 따라 제각각이 되고(실측 122 / 217 / 220), **서로 다른 두 방법이 한
    사다리처럼** 보입니다.

    그래서 방법 두 개를 각각 한 줄로 묶고, 입력이 남는 폭을 먹게(`flex-1`) 해서 두 줄의
    양끝을 맞췄습니다. 순서도 뒤집었습니다 — 이 줄의 제목은 «인스타 팔로우» 이므로 주
    경로(팔로우 → 아이디 → 받기)가 먼저고, DM 코드는 이미 코드를 받은 사람을 위한
    지름길이라 아래입니다.
  */
  return (
    <>
      {/*
        이 링크만 **제목 줄 오른쪽**에 섭니다. 조각 둘을 프래그먼트로 내보내면 둘 다
        줄 컨테이너의 flex 항목이 되고, 링크는 `shrink-0` 이라 제목 옆에 남고 아래
        폼은 `w-full` 이라 다음 줄로 넘어갑니다(EarnRow 의 `flex-wrap`).

        그 자리는 다른 줄에서 «쇼핑몰 →»·«연동하기»·«내일 다시» 가 서는 자리입니다.
        여기 오는 것이 버튼이 아니라 **밑줄 링크**인 건 그래서입니다 — 이걸 누른다고
        크레딧이 들어오지 않고, 돌아와서 아이디를 넣고 받기를 눌러야 합니다. 같은
        무게로 그리면 그 자체가 획득 버튼인 것처럼 읽힙니다.
      */}
      <a
        href={NUTTI_INSTAGRAM_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() => {
          // 서버는 이 이벤트의 시각으로 «열고 나서 받았는지» 를 판정합니다(10초~30분).
          track({ event_type: 'follow_ig_open', properties: { from: 'W-10' } })
          setOpenedAt(Date.now())
          setWaitLeft(FOLLOW_IG_MIN_WAIT_SECONDS)
        }}
        /*
          `self-start mt-0.5` — 줄 컨테이너가 `items-center` 라 그냥 두면 링크가 제목
          두 줄(«인스타 팔로우 +2» / «@nutti_official») **사이**에 걸쳐 어느 쪽과도 안
          맞습니다(실측 327~343, 두 줄의 경계가 337). 첫 줄에 맞춥니다 — 이 링크가 짝을
          이루는 것은 제목이지 그 아래 보조 문구가 아닙니다.

          `after:` 는 탭 영역입니다. 글자 상자가 84×16 이라 세로가 WCAG 2.5.8(AA) 의
          최소 24 를 못 넘깁니다 — 이 줄에서 «인스타 팔로우» 를 받으려면 반드시 먼저
          눌러야 하는 링크인데(서버가 이 열기 시각으로 판정합니다) 손가락으로 16px 을
          맞춰야 했습니다. 글자를 키우거나 padding 을 주면 바로 위에 적어 둔 «제목 첫
          줄에 맞춘다» 가 깨지므로, BackButton 과 같은 수를 씁니다 — 보이는 상자는
          그대로 두고 ::after 로 세로만 넓힙니다(레이아웃 영향 0, 결과 84×28).
        */
        className="relative mt-0.5 shrink-0 self-start text-xs text-ink-3 underline after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] hover:text-brand"
      >
        {/*
          글자를 그대로 둡니다. 이 라벨은 **서버가 이름으로 부릅니다** — 400
          FOLLOW_IG_NOT_OPENED 의 메시지가 「먼저 「팔로우하러 가기」로 …」이고
          (app/routers/credits.py), 위 claim 오류 문구·목·문서·테스트 셀렉터도 같은
          글자를 씁니다. 화살표 하나를 붙이면 그 문장들이 가리키는 이름과 화면의 글자가
          어긋납니다.
        */}
        팔로우하러 가기
      </a>

      <div className="w-full">
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label="인스타그램 아이디"
          placeholder="내 인스타 아이디"
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
          maxLength={31}
          className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          onClick={() => onClaim({ action: 'follow_ig', instagram_username: handle })}
          disabled={claiming || openedAt === null || waitLeft > 0 || !valid}
          title={
            openedAt === null
              ? '먼저 「팔로우하러 가기」를 눌러 주세요'
              : waitLeft > 0
                ? '팔로우가 확인되기까지 잠깐 걸려요'
                : !valid
                  ? '인스타 아이디를 입력해 주세요'
                  : undefined
          }
          /*
            `min-w-24` — 아래 «코드로 받기» 와 폭을 맞춥니다. 두 줄이 [입력][버튼] 으로
            같은 모양인데 버튼 폭이 다르면(실측 49 vs 87) 입력이 남는 폭을 먹는 만큼
            **입력의 오른쪽 끝도 어긋납니다**(304 vs 266). 바깥 양끝만 맞고 안쪽 경계는
            안 맞는 상태였습니다.

            `w-` 가 아니라 `min-w-` 인 이유는 이 버튼만 글자가 바뀌기 때문입니다 —
            «받기» · «받는 중…» · «10초 후 받기» 셋이 돌아갑니다. 지금은 셋 다 96px 안에
            들어가서(카운트다운도 실측 96) 폭이 흔들리지 않지만, 고정폭으로 박아 두면
            글자가 하나만 길어져도 눌립니다.
          */
          className="min-w-24 shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
        >
          {/* 남은 초를 적습니다 — 비활성 버튼만 두면 «왜 안 눌리지» 가 됩니다. */}
          {claiming ? '받는 중…' : waitLeft > 0 ? `${waitLeft}초 후 받기` : (row.cta ?? '받기')}
        </button>
      </div>

      {/*
        인스타 게시물에 댓글 → DM 으로 받은 코드(05 §3 redeem-instagram). 팔로우가 API 로 확인된
        사람에게만 오는 코드라 아이디·열기 없이 바로 받습니다. 링크로 들어왔으면 자동 소진되고,
        여기는 코드를 손으로 옮겨 적는 사람용입니다.

        한 줄 설명을 붙인 이유: 이게 **또 하나의 필수 단계가 아니라 다른 길**이라는 걸
        말해 주지 않으면, 위 아이디를 넣은 사람이 코드까지 넣어야 하는 줄 압니다.
      */}
      <p className="mt-3 text-xs text-ink-3">DM으로 코드를 받았다면</p>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="text"
          aria-label="인스타 DM 코드"
          placeholder="DM으로 받은 코드"
          autoCapitalize="characters"
          autoCorrect="off"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
          maxLength={16}
          className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-2 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => onRedeem(code.trim())}
          disabled={claiming || !codeValid}
          /* 위 «받기» 와 같은 폭(min-w-24). 이유는 그쪽 주석. */
          className="min-w-24 shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-xs font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
        >
          코드로 받기
        </button>
      </div>
      </div>
    </>
  )
}
