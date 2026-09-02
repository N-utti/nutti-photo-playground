/**
 * 획득 보상 금액(「+3」·「+20」)을 **서버에서** 읽습니다.
 *
 * 이 숫자들은 `app_setting` 의 `link_account_amount`·`order_reward_amount` 이고,
 * `GET /v1/credits` 의 `earn_actions[].amount` 로 이미 내려옵니다. 그동안 화면 **문장 안에**
 * 3·20 을 그대로 박아 둬도 안전했던 이유는 그 행을 만들 수단이 없었기 때문입니다 — 시드도
 * 마이그레이션도 `app_setting` 을 건드리지 않아 서버는 늘 `credits.py:_AMOUNT_DEFAULTS` 로
 * 떨어졌습니다. **백엔드 PR #186 이 그 전제를 끝냈습니다**: `PATCH /v1/admin/settings/{key}` 가
 * 이 테이블의 첫 쓰기 경로입니다.
 *
 * 그래서 지금 구조는 W-10 목록 줄만 서버값(`+{row.amount}`)이고, 그 줄을 눌러 여는 시트와
 * 마이페이지는 리터럴입니다. 운영이 값을 바꾸는 날 **한 화면이 자기 자신을 반박합니다** —
 * 목록은 「쇼핑몰 계정 연동 +5」, 방금 그 줄에서 연 시트는 「연동하고 +3 받기」.
 *
 * `customPromptCost.ts` 와 같은 이유로 같은 모양입니다. **모르는 동안은 숫자를 적지
 * 않습니다** — 응답 전에 3 을 그려 두면 화면이 먼저 단정하고 나중에 정정하는데, 여기서
 * 틀린 숫자는 「받을 금액」이라 정정이 곧 약속 파기로 읽힙니다. 금액이 빠진 문장은
 * 「얼마인지 아직 모른다」로 읽히지만, 틀린 금액은 거짓말로 읽힙니다.
 */

import { useCredits } from '../api/queries'
import type { EarnAction } from '../api/types'

/** 서버가 말한 획득 보상. 아직 모르면(로딩·오류) `null`. */
export function useEarnAmount(action: EarnAction): number | null {
  const { data } = useCredits()
  return data?.earn_actions.find((row) => row.action === action)?.amount ?? null
}

/** 「+3 크레딧」 — 모르면 숫자를 빼고 「크레딧」. 뒤에 오는 조사는 이/을 둘 다 붙습니다. */
export function creditAmountPhrase(amount: number | null): string {
  return amount === null ? '크레딧' : `+${amount} 크레딧`
}

/**
 * 연동 CTA 라벨 — 시트(W-10 에서 연 것)와 마이페이지가 같은 문장을 말해야 해서 여기서 만듭니다.
 *
 * 금액을 모르면 숫자를 빼고 할 일만 남깁니다. 폴백이 「연동하기」가 **아닌** 이유는 그게
 * W-10 목록 줄의 서버 CTA(`row.cta`)와 같은 글자라, 시트가 열린 동안 같은 이름의 버튼이
 * 둘이 되기 때문입니다.
 */
export function linkAccountCtaLabel(amount: number | null): string {
  return amount === null ? '쇼핑몰 계정 연동하기' : `연동하고 +${amount} 받기`
}
