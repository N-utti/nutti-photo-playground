/**
 * 데스크톱 상단 GNB — **모든 화면**에 붙는 유일한 내비입니다. RootLayout 이 깝니다.
 *
 * 이제 **로고 | 크레딧 · 계정** 뿐입니다. 가운데 탭 목록(홈·만들기·보관함)과 누띠샵을
 * 걷어냈습니다 — 홈은 로고가 겸하고(원페이지 갤러리), 만들기는 스타일을 눌러 들어가며,
 * 보관함은 회원 전용이라 마이페이지(W-12) 안으로, 누띠샵도 마이페이지의 작은 링크로
 * 옮겼습니다. 모바일 하단 탭바는 통째로 없앴습니다(핀터레스트·carat 처럼 최소 내비).
 *
 * 크레딧·계정을 여기 하나로 모은 이유는 그대로입니다 — 배지가 앱바 여러 곳에 흩어져
 * 위아래로 겹치던 것을 이 줄로 올리고 각 화면 앱바를 데스크톱에서 내렸습니다. 계정
 * 진입점(마이페이지)도 여기 하나입니다.
 *
 * 높이는 `h-14`(56px)로 **선언**합니다. 각 화면 앱바가 이 아래에 붙어 서려면
 * (`desktop:top-14`) 이 값을 알아야 하는데, 내용에 따라 알아서 정해지게 두면 언젠가
 * 1px 씩 어긋나 앱바가 GNB 를 덮거나 그 아래 틈이 생깁니다.
 *
 * z 는 앱바와 같은 20 입니다. 둘은 세로로 만나지 않아서(GNB 는 top-0, 앱바는 top-14)
 * 겹칠 일이 없고, 30 으로 올리면 시트·모달(z-30)이 GNB 를 못 덮어 모달 위로 나가는
 * 문이 다섯 개 열립니다.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AccountEntry } from './AccountEntry'
import { BrandLockup } from './BrandLockup'
import { CreditBadge } from './CreditBadge'

export default function DesktopNav() {
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
      className={`sticky top-0 z-20 hidden h-14 bg-paper px-5 transition-shadow desktop:block ${
        scrolled ? 'shadow-[0_2px_10px_-6px_rgba(51,46,42,0.35)]' : ''
      }`}
    >
      {/*
        본문 컨테이너(`--container-canvas`)로 가운데 정렬하지 않습니다. 바로 아래
        화면 앱바가 폭 전체를 쓰는 줄이라(`px-5`), GNB 만 1180px 안으로 모으면 두 줄이
        붙어 있는데 왼쪽 끝이 서로 어긋납니다 — 1440px 에서 로고는 130px, 앱바의 ← 는
        20px 에서 시작했습니다.

        **이 값은 앱바를 따라가야 합니다.** 화면 앱바의 좌우 여백을 바꾸면 여기도 같이
        바꾸세요 — 안 그러면 위아래 두 줄의 왼쪽 끝이 조용히 어긋납니다.
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
