/**
 * 계산기 링크에서 화면 문구를 뽑는 규칙 (05-api-spec §2 W-07 · FR-EDGE-10/11).
 *
 * W-06 배너와 W-07 화면이 **같은 문장**을 말해야 합니다. 3케이스 분기를 여기 한 곳에
 * 둡니다. 견종은 W-04 에서 사용자가 고르거나 직접 쓴 값입니다(비전 추정 아님).
 *
 * **Q9 확정으로 갈래를 알아볼 수 있게 됐습니다**(PR #122). 계산기에는 코드 체계가
 * 없고 한글 견종명이 곧 키라, `breed_code` = `breed_label` = 한글명이고 목록은
 * 40종입니다(`app/breeds.py` 스냅샷). 폴백 표식도 `mixed` 가 아니라 **`믹스견`** 입니다.
 *
 *   정상   : 목록 40종에 매칭       → "입력한 견종 토이푸들 · 소형"
 *   폴백   : breed_code === '믹스견' → 목록 밖이라 믹스견으로 넘김(FR-EDGE-11)
 *   완전실패: breed_code === null    → URL 에 breed 파라미터가 없고 1단계부터(FR-EDGE-10)
 *
 * `calculator_url` 은 서버가 UTM 까지 붙여 완성해 주므로 **가공하지 않고 그대로**
 * 씁니다(FR-W07-03). 아래에서 URL 을 읽는 건 표시용 이름 하나뿐입니다.
 */

import type { CalculatorLink } from './types'

/**
 * 목록 밖 견종의 폴백 표식(FR-EDGE-11). 계산기 목록에 **실재하는 항목**이기도 해서,
 * 이 값이 왔다는 것만으로 "폴백이었다"고 단정할 수 없습니다 — 사용자가 직접 믹스견을
 * 골랐을 때도 같은 값이 옵니다. 그래서 아래 문구는 둘 다에 대해 참이어야 합니다.
 */
export const MIX_BREED = '믹스견'

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

/** 화면이 갈라 봐야 하는 세 상태. `prefilled` 는 "2단계부터 시작하는가"와 같은 뜻입니다. */
export type EstimateKind = 'matched' | 'mixed' | 'unknown'

/**
 * 견종 요약 한 줄. 노트3 — 1단계(40종 그리드)가 이탈이 가장 큰 구간이라 건너뛴다는
 * 게 이 출구의 값어치입니다.
 *
 * 믹스견을 따로 가르는 이유: 폴백으로 온 값이면 «입력한 견종 믹스견» 은 거짓입니다
 * (사용자는 «골든두들» 이라고 썼고 그게 목록에 없었을 뿐입니다). 반대로 진짜 믹스견을
 * 골랐을 수도 있어 "목록에 없어서"라고 단정하는 것도 틀립니다 — 응답만으로는 둘을
 * 구분할 수 없습니다. 그래서 둘 다에 대해 참인 말만 합니다: 계산기에는 믹스견으로 넘긴다.
 */
export function estimateSummary(
  link: Pick<CalculatorLink, 'breed_label' | 'size_label'>,
): { text: string; prefilled: boolean; kind: EstimateKind } {
  const breed = link.breed_label?.trim()
  if (!breed) {
    return { text: '견종을 입력하지 않았어요 · 1단계부터 시작', prefilled: false, kind: 'unknown' }
  }

  /*
    서버는 세 필드를 **함께** 채웁니다 — 매칭돼도 폴백이어도 크기가 같이 오고, 못
    찾으면 셋 다 null 입니다(`app/routers/results.py`). 그래도 크기만 빠진 응답에
    갈래를 따로 두는 건 조사 때문입니다: "…으로" 앞에 오는 게 크기(소형·중형·대형,
    모두 받침 ㅇ)일 때만 문장이 성립하고, 견종 이름이 오면 «토이푸들으로» 처럼
    깨집니다. 값 뒤에 조사를 붙이지 않는 게 이 저장소의 규칙이기도 합니다
    (`W04Upload.tsx` PetNameNotice).
  */
  const size = link.size_label?.trim()
  const mixed = breed === MIX_BREED

  if (!size) {
    const text = mixed
      ? `${MIX_BREED}으로 넘겨요 · 2단계부터 시작`
      : `입력한 견종 · ${breed} · 2단계부터 시작`
    return { text, prefilled: true, kind: mixed ? 'mixed' : 'matched' }
  }
  if (mixed) {
    return {
      text: `${breed} · ${size}으로 넘겨요 · 2단계부터 시작`,
      prefilled: true,
      kind: 'mixed',
    }
  }
  return { text: `입력한 견종 ${breed} · ${size} · 2단계부터 시작`, prefilled: true, kind: 'matched' }
}
