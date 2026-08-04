/**
 * 크레딧 부족 오버레이 (FR-EDGE-03 · 05-api-spec §4 시나리오3).
 *
 * 화면 이동이 아니라 **인라인 오버레이**여야 합니다 — 생성 직전에 흐름을 끊고
 * 다른 화면으로 보내면 그대로 이탈입니다. W-04 "이대로 만들기"와 W-06 "다시
 * 만들기"가 같은 402 를 받으므로 공유합니다.
 *
 * 시나리오3 그대로: 402 → 이 시트에서 `GET /v1/credits`(EarnActionList) → 클레임 →
 * **같은 Idempotency-Key 로 재시도**. 재시도 키는 호출부의 몫입니다 —
 * `resumeJobAttempt(intent) ?? beginJobAttempt(intent)` 로 부르면 자동으로 이어집니다
 * (api/idempotency.ts). 아직 job 이 만들어지지 않았으므로 원래 키를 그대로 씁니다.
 *
 * 잔액이 필요한 만큼 차면 주 버튼이 "다시 시도"로 바뀝니다. 여기서 사용자가 직접
 * 닫고 원래 버튼을 다시 찾아야 하면, 크레딧을 받고도 이탈합니다.
 */

import { useEffect, useRef } from 'react'
import { useCredits } from '../api/queries'
import EarnActionList from './EarnActionList'

export default function InsufficientCreditOverlay({
  required,
  balance,
  onClose,
  onRetry,
}: {
  required: number
  /** 402 응답이 실어 준 그 시점의 잔액. 이후 클레임으로 바뀌므로 표시용 초기값입니다. */
  balance: number
  onClose: () => void
  /** 잔액이 찼을 때의 재시도. 없으면 재시도 버튼을 감춥니다. */
  onRetry?: () => void
}) {
  // 클레임하면 이 쿼리가 무효화되므로(useClaimCredit) 잔액이 살아 움직입니다.
  const { data, dataUpdatedAt, refetch } = useCredits()
  const openedAt = useRef(Date.now())

  // 캐시된 잔액은 402 를 받기 **전** 값일 수 있습니다(staleTime 30초). 그 값을 믿으면
  // "크레딧이 있는데 왜 안 되지" 화면이 되므로, 열릴 때 한 번 다시 읽고 그 전까지는
  // 402 응답이 실어 준 잔액을 씁니다.
  useEffect(() => {
    void refetch()
  }, [refetch])

  const fresh = dataUpdatedAt > openedAt.current
  // ADR-02 로 잔액은 음수일 수 있습니다 — **판정은 원값**으로, 표시만 max(0,·).
  const current = fresh && data ? data.balance : balance
  const enough = current >= required

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-overlay-title"
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id="credit-overlay-title" className="text-base font-bold">
          {enough ? '이제 만들 수 있어요' : '크레딧이 부족해요'}
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {required} 크레딧이 필요한데 지금 {Math.max(0, current)} 크레딧이 있어요.
        </p>

        <div className="mt-4">
          <EarnActionList />
        </div>

        {enough && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 w-full rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper"
          >
            다시 시도 · {required} 크레딧
          </button>
        )}

        {/* 여기서 다른 화면으로 나가는 링크는 두지 않습니다 — 인라인이어야 하는 이유가
            "생성 직전에 흐름을 끊지 않는다"인데, 내역 보기 하나로도 그게 깨집니다. */}
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3">
          닫기
        </button>
      </div>
    </div>
  )
}
