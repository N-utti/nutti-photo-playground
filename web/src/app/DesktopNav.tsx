/**
 * 데스크톱 상단 GNB — **모든 화면**에 붙는 유일한 내비입니다. RootLayout 이 깝니다.
 *
 * **로고 / 화면 이름 | 크레딧 · 계정** 입니다. 화면 이름은 라우트의 `handle.title`
 * (routes.tsx)에서 옵니다 — 탭 제목과 같은 값입니다(app/routeTitle.ts). 홈은 제목이
 * 없어 로고 혼자 섭니다.
 *
 * 화면 이름이 여기 선 이유: 각 화면 앱바(← + 제목)가 데스크톱에서 GNB 바로 밑에 한
 * 줄 더 붙어 있었습니다. 처음엔 흰 띠였고(#286 에서 바탕 위 제목 한 줄로 내림), 그
 * 뒤에도 «← 크레딧 받기» 가 1440px 왼쪽 끝에 혼자 떠 있었습니다. ← 는 브라우저
 * 뒤로가기와 로고가 이미 하는 일이라 데스크톱에서는 할 일이 없고, 남는 건 «지금 어느
 * 화면인가» 뿐입니다 — 그건 GNB 의 빈 가운데가 로고 옆에서 말할 수 있습니다. 그래서
 * 여덟 화면 앱바는 데스크톱에서 통째로 숨기고(`desktop:hidden`, 홈·보관함이 먼저 그렇게
 * 하고 있었습니다) 이름만 여기로 올렸습니다. 화면마다 «제목을 둘지» 정할 일이 없고,
 * 라우트 표에 제목을 적는 순간 GNB 에도 섭니다.
 *
 * 이름은 **h1** 입니다. 화면 앱바의 h1 이 데스크톱에서 display:none 으로 접근성
 * 트리에서도 빠지므로, 데스크톱에서는 이게 그 화면의 유일한 h1 이고 모바일(GNB 없음)
 * 에서는 앱바의 h1 이 그 자리를 맡습니다. 한 화면에 h1 하나입니다.
 *
 * 로고 링크 **밖**에 둡니다. 이름까지 눌러서 홈으로 가면 «누른 게 뭔지» 가 흐려집니다.
 * 사이의 세로 선은 장식이라 읽지 않습니다(`aria-hidden`).
 *
 * 그 전에는 **로고 | 크레딧 · 계정** 뿐이었습니다. 가운데 탭 목록(홈·만들기·보관함)과 누띠샵을
 * 걷어냈습니다 — 홈은 로고가 겸하고(원페이지 갤러리), 만들기는 스타일을 눌러 들어가며,
 * 보관함은 회원 전용이라 마이페이지(W-12) 안으로, 누띠샵도 마이페이지의 작은 링크로
 * 옮겼습니다. 모바일 하단 탭바는 통째로 없앴습니다(핀터레스트·carat 처럼 최소 내비).
 *
 * 크레딧·계정을 여기 하나로 모은 이유는 그대로입니다 — 배지가 앱바 여러 곳에 흩어져
 * 위아래로 겹치던 것을 이 줄로 올리고 각 화면 앱바를 데스크톱에서 내렸습니다. 계정
 * 진입점(마이페이지)도 여기 하나입니다.
 *
 * 높이는 `h-16`(64px)로 **선언**합니다. 이 아래에 붙어 서는 것(보관함 W-09 의 선택
 * 툴바, `desktop:top-16`)이 이 값을 알아야 하는데, 내용에 따라 알아서 정해지게 두면
 * 언젠가 1px 씩 어긋나 툴바가 GNB 를 덮거나 그 아래 틈이 생깁니다.
 *
 * **이 값을 바꾸면 세 곳을 같이 바꿔야 합니다** — W-09 선택 툴바의 `desktop:top-16`,
 * `index.css` 의 `screen-min-h`(창 높이에서 GNB 를 빼는 계산), 그리고 이 주석입니다.
 *
 * 나머지 여덟 화면의 앱바(← + 제목)는 데스크톱에서 **숨깁니다**(`desktop:hidden`).
 * 이름은 위 설명대로 이 줄이 대신 냅니다. 모바일은 GNB 가 없어 앱바가 그대로 붙어 섭니다.
 * 56px 이었는데 레퍼런스(carat 62px · Pinterest 80px)보다 낮아 로고가 갑갑했습니다.
 *
 * z 는 앱바와 같은 20 입니다. 둘은 세로로 만나지 않아서(GNB 는 top-0, 앱바는 top-16)
 * 겹칠 일이 없고, 30 으로 올리면 시트·모달(z-30)이 GNB 를 못 덮어 모달 위로 나가는
 * 문이 다섯 개 열립니다.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AccountEntry } from './AccountEntry'
import { BrandLockup } from './BrandLockup'
import { CreditBadge } from './CreditBadge'
import { useRouteTitle } from './routeTitle'

export default function DesktopNav() {
  const title = useRouteTitle()
  /*
    배경은 페이지와 같은 `bg-paper` 이고 테두리도 없습니다 — 헤더가 크림 배경 위로
    뜨지 않고 녹아듭니다(핀터레스트·carat). 다만 배경색이 같아 **테두리가 없으면**,
    스크롤한 순간 뒤 카드가 이 바 아래 끝에서 경계 없이 잘려 «떠 있는 크림 띠» 처럼
    보입니다. 그래서 핀터레스트와 같은 방식으로 **스크롤됐을 때만** 옅은 그림자를 답니다
    — 맨 위(히어로)에서는 분리할 게 없어 그림자도 없고, 내리는 순간에만 경계가 섭니다.

    스크롤 위치를 rAF 로 접어 프레임당 한 번만 읽습니다(W-02 앵커바가 쓰던 것과 같은
    이유). 8px 은 «살짝이라도 내렸다» 의 문턱입니다.
  */
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    let frame = 0
    const read = () => {
      frame = 0
      setScrolled(window.scrollY > 8)
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
    }
  }, [])

  return (
    <header
      /*
        그림자는 200ms·ease-out 으로 켜고 끕니다. `<header>` 는 index.css 의 전역 전환
        규칙(button · a[href] · [role=button])에 안 걸려서, 안 적으면 Tailwind 기본값
        150ms·ease 로 돕니다 — 값이 어디서 오는지 모르는 채로 도는 셈입니다.

        200ms 는 집안 값이고(`duration-200`), 타이밍은 전역 규칙과 같은 `ease-out` 입니다.
        스크롤 문턱(8px) 근처에서 오갈 때 150ms 보다 덜 깜빡입니다.
      */
      className={`sticky top-0 z-20 hidden h-16 bg-paper px-5 desktop:px-7 transition-shadow duration-200 ease-out desktop:block ${
        scrolled ? 'shadow-[0_2px_10px_-6px_rgba(51,46,42,0.35)]' : ''
      }`}
    >
      {/*
        본문 컨테이너(`--container-canvas`)로 가운데 정렬하지 않습니다. 바로 아래
        화면 앱바가 폭 전체를 쓰는 줄이라(`px-5 desktop:px-7`), GNB 만 1180px 안으로
        모으면 두 줄이 붙어 있는데 왼쪽 끝이 서로 어긋납니다 — 1440px 에서 로고는 130px,
        앱바의 ← 는 20px 에서 시작했습니다.

        **이 값은 앱바를 따라가야 합니다.** 화면 앱바의 좌우 여백을 바꾸면 여기도 같이
        바꾸세요 — 안 그러면 위아래 두 줄의 왼쪽 끝이 조용히 어긋납니다. 지금 값은
        모바일 20px · 데스크톱 28px 이고, 28px 은 레퍼런스 실측치입니다(carat 안쪽
        컨테이너 28px · Pinterest 로고 28px). 모바일 20px 은 carat 과 같은 값이라
        그대로 뒀습니다.
      */}
      <div className="flex h-full w-full items-center gap-6">
        {/*
          W-02 앱바와 같은 규칙입니다 — 로고를 누르면 홈. 옆에 «홈» 탭이 따로 있어
          중복처럼 보이지만, 로고가 홈이라는 건 웹의 관습이라 여기 없으면 사람들이
          로고를 누르고 아무 일도 안 일어나는 경험을 합니다.
        */}
        <Link to="/" className="-m-2 flex shrink-0 p-2">
          <BrandLockup className="text-base" />
        </Link>

        {/*
          구분은 글자 `/` 가 아니라 **1px 세로 선**입니다(Linear 문서 헤더 실측: 로고
          높이와 같은 20px 선, 양쪽 12px, 낮은 대비의 선 색, 제목은 로고와 같은 색의
          중간 굵기). `/` 는 GitHub 처럼 «경로의 다음 칸» 으로 읽히고, 글자라 굵고
          짧아서 로고와 이름 사이에 얹힌 얼룩처럼 보였습니다. 선은 높이를 로고 글자
          (`text-base`, 16px)에 맞추고 색은 `rule-strong` — 앱의 다른 구분선과 같은 색.

          왼쪽은 `-ml-3` 으로 당겨 선 양쪽이 12px 씩 같게 합니다(GNB 의 `gap-6` 은
          오른쪽 배지 묶음과의 간격입니다). 이름은 `ink` 중간 굵기 — 흐리게 하지
          않습니다. 로고가 갈색이라 검정 이름은 색으로 이미 구분되고, 흐리면 «비활성»
          으로 읽힙니다.
        */}
        {title && (
          <div className="-ml-3 flex items-center gap-3 text-base">
            <span aria-hidden className="h-4 w-px bg-rule-strong" />
            <h1 className="font-medium text-ink">{title}</h1>
          </div>
        )}

        {/*
          가운데 탭 목록(홈·만들기·보관함)과 누띠샵을 걷어냈습니다 — 홈은 로고가
          겸하고(원페이지 갤러리), 만들기는 스타일을 눌러 들어가며, 보관함은 마이페이지
          안으로, 누띠샵도 마이페이지의 작은 링크로 옮겼습니다. GNB 는 이제 «로고 |
          크레딧 · 계정» 뿐입니다(핀터레스트·carat 처럼 최소).

          데스크톱에서는 크레딧 배지도 계정 진입점도 **여기 하나**입니다. 배지는 원래
          앱바 여러 곳에 흩어져 있었고 이 줄에 넣으면 겹쳤습니다 — 그래서 여기로 올리고
          각 화면 앱바를 데스크톱에서 내렸습니다.
        */}
        <div className="ml-auto flex items-center gap-3">
          <CreditBadge showUnit />
          <AccountEntry />
        </div>
      </div>
    </header>
  )
}
