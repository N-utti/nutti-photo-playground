/**
 * 429 의 `Retry-After`(초)를 사람이 읽는 말로 (PR #21).
 *
 * 레이트리밋은 게스트 발급·로그인·가입 세 곳에서 나오고 화면도 세 곳이라, 문구를
 * 각자 만들면 같은 상황을 두고 "잠시 뒤"와 "1시간 뒤"가 동시에 나옵니다.
 *
 * 헤더가 없을 수도 있으므로 null 을 정상 입력으로 취급합니다 — 그때 "잠시 뒤"라고
 * 말하는 건 거짓이 아니라 모른다는 뜻이고, 임의의 숫자를 지어내는 것보다 낫습니다.
 */
export function formatRetryAfter(seconds: number | null): string {
  if (seconds === null) return '잠시 뒤'
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}초 뒤`
  return `약 ${Math.ceil(seconds / 60)}분 뒤`
}
