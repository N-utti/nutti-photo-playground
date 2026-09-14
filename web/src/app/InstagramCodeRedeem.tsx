/**
 * 인스타 DM 링크(`?ig=CODE`)로 들어온 사람이 로그인하면 **어느 화면에 있든** 코드를 소진해
 * 팔로우 크레딧을 바로 넣습니다.
 *
 * 코드는 서버가 팔로우를 API 로 확인한 사람에게만 발급하므로(app/instagram.py) 아이디 입력이나
 * 「팔로우하러 가기」 대기 없이 곧장 지급됩니다(`POST /credits/redeem-instagram`). 예전에는 이
 * 배선이 W-10 획득 목록 안에 있어서 홈에서 로그인만 하고 크레딧 화면을 안 연 사람은 받지
 * 못했습니다 — 세션 복구(sessionRecovery.tsx)와 같은 이유로 RootLayout 에 둡니다.
 *
 * 성공은 말하지 않습니다. 크레딧 캐시가 무효화돼 앱바 배지와 W-10 팔로우 행(완료)이
 * 바뀌고, DM 문구가 이미 「로그인하면 자동으로 들어가요」라 별도 카드는 겹말입니다.
 *
 * **실패는 말합니다.** 옮기기 전에는 W-10 의 빨간 문구가 이유를 말했는데(같은 mutation),
 * 전역으로 오면서 자기 mutation 을 따로 들게 돼 그 문구가 사라졌습니다. 성공·실패 어느
 * 쪽이든 코드는 지우므로(다시 넣어도 404/409 로 결과가 같음) 아무 말도 안 하면 사용자는
 * «링크 눌렀는데 아무 일도 없네» 를 로그인까지 마친 뒤에 겪습니다 — DM 링크를 단체방에
 * 공유해 남이 먼저 쓴 코드가 되는 건 실제로 나는 일입니다. 카드 자리는 세션 안내·job
 * 상태 바와 같은 아래 떠 있는 자리이고, 누가 먼저인지는 RootLayout 의 FloatingStatus 가
 * 한 곳에서 정합니다. 소진 자체(`useInstagramCodeRedeem`)와 실패 문구 표는 코드를 기억하는
 * 쪽(instagramCode.ts)에 있습니다 — 이 파일은 카드만 그립니다.
 */

import { redeemErrorMessage } from './instagramCode'

export default function InstagramRedeemNotice({ error, onClose }: { error: Error; onClose: () => void }) {
  return (
    // 자리와 z 는 세션 안내·job 상태 바와 같습니다(app/SessionNotice.tsx 주석).
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 px-5 desktop:px-7 desktop:bottom-5">
      <div
        role="alert"
        className="mx-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-rule-strong bg-surface p-4 shadow-md"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">인스타 팔로우 크레딧을 넣지 못했어요</p>
          <p className="mt-1 text-sm text-ink-2">{redeemErrorMessage(error)}</p>
        </div>
        <button
          type="button"
          aria-label="안내 닫기"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-xl text-ink-3 hover:bg-brand-soft hover:text-ink"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
