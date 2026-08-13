/**
 * `role="dialog" aria-modal="true"` 를 **실제로** 모달로 만드는 훅.
 *
 * `aria-modal="true"` 는 선언일 뿐 브라우저가 강제해 주는 게 없습니다. 뒤 화면을
 * 못 만지게 막는 건 구현의 몫인데, W-03 스타일 시트는 W-02 가 본문을
 * `<div inert={sheetOpen}>` 으로 감싸 줘서 공짜로 됐습니다(W02StyleCatalog.tsx Shell).
 * 그 방식은 시트가 **라우트 자식**이라 부모가 열림 여부를 알 때만 성립합니다.
 *
 * AccountSheet · InsufficientCreditOverlay 는 아무 화면에서나 인라인으로 뜨므로
 * inert 를 걸어 줄 부모가 없습니다. 그래서 실제로 이런 상태였습니다:
 *   - 열려도 포커스가 body 에 남음 → Tab 한 번에 **오버레이 뒤**로 나감
 *   - 가려진 «다시 만들기 · 1 크레딧» 에 키보드로 도달 → 안 보이는 채로 크레딧 결제
 *   - Escape 로 닫히지 않음(스타일 시트는 닫힘 — 같은 앱에서 규칙이 갈림)
 *
 * 그래서 여기서 네 가지를 한 벌로 처리합니다: 열 때 포커스 이동 · Tab 순환 가둠 ·
 * Escape 닫기 · 배경 스크롤 잠금. 닫을 때는 열기 전 포커스가 있던 곳으로
 * 되돌립니다 — 안 그러면 시트를 닫은 키보드 사용자가 문서 맨 위로 떨어집니다.
 *
 * 복원이 **항상** 되지는 않습니다. 요청이 나가는 동안 트리거 버튼을 disabled 로
 * 바꾸는 화면(W-04 «이대로 만들기» → 402)에서는 시트가 뜨기 전에 브라우저가 이미
 * 포커스를 body 로 옮겨 놓습니다. 그 경우 되돌릴 대상이 없어 body 에 남습니다.
 * 제대로 하려면 트리거를 클릭 시점에 호출부가 잡아 넘겨야 하는데, 그건 이 훅이
 * 아니라 화면의 몫입니다. 시트가 떠 있는 동안의 가둠은 그와 무관하게 성립합니다.
 *
 * inert 를 쓰지 않은 이유: 이 시트들의 «배경» 은 형제 노드가 아니라 화면 전체라
 * 감쌀 지점이 화면마다 다릅니다. 포커스 가둠은 감쌀 곳 없이 시트 혼자 성립합니다.
 */

import { useEffect, useRef } from 'react'

/** 탭 순서에 실제로 들어가는 것들. `[tabindex="-1"]` 은 프로그램 포커스 전용이라 뺍니다. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 반환한 ref 를 `role="dialog"` 엘리먼트에 답니다. 그 엘리먼트에는
 * `tabIndex={-1}` 이 있어야 합니다 — 열 때 포커스를 받을 대상이 자기 자신입니다.
 */
export function useModalDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null)

  // onClose 는 렌더마다 새 함수일 수 있습니다. 이걸 effect 의존성에 넣으면
  // 시트가 살아 있는 동안 리스너가 재등록되면서 포커스 이동이 다시 일어납니다.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    // 닫은 뒤 돌아갈 자리. 시트를 연 그 버튼입니다.
    const restoreTo = document.activeElement as HTMLElement | null

    dialog.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      // 매번 다시 찾습니다 — 로그인 성공처럼 시트 내용이 통째로 바뀝니다.
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      )

      // 내용이 스켈레톤뿐이라 탭 대상이 없을 때도 밖으로 새면 안 됩니다.
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = dialog.contains(active)

      if (event.shiftKey) {
        if (!inside || active === first || active === dialog) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    // 뒤 화면이 같이 스크롤되면 «내가 뭘 움직인 거지» 가 됩니다(W-03 과 같은 처리).
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      // 이미 사라진 노드로는 못 돌아갑니다(로그인 후 화면이 바뀐 경우).
      if (restoreTo?.isConnected) restoreTo.focus()
    }
  }, [])

  return ref
}
