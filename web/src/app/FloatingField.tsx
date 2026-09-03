/**
 * 라벨이 칸 안에 앉아 있다가, 포커스하거나 값이 차면 테두리 위로 올라가는 입력칸.
 *
 * 구글 로그인이 쓰는 그 모양입니다. placeholder 로 라벨을 대신하는 흔한 절약과 다른
 * 점은 **라벨이 사라지지 않는다**는 것입니다 — placeholder 만 있는 칸은 한 글자 치는
 * 순간 무엇을 묻던 칸인지 화면에서 지워져서, 다 채우고 되짚어 볼 때 값만 남고 질문이
 * 없습니다. 그래서 라벨을 지우는 대신 자리만 옮깁니다.
 *
 * 상태 전환은 CSS 만으로 합니다 — `:focus` 와 `:placeholder-shown`. React 상태를
 * 안 쓰는 게 짧아서가 아니라, 브라우저 자동완성처럼 `onChange` 가 울지 않는 경로로
 * 값이 들어와도 라벨이 같이 올라가야 하기 때문입니다. 대신 이 조건이 성립하려면
 * placeholder 속성이 **항상** 비어 있지 않아야 합니다(빈 값이면 `:placeholder-shown`
 * 이 영영 거짓이라 라벨이 올라간 채로 굳습니다). 안 받았을 때 공백 한 칸을 넣는
 * 이유입니다.
 *
 * ── 라벨이 테두리를 «덮는» 이유 (한 번 틀렸던 자리)
 *
 * 처음에는 `<fieldset>` + `<legend>` 로 테두리에 진짜 구멍을 냈습니다. 배경색을
 * 가정하지 않아 더 안전해 보였고, DPR 1 에서는 실제로 깨끗했습니다. 그런데 legend 가
 * 지우는 띠는 **위 모서리가 테두리 선과 같은 y** 라, 배율이 정수가 아니면(윈도우
 * 125·150%) 반올림이 갈리면서 선 한 줄이 살아남습니다. 하필 그 자리가 떠 있는 라벨
 * 글자의 한가운데입니다 — 1280×800 · DPR 1.5 에서 재현했습니다.
 *
 * 그래서 라벨이 선을 덮는 쪽으로 바꿨습니다. 이 방식이 원래 막혔던 이유는 시트가 흰색
 * (`surface`)인데 칸은 크림(`paper`)이라 덮개를 어느 색으로 칠해도 한쪽과 어긋나서
 * 였는데, **칸의 바탕을 감싸는 화면과 같은 색으로 두면** 그 문제가 사라집니다. 덮개는
 * 색이 같은 사각형이라 반올림이 어긋나도 눈에 보일 것이 없습니다. 그 대신 칸을
 * 구분하는 일은 테두리가 혼자 하므로, 쉬고 있을 때의 테두리를 `rule` 이 아니라
 * `rule-strong` 으로 씁니다.
 *
 * `surfaceClass` 가 그 «화면과 같은 색» 입니다. 칸의 바탕과 라벨 덮개에 **같은 값**이
 * 들어가므로 둘이 어긋날 수 없고, 바탕이 다른 화면(`paper`·`canvas`)에 놓을 때만
 * 호출부가 바꿔 주면 됩니다.
 *
 * 넘겨받은 placeholder 는 포커스했을 때만 보입니다. 쉬고 있을 때 그 자리는 라벨이
 * 쓰고 있으니 둘이 겹치고, 형식 예시(«example@email.com»)는 채워 넣기 **직전**에만
 * 쓸모가 있습니다.
 */

import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

type FloatingFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  /** 칸 안에 앉았다가 테두리로 올라가는 글자. `<label for>` 이므로 접근성 이름이기도 합니다. */
  label: string
  /** 테두리와 라벨을 경고색으로. 무엇이 틀렸는지는 호출부가 칸 밖에 씁니다. */
  invalid?: boolean
  /**
   * 칸의 바탕색 — **감싸는 화면의 바탕과 같아야** 합니다. 라벨이 테두리를 덮을 때
   * 같은 색이라야 이음매가 안 보입니다. 지금 쓰는 자리는 전부 흰 시트·창입니다.
   */
  surfaceClass?: string
  /** 입력칸에만 더할 클래스(예: 인증번호의 자간). 크기·테두리·색은 이 파일이 정합니다. */
  inputClassName?: string
  /** 감싸는 칸에 줄 클래스 — 바깥 여백은 호출부의 몫입니다. */
  className?: string
}

/*
  라벨이 올라가는 조건은 둘입니다: 포커스, 또는 값이 있음(`:placeholder-shown` 의 부정).
  두 벌을 쓰는 이유는 CSS 에 «또는» 을 한 줄로 쓰는 방법이 선택자 목록뿐이라서입니다.
*/
const FLOATED =
  'peer-focus:top-0 peer-focus:text-xs peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs'

export default function FloatingField({
  label,
  invalid = false,
  surfaceClass = 'bg-surface',
  inputClassName = '',
  className = '',
  id,
  placeholder = ' ',
  ...inputProps
}: FloatingFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    /*
      `pt-2` — 올라간 라벨은 칸 위로 8px(글자 높이의 절반) 튀어나옵니다. 그 자리를
      레이아웃에 넣어 두지 않으면 위 형제와의 간격이 보이는 것보다 8px 좁아지고,
      좁은 폼에서는 라벨이 위 칸 테두리에 붙습니다.
    */
    <div className={`pt-2 ${className}`}>
      {/* 안쪽 칸은 입력칸과 크기가 같습니다 — 라벨의 `top-0`·`top-1/2` 가 칸의 위
          모서리와 한가운데를 뜻하게 하려면 기준이 입력칸과 같아야 합니다. */}
      <div className="relative">
        <input
          {...inputProps}
          id={inputId}
          placeholder={placeholder}
          /*
            `focus-visible:outline-none` — 앱 공통 포커스 링(index.css)은 요소 **바깥**에
            2px 를 하나 더 두르는데, 이 칸은 테두리가 이미 칸의 경계를 그리고 있어서
            링이 생기면 테두리가 두 겹으로 보입니다. 링을 지우는 대신 그 역할을 테두리
            자신이 합니다 — 쉴 때 `rule-strong`(#cbbfae) → 포커스 `brand`(#5c3d24) 로,
            두 상태의 대비는 5.2:1 이라 WCAG 2.2 의 포커스 표시 기준(3:1)을 넘습니다.
            링을 끄는 건 이 칸뿐입니다. 버튼·링크는 공통 규칙 그대로입니다.
          */
          className={`peer w-full rounded-xl border ${surfaceClass} px-3 py-3 text-sm leading-6 transition-colors duration-200 placeholder:text-ink-3 placeholder:opacity-0 focus-visible:outline-none focus:placeholder:opacity-100 ${
            invalid ? 'border-danger' : 'border-rule-strong focus:border-brand'
          } ${inputClassName}`}
        />
        <label
          htmlFor={inputId}
          /*
            `pointer-events-none` — 라벨이 칸 위에 겹쳐 있어서, 누르면 라벨이 먹고 커서가
            엉뚱한 곳에 놓입니다. 클릭은 칸으로 통과시키고 포커스는 브라우저가 `for` 로
            이어 줍니다.

            `px-1` 은 덮개가 글자보다 조금 넓어야 테두리가 글자에 닿지 않기 때문이고,
            그만큼 왼쪽으로 당겨(`left-2.5`) 글자 자체는 칸 안쪽 여백(`px-3`)과 같은
            자리에서 시작합니다.
          */
          className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 px-1 text-sm transition-all duration-200 ease-out motion-reduce:transition-none ${surfaceClass} ${
            invalid ? 'text-danger' : 'text-ink-3 peer-focus:text-brand'
          } ${FLOATED}`}
        >
          {label}
        </label>
      </div>
    </div>
  )
}
