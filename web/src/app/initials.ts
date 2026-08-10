/**
 * 이름에서 아바타·자리 표시자에 넣을 **한 글자**.
 *
 * 코드 포인트 단위로 자릅니다 — `slice(0, 1)` 은 이모지를 서러게이트 반쪽으로 잘라
 * 깨진 문자를 그립니다. 회원 이니셜(memberIdentity.ts)과 펫 썸네일 폴백
 * (app/Thumbnail.tsx)이 같은 규칙을 써야 화면마다 다른 모양이 나오지 않습니다.
 */
export function initialOf(name: string): string {
  return [...name][0] ?? ''
}
