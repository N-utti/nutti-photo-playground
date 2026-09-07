/**
 * W-08(직접 만들기) 진입 카드 — 홈 스타일 목록 끝에 섭니다.
 *
 * 한때 업로드 화면(스타일 없이 올린 뒤)에도 같은 카드가 있었는데 뺐습니다. «마음에
 * 드는 스타일이 없다» 는 판단은 목록을 다 본 뒤에 생기므로 그 자리는 여기 하나면
 * 되고, W-08 은 올린 사진을 세션 초안에서 읽어서 어디서 들어가든 사진이 따라갑니다.
 *
 * 예전엔 「원하는 걸 직접 써서 만들기 · N 크레딧」 링크 한 줄이었습니다. 「걸」이
 * 입말이고 「써서」가 «글을 쓰다» 인지 «사용하다» 인지 갈려서 어색했고, 무엇보다
 * **왜 여기가 있는지** 를 말하지 않았습니다. 이 진입점은 스타일 목록을 다 보고도
 * 마음에 드는 게 없는 사람을 위한 것이라, 그 상황을 먼저 물어야 합니다 — carat 이
 * 프롬프트 목록 끝에 두는 블록(「원하는 프롬프트가 없나요? / 직접 만들어보세요 /
 * 직접 만들기」)과 같은 꼴입니다: 질문 · 한 줄 설명 · 버튼.
 *
 * 설명 줄은 **얼마나 적은 노력으로 무엇이 되는가** 를 말합니다 — 「한 문장으로 우리
 * 강아지를 변신시켜요」. 앞은 «한 문장» 이라는 값싼 입력, 뒤는 «변신» — 사용자가 고른
 * 단어입니다(「주인공이 돼요」「새로 그려요」「어디든 가요」를 두고). 예전엔 입력
 * 예시(「눈 오는 날 산책 같은 한 줄이면 돼요」)로 «글을 적는다» 는 것만 말했는데, 그건
 * 방법이지 이유가 아닙니다. 예시는 W-08 입력창의 placeholder 가 이미 보여 줍니다.
 *
 * 390px 에서 한 줄에 들어가는 길이(19자)로 둡니다 — 21자짜리는 마지막 한 글자가 다음
 * 줄로 떨어졌습니다. UI 문구에 「」·«» 는 쓰지 않습니다(사용자: «너무 AI 스럽다»).
 * 버튼 이름은 도착하는 화면 이름(routes.tsx 「직접 만들기」)과 같습니다.
 *
 * 비용은 버튼 안에만 적습니다(customPromptLinkLabel) — 모르는 동안은 숫자를 안 적는
 * 규칙이 거기 있습니다.
 */

import { Link } from 'react-router'
import { customPromptLinkLabel } from './customPromptCost'

export function CustomPromptEntry({
  to,
  cost,
  className = '',
}: {
  to: string
  cost: number | null
  className?: string
}) {
  return (
    <div className={`rounded-2xl bg-surface px-4 py-5 text-center ${className}`}>
      <p className="text-base font-semibold">원하는 스타일이 없나요?</p>
      <p className="mt-1 text-sm text-ink-3">한 문장으로 우리 강아지를 변신시켜요</p>
      <Link
        to={to}
        className="mt-3 inline-block rounded-full border border-rule-strong px-4 py-2 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99]"
      >
        {customPromptLinkLabel(cost)}
      </Link>
    </div>
  )
}
