/**
 * 지금 화면의 이름 — 라우트가 `handle.title` 로 선언한 것(routes.tsx).
 *
 * 읽는 곳이 둘입니다. 브라우저 탭 제목(RootLayout DocumentTitle)과 데스크톱 GNB 의
 * 로고 옆 화면 이름(DesktopNav). 같은 값을 두 곳이 따로 계산하면 언젠가 탭에는
 * 「받은 내역」이 뜨고 GNB 에는 「크레딧 받기」가 남는 식으로 갈립니다.
 *
 * 가장 깊은 매치부터 거슬러 올라가 첫 title 을 씁니다 — W-03 시트처럼 자식이 제목을
 * 안 가진 경우 부모의 제목이 그대로 남습니다. 홈(`/`)은 제목이 없어 `undefined` 입니다.
 *
 * `useMatches` 라서 **데이터 라우터 안에서만** 됩니다(createBrowserRouter /
 * createMemoryRouter). 테스트에서 `MemoryRouter` 로 감싸면 던집니다 — DesktopNav.test 가
 * 실제 라우트 표로 세우는 이유입니다.
 */

import { useMatches } from 'react-router'

type TitleHandle = { title?: string }

export function useRouteTitle(): string | undefined {
  const matches = useMatches()
  return [...matches]
    .reverse()
    .map((match) => (match.handle as TitleHandle | undefined)?.title)
    .find((title): title is string => Boolean(title))
}
