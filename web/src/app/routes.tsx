/**
 * 라우트 테이블 — 11개 화면(W-01~W-11) 전건에 자리를 잡아 둡니다.
 *
 * URL 설계 원칙: **결과는 URL 로 복원 가능해야 합니다.** W-05 완료 알림을 MVP 에서
 * 뺀 대체재가 "URL 보존 + 재방문 시 복원"이므로(07-decisions.md Q7), job_id 가
 * 경로에 들어가야 합니다. 단 게스트에게 이 복원이 실제로 성립하지 않는 조건이
 * 있어 확인 중입니다(이슈 #5).
 */

import { createBrowserRouter } from 'react-router'
import W02StyleCatalog from '../screens/W02StyleCatalog'
import {
  NotFound,
  W01Landing,
  W03StyleDetail,
  W04Upload,
  W05Waiting,
  W06Result,
  W07Calculator,
  W08Creative,
  W09Library,
  W10Credits,
  W11Console,
} from '../screens/placeholders'

export const router = createBrowserRouter([
  { path: '/', element: <W01Landing /> },
  { path: '/styles', element: <W02StyleCatalog /> },
  { path: '/styles/:styleId', element: <W03StyleDetail /> },
  { path: '/upload', element: <W04Upload /> },
  // job_id 가 경로에 있어야 재방문 시 복원됩니다(Q7).
  { path: '/jobs/:jobId/waiting', element: <W05Waiting /> },
  { path: '/jobs/:jobId', element: <W06Result /> },
  { path: '/calculator', element: <W07Calculator /> },
  { path: '/creative', element: <W08Creative /> },
  { path: '/library', element: <W09Library /> },
  { path: '/credits', element: <W10Credits /> },
  { path: '/admin', element: <W11Console /> },
  { path: '*', element: <NotFound /> },
])
