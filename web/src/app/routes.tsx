/**
 * 라우트 테이블 — 11개 화면(W-01~W-11) 전건에 자리를 잡아 둡니다.
 *
 * URL 설계 원칙: **결과는 URL 로 복원 가능해야 합니다.** W-05 완료 알림을 MVP 에서
 * 뺀 대체재가 "URL 보존 + 재방문 시 복원"이므로(07-decisions.md Q7), job_id 가
 * 경로에 들어가야 합니다. 단 게스트에게 이 복원이 실제로 성립하지 않는 조건이
 * 있어 확인 중입니다(이슈 #5).
 */

import { createBrowserRouter } from 'react-router'
import RootLayout from './RootLayout'
import W01Landing from '../screens/W01Landing'
import W02StyleCatalog from '../screens/W02StyleCatalog'
import W03StyleDetail from '../screens/W03StyleDetail'
import W04Upload from '../screens/W04Upload'
import W05Waiting from '../screens/W05Waiting'
import W06Result from '../screens/W06Result'
import W10Credits from '../screens/W10Credits'
import W10Ledger from '../screens/W10Ledger'
import {
  NotFound,
  W07Calculator,
  W08Creative,
  W09Library,
  W11Console,
} from '../screens/placeholders'

export const router = createBrowserRouter([
  {
    // 세션 배너를 한 곳에서만 달기 위한 껍데기 라우트입니다(경로 없음).
    element: <RootLayout />,
    children: [
      { path: '/', element: <W01Landing /> },
      // W-03 은 W-02 의 **자식**입니다 — 시트가 떠도 뒤 그리드가 살아 있어야 하고
      // (#p03 노트1), /styles/101 로 직접 들어와도 닫으면 탐색이 이어져야 합니다.
      {
        path: '/styles',
        element: <W02StyleCatalog />,
        children: [{ path: ':styleId', element: <W03StyleDetail /> }],
      },
      // 스타일 맥락은 `?style_id=`. W-08(커스텀 프롬프트)도 스타일 없이 이 화면에 옵니다.
      { path: '/upload', element: <W04Upload /> },
      // job_id 가 경로에 있어야 재방문 시 복원됩니다(Q7).
      { path: '/jobs/:jobId/waiting', element: <W05Waiting /> },
      { path: '/jobs/:jobId', element: <W06Result /> },
      { path: '/calculator', element: <W07Calculator /> },
      { path: '/creative', element: <W08Creative /> },
      { path: '/library', element: <W09Library /> },
      { path: '/credits', element: <W10Credits /> },
      // W-10 B(받은 내역)는 자기 앱바·뒤로가기를 가진 별도 프레임입니다(#p10 B).
      { path: '/credits/ledger', element: <W10Ledger /> },
      { path: '/admin', element: <W11Console /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
