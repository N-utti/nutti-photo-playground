/**
 * 커스텀 프롬프트(W-08 「직접 만들기」) 비용을 **서버에서** 읽습니다.
 *
 * 예전에는 이 파일이 `CUSTOM_PROMPT_COST_ESTIMATE = 2` 라는 추정치였습니다. 2 는
 * `app_setting.custom_prompt_credit_cost` 행이 없을 때의 서버 폴백이지, 서버가 말해 준
 * 값이 아니었습니다 — 노출 경로를 요청한 게 이슈 #149 고, `GET /v1/credits` 에
 * `custom_prompt_credit_cost` 가 실리면서(PR #151) 지어낼 이유가 없어졌습니다.
 *
 * 파일을 남겨 둔 이유는 «출처가 하나여야 한다» 는 원래 이유가 그대로이기 때문입니다.
 * 이 숫자는 세 화면의 **문장 안에** 들어갑니다 — W-02 카탈로그 하단 링크 · W-04 업로드
 * 후 링크 · W-08 만들기 버튼. 흩어 놓으면 값이 바뀌는 날 한두 곳만 고쳐지고, 남은
 * 화면이 «2 크레딧» 이라고 말하며 3 을 빼 갑니다.
 *
 * **모르는 동안은 숫자를 적지 않습니다.** 응답이 오기 전에 2 를 그려 두면 화면이 먼저
 * 단정하고 나중에 정정하는데, 그 사이에 누른 사람은 자기가 본 적 없는 값으로 결제합니다.
 * 비용이 빠진 라벨은 «모른다» 로 읽히지만 틀린 숫자는 거짓말로 읽힙니다.
 */

import { useCredits } from '../api/queries'

/** 서버가 말한 커스텀 비용. 아직 모르면(로딩·오류) `null`. */
export function useCustomPromptCost(): number | null {
  const { data } = useCredits()
  return data?.custom_prompt_credit_cost ?? null
}

/**
 * W-02·W-04 의 W-08 진입 링크 라벨.
 *
 * 두 화면이 같은 문장을 말해야 해서 여기서 만듭니다. 링크의 목적지가 같은데 한쪽만
 * 비용을 말하거나 두 값이 다르면, 사용자는 어느 쪽을 믿어야 할지 알 수 없습니다.
 */
export function customPromptLinkLabel(cost: number | null): string {
  const base = '원하는 걸 직접 써서 만들기'
  return cost === null ? base : `${base} · ${cost} 크레딧`
}
