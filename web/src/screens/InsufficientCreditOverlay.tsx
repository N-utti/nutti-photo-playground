/**
 * 크레딧 부족 오버레이 (FR-EDGE-03 · 05-api-spec §4 시나리오3).
 *
 * 화면 이동이 아니라 **인라인 오버레이**여야 합니다 — 생성 직전에 흐름을 끊고
 * 다른 화면으로 보내면 그대로 이탈입니다. W-04 "이대로 만들기"와 W-06 "다시
 * 만들기"가 같은 402 를 받으므로 공유합니다.
 *
 * 지금은 안내와 W-10 진입점까지입니다. 클레임 목록(주문 보상 최상단)은 W-10 의
 * 것이고 Phase 3 이라, 그때 이 오버레이 안에서 바로 받도록 교체합니다. 그때까지는
 * 실제 화면 이동이 일어나므로 호출부가 재시도 재료(업로드·Idempotency-Key)를
 * 스토리지에 남겨 둬야 합니다.
 */

import { Link } from 'react-router'

export default function InsufficientCreditOverlay({
  required,
  balance,
  onClose,
}: {
  required: number
  balance: number
  onClose: () => void
}) {
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
        className="relative w-full rounded-t-2xl bg-surface p-5 desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id="credit-overlay-title" className="text-base font-bold">
          크레딧이 부족해요
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {required} 크레딧이 필요한데 지금 {Math.max(0, balance)} 크레딧이 있어요.
        </p>
        <Link
          to="/credits"
          className="mt-4 block rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-paper"
        >
          크레딧 받기
        </Link>
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3">
          닫기
        </button>
      </div>
    </div>
  )
}
