/**
 * W-10 A · 크레딧 받기 (docs/wireframe-spec-v0.5.html#p10)
 *
 * 이 화면의 설계 반전(와이어프레임 콜아웃): v0.2 에서 크레딧은 **수익원**이었고
 * 결제 장벽이었습니다. v0.3 에서 크레딧은 **미끼**입니다 — 사용자가 크레딧을
 * 원할수록 누띠 쇼핑몰과 인스타로 갑니다. 그래서 **결제 UI 가 하나도 없어야**
 * 하고(FR-W10-01 노트1), 획득 목록이 화면의 본문입니다.
 *
 * 획득 목록 자체는 EarnActionList 에 있습니다 — 402 오버레이가 같은 것을 씁니다.
 * 여기 남은 건 잔액·설명·받은 내역 진입점뿐입니다.
 */

import { Link } from 'react-router'
import { useCredits } from '../api/queries'
import BackButton from '../app/BackButton'
import EarnActionList from './EarnActionList'

export default function W10Credits() {
  const { data, isPending, isError } = useCredits()
  // CreditBadge 와 같은 규칙 — 모르는 값을 0 으로 적으면 "크레딧이 없다"가 됩니다.
  const known = !isPending && !isError && data !== undefined
  const balance = known ? Math.max(0, data.balance) : null

  return (
    <div className="screen-min-h bg-paper pb-16">
      <header className="sticky top-0 desktop:top-16 z-20 flex items-center gap-3 border-b border-rule bg-surface px-5 desktop:px-7 py-3">
        <BackButton fallback="/styles" />
        <h1 className="text-base font-bold">크레딧 받기</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-5 desktop:px-7 py-4">
        <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
          <span className="text-sm font-semibold">보유 크레딧</span>
          <span className="font-mono text-lg font-bold tabular-nums">{balance ?? '—'}</span>
        </div>

        {/* 노트1 — 결제창을 통째로 뺐다는 사실 자체를 말해 줘야 사용자가 결제를 찾지 않습니다. */}
        <p className="mt-2 text-sm text-ink-3">크레딧은 판매하지 않아요. 아래로 받으세요.</p>

        <div className="mt-4">
          <EarnActionList />
        </div>

        <Link
          to="/credits/ledger"
          className="mt-4 block rounded-xl border border-rule px-4 py-3 text-sm text-ink-2 hover:border-rule-strong hover:bg-surface-2 hover:text-ink"
        >
          받은 내역 보기
        </Link>
      </main>
    </div>
  )
}
