/**
 * 쇼핑몰 계정 연동 시트 — SMS 인증번호 2단계 (05 §3 `POST /auth/cafe24/link/{request,verify}`).
 *
 * 카페24 OAuth 는 **몰 운영자** 로그인이라 고객 본인 확인에 쓸 수 없어(2026-09-01 확인)
 * 연동이 «아이디 입력 → 카페24가 그 회원 휴대폰으로 SMS → 6자리 입력» 으로 바뀌었습니다.
 * 우리는 휴대폰 번호를 보지 않습니다 — 그 아이디의 폰을 쥔 사람만 코드를 압니다.
 *
 * W-10 연동 행과 W-12 마이페이지가 이 한 벌을 씁니다(진입점 둘, 구현 하나).
 */

import { useState, type FormEvent } from 'react'
import { ApiError, isApiError } from '../api/client'
import { useCafe24LinkRequest, useCafe24LinkVerify } from '../api/queries'
import { formatRetryAfter } from '../app/retryAfter'
import { useModalDialog } from '../app/useModalDialog'

/** 서버 제약과 같은 값(app/routers/auth.py Cafe24LinkRequest) — 왕복 없이 먼저 걸러 줍니다. */
const SHOP_ID_PATTERN = /^[A-Za-z0-9_.@-]{2,64}$/
const CODE_PATTERN = /^\d{6}$/

function linkErrorMessage(error: unknown): string {
  if (isApiError(error, 'CAFE24_MEMBER_NOT_FOUND')) return '그 아이디의 쇼핑몰 회원을 찾지 못했어요. 아이디를 확인해 주세요.'
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
  const [shopMemberId, setShopMemberId] = useState('')
  const [code, setCode] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  // mutate 를 다시 부르면 `request.data` 가 비므로(v5 pending 리셋) «다시 받기» 중에 1단계로
  // 깜빡 되돌아갑니다 — 단계는 파생값이 아니라 상태로 들고 있습니다.
  const [sent, setSent] = useState(false)
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)

  const done = verify.data

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const trimmed = shopMemberId.trim()
    if (!SHOP_ID_PATTERN.test(trimmed)) {
      setFormError('쇼핑몰 아이디를 확인해 주세요. (영문·숫자, 2~64자)')
      return
    }
    setShopMemberId(trimmed)
    verify.reset()
    setCode('')
    request.mutate(trimmed, { onSuccess: () => setSent(true) })
  }

  function submitVerify(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!CODE_PATTERN.test(code)) {
      setFormError('문자로 받은 6자리 숫자를 입력해 주세요.')
      return
    }
    verify.mutate({ shop_member_id: shopMemberId, code })
  }

  /** 오답은 1회로 코드가 소비됩니다(서버) — 재시도 버튼은 «다시 받기» 뿐입니다. */
  function resend() {
    setFormError(null)
    verify.reset()
    setCode('')
    request.mutate(shopMemberId)
  }

  const error = formError ?? (verify.isError ? linkErrorMessage(verify.error) : null) ?? (request.isError ? linkErrorMessage(request.error) : null)
  const inputClass = 'mt-1 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm'
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
            <p className="mt-1 text-sm text-ink-2">
              연동 보상 +3 크레딧을 받았어요. 지금부터 주문하시면 주문 보상도 쌓여요. (보유{' '}
              {Math.max(0, done.credit_balance)}개)
            </p>
            <button type="button" onClick={onClose} className={`mt-4 ${primaryClass}`}>
              계속하기
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
                : '누띠 쇼핑몰 아이디를 입력하면 가입 때 등록한 휴대폰으로 인증번호를 보내 드려요.'}
            </p>

            {sent ? (
              <form onSubmit={submitVerify} className="mt-4 space-y-2">
                <p className="text-xs text-ink-3">
                  쇼핑몰 아이디 <span className="font-mono text-ink">{shopMemberId}</span>
                </p>
                <label className="block">
                  <span className="text-xs text-ink-3">인증번호 6자리</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    required
                    autoFocus
                    className={`${inputClass} tracking-[0.3em]`}
                  />
                </label>
                <button type="submit" disabled={verify.isPending} className={primaryClass}>
                  {verify.isPending ? '확인 중…' : '연동하고 +3 받기'}
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
                <label className="block">
                  <span className="text-xs text-ink-3">쇼핑몰 아이디</span>
                  <input
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    value={shopMemberId}
                    onChange={(event) => setShopMemberId(event.currentTarget.value)}
                    maxLength={64}
                    required
                    autoFocus
                    className={inputClass}
                  />
                </label>
                <button type="submit" disabled={request.isPending} className={primaryClass}>
                  {request.isPending ? '보내는 중…' : '인증번호 받기'}
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
