/**
 * 앱바 크레딧 배지 — W-02·W-04·W-06 이 같은 값을 같은 규칙으로 보여 줍니다.
 *
 * 규칙이 두 개고 셋 다 틀리기 쉬워서 한 곳에 모읍니다.
 *
 *  1. ADR-02 로 잔액은 **음수가 될 수 있습니다**. 표시는 `max(0, balance)` 지만
 *     판정(`balance >= cost`)은 원값으로 해야 합니다 — 판정은 각 화면의 몫입니다.
 *  2. 아직 못 받았거나 요청이 실패했으면 **`—`** 입니다. 0 으로 적으면 "잔액을
 *     모른다"가 "잔액이 없다"로 바뀌어, 세션이 끊긴 순간(RootLayout 배너가 뜨는
 *     그 순간) 크레딧이 사라진 것처럼 보입니다.
 *
 * 쿼리는 이 컴포넌트가 직접 구독합니다. 세 화면이 같은 queryKey 를 보므로
 * react-query 가 요청을 합쳐 주고, 화면 쪽에는 배지용 상태가 남지 않습니다.
 */

import { useCredits } from '../api/queries'

export function CreditBadge({ showUnit = false }: { showUnit?: boolean }) {
  const { data, isPending, isError } = useCredits()
  const known = !isPending && !isError && data !== undefined
  const balance = known ? Math.max(0, data.balance) : null

  return (
    <span
      // 크레딧은 이 앱의 화폐라 브랜드 골드(로고 i 위의 점 색)를 씁니다. 단,
      // **잔액을 아는 경우에만** 입니다 — `—` 를 금색으로 칠하면 규칙 2 가 무너져서
      // "모른다"가 다시 "있다"처럼 보입니다.
      className={`ml-auto rounded-full border px-3 py-1 font-mono text-sm tabular-nums ${
        balance === null ? 'border-rule bg-surface-2 text-ink-3' : 'border-gold bg-gold-soft'
      }`}
      aria-label={balance === null ? '보유 크레딧을 불러오지 못했습니다' : `보유 크레딧 ${balance}개`}
    >
      ◆ {balance ?? '—'}
      {showUnit && ' 크레딧'}
    </span>
  )
}
