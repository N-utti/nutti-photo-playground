/**
 * 바깥으로 나가는 고정 링크.
 *
 * 쇼핑몰·인스타는 API 대상이 아니라 **운영이 갱신하는 정적 값**입니다
 * (05-api-spec §2 W-06 "쇼핑몰 행", W-10 "쇼핑몰 →"). 화면마다 문자열을 적어 두면
 * 주소가 바뀔 때 한 곳이 반드시 남으므로 여기 모읍니다.
 */

export const NUTTI_SHOP_URL = 'https://nutti.co.kr'

/**
 * 놀이터 → 쇼핑몰 출구 위치. GA4·카페24 유입경로에서 «어느 화면이 주문을 만들었나»를 가르는 키입니다.
 *
 * `tabbar` 와 `gnb` 는 같은 «누띠샵» 칸이지만 나눠 둡니다 — 전자는 모바일 하단 탭바,
 * 후자는 데스크톱 상단 GNB 입니다. 합쳐 두면 이 출구가 모바일에서 눌리는지 데스크톱에서
 * 눌리는지 GA4 에서 갈라볼 수 없고, 그건 이 링크를 어디에 둘지 정할 때 필요한 숫자입니다.
 */
export type ShopExit = 'w06_result' | 'w10_credits' | 'tabbar' | 'gnb'

/**
 * 쇼핑몰로 나가는 **레퍼럴 링크** (PO 요청 2026-09-01).
 *
 * 맨 링크로 보내면 쇼핑몰 쪽 GA4·카페24 유입경로에 «직접 유입/기타»로 남아 놀이터가 만든 매출을
 * 증명할 수 없습니다. UTM 은 백엔드 계산기 링크(app/routers/results.py)와 같은 규약을 씁니다 —
 * `utm_source=nutti_playground` 로 두 출구가 GA4 에서 한 소스로 묶이고, `utm_content` 가 화면을 가릅니다.
 * GA4 크로스도메인 `_gl` 은 gtag 가 **`<a href>` 클릭에만** 붙이므로(app/analytics.ts) 이 URL 은 반드시
 * 앵커의 href 로 쓰고 JS 이동으로 바꾸지 마세요.
 */
export function shopLink(exit: ShopExit): string {
  const url = new URL(NUTTI_SHOP_URL)
  url.searchParams.set('utm_source', 'nutti_playground')
  url.searchParams.set('utm_medium', 'referral')
  url.searchParams.set('utm_campaign', 'playground_exit')
  url.searchParams.set('utm_content', exit)
  return url.toString()
}

/** W-10 인스타 팔로우 행(+2). 계정명은 와이어프레임 #p10 표기. */
export const NUTTI_INSTAGRAM_HANDLE = '@nutti_official'
export const NUTTI_INSTAGRAM_URL = 'https://www.instagram.com/nutti_official/'
