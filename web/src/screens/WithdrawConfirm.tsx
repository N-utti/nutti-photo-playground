/**
 * 회원 탈퇴 확인 (FR-W12-06 · 이슈 #123 · 백엔드 #22 → PR #120).
 *
 * 이 화면이 존재하는 이유는 «한 번 더 물어보기» 가 아니라 **고지**입니다. 탈퇴는
 * 되돌릴 수 없고, 무엇이 사라지는지 사용자가 여기서 처음이자 마지막으로 봅니다.
 * 이슈 #123 이 못 박은 고지 3건을 그대로 답니다:
 *
 *   1. 업로드한 사진·생성 결과물이 **즉시 파기**되고 복구되지 않음
 *   2. 크레딧 잔액이 **소멸**하고 재가입해도 안 돌아옴 — 지금 잔액을 함께 보여 줍니다.
 *      «크레딧이 사라집니다» 는 잔액이 0 인 사람에게는 아무 말도 아니고, 12 인 사람에게는
 *      멈춰 설 이유입니다. 그 차이를 화면이 대신 판단하지 않습니다
 *   3. **누띠 쇼핑몰(카페24) 회원과는 무관** — 이슈 #22 PO 결정의 고지 의무입니다.
 *      W-12 D 섹션이 쇼핑몰 연동을 보여 주는 화면이라 «연동했으니 쇼핑몰 계정도
 *      지워지나» 가 실제로 생기는 오해입니다
 *
 * 확인 문구를 타이핑하게 하는 방식(«탈퇴합니다» 입력)은 쓰지 않습니다 — 이 앱의 다른
 * 되돌릴 수 없는 동작(보관함 삭제·펫 삭제)이 전부 ConfirmDialog 한 겹이고, 여기만
 * 다르게 하면 «어려운 것 = 위험한 것» 이라는 규칙을 화면마다 다시 배워야 합니다.
 * 대신 버튼을 danger 색으로 두고 고지를 버튼 위에 답니다.
 */

import { useNavigate } from 'react-router'
import { useCredits, useWithdraw } from '../api/queries'
import ConfirmDialog from '../app/ConfirmDialog'

export default function WithdrawConfirm({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const withdraw = useWithdraw()
  const { data: credits } = useCredits()

  return (
    <ConfirmDialog title="정말 탈퇴할까요?" titleId="withdraw-title" onClose={onClose}>
      <p className="mt-1 text-sm text-ink-2">되돌릴 수 없어요. 아래를 먼저 확인해 주세요.</p>

      <ul className="mt-3 space-y-2 rounded-lg border border-rule bg-surface-2 px-3 py-3 text-sm text-ink-2">
        <li>
          <span className="font-semibold text-ink">올린 사진과 만든 결과물이 즉시 지워져요.</span>{' '}
          다시 살릴 수 없으니 남기고 싶은 사진은 먼저 저장해 주세요.
        </li>
        <li>
          <span className="font-semibold text-ink">
            크레딧
            {/*
              잔액을 아직 못 받았으면 숫자를 지어내지 않습니다 — 0 으로 그리면 «어차피
              없다» 고 읽히고, 그 순간 12 개를 두고 탈퇴하는 사람이 생깁니다.
              (app/CreditBadge.tsx 가 같은 이유로 «—» 를 씁니다. 표시는 max(0,·) 로
              — ADR-02 상 잔액은 음수가 될 수 있는데 «-3개가 사라져요» 는 말이 안 됩니다.)
            */}
            {credits ? ` ${Math.max(0, credits.balance)}개가` : ' 잔액이'} 사라져요.
          </span>{' '}
          같은 이메일로 다시 가입해도 돌아오지 않아요.
        </li>
        <li>
          <span className="font-semibold text-ink">누띠 쇼핑몰 회원은 그대로예요.</span> 놀이터
          계정만 지워지고, 쇼핑몰 계정과 주문 내역에는 영향이 없어요.
        </li>
      </ul>

      <button
        type="button"
        disabled={withdraw.isPending}
        onClick={() =>
          withdraw.mutate(undefined, {
            /*
              랜딩으로 보냅니다(이슈 #123 3번). `replace` 인 이유는 뒤로가기로 마이페이지에
              돌아오면 그 화면이 «회원» 을 전제로 그려지기 때문입니다 — 지금은 게스트라
              GuestPanel 이 뜨겠지만, 방금 지운 계정의 화면으로 되돌아가는 동선 자체를
              남기지 않습니다.
            */
            onSuccess: () => navigate('/', { replace: true }),
          })
        }
        className="mt-4 w-full rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper hover:brightness-110 motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {withdraw.isPending ? '탈퇴하는 중…' : '탈퇴하기'}
      </button>

      {withdraw.isError && (
        /*
          실패했으면 계정은 **그대로 살아 있습니다**(endpoints.ts `withdraw` 는 204 를
          받은 뒤에만 로컬을 비웁니다). 그러니 여기서 «탈퇴됐다» 는 인상을 주면 안 되고,
          다시 시도할 수 있다고 말해야 합니다.
        */
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          탈퇴하지 못했어요. 계정은 그대로 있으니 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
    </ConfirmDialog>
  )
}
