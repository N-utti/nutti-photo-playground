/**
 * W-10 B · 받은 내역 (docs/wireframe-spec-v0.5.html#p10 · FR-W10-06/07)
 *
 * 별도 라우트(`/credits/ledger`)인 이유: 와이어프레임에서 B 는 자기 앱바와 뒤로가기를
 * 가진 화면이고, 목록이 커서 페이지네이션이라 "펼치기"로 붙이면 뒤로가기가 A 를
 * 건너뛰어 버립니다.
 *
 * 노트5 — **주문번호를 남깁니다**(`ref_label`). 어떤 주문으로 받았는지 보여야 자동
 * 지급이 신뢰를 얻고 CS 문의가 줄어듭니다. 노트6 — 실패 반환 줄도 그대로 남깁니다.
 */

import { Link } from 'react-router'
import { useLedger } from '../api/queries'
import type { LedgerEntry } from '../api/types'

/**
 * `reason` 은 서버가 주는 코드고 §3 예시에 5종이 등장합니다. 값 도메인이 명세로
 * 닫혀 있지 않으므로(관리자 조정 `cs_adjustment` 처럼 나중에 늘 수 있음) 모르는
 * 코드는 **코드 그대로 보여 줍니다** — 빈칸으로 두면 사용자가 왜 받았는지 모릅니다.
 */
const REASON_LABEL: Record<string, string> = {
  generation_charge: '생성',
  generation_refund: '실패 반환',
  order_reward: '주문 확인',
  order_clawback: '주문 취소',
  link_account: '계정 연동',
  follow_ig: '인스타 팔로우',
  daily_free: '매일 무료',
  guest_trial: '첫 무료',
  cs_adjustment: '고객센터 조정',
}

/** '2026-08-03' → '08-03'. 표가 좁고(4열) 연도는 같은 해 안에서 정보가 없습니다. */
function shortDate(occurredOn: string): string {
  const parts = occurredOn.split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : occurredOn
}

export default function W10Ledger() {
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useLedger()

  const entries: LedgerEntry[] = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        {/* navigate(-1) 이 아니라 A 로 고정합니다 — 402 오버레이에서 내역만 열고
            돌아갈 때 뒤로가기가 생성 화면을 지나쳐 버립니다. */}
        <Link to="/credits" aria-label="뒤로" className="text-ink-2">
          ←
        </Link>
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
              className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm"
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
                  <td className="py-2">{REASON_LABEL[entry.reason] ?? entry.reason}</td>
                  <td className="max-w-24 truncate py-2 text-ink-2">{entry.ref_label ?? '—'}</td>
                  <td className="py-2 font-mono text-xs text-ink-3 tabular-nums">
                    {shortDate(entry.occurred_on)}
                  </td>
                  <td
                    className={`py-2 text-right font-mono tabular-nums ${
                      entry.amount < 0 ? 'text-danger' : 'text-good'
                    }`}
                  >
                    {entry.amount > 0 ? `+${entry.amount}` : `−${Math.abs(entry.amount)}`}
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
            className="mt-4 w-full rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold disabled:opacity-50"
          >
            {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
          </button>
        )}
      </main>
    </div>
  )
}
