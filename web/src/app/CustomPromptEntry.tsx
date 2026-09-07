/**
 * W-08(직접 만들기) 진입 카드 — 홈 스타일 목록 아래와 업로드 화면(스타일 없이 올린
 * 뒤)이 같은 것을 씁니다.
 *
 * 예전엔 「원하는 걸 직접 써서 만들기 · N 크레딧」 링크 한 줄이었습니다. 「걸」이
 * 입말이고 「써서」가 «글을 쓰다» 인지 «사용하다» 인지 갈려서 어색했고, 무엇보다
 * **왜 여기가 있는지** 를 말하지 않았습니다. 이 진입점은 스타일 목록을 다 보고도
 * 마음에 드는 게 없는 사람을 위한 것이라, 그 상황을 먼저 물어야 합니다 — carat 이
 * 프롬프트 목록 끝에 두는 블록(「원하는 프롬프트가 없나요? / 직접 만들어보세요 /
 * 직접 만들기」)과 같은 꼴입니다: 질문 · 한 줄 설명 · 버튼.
 *
 * 설명 줄은 W-08 입력창의 예시(「눈 오는 날 산책」)를 그대로 씁니다 — «글을 적는다»
 * 는 걸 예시 하나로 보여 주는 게 「문장으로」「프롬프트로」 같은 말보다 빠릅니다.
 * 390px 에서 한 줄에 들어가는 길이로 둡니다 — 「…한 줄만 적으면 그대로 만들어요」는
 * 마지막 한 글자가 다음 줄로 떨어졌습니다.
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
      <p className="mt-1 text-sm text-ink-3">「눈 오는 날 산책」처럼 한 줄이면 돼요</p>
      <Link
        to={to}
        className="mt-3 inline-block rounded-full border border-rule-strong px-4 py-2 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99]"
      >
        {customPromptLinkLabel(cost)}
      </Link>
    </div>
  )
}
