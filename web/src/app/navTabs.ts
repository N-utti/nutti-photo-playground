/**
 * 내비 목적지 — 모바일 하단 탭바(app/TabBar.tsx)와 데스크톱 상단 GNB(app/DesktopNav.tsx)가
 * **같은 곳**을 가리키게 하는 한 벌입니다. 둘이 서로 다른 목록을 들면 그건 두 개의 앱입니다.
 *
 * 아이콘은 여기 없습니다. 탭바만 아이콘을 쓰고 GNB 는 글자만 쓰는데, 아이콘 컴포넌트를
 * 이 파일에 같이 두면 «컴포넌트와 상수를 한 파일에서 내보내지 말라»(react-refresh)에
 * 걸립니다. 탭바가 자기 파일에서 key 로 아이콘을 찾습니다.
 *
 * 순서와 이름은 와이어프레임 표기(#p02·#p09 탭바)를 따르되, 맨 앞에 «홈» 을 더했습니다.
 * 와이어프레임의 4칸에는 `/` 로 돌아오는 길이 **W-02 앱바의 24px 짜리 로고 마크 하나뿐**
 * 이었고(W-09 에는 그것도 없습니다), 로고가 홈이라는 건 웹의 관습이지 손가락에 보이는
 * 문은 아닙니다.
 *
 * «만들기» 가 `/upload` 인 것은 FR-W01-02(사진이 먼저 — 랜딩 CTA 도 스타일 없이 여기로
 * 들어옵니다)와 FR-W08-01(크리에이티브 모드는 «만들기» 안의 보조 진입점)이 같이
 * 규정합니다. `/creative` 는 탭이 아니라 그 화면 안의 한 줄입니다.
 *
 * 누띠샵은 여기 없습니다 — 앱 밖으로 나가는 링크라 `<a target="_blank">` 이고, 출구
 * 위치까지 이벤트로 남깁니다(app/externalLinks.ts). 두 내비가 각자 붙입니다.
 */

export const TABS = [
  { key: 'home', label: '홈', to: '/' },
  { key: 'styles', label: '스타일', to: '/styles' },
  { key: 'create', label: '만들기', to: '/upload' },
  { key: 'library', label: '보관함', to: '/library' },
] as const

export type TabKey = (typeof TABS)[number]['key']

/**
 * `/styles` 는 자식 라우트가 있어서(`/styles/101` = W-03 시트) 정확히 일치로만 보면
 * 시트가 열린 순간 활성 표시가 꺼집니다. 시트는 여전히 카탈로그 위에 있는 것이므로
 * 접두사로 봅니다.
 *
 * «홈»(`/`)만은 접두사 규칙이 저절로 비껴갑니다 — 붙여 만든 접두사가 `//` 라 어떤
 * 경로와도 안 맞고, 결국 정확히 일치할 때만 켜집니다. 원하던 결과입니다: 여기서
 * 접두사로 봤다면 모든 화면에서 홈이 켜져 있었을 겁니다.
 */
export function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}
