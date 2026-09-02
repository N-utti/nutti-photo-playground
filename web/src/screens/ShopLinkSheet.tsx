/**
 * 쇼핑몰 계정 연동 시트 — SMS 인증번호 2단계 (05 §3 `POST /auth/cafe24/link/{request,verify}`).
 *
 * 카페24 OAuth 는 **몰 운영자** 로그인이라 고객 본인 확인에 쓸 수 없어(2026-09-01 확인)
 * 연동이 «가입 휴대폰 번호(또는 아이디) 입력 → 카페24가 그 회원 휴대폰으로 SMS → 6자리 입력»
 * 으로 바뀌었습니다. 우리는 번호를 저장하지 않고 조회에만 씁니다 — 그 번호의 폰을 쥔 사람만
 * 코드를 압니다.
 *
 * **번호가 기본**인 이유: 카카오/네이버로 쇼핑몰에 가입한 고객의 아이디는 `4993695098@k` 꼴이라
 * 본인이 모릅니다. 아이디 입력은 이메일 가입자용 폴백으로만 남깁니다.
 *
 * 한 번호에 쇼핑몰 계정이 여러 개면(실측 3개) OTP 를 통과한 뒤 목록을 받아 고릅니다 — 그때까지
 * 코드는 소비되지 않으므로 같은 코드로 한 번 더 verify 합니다.
 *
 * W-10 연동 행과 W-12 마이페이지가 이 한 벌을 씁니다(진입점 둘, 구현 하나).
 */

import { useState, type FormEvent } from 'react'
import { ApiError, isApiError } from '../api/client'
import { useCafe24LinkRequest, useCafe24LinkVerify } from '../api/queries'
// `creditAmountPhrase` 는 더 안 씁니다 — 성공 문구가 응답값(`amount_granted`)으로 갔습니다.
// `linkAccountCtaLabel` 은 남습니다: 제출 버튼은 **아직 안 받은** 금액이라 정책값이 맞습니다.
import { linkAccountCtaLabel, useEarnAmount } from '../app/earnAmount'
import FloatingField from '../app/FloatingField'
import { formatRetryAfter } from '../app/retryAfter'
import { useModalDialog } from '../app/useModalDialog'
import type { Cafe24LinkTarget } from '../api/types'

/** 서버 제약과 같은 값(app/routers/auth.py Cafe24LinkRequest) — 왕복 없이 먼저 걸러 줍니다. */
const CELLPHONE_PATTERN = /^01\d{8,9}$/
const SHOP_ID_PATTERN = /^[A-Za-z0-9_.@-]{2,64}$/
const CODE_PATTERN = /^\d{6}$/

type Mode = 'cellphone' | 'shop_member_id'

function linkErrorMessage(error: unknown, mode: Mode): string {
  if (isApiError(error, 'CAFE24_MEMBER_NOT_FOUND')) {
    return mode === 'cellphone'
      ? '이 번호로 가입된 쇼핑몰 회원을 찾지 못했어요. 쇼핑몰 가입 때 쓴 번호인지 확인해 주세요.'
      : '그 아이디의 쇼핑몰 회원을 찾지 못했어요. 아이디를 확인해 주세요.'
  }
  if (isApiError(error, 'CAFE24_CODE_INVALID')) return '인증번호가 맞지 않거나 만료됐어요. 인증번호를 다시 받아 주세요.'
  // 두 방향 모두 409 — 이 쇼핑몰 계정이 남에게 붙어 있거나, 내 계정이 이미 다른 쇼핑몰
  // 계정에 붙어 있거나. 연동 해제가 MVP 에 없어 어느 쪽이든 스스로 풀 수 없습니다.
  if (isApiError(error, 'CAFE24_ALREADY_LINKED')) {
    return '이미 다른 계정과 연동된 쇼핑몰 계정이거나, 이 계정에 다른 쇼핑몰 계정이 연동돼 있어요. 연동 변경은 고객센터로 문의해 주세요.'
  }
  if (isApiError(error, 'MEMBER_ONLY')) return '로그인 후 연동할 수 있어요.'
  if (isApiError(error, 'RATE_LIMITED')) {
    const retryAfter = error instanceof ApiError ? error.retryAfter : null
    return `인증번호 요청이 너무 많았어요. ${formatRetryAfter(retryAfter)} 다시 시도해 주세요.`
  }
  if (isApiError(error, 'BAD_GATEWAY')) return '쇼핑몰 문자 발송이 잠시 안 되고 있어요. 잠시 뒤 다시 시도해 주세요.'
  if (error instanceof Error) return error.message
  return '연동하지 못했어요.'
}

export default function ShopLinkSheet({ onClose }: { onClose: () => void }) {
  const request = useCafe24LinkRequest()
  const verify = useCafe24LinkVerify()
  /*
    보상 금액은 이 시트가 정하지 않습니다 — `app_setting.link_account_amount` 고, 운영이
    바꿀 수 있게 된 값입니다(백엔드 PR #186). 두 진입점(W-10 목록 · W-12 마이페이지)이
    이미 이 값을 화면에 적고 있어, 시트만 리터럴로 두면 같은 흐름 안에서 숫자가 갈립니다.
  */
  const linkAmount = useEarnAmount('link_account')
  const [mode, setMode] = useState<Mode>('cellphone')
  const [value, setValue] = useState('')
  const [code, setCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  // mutate 를 다시 부르면 `request.data` 가 비므로(v5 pending 리셋) «다시 받기» 중에 1단계로
  // 깜빡 되돌아갑니다 — 단계는 파생값이 아니라 상태로 들고 있습니다.
  const [sent, setSent] = useState(false)
  // 후보 목록도 같은 이유로 상태입니다. `verify.data` 에서 파생시키면 후보를 하나 고르는
  // 순간 `pick()` 의 `verify.mutate` 가 `data` 를 비우고, **목록 화면이 통째로 사라져**
  // 인증번호 입력 화면으로 되돌아갔다가 응답이 와야 다시 넘어갑니다. 고르는 중에 고르던
  // 화면이 없어지는 셈이고, 실패하면 무엇을 고르던 중이었는지도 함께 사라집니다.
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)

  const done = verify.data?.cafe24_linked ? verify.data : null
  const target: Cafe24LinkTarget = mode === 'cellphone' ? { cellphone: value } : { shop_member_id: value }

  /** 후보는 «이 번호로 조회한 결과»라, 조회 대상이 바뀌면 같이 버립니다. */
  function switchMode(next: Mode) {
    setMode(next)
    setValue('')
    setFormError(null)
    setCandidates(null)
    request.reset()
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const trimmed = mode === 'cellphone' ? value.replace(/\D/g, '') : value.trim()
    if (mode === 'cellphone' ? !CELLPHONE_PATTERN.test(trimmed) : !SHOP_ID_PATTERN.test(trimmed)) {
      setFormError(
        mode === 'cellphone'
          ? '휴대폰 번호를 확인해 주세요. (01로 시작하는 10~11자리)'
          : '쇼핑몰 아이디를 확인해 주세요. (영문·숫자, 2~64자)',
      )
      return
    }
    setValue(trimmed)
    verify.reset()
    setCandidates(null)
    setCode('')
    const body: Cafe24LinkTarget = mode === 'cellphone' ? { cellphone: trimmed } : { shop_member_id: trimmed }
    request.mutate(body, { onSuccess: () => setSent(true) })
  }

  function submitVerify(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!CODE_PATTERN.test(code)) {
      setFormError('문자로 받은 6자리 숫자를 입력해 주세요.')
      return
    }
    // 한 번호에 계정이 여럿이면 `cafe24_linked: false` + 후보가 옵니다(types.ts §Cafe24LinkResult).
    verify.mutate(
      { ...target, code },
      { onSuccess: (data) => setCandidates(data.cafe24_linked ? null : data.candidates) },
    )
  }

  /**
   * 후보 선택 — 같은 코드로 한 번 더(서버가 아직 소비하지 않음).
   *
   * 여기서는 `setCandidates` 를 하지 않습니다. 성공하면 `done` 이 목록 화면을 덮고,
   * 실패하면 **목록이 그대로 남아 있어야** 사용자가 다른 계정을 고를 수 있습니다.
   */
  function pick(shopMemberId: string) {
    setFormError(null)
    verify.mutate({ cellphone: value, shop_member_id: shopMemberId, code })
  }

  /** 오답은 1회로 코드가 소비됩니다(서버) — 재시도 버튼은 «다시 받기» 뿐입니다. */
  function resend() {
    setFormError(null)
    verify.reset()
    setCandidates(null)
    setCode('')
    request.mutate(target)
  }

  const error =
    formError ??
    (verify.isError ? linkErrorMessage(verify.error, mode) : null) ??
    (request.isError ? linkErrorMessage(request.error, mode) : null)
  const primaryClass =
    'w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
      <button type="button" aria-label="닫기" onClick={onClose} className="absolute inset-0 cursor-default bg-ink/40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-link-sheet-title"
        tabIndex={-1}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 outline-none desktop:max-w-sm desktop:rounded-2xl"
      >
        {done ? (
          <>
            <h2 id="shop-link-sheet-title" className="text-base font-bold">
              쇼핑몰 계정을 연동했어요
            </h2>
            {/*
              여기만 성격이 다릅니다 — 이 문장은 「받을 금액」이 아니라 「**받은** 금액」이라
              정책값이 아니라 **서버가 방금 지급한 값**(`amount_granted`, 백엔드 PR #230)을
              말해야 합니다. 그 둘은 지급 이후에 운영이 금액을 바꾸면 갈립니다.

              **0 이면 지급 문장 자체를 뺍니다.** 「연동 보상 +0 크레딧을 받았어요」는
              받지도 않은 것을 받았다고 말하는 문장입니다. 도달 경로가 실재합니다 — 응답이
              유실돼 같은 코드로 한 번 더 넣거나, 다른 탭에서 이미 연동된 상태로 확인하는
              경우입니다(목도 이 상태를 만듭니다: `handlers.ts` 의 두 번째 verify).

              「이미 받으셨어요」처럼 **과거 지급을 단정하지도 않습니다** — 0 은 「이번엔 안
              줬다」일 뿐이고 언제 받았는지, 받기는 했는지를 응답이 말해 주지 않습니다.
              확정 숫자는 보유 잔액 쪽이라 그것만 남깁니다.

              로딩 폴백(`creditAmountPhrase` 의 null → 「크레딧」)은 여기서 필요 없습니다.
              `done` 이 있으면 금액도 이미 손에 있어 «모르는 동안» 이 존재하지 않습니다.
            */}
            <p className="mt-1 text-sm text-ink-2">
              {done.amount_granted > 0
                ? `연동 보상 +${done.amount_granted} 크레딧을 받았어요. `
                : ''}
              지금부터 주문하시면 주문 보상도 쌓여요. (보유 {Math.max(0, done.credit_balance)}개)
            </p>
            <button type="button" onClick={onClose} className={`mt-4 ${primaryClass}`}>
              계속하기
            </button>
          </>
        ) : candidates ? (
          <>
            <h2 id="shop-link-sheet-title" className="text-base font-bold">
              연동할 쇼핑몰 계정을 골라 주세요
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              이 번호로 가입된 쇼핑몰 계정이 {candidates.length}개예요. 주문할 때 쓰는 계정을 고르면 그 계정의
              주문에 보상이 쌓여요.
            </p>
            {/*
              AccountSheet 의 소셜 버튼과 같은 함정입니다 — 후보 전부가 `verify` 하나를
              공유하므로 `disabled:opacity-50` 을 걸면 한 개를 고르는 순간 **나머지 후보도
              같이 흐려집니다**. 계정을 고르는 화면에서 그건 «어느 걸 골랐는지»를 지워
              버리는 거라 더 나쁩니다. 고른 것만 흐리고, 나머지는 눌리지만 않게 둡니다.

              라벨은 «확인 중…» 으로 바꾸지 않습니다. 여기 적힌 글자가 곧 고른 계정
              아이디라, 그걸 가리면 확인할 것이 사라집니다.
            */}
            <ul className="mt-4 space-y-2">
              {candidates.map((shopMemberId) => {
                const busy = verify.isPending && verify.variables?.shop_member_id === shopMemberId
                return (
                  <li key={shopMemberId}>
                    <button
                      type="button"
                      disabled={verify.isPending}
                      aria-busy={busy}
                      onClick={() => pick(shopMemberId)}
                      className={`w-full rounded-xl border border-rule-strong px-4 py-3 text-left font-mono text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand ${busy ? 'opacity-50' : ''}`}
                    >
                      {shopMemberId}
                    </button>
                  </li>
                )
              })}
            </ul>
            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {error}
              </p>
            )}
            <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3 hover:text-ink">
              나중에 하기
            </button>
          </>
        ) : (
          <>
            <h2 id="shop-link-sheet-title" className="text-base font-bold">
              쇼핑몰 계정 연동
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              {sent
                ? '쇼핑몰에 등록된 휴대폰으로 인증번호를 보냈어요. 5분 안에 입력해 주세요.'
                : mode === 'cellphone'
                  ? '누띠 쇼핑몰에 가입할 때 쓴 휴대폰 번호를 입력하면 그 번호로 인증번호를 보내 드려요. 카카오·네이버로 가입했어도 번호만 있으면 돼요.'
                  : '누띠 쇼핑몰 아이디를 입력하면 가입 때 등록한 휴대폰으로 인증번호를 보내 드려요.'}
            </p>

            {sent ? (
              <form onSubmit={submitVerify} className="mt-4 space-y-2">
                <p className="text-xs text-ink-3">
                  {mode === 'cellphone' ? '휴대폰 번호' : '쇼핑몰 아이디'}{' '}
                  <span className="font-mono text-ink">{value}</span>
                </p>
                <FloatingField
                  label="인증번호 6자리"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  required
                  autoFocus
                  inputClassName="tracking-[0.3em]"
                />
                <button type="submit" disabled={verify.isPending} className={primaryClass}>
                  {verify.isPending ? '확인 중…' : linkAccountCtaLabel(linkAmount)}
                </button>
                <button
                  type="button"
                  disabled={request.isPending}
                  onClick={resend}
                  className="w-full py-2 text-sm text-ink-3 hover:text-ink disabled:opacity-50"
                >
                  {request.isPending ? '보내는 중…' : '인증번호 다시 받기'}
                </button>
              </form>
            ) : (
              <form onSubmit={submitRequest} className="mt-4 space-y-2">
                {mode === 'cellphone' ? (
                  <FloatingField
                    label="쇼핑몰 가입 휴대폰 번호"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="01012345678"
                    value={value}
                    onChange={(event) => setValue(event.currentTarget.value)}
                    maxLength={13}
                    required
                    autoFocus
                  />
                ) : (
                  <FloatingField
                    label="쇼핑몰 아이디"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    // 소셜(카카오·네이버)로 가입했으면 «아이디» 가 아예 없습니다 — 그
                    // 경우 휴대폰 갈래로 가야 하므로, 어느 아이디를 묻는지 밝힙니다.
                    placeholder="가입할 때 만든 아이디"
                    value={value}
                    onChange={(event) => setValue(event.currentTarget.value)}
                    maxLength={64}
                    required
                    autoFocus
                  />
                )}
                <button type="submit" disabled={request.isPending} className={primaryClass}>
                  {request.isPending ? '보내는 중…' : '인증번호 받기'}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode(mode === 'cellphone' ? 'shop_member_id' : 'cellphone')}
                  className="w-full py-2 text-sm text-ink-3 hover:text-ink"
                >
                  {mode === 'cellphone' ? '쇼핑몰 아이디로 연동하기' : '휴대폰 번호로 연동하기'}
                </button>
              </form>
            )}

            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {error}
              </p>
            )}

            <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3 hover:text-ink">
              나중에 하기
            </button>
          </>
        )}
      </div>
    </div>
  )
}
