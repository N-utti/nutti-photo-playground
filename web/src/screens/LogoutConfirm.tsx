/**
 * 로그아웃 확인 (FR-W12-05).
 *
 * W-01 헤더의 임시 진입점에서 시작했지만 이제 마이페이지(W-12 E 섹션)의 것입니다.
 * 두 곳에서 같은 문구·같은 동작이어야 해서 컴포넌트로 분리했습니다.
 *
 * 확인을 한 겹 두는 이유: 로그아웃은 이 브라우저를 다시 게스트로 되돌리는 동작이라
 * (api/queries.ts `useLogout`) 로컬 계정 사용자가 비밀번호를 기억 못 하면 돌아올
 * 방법이 없습니다 — MVP 에 비밀번호 재설정이 없기 때문입니다(이슈 #17).
 */

import { useLogout } from '../api/queries'

export default function LogoutConfirm({ onClose }: { onClose: () => void }) {
  const logout = useLogout()

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        className="relative w-full rounded-t-2xl bg-surface p-5 desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id="logout-title" className="text-base font-bold">
          로그아웃할까요?
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          이 브라우저는 다시 게스트로 시작해요. 계정에 쌓인 결과와 크레딧은 그대로 있고, 다시
          로그인하면 이어서 쓸 수 있어요.
        </p>

        <button
          type="button"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: onClose })}
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
        >
          {logout.isPending ? '로그아웃 중…' : '로그아웃'}
        </button>

        {logout.isError && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            로그아웃은 됐지만 새 게스트 세션을 받지 못했어요. 잠시 뒤 새로고침해 주세요.
          </p>
        )}

        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3">
          취소
        </button>
      </div>
    </div>
  )
}
