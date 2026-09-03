/**
 * 되돌릴 수 없는 동작을 확인받는 창 — 로그아웃 · 보관함 삭제 · 펫 프로필 삭제/이름 변경.
 *
 * 세 화면이 **완전히 같은 껍데기**를 각자 복제하고 있었습니다(LogoutConfirm ·
 * W09Library · W12MyPage). 문제는 중복 자체가 아니라 그 복제본 중 어느 것도
 * `useModalDialog` 를 달지 않았다는 것입니다 — `role="dialog" aria-modal="true"` 까지는
 * 그대로 베껴 갔는데, 그건 보조기술에 대한 선언일 뿐이라 브라우저가 강제해 주는 게
 * 없습니다. 그래서 셋 다 Tab 한 번이면 포커스가 창 밖 뒤 화면으로 나갔습니다.
 * 삭제 여부를 묻는 창이 떠 있는데 보이지도 않는 뒤쪽 버튼이 눌리는 상태입니다.
 *
 * 훅을 세 군데에 따로 다는 대신 껍데기를 여기로 모은 이유가 그것입니다. 다음에 확인
 * 창을 만드는 사람은 훅의 존재를 몰라도 됩니다 — 이걸 쓰면 이미 들어 있고, 안 쓰고
 * 직접 `role="dialog"` 를 그리면 `modalContract.test.ts` 가 잡습니다. 이슈 #94 가 남긴
 * «새 시트를 만들면 CASES 에 한 줄 추가하세요» 라는 사람 규칙이 세 번 연속 지켜지지
 * 않았으니, 지키지 않아도 되게 만드는 쪽이 맞습니다.
 *
 * 여기 없는 것: 확인 버튼. 문구도 색도(삭제는 `bg-danger`, 로그아웃은 `bg-brand`)
 * 처리 중 표시도 화면마다 달라서 `children` 으로 받습니다. 공통인 «취소» 만 답니다.
 */

import type { ReactNode } from 'react'
import { useModalDialog } from './useModalDialog'

export default function ConfirmDialog({
  title,
  titleId,
  onClose,
  children,
  closeLabel,
}: {
  title: string
  /** `aria-labelledby` 가 가리킬 제목 id. 한 화면에 창이 둘 이상이면 서로 달라야 합니다. */
  titleId: string
  onClose: () => void
  children: ReactNode
  /** 닫기 버튼 문구. 확인 창은 «취소», 항목을 고르는 시트(공유)는 «닫기». */
  closeLabel?: string
}) {
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
      {/*
        배경을 버튼으로 두는 건 «바깥을 눌러 닫기» 를 마우스에게 주기 위한 것입니다.
        키보드에는 Escape 가 있고(훅), 이 버튼도 탭 순서에 들어가지만 창 안이 아니라
        형제라 가둠 밖입니다 — 그래서 Tab 으로는 닿지 않습니다.
      */}
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // 훅이 열자마자 여기로 포커스를 옮깁니다. 빠지면 포커스가 body 에 남습니다.
        tabIndex={-1}
        className="relative w-full rounded-t-2xl bg-surface p-5 outline-none desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        {children}
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3 hover:text-ink">
          {closeLabel ?? '취소'}
        </button>
      </div>
    </div>
  )
}
