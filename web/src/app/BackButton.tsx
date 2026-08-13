/**
 * 앱바의 ← — **직전 페이지로 돌아갑니다. 예외 없습니다.**
 *
 * 원래는 화면마다 달랐습니다. W-04·W-07·W-08·W-10 A 는 `navigate(-1)`, W-06 은
 * `/styles` 고정, W-10 B 는 `/credits` 고정, W-12 는 `state.from` — 각각 그 화면
 * 안에서는 말이 되는 규칙이었지만, 사용자에게는 같은 자리의 같은 화살표입니다.
 * 눌러 보기 전에는 어느 쪽인지 알 수 없는 버튼이라 되돌아가는 길을 못 믿게 됩니다.
 * 그래서 규칙을 하나로 접었습니다 — ← 는 히스토리 한 칸 뒤입니다.
 *
 * `fallback` 은 **돌아갈 앱 화면이 없을 때만** 씁니다(아래 `hasAppHistory`).
 * 공유 링크·주소 직접 입력·OAuth 복귀처럼 우리 화면이 뒤에 없는 진입에서
 * `navigate(-1)` 은 앱 밖(또는 아무 데도 아닌 곳)으로 나가므로, 그 한 경우에만
 * 화면이 정한 상위 경로로 보냅니다. `replace` 인 이유: 그 이동은 「뒤로」이지
 * 「새 화면」이 아니라서, 히스토리에 쌓이면 ← 를 두 번 눌러야 나갈 수 있게 됩니다.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router'

/**
 * 뒤에 **우리 화면**이 있는지.
 *
 * react-router 의 history 가 항목마다 `idx` 를 찍습니다(첫 항목 0, push 마다 +1 —
 * node_modules/react-router `getUrlBasedHistory`). 그래서 `idx > 0` 이면 이 탭에서
 * 우리가 직접 쌓은 항목이 뒤에 있다는 뜻입니다. `window.history.length` 로는 이걸
 * 알 수 없습니다 — 다른 사이트에서 넘어온 항목까지 세기 때문에, 링크를 타고 처음
 * 들어온 사용자에게도 "뒤가 있다"고 답합니다.
 *
 * 새로고침 후에도 `idx` 는 그 항목에 남아 있으므로 판정이 유지됩니다.
 */
function hasAppHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}

/** 컴포넌트 밖으로 내보내지 않습니다 — ← 는 이 파일의 버튼 하나로만 만듭니다. */
function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    if (hasAppHistory()) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}

export default function BackButton({ fallback }: { fallback: string }) {
  const goBack = useGoBack(fallback)

  return (
    <button type="button" onClick={goBack} aria-label="뒤로" className="text-ink-2 hover:text-ink">
      ←
    </button>
  )
}
