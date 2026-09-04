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
import StylesRedirect from './StylesRedirect'

/*
  랜딩(W-01)만 정적으로 들여옵니다. 나머지 열한 화면은 `lazy` 로 갈라 별도 청크가
  됩니다 — 아래 `screen()` 이 그 한 줄짜리 규약입니다.

  왜 가르는지: 이 앱은 쇼핑몰의 홍보 유입구라 **첫 화면이 곧 이탈률**입니다. 그런데
  정적 import 는 랜딩 한 장을 그리려고 결과(W-06 1181줄)·업로드(W-04 1116줄)·
  보관함(W-09 768줄)까지 전부 받아 파싱하게 만듭니다. 랜딩에서 저 셋을 볼 확률은
  0 이고, 그 중 하나에 도달할 때쯤이면 사용자는 이미 화면을 보고 있어서 몇십 KB 를
  더 받는 걸 기다림으로 느끼지 않습니다.

  react-router 의 `lazy` 를 씁니다 — `React.lazy` 가 아닙니다. 그쪽은 렌더 중에
  던져서(`throw promise`) Suspense 경계를 요구하고, 경계를 어디에 두든 **직전 화면이
  통째로 사라졌다가** 폴백이 뜹니다. 라우터의 `lazy` 는 전환을 «시작하기 전에» 청크를
  받으므로 이전 화면이 그대로 서 있고, 화면 전환이 늦어질 뿐 깜빡이지 않습니다.
  이 앱에는 로딩 스피너를 새로 만들 자리가 없다는 뜻이기도 합니다.

  `handle.title` 은 여기 남습니다(`lazy` 안으로 넣지 않습니다). 제목은 화면을 받기
  **전에** 필요하고 — 전환이 시작되는 순간 탭 이름이 바뀌어야 합니다 — 무엇보다
  `routes.test.tsx` 가 «화면을 띄우지 않고 표를 센다» 는 전제 위에 서 있습니다.
  제목이 청크 안으로 들어가면 그 검사는 표만 보고는 제목을 찾을 수 없게 됩니다.
*/
function screen(load: () => Promise<{ default: React.ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

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
      // 홈이 곧 원페이지 갤러리입니다(옛 W-01 랜딩 + W-02 카탈로그). 제목 없이
      // 브랜드 이름 하나로 둡니다 — "누띠 사진 놀이터 · 누띠 사진 놀이터".
      //
      // W-03 상세 시트는 이 홈의 **자식**입니다(`/styles/:styleId`). 시트가 떠도 뒤
      // 그리드가 살아 있어야 하고(#p03 노트1), 카드를 눌러 열 때 부모가 그대로라
      // 스크롤·필터가 보존됩니다. `/styles/101` 로 직접 들어와도 닫으면 홈이 섭니다.
      // 시트는 제목을 따로 갖지 않습니다 — 뒤 갤러리가 살아 있으므로 탭 제목까지
      // 바뀌면 «다른 화면으로 갔다» 는 잘못된 신호가 됩니다.
      {
        path: '/',
        element: <W01Landing />,
        children: [{ path: 'styles/:styleId', lazy: screen(() => import('../screens/W03StyleDetail')) }],
      },
      // 옛 카탈로그 주소 — 홈으로 넘깁니다(위 StylesRedirect). `/styles/:styleId` 는
      // 이 규칙보다 구체적인 홈의 자식이 먼저 잡으므로 상세 시트는 그대로 열립니다.
      { path: '/styles', element: <StylesRedirect /> },
      // 스타일 맥락은 `?style_id=`. W-08(커스텀 프롬프트)도 스타일 없이 이 화면에 옵니다.
      { path: '/upload', lazy: screen(() => import('../screens/W04Upload')), handle: { title: '사진 올리기' } },
      // job_id 가 경로에 있어야 재방문 시 복원됩니다(Q7).
      {
        path: '/jobs/:jobId/waiting',
        lazy: screen(() => import('../screens/W05Waiting')),
        handle: { title: '만드는 중' },
      },
      // 한 라우트가 완성·실패·열람 불가를 모두 렌더하므로 중립적인 이름을 씁니다.
      { path: '/jobs/:jobId', lazy: screen(() => import('../screens/W06Result')), handle: { title: '결과' } },
      // 결과에서 넘기는 주 경로는 W-06 배너가 **직접** 계산기로 나갑니다(UC-06 (c),
      // 노트6 — 필수 경유지가 아님). 이 라우트는 결과가 눈앞에 없을 때의 진입
      // (`?pet_id=`)이고, W-09 보관함에서 강아지 필터를 걸면 그 링크가 나옵니다.
      {
        path: '/calculator',
        lazy: screen(() => import('../screens/W07Calculator')),
        handle: { title: '간식량 계산기' },
      },
      { path: '/creative', lazy: screen(() => import('../screens/W08Creative')), handle: { title: '직접 만들기' } },
      { path: '/library', lazy: screen(() => import('../screens/W09Library')), handle: { title: '보관함' } },
      { path: '/credits', lazy: screen(() => import('../screens/W10Credits')), handle: { title: '크레딧 받기' } },
      // W-10 B(받은 내역)는 자기 앱바·뒤로가기를 가진 별도 프레임입니다(#p10 B).
      {
        path: '/credits/ledger',
        lazy: screen(() => import('../screens/W10Ledger')),
        handle: { title: '받은 내역' },
      },
      // W-12 마이페이지(이슈 #12 신설). 앱바 아바타가 유일한 진입점입니다
      // (app/AccountEntry.tsx) — 탭바에는 넣지 않습니다.
      { path: '/me', lazy: screen(() => import('../screens/W12MyPage')), handle: { title: '마이페이지' } },
      {
        path: '/admin',
        lazy: async () => ({ Component: (await import('../screens/placeholders')).W11Console }),
        handle: { title: '프롬프트 운영 콘솔' },
      },
      // 화면이 아니라 OAuth 복귀 지점입니다 — 프로바이더 콘솔에 등록하는 redirect_uri 가
      // 이 주소라(§3 인증) 경로를 바꾸면 카카오·네이버·카페24 설정도 같이 바꿔야 합니다.
      {
        path: '/auth/callback/:provider',
        lazy: screen(() => import('../screens/AuthCallback')),
        handle: { title: '로그인 중' },
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await import('../screens/placeholders')).NotFound }),
        handle: { title: '페이지를 찾을 수 없어요' },
      },
    ],
  },
]

/**
 * 갈라 둔 화면 청크를 **첫 화면이 뜬 뒤** 미리 받아 둡니다.
 *
 * 코드 분할이 값을 치르는 자리가 여기입니다. 전환이 시작될 때 청크를 받으므로,
 * 느린 회선에서 탭을 눌렀는데 **아무 반응이 없는 구간**이 생깁니다 — 이 앱에는
 * 라우터의 전환 대기를 표시하는 자리가 없어서(`useNavigation` 을 읽는 곳이 없습니다)
 * 그 침묵이 그대로 «안 눌렸나» 로 읽힙니다. 스피너를 새로 만드는 것보다 **기다림
 * 자체를 없애는 편**이 낫습니다.
 *
 * 유휴 시점에 도는 것이 계약입니다. 첫 페인트를 앞당기려고 가른 것을 그 앞에 다시
 * 세우면 아무것도 얻지 못합니다 — `requestIdleCallback` 이 없는 사파리에서는
 * 타이머로 대신하되 넉넉히 뒤로 미룹니다.
 *
 * 전부 받습니다(합쳐서 gzip 45KB 남짓). 어느 화면으로 갈지 맞히려 들면 빗나간
 * 사용자만 손해를 보는데, 이 앱의 다음 화면은 랜딩 CTA(업로드)·탭바(스타일·보관함)로
 * 갈리고 그 셋이 이미 큰 쪽입니다. 데이터 절약 모드는 존중합니다 — 그 설정을 켠
 * 사람에게 «쓸지도 모르는» 코드를 미리 밀어 넣지 않습니다.
 */
export function warmScreens(): void {
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return

  const warm = () => {
    const walk = (nodes: RouteObject[]) => {
      for (const node of nodes) {
        // 실패는 삼킵니다 — 미리 받기는 어디까지나 덤이고, 실제 이동은 라우터가
        // 그때 다시 부릅니다. 여기서 뜬 오류가 콘솔에 남으면 진짜 오류를 가립니다.
        //
        // `lazy` 는 함수 말고 «속성별 지연» 객체(`LazyRouteObject`)일 수도 있습니다.
        // 위 표는 전부 함수형이지만, 좁히지 않으면 타입이 안 맞고 나중에 객체형을
        // 하나 섞었을 때 조용히 터집니다.
        if (typeof node.lazy === 'function') void node.lazy()
        if (node.children) walk(node.children)
      }
    }
    walk(routes)
  }

  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 3_000 })
  else setTimeout(warm, 2_000)
}

export const router = createBrowserRouter(routes)
