/**
 * 받은 내역 한 줄의 표기 규칙.
 *
 * W-10 B(`/credits/ledger` 전체 표)와 W-12 마이페이지 미리보기가 **같은 줄을 같은 말로**
 * 보여야 해서 공용 모듈로 둡니다 — 한쪽에만 사유 라벨을 추가하면 같은 거래가 화면에
 * 따라 «주문 확인»과 `order_reward` 로 갈라집니다.
 */

/**
 * `reason` 은 서버가 주는 코드고 §3 예시에 5종이 등장합니다. 값 도메인이 명세로
 * 닫혀 있지 않으므로(관리자 조정 `cs_adjustment` 처럼 나중에 늘 수 있음) 모르는
 * 코드는 **코드 그대로 보여 줍니다** — 빈칸으로 두면 사용자가 왜 받았는지 모릅니다.
 */
const REASON_LABEL: Record<string, string> = {
  generation_charge: '생성',
  generation_refund: '실패 반환',
  // 세이프티 차단(SAFETY_BLOCKED)으로 되돌려준 줄. 서버가 실제로 내려주는 값인데
  // (app/models.py CreditReason) 여기 없어서 표에 영문 코드가 그대로 찍혔습니다.
  safety_block_refund: '안전 차단 반환',
  order_reward: '주문 확인',
  order_clawback: '주문 취소',
  link_account: '계정 연동',
  follow_ig: '인스타 팔로우',
  daily_free: '매일 무료',
  guest_trial: '첫 무료',
  guest_merge: '게스트 크레딧 이전',
  cs_adjustment: '고객센터 조정',
}

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason
}

/** '2026-08-03' → '08-03'. 표가 좁고(4열) 연도는 같은 해 안에서 정보가 없습니다. */
export function shortDate(occurredOn: string): string {
  const parts = occurredOn.split('-')
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : occurredOn
}

/**
 * 증감 표기. 음수는 하이픈(-)이 아니라 **빼기 기호(−, U+2212)** 입니다 — tabular-nums
 * 폰트에서 하이픈은 폭이 어긋나 숫자 열이 흔들립니다.
 */
export function signedAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : `−${Math.abs(amount)}`
}

/** 증감의 색. 차감은 danger, 지급·반환은 good 입니다. */
export function amountTone(amount: number): string {
  return amount < 0 ? 'text-danger' : 'text-good'
}
