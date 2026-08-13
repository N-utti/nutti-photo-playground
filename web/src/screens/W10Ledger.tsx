/**
 * W-10 B · 받은 내역 (docs/wireframe-spec-v0.5.html#p10 · FR-W10-06/07)
 *
 * 별도 라우트(`/credits/ledger`)인 이유: 와이어프레임에서 B 는 자기 앱바와 뒤로가기를
 * 가진 화면이고, 목록이 커서 페이지네이션이라 "펼치기"로 붙이면 뒤로가기가 A 를
 * 건너뛰어 버립니다.
 *
 * 노트5 — **주문번호를 남깁니다**(`ref_label`). 어떤 주문으로 받았는지 보여야 자동
 * 지급이 신뢰를 얻고 CS 문의가 줄어듭니다. 노트6 — 실패 반환 줄도 그대로 남깁니다.
 *
 * 줄의 표기(사유 라벨·날짜·증감)는 `app/ledgerFormat` 에 있습니다 — W-12 마이페이지
 * 미리보기가 같은 규칙을 씁니다.
 */

import { useLedger } from '../api/queries'
import BackButton from '../app/BackButton'
import { amountTone, reasonLabel, shortDate, signedAmount } from '../app/ledgerFormat'
import type { LedgerEntry } from '../api/types'

export default function W10Ledger() {
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLedger()

  const entries: LedgerEntry[] = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        {/* A 고정이었습니다. 402 오버레이에서 내역만 열고 돌아갈 때 A 를 지나치는 게
            싫어서였는데, 그 경우 사용자가 있던 곳은 생성 화면입니다 — 거기로 돌려보내는
            게 맞습니다. `/credits` 는 이제 뒤가 없을 때의 폴백입니다. */}
        <BackButton fallback="/credits" />
        <h1 className="text-base font-bold">받은 내역</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {isPending && (
          <ul className="space-y-2">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="h-10 animate-pulse rounded bg-rule/60" />
            ))}
          </ul>
        )}

        {isError && (
          <div className="rounded-xl border border-rule bg-surface px-3 py-4 text-center">
            <p className="text-sm text-ink-2">내역을 불러오지 못했어요.</p>
            <p className="mt-1 font-mono text-xs text-ink-3">{error.message}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
            >
              다시 시도
            </button>
          </div>
        )}

        {!isPending && !isError && entries.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-3">아직 받은 내역이 없어요.</p>
        )}

        {entries.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-ink-3">
                <th className="py-2 font-medium">내역</th>
                <th className="py-2 font-medium">구분</th>
                <th className="py-2 font-medium">일시</th>
                <th className="py-2 text-right font-medium">증감</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.reason}-${entry.occurred_on}-${index}`} className="border-b border-rule">
                  <td className="py-2">{reasonLabel(entry.reason)}</td>
                  <td className="max-w-24 truncate py-2 text-ink-2">{entry.ref_label ?? '—'}</td>
                  <td className="py-2 font-mono text-xs text-ink-3 tabular-nums">
                    {shortDate(entry.occurred_on)}
                  </td>
                  <td className={`py-2 text-right font-mono tabular-nums ${amountTone(entry.amount)}`}>
                    {signedAmount(entry.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {hasNextPage && (
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="mt-4 w-full rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
          >
            {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
          </button>
        )}
      </main>
    </div>
  )
}
