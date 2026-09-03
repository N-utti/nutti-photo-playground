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
 *
 * 읽어 주는 말은 `aria-label` 이 아니라 **`sr-only` 텍스트**입니다. `<span>` 은 role 이
 * 없는 generic 이고 ARIA 는 generic 에 이름 붙이는 것을 금지합니다 — 그래서 예전의
 * `aria-label="보유 크레딧 1개"` 는 접근성 트리에서 그냥 버려졌고, 스크린리더는 «◆ 1»
 * 을 그대로 읽었습니다(기호는 «검은 다이아몬드» 로 읽히거나 조용히 넘어갑니다).
 * 값이 «—» 일 때가 특히 나쁩니다 — 모른다는 사실이 읽히지 않고 대시 하나만 남습니다.
 *
 * **이제 누르면 크레딧 받기(W-10 A)로 갑니다.** W-02 앱바에는 예전부터 «숫자 = 크레딧
 * 받기, 아바타 = 계정» 이라고 적혀 있었는데(W02StyleCatalog.tsx) 정작 숫자는 `<span>`
 * 이라 아무 데도 가지 않았습니다 — 잔액을 보고 «적네» 라고 생각한 사람이 그 자리에서
 * 할 수 있는 게 없었고, 크레딧 받는 길은 아바타 → 마이페이지 → 「크레딧 받기」로 세 번
 * 눌러야 나왔습니다. 잔액을 보여 주는 자리에서 잔액을 늘리는 자리로 가는 게 가장
 * 짧습니다.
 */

import { Link, useLocation } from 'react-router'
import { useCredits } from '../api/queries'

/**
 * 알약의 생김새 — 링크일 때와 아닐 때가 **같은 것으로 보여야** 해서 한 곳에 둡니다.
 *
 * 크레딧은 이 앱의 화폐라 액센트 색(`accent-soft`)을 씁니다 — 워드마크의 `i` 가 쓰는
 * 세이지 그린이고, 팔레트에서 유일하게 브랜드 갈색과 경쟁하지 않는 색입니다. 단,
 * **잔액을 아는 경우에만** 입니다(아래 `tone`) — `—` 를 액센트로 칠하면 규칙 2 가
 * 무너져서 "모른다"가 다시 "있다"처럼 보입니다.
 *
 * 예전에는 골드(`gold-soft`)였는데, 배지가 실제로 얹히는 흰 앱바 위에서 **1.10:1**
 * 이라 알약이 아예 보이지 않았습니다(index.css 「액센트 세이지」).
 *
 * 테두리는 여전히 없습니다. 누르는 것이 됐으니 두르고 싶어지지만, 이 배지 바로
 * 오른쪽이 «로그인» 버튼이고 그쪽이 테두리 두른 알약입니다 — 둘이 같은 무게로 나란히
 * 서면 **무엇이 무엇인지** 다시 흐려집니다(랜딩·카탈로그 앱바). 눌린다는 표시는 커서가
 * 올라왔을 때의 테두리 한 겹과 눌리는 순간의 살짝 줄어듦으로 냅니다.
 */
const PILL = 'ml-auto rounded-full px-3 py-1 font-mono text-sm tabular-nums'

/**
 * 링크일 때만 붙는 것 — 눌린다는 표시와 손가락 자리.
 *
 * `after:-inset-y-2` 는 **보이는 알약은 그대로 두고 탭 영역만** 넓힙니다. 알약은 28px
 * 이라 WCAG 2.5.8 의 24×24 는 넘지만 44 에는 못 미치고, padding 을 키우면 앱바 높이가
 * 통째로 밀립니다(BackButton.tsx 가 ← 에 쓴 것과 같은 수법). 위아래로만 넓혀서 옆의
 * 아바타·로그인 버튼과 겹치지 않습니다.
 */
const PRESSABLE =
  "relative motion-safe:active:scale-[0.99] hover:ring-1 after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"

export function CreditBadge({ showUnit = false }: { showUnit?: boolean }) {
  const { data, isPending, isError } = useCredits()
  const known = !isPending && !isError && data !== undefined
  const balance = known ? Math.max(0, data.balance) : null

  /*
    크레딧 화면 위에서는 링크를 떼고 도로 «표시» 로 둡니다.

    누를 수 있게 생긴 것이 눌러도 아무 일이 없으면 사용자는 앱이 멈춘 줄 압니다.
    데스크톱 GNB(app/DesktopNav.tsx)는 모든 화면에 붙으므로 크레딧 화면 위에도 이
    배지가 떠 있고, 거기서 이건 자기 자신으로 가는 링크가 됩니다.

    `/credits/ledger`(받은 내역)는 다른 화면이라 그대로 링크입니다.
  */
  const here = useLocation().pathname === '/credits'
  const label = balance === null ? '보유 크레딧을 불러오지 못했습니다' : `보유 크레딧 ${balance}개`
  const tone = balance === null ? 'bg-surface-2 text-ink-3' : 'bg-accent-soft'

  const face = (
    <>
      {/* `◆` 를 따로 칠하지 않습니다. 여기서는 **면이 액센트를 지니고**, 기호까지
          같은 색으로 물들이면 알약 안에서 세이지 위에 세이지가 됩니다(4.21:1).
          카탈로그 카드는 반대입니다 — 거기엔 알약이 없어서 기호가 색을 집니다
          (W02StyleCatalog.tsx). 화폐 표시가 액센트를 입는다는 규칙은 같고,
          면이 있느냐 없느냐에 따라 입는 자리만 다릅니다.

          기호와 숫자를 한 텍스트 노드에 두는 것도 의도입니다 — 아래 `sr-only` 와
          짝이 되는 «눈으로만 읽는 한 덩어리» 이고, CreditBadge.test.tsx 가
          `◆ 7` 통째로 aria-hidden 인지 봅니다. */}
      <span aria-hidden>
        ◆ {balance ?? '—'}
        {showUnit && ' 크레딧'}
      </span>
      {/* 링크일 때는 **어디로 가는지**까지가 이름입니다. 값만 읽어 주면 스크린리더에는
          «링크, 보유 크레딧 7개» 로 들리고, 그건 눌러서 무슨 일이 나는지 안 말합니다. */}
      <span className="sr-only">{here ? label : `${label}, 크레딧 받기`}</span>
    </>
  )

  if (here) return <span className={`${PILL} ${tone}`}>{face}</span>

  return (
    <Link
      to="/credits"
      className={`${PILL} ${tone} ${PRESSABLE} ${
        balance === null ? 'hover:ring-rule-strong' : 'hover:ring-accent'
      }`}
    >
      {face}
    </Link>
  )
}
