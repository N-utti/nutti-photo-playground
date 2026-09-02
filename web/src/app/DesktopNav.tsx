/**
 * 데스크톱 상단 GNB — **모든 화면**에 붙는 유일한 내비입니다.
 *
 * 하단 탭바(app/TabBar.tsx)는 이제 모바일 전용이고, 그쪽은 세 화면(W-01·W-02·W-09)
 * 에만 붙습니다. 그 규칙을 데스크톱으로 그대로 가져오면 넓은 화면에서 만들기 흐름에
 * 들어간 순간 내비가 통째로 사라집니다 — 마우스에는 «뒤로» 제스처가 없어서, 남는
 * 길이 앱바의 ← 하나뿐입니다. 그래서 이건 RootLayout 이 깝니다.
 *
 * **탭바가 만들기 흐름을 피했던 이유는 여기서 다시 따지지 않습니다.** 하단 탭바를
 * W-04·W-05·W-06 에서 뺀 판단(TabBar.tsx 주석)은 «결제 직전에 나가는 문 셋» 이
 * 엄지 밑에 깔리는 것에 대한 것이었습니다. 상단 GNB 는 그 문이 없어지는 게 아니라
 * 위치가 달라지는 것이고, 데스크톱에서 상단 내비가 항상 있는 것은 웹의 기본값입니다.
 * 다만 전환율에 영향이 있다면 그건 이 화면이 아니라 GA4 에서 먼저 보일 것입니다.
 *
 * 목적지 목록은 TabBar 에서 가져옵니다 — 모바일과 데스크톱이 서로 다른 곳으로 갈 수
 * 있으면 그건 두 개의 앱입니다.
 *
 * 높이는 `h-14`(56px)로 **선언**합니다. 각 화면 앱바가 이 아래에 붙어 서려면
 * (`desktop:top-14`) 이 값을 알아야 하는데, 내용에 따라 알아서 정해지게 두면 언젠가
 * 1px 씩 어긋나 앱바가 GNB 를 덮거나 그 아래 틈이 생깁니다.
 *
 * z 는 앱바와 같은 20 입니다. 둘은 세로로 만나지 않아서(GNB 는 top-0, 앱바는 top-14)
 * 겹칠 일이 없고, 30 으로 올리면 시트·모달(z-30)이 GNB 를 못 덮어 모달 위로 나가는
 * 문이 다섯 개 열립니다.
 */

import { Link, useLocation } from 'react-router'
import { AccountEntry } from './AccountEntry'
import { track } from './analytics'
import { shopLink } from './externalLinks'
import { TABS, isActive } from './navTabs'

export default function DesktopNav() {
  const { pathname } = useLocation()

  return (
    <header className="sticky top-0 z-20 hidden h-14 border-b border-rule bg-surface px-4 desktop:block">
      {/*
        본문 컨테이너(`--container-canvas`)로 가운데 정렬하지 않습니다. 바로 아래
        화면 앱바가 폭 전체를 쓰는 줄이라(`px-4`), GNB 만 1180px 안으로 모으면 두 줄이
        붙어 있는데 왼쪽 끝이 서로 어긋납니다 — 1440px 에서 로고는 130px, 앱바의 ← 는
        16px 에서 시작했습니다.
      */}
      <div className="flex h-full w-full items-center gap-6">
        {/*
          W-02 앱바와 같은 규칙입니다 — 로고를 누르면 홈. 옆에 «홈» 탭이 따로 있어
          중복처럼 보이지만, 로고가 홈이라는 건 웹의 관습이라 여기 없으면 사람들이
          로고를 누르고 아무 일도 안 일어나는 경험을 합니다.
        */}
        <Link to="/" className="-m-2 flex shrink-0 items-center gap-2 p-2 hover:opacity-70">
          <img
            src="/brand/nutti-wordmark.svg"
            alt="누띠"
            width={70}
            height={18}
            className="h-3.5 w-auto"
          />
          <span className="font-display text-base">놀이터</span>
        </Link>

        <nav aria-label="주요 메뉴" className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = isActive(pathname, tab.to)
            return (
              <Link
                key={tab.key}
                to={tab.to}
                aria-current={active ? 'page' : undefined}
                // 지금 있는 탭은 hover 로 안 바뀝니다 — 탭바와 같은 규칙입니다.
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  active ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}

          {/* 누띠샵만 앱 밖입니다. 새 탭으로 여는 이유와 이벤트는 탭바와 같습니다. */}
          <a
            href={shopLink('gnb')}
            target="_blank"
            rel="noreferrer"
            onClick={() => track({ event_type: 'shop_exit_click', properties: { from: 'gnb' } })}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
          >
            누띠샵
          </a>
        </nav>

        {/*
          크레딧 배지는 여기 두지 않습니다. 화면 앱바가 이미 들고 있어서(W-02·W-04·
          W-06·W-08·W-09) 데스크톱에서 같은 숫자가 두 줄에 겹쳐 보이게 됩니다. 계정
          진입점은 반대입니다 — W-02 앱바 하나에만 있어서 나머지 화면에서는 마이페이지로
          가는 문이 없었습니다.
        */}
        <div className="ml-auto flex items-center gap-3">
          <AccountEntry />
        </div>
      </div>
    </header>
  )
}
