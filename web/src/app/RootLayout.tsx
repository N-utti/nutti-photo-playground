/**
 * 전 화면 공통 껍데기. 지금 하는 일은 세션 안내와 job 상태 바 둘입니다.
 *
 * 둘 다 «특정 화면의 문제가 아닌 것»이라 여기 있습니다. 세션 상실·발급 제한은 앱
 * 전체가 요청을 못 보내는 상태이고, 만드는 중인 job 은 어느 화면을 보고 있든 계속
 * 진행 중입니다 — 화면마다 따로 처리하면 빠지는 곳이 생기고, 하필 빠진 화면에서
 * 사용자가 그걸 잃습니다.
 *
 * 세션 쪽은 예전에 화면 맨 위의 전폭 배너였습니다. 지금 «끊겼다» 는 사용자에게
 * 말하지 않고 앱이 처리합니다(app/sessionRecovery.tsx). 남은 안내 둘은 아래 떠 있는
 * 카드이고, 왜 그렇게 바뀌었는지는 app/SessionNotice.tsx 앞머리에 있습니다.
 */

import { useEffect } from 'react'
import { Outlet, useMatches } from 'react-router'
import AuthWelcomeDialog from './AuthWelcomeDialog'
import DesktopNav from './DesktopNav'
import JobStatusBar from './JobStatusBar'
import SessionNotice from './SessionNotice'
import SessionRecovery from './sessionRecovery'
import { useSessionNotice } from './sessionStatus'

export default function RootLayout() {
  return (
    <>
      <DocumentTitle />
      {/* 그리는 것이 없습니다 — 회원 세션이 끊긴 순간 게스트로 내려앉히는 배선입니다.
          여기 있는 이유는 위 둘과 같습니다: 어느 화면에서든 끊길 수 있습니다. */}
      <SessionRecovery />
      {/*
        데스크톱 상단 GNB (app/DesktopNav.tsx). 모바일 하단 탭바와 달리 화면이 직접
        붙이지 않고 여기서 한 번에 깝니다 — 붙일 화면을 고르는 판단 자체가 없어야
        «모든 화면에서 보인다» 가 성립하고, 새 라우트가 늘어도 빠지지 않습니다.
      */}
      <DesktopNav />
      <Outlet />
      {/* 화면 위에 떠 있는 것이라 흐름의 마지막에 둡니다 — 같은 z 인 탭바와 만나도
          이쪽이 위입니다. 붙이고 뗄 조건은 전부 그 안에 있습니다. */}
      <FloatingStatus />
      {/*
        소셜 로그인 복귀 알림(app/AuthWelcomeDialog.tsx). 여기 있는 이유는 위 둘과
        같습니다 — 로그인을 누른 화면이 랜딩·결과·크레딧 어디든 될 수 있어서, 붙일
        화면을 고르는 판단이 있으면 언젠가 한 곳이 빠집니다.
      */}
      <AuthWelcomeDialog />
    </>
  )
}

/**
 * 아래 떠 있는 자리 하나를 둘이 나눠 씁니다.
 *
 * 세션이 끊긴 동안 job 바는 그릴 게 없습니다 — 토큰이 죽어 폴링이 실패하는 중이라
 * 진행률이 그 자리에 얼어 있고, 그건 «되고 있다» 는 거짓말입니다. 판단을 여기 한
 * 곳에 둔 이유는 두 컴포넌트가 서로의 존재를 알지 않게 하려는 것입니다.
 *
 * 훅이 이 안에 있는 것도 의도입니다. RootLayout 본체에서 부르면 세션 상태가 바뀔
 * 때마다 `<Outlet />` 이 통째로 다시 그려집니다.
 */
function FloatingStatus() {
  const notice = useSessionNotice()

  // key 로 안내 종류를 물립니다 — 종류가 바뀌면 «닫음» 도 같이 초기화돼야 합니다.
  // 발급 제한을 닫아 둔 채 로그인이 끊기면 그 소식까지 함께 삼켜집니다.
  return notice ? <SessionNotice key={notice} notice={notice} /> : <JobStatusBar />
}

const SITE_NAME = '누띠 사진 놀이터'

/** 라우트가 `handle.title` 로 선언한 이름 (routes.tsx). */
type TitleHandle = { title?: string }

/**
 * 주소가 바뀌면 `document.title` 도 바꿉니다.
 *
 * SPA 라 index.html 의 <title> 한 줄이 끝까지 갑니다 — 열두 화면이 전부
 * "누띠 사진 놀이터" 였습니다. 그러면 세 군데가 같이 망가집니다:
 *   - 뒤로가기 **길게 누르기** 목록이 전부 같은 줄이라 어디로 돌아가는지 못 고릅니다
 *   - 탭을 여러 개 띄우면 어느 탭이 결과 화면인지 구분되지 않습니다
 *   - 스크린리더는 화면 전환을 제목으로 알리는데, 매번 같은 말을 듣습니다
 *
 * 제목은 라우트에 붙여 둡니다(`handle.title`) — 화면 컴포넌트마다 useEffect 를
 * 흩뿌리면 새 화면에서 빠뜨리기 쉽고, 빠뜨려도 티가 안 납니다.
 */
function DocumentTitle() {
  const matches = useMatches()
  // 가장 깊은 매치부터 거슬러 올라가 첫 title 을 씁니다 — W-03 시트처럼 자식이
  // 제목을 안 가진 경우 부모(카탈로그)의 제목이 그대로 남습니다.
  const label = [...matches]
    .reverse()
    .map((match) => (match.handle as TitleHandle | undefined)?.title)
    .find((title): title is string => Boolean(title))

  useEffect(() => {
    document.title = label ? `${label} · ${SITE_NAME}` : SITE_NAME
  }, [label])

  return null
}
