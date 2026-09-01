/**
 * 인스타 DM으로 받은 1회용 코드를 랜딩에서 기억합니다 (05 §3 `POST /credits/redeem-instagram`).
 *
 * DM 링크는 `https://play.nutti.co.kr/?ig=K7M2P9QX` 꼴입니다. 링크로 들어온 사람은 대개 아직
 * 게스트라 그 자리에서 소진할 수 없고(회원 전용), 로그인·가입을 거친 뒤 W-10 에서 자동으로
 * 넣어 줘야 «링크 눌렀는데 아무 일도 없네» 가 안 생깁니다. localStorage 인 이유: 소셜 로그인은
 * 전체 페이지 이동이라 메모리는 물론 sessionStorage 도 탭이 바뀌면(인스타 인앱 브라우저 →
 * 외부 브라우저 열기) 사라질 수 있어서입니다. 코드 자체는 팔로우가 확인된 사람에게만 발급되고
 * 인스타 계정당 1회라 오래 남아 있어도 남이 쓸 수 없습니다.
 */

const CODE_KEY = 'nutti.instagram.code'
const CODE_PATTERN = /^[A-Za-z0-9]{6,16}$/

/** 앱 부팅 시 한 번 — 주소의 `?ig=` 를 저장하고 주소창에서는 지웁니다(새로고침·공유 시 재소진 시도 방지). */
export function captureInstagramCode(): void {
  try {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('ig')
    if (!code) return
    if (CODE_PATTERN.test(code)) localStorage.setItem(CODE_KEY, code.toUpperCase())
    url.searchParams.delete('ig')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // localStorage 가 막힌 브라우저 — 코드는 DM 에 그대로 남아 있으니 수동 입력으로 물러납니다.
  }
}

export function peekInstagramCode(): string | null {
  try {
    const stored = localStorage.getItem(CODE_KEY)
    return stored && CODE_PATTERN.test(stored) ? stored : null
  } catch {
    return null
  }
}

export function clearInstagramCode(): void {
  try {
    localStorage.removeItem(CODE_KEY)
  } catch {
    // 지울 수 없으면 다음 소진 시도가 404/409 로 끝나고 그때 다시 지웁니다.
  }
}
