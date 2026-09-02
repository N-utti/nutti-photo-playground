/**
 * 하단 탭바 (FR-W02-08 · #p02 · #p09)
 *
 * **어느 화면에 다는가.** 와이어프레임에서 탭바가 그려진 건 W-02 카탈로그와 W-09
 * 보관함 **두 곳뿐**입니다. 02-requirements.md 가 이걸 "전역"이라 부르는 건 "여러
 * 화면에 반복 등장하니 FR 을 한 번만 쓴다"는 문서 규칙이지(§ 서두), 모든 화면에
 * 깔라는 뜻이 아닙니다 — 실제로 탭바 참조 행이 있는 화면 표도 W-09 하나입니다.
 * 여기에 **W-01 랜딩이 뒤늦게 합류했습니다** — 탭바에 «홈» 이 생기면서 목적지가
 * 됐기 때문입니다. 탭으로 도착한 화면에 탭바가 없으면 방금 누른 줄이 통째로 사라져
 * 다음 탭으로 못 넘어갑니다. 아래 «만들기» 와 달리 여기서는 새는 것도 없습니다 —
 * 랜딩은 만들기 흐름이 시작되기 **전**이라 지켜야 할 흐름이 아직 없습니다.
 *
 * 나머지가 빠진 데는 이유가 있습니다. W-04→W-05→W-06 은 만들기 흐름 한복판이라
 * 탭을 깔면 결제 직전에 나가는 문을 세 개 열어 주는 꼴이고, W-10 B·W-12 는 자기
 * 앱바와 뒤로가기를 가진 별도 프레임입니다(#p10 B). W-03 은 W-02 위에 뜨는 시트라
 * 뒤에 탭바가 남지만 시트(z-30)가 덮습니다.
 *
 * 그래서 이 컴포넌트는 RootLayout 이 경로를 보고 자동으로 까는 대신 **화면이 직접
 * 붙입니다**. 크레딧 배지(app/CreditBadge.tsx)와 같은 방식이고, 화면 파일만 읽어도
 * 탭바가 있는지 없는지 보입니다 — 라우트 조건문에 숨어 있으면 라우트가 늘 때마다
 * 그 조건문을 고쳐야 하고, 빠뜨려도 아무도 모릅니다.
 *
 * **«만들기» 탭의 목적지(`/upload`)에는 탭바가 없습니다 — 버그가 아닙니다.** 탭을
 * 눌러 도착한 화면에 탭바가 없는 건 확실히 어색하지만, W-04 는 만들기 흐름의 첫
 * 걸음이라 여기에 이탈문 셋을 열면 전환이 그만큼 샙니다(#p04 는 실제로 탭바를 그리지
 * 않았습니다). 갇히지는 않습니다 — W-04 의 ← 가 `navigate(-1)` 이라 탭으로 들어왔으면
 * 직전 탭으로 정확히 돌아가고, 사진을 고른 뒤에는 «다른 사진 고르기» 로 먼저 떨어집니다.
 * 여기를 바꾸고 싶어지면 «업로드 전 상태에서만 탭바» 같은 조건부보다, 와이어프레임을
 * 고치는 쪽이 먼저입니다.
 *
 * 활성 탭은 `prop` 이 아니라 현재 경로로 정합니다. 화면이 자기 이름을 문자열로
 * 넘기면 그게 틀렸을 때(복사·붙여넣기) 아무 데서도 안 걸립니다.
 *
 * **이제 모바일 전용입니다**(`desktop:hidden`). 한동안 데스크톱에서도 이 하단 바를
 * 그렸는데, 그건 «넓은 화면에서만 숨기면 보관함으로 가는 길이 사라진다» 는 이유였지
 * 하단 바가 데스크톱에 맞아서가 아니었습니다. 그 자리를 상단 GNB(app/DesktopNav.tsx)가
 * 가져갔습니다 — 그쪽은 **모든 화면**에 붙으므로, 여기서 데스크톱을 놓아도 길이 줄지
 * 않고 오히려 여덟 화면에서 늘어납니다.
 *
 * 목적지 목록은 app/navTabs.ts 로 나갔습니다 — 두 내비가 같은 곳을 가리켜야 하고,
 * 상수를 컴포넌트 파일에서 내보내면 react-refresh 가 걸립니다.
 */

import { Link, useLocation } from 'react-router'
import { track } from './analytics'
import { shopLink } from './externalLinks'
import { TABS, isActive, type TabKey } from './navTabs'

/** 아이콘은 탭바만 씁니다(GNB 는 글자만) — 그래서 목적지 목록이 아니라 여기 있습니다. */
const ICONS: Record<TabKey, () => React.ReactElement> = {
  home: HomeIcon,
  styles: GridIcon,
  create: CameraIcon,
  library: PhotoStackIcon,
}

export function TabBar() {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="주요 메뉴"
      // z-20 — W-03 시트·삭제 확인(z-30)보다 아래입니다. 모달이 떠 있는데 탭바가
      // 그 위에 뜨면 모달 밖으로 나가는 길이 열려 모달이 아니게 됩니다.
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] desktop:hidden"
    >
      <ul className="mx-auto flex w-full max-w-md">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.to)
          const Icon = ICONS[tab.key]
          return (
            <li key={tab.key} className="flex-1">
              <Link
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                // 지금 있는 탭은 hover 로 안 바뀝니다 — 이미 «여기» 라고 말하고 있는
                // 것을 커서가 또 흔들면 어디에 있는지가 흐려집니다.
                className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                  active ? 'font-semibold text-brand' : 'text-ink-3 hover:text-ink'
                }`}
              >
                <Icon />
                {tab.label}
              </Link>
            </li>
          )
        })}

        {/* 누띠샵만 앱 밖입니다. 새 탭으로 여는 건 나머지 세 탭과 달리 **돌아올 수
            없기 때문**입니다 — 같은 탭에서 나가면 만들던 흐름이 통째로 날아갑니다.
            나가는 링크는 어디서 눌렸는지까지 남깁니다(W-06·W-10 과 같은 이벤트). */}
        <li className="flex-1">
          <a
            href={shopLink('tabbar')}
            target="_blank"
            rel="noreferrer"
            onClick={() =>
              track({ event_type: 'shop_exit_click', properties: { from: 'tabbar' } })
            }
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-ink-3 hover:text-ink"
          >
            <BagIcon />
            누띠샵
          </a>
        </li>
      </ul>
    </nav>
  )
}


// ---------------------------------------------------------------- 아이콘

/**
 * 와이어프레임의 탭 아이콘은 빈 사각형(`<i></i>`)이고 아이콘 세트가 확정된 문서가
 * 없습니다. 그래서 여기 있는 건 **자리를 지키는 최소 도형**이지 브랜드 아이콘이
 * 아닙니다 — `currentColor` 로만 그려서 색은 테마를 따라가고, 확정되면 이 다섯
 * 함수만 갈아 끼우면 됩니다(index.css 의 색 토큰과 같은 취급).
 */
const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 8.5A2 2 0 0 1 5 6.5h2l1.2-2h7.6L19 6.5h0a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

function PhotoStackIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="M3 14.5 7 11l4 3.5" />
      <path d="M20 8v9a2 2 0 0 1-2 2H8" />
    </svg>
  )
}

function BagIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  )
}
