/**
 * 라우트 테이블 — 11개 화면(W-01~W-11) 전건에 자리를 잡아 둡니다.
 *
 * URL 설계 원칙: **결과는 URL 로 복원 가능해야 합니다.** W-05 완료 알림을 MVP 에서
 * 뺀 대체재가 "URL 보존 + 재방문 시 복원"이므로(07-decisions.md Q7), job_id 가
 * 경로에 들어가야 합니다. 단 게스트에게 이 복원이 실제로 성립하지 않는 조건이
 * 있어 확인 중입니다(이슈 #5).
 */

import { createBrowserRouter, type RouteObject } from 'react-router'
import RootLayout from './RootLayout'
import W01Landing from '../screens/W01Landing'
import W02StyleCatalog from '../screens/W02StyleCatalog'
import W03StyleDetail from '../screens/W03StyleDetail'
import W04Upload from '../screens/W04Upload'
import W05Waiting from '../screens/W05Waiting'
import W06Result from '../screens/W06Result'
import W07Calculator from '../screens/W07Calculator'
import W08Creative from '../screens/W08Creative'
import W09Library from '../screens/W09Library'
import W10Credits from '../screens/W10Credits'
import W10Ledger from '../screens/W10Ledger'
import W12MyPage from '../screens/W12MyPage'
import AuthCallback from '../screens/AuthCallback'
import { NotFound, W11Console } from '../screens/placeholders'

/**
 * `handle.title` 은 브라우저 탭·뒤로가기 목록·스크린리더가 읽는 이름입니다
 * (app/RootLayout.tsx `DocumentTitle`). 여기 없으면 그 화면은 앞 화면의 제목을
 * 그대로 달고 다닙니다 — 새 라우트를 추가할 때 같이 적어 주세요. 빠뜨리면
 * `routes.test.tsx` 가 «$path 가 제목을 선언한다» 로 실패합니다.
 *
 * 표와 라우터를 갈라 둔 이유도 그것입니다 — `createBrowserRouter` 는 부르는 순간
 * 실제 주소창에 붙어서, 표만 따로 있어야 화면을 띄우지 않고 표를 셀 수 있습니다.
 */
export const routes: RouteObject[] = [
  {
    // 세션 배너를 한 곳에서만 달기 위한 껍데기 라우트입니다(경로 없음).
    element: <RootLayout />,
    children: [
      // 랜딩만 제목 없이 브랜드 이름 하나로 둡니다 — "누띠 사진 놀이터 · 누띠 사진 놀이터".
      { path: '/', element: <W01Landing /> },
      // W-03 은 W-02 의 **자식**입니다 — 시트가 떠도 뒤 그리드가 살아 있어야 하고
      // (#p03 노트1), /styles/101 로 직접 들어와도 닫으면 탐색이 이어져야 합니다.
      {
        path: '/styles',
        element: <W02StyleCatalog />,
        handle: { title: '스타일' },
        // 시트는 제목을 따로 갖지 않습니다 — 뒤의 카탈로그가 그대로 살아 있으므로
        // 탭 제목까지 바뀌면 «다른 화면으로 갔다» 는 잘못된 신호가 됩니다.
        children: [{ path: ':styleId', element: <W03StyleDetail /> }],
      },
      // 스타일 맥락은 `?style_id=`. W-08(커스텀 프롬프트)도 스타일 없이 이 화면에 옵니다.
      { path: '/upload', element: <W04Upload />, handle: { title: '사진 올리기' } },
      // job_id 가 경로에 있어야 재방문 시 복원됩니다(Q7).
      { path: '/jobs/:jobId/waiting', element: <W05Waiting />, handle: { title: '만드는 중' } },
      // 한 라우트가 완성·실패·열람 불가를 모두 렌더하므로 중립적인 이름을 씁니다.
      { path: '/jobs/:jobId', element: <W06Result />, handle: { title: '결과' } },
      // 결과에서 넘기는 주 경로는 W-06 배너가 **직접** 계산기로 나갑니다(UC-06 (c),
      // 노트6 — 필수 경유지가 아님). 이 라우트는 결과가 눈앞에 없을 때의 진입
      // (`?pet_id=`)이고, W-09 보관함에서 강아지 필터를 걸면 그 링크가 나옵니다.
      { path: '/calculator', element: <W07Calculator />, handle: { title: '간식량 계산기' } },
      { path: '/creative', element: <W08Creative />, handle: { title: '직접 만들기' } },
      { path: '/library', element: <W09Library />, handle: { title: '보관함' } },
      { path: '/credits', element: <W10Credits />, handle: { title: '크레딧 받기' } },
      // W-10 B(받은 내역)는 자기 앱바·뒤로가기를 가진 별도 프레임입니다(#p10 B).
      { path: '/credits/ledger', element: <W10Ledger />, handle: { title: '받은 내역' } },
      // W-12 마이페이지(이슈 #12 신설). 앱바 아바타가 유일한 진입점입니다
      // (app/AccountEntry.tsx) — 탭바에는 넣지 않습니다.
      { path: '/me', element: <W12MyPage />, handle: { title: '마이페이지' } },
      { path: '/admin', element: <W11Console />, handle: { title: '프롬프트 운영 콘솔' } },
      // 화면이 아니라 OAuth 복귀 지점입니다 — 프로바이더 콘솔에 등록하는 redirect_uri 가
      // 이 주소라(§3 인증) 경로를 바꾸면 카카오·네이버·카페24 설정도 같이 바꿔야 합니다.
      { path: '/auth/callback/:provider', element: <AuthCallback />, handle: { title: '로그인 중' } },
      { path: '*', element: <NotFound />, handle: { title: '페이지를 찾을 수 없어요' } },
    ],
  },
]

export const router = createBrowserRouter(routes)
