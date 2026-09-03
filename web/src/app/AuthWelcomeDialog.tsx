/**
 * 소셜 로그인 직후의 «로그인됐어요» 모달 (app/authWelcome.ts).
 *
 * 이 창이 뜨는 자리는 **로그인을 누른 그 화면**입니다 — 콜백이 먼저 그리로 되돌린 뒤
 * 알림만 위에 얹습니다. 뒤에 원래 보던 화면이 그대로 서 있는 것이 핵심입니다. 예전의
 * 전용 페이지는 그 배경이 없어서, 성공했는데도 실패 화면처럼 읽혔습니다.
 *
 * RootLayout 에 답니다(screens 가 아니라 app 에 있는 이유). 복귀 지점은 랜딩·결과·
 * 크레딧 어디든 될 수 있어서, 붙일 화면을 고르는 판단이 있으면 언젠가 한 화면이
 * 빠집니다 — 하필 빠진 화면에서 사용자는 로그인이 됐는지조차 모르게 됩니다.
 */

import {
  authWelcomeBalance,
  authWelcomeMessage,
  dismissAuthWelcome,
  useAuthWelcome,
  type AuthWelcome,
} from './authWelcome'
import { useModalDialog } from './useModalDialog'

export default function AuthWelcomeDialog() {
  const welcome = useAuthWelcome()
  // 껍데기를 안쪽 컴포넌트로 가른 이유는 훅입니다 — `useModalDialog` 의 포커스 이동·
  // 스크롤 잠금은 «열리는 순간» 한 번 돌아야 하는데, 여기서 조건부로 부를 수 없습니다.
  if (!welcome) return null
  return <WelcomeDialog welcome={welcome} onClose={dismissAuthWelcome} />
}

/**
 * 껍데기만 따로 내보냅니다 — 모달 계약 검사(`useModalDialog.test.tsx`)가 스토어를
 * 건드리지 않고 열어 보기 위해서입니다. 앱에서 부르는 쪽은 위 기본 export 하나입니다.
 */
export function WelcomeDialog({ welcome, onClose }: { welcome: AuthWelcome; onClose: () => void }) {
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
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
        aria-labelledby="auth-welcome-title"
        // 훅이 열자마자 여기로 포커스를 옮깁니다. 빠지면 포커스가 body 에 남습니다.
        tabIndex={-1}
        className="relative w-full rounded-t-2xl bg-surface p-5 outline-none desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id="auth-welcome-title" className="text-base font-bold">
          로그인됐어요
        </h2>
        <p className="mt-1 text-sm text-ink-2">{authWelcomeMessage(welcome.merged)}</p>
        <p className="mt-1 text-sm text-ink-2">{authWelcomeBalance(welcome.creditBalance)}</p>
        {/*
          닫기 버튼 하나뿐입니다. 여기서 다른 화면으로 나가는 링크(보관함 · 마이페이지)를
          주지 않는 건 의도입니다 — 사용자는 방금 하던 일 중간에 로그인을 눌렀고, 뒤에
          그 화면이 이미 떠 있습니다. 새 목적지를 권하면 원래 하던 일을 잃습니다.
        */}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
        >
          계속하기
        </button>
      </div>
    </div>
  )
}
