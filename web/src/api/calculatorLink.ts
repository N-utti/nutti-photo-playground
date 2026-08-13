/**
 * 계산기 링크에서 화면 문구를 뽑는 규칙 (05-api-spec §2 W-07 · FR-EDGE-10/11).
 *
 * W-06 배너와 W-07 화면이 **같은 문장**을 말해야 합니다. 한쪽만 "푸들로 봤어요"라고
 * 하고 다른 쪽이 "확인하지 못했어요"라고 하면 같은 추정을 두고 서로 다른 말을 하는
 * 셈이라, 3케이스 분기를 여기 한 곳에 둡니다.
 *
 *   정상   : breed_label 있음        → "사진에서 푸들 · 소형견으로 봤어요"
 *   폴백   : breed_code === 'mixed'  → 계산기 42종에 매칭 실패, 믹스견으로 넘김(FR-EDGE-11)
 *   완전실패: breed_code === null     → URL 에 breed 파라미터가 없고 1단계부터(FR-EDGE-10)
 *
 * `calculator_url` 은 서버가 UTM 까지 붙여 완성해 주므로 **가공하지 않고 그대로**
 * 씁니다(FR-W07-03). 아래에서 URL 을 읽는 건 표시용 이름 하나뿐입니다.
 */

import type { CalculatorLink } from './types'

/**
 * 강아지 이름은 응답 필드에 없고 `calculator_url` 의 `name` 파라미터에만 있습니다
 * (§3 예시: `calculator.html?name=콩이&breed=…`). 와이어프레임 문구가 "콩이는 하루
 * 몇 g까지 괜찮을까?"라 이름이 필요한데, 이걸 위해 job 응답에 없는 pet 을 브라우저에
 * 따로 들고 다니면 지워야 할 우회가 늘어납니다 — 그렇게 생겼다가 계약이 메워지면서
 * 통째로 지운 게 예전의 `api/jobContext.ts` 입니다(이슈 #9·#41·#81).
 *
 * 서버가 준 URL 이 상대 경로일 수도 있어 파싱은 실패해도 조용히 넘깁니다.
 */
export function petNameFromLink(link: Pick<CalculatorLink, 'calculator_url'>): string | null {
  try {
    const name = new URL(link.calculator_url, window.location.origin).searchParams.get('name')
    return name?.trim() ? name : null
  } catch {
    return null
  }
}

/** "콩이는 하루 몇 g까지 괜찮을까?" — 이름을 모르면 "우리 아이는". */
export function calculatorHeadline(link: Pick<CalculatorLink, 'calculator_url'>): string {
  const name = petNameFromLink(link)
  return `${name ?? '우리 아이'}는 하루 몇 g까지 괜찮을까?`
}

/**
 * 추정 요약 한 줄. 노트3 — 1단계(42종 그리드)가 이탈이 가장 큰 구간이라 건너뛴다는
 * 게 이 출구의 값어치이고, 노트4 — 믹스견은 판별이 부정확하므로 **단정하지 않고
 * 출처를 밝힙니다**.
 */
export function estimateSummary(
  link: Pick<CalculatorLink, 'breed_label' | 'size_label'>,
): { text: string; prefilled: boolean } {
  if (!link.breed_label) {
    return { text: '견종을 확인하지 못했어요 · 1단계부터 시작', prefilled: false }
  }
  const parts = [link.breed_label, link.size_label].filter(Boolean).join(' · ')
  return { text: `사진에서 ${parts}으로 봤어요 · 2단계부터 시작`, prefilled: true }
}
