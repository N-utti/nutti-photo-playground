/**
 * 로그인 바텀시트 — W-06 B 계정 연동(FR-W06-09/10)과 W-10 연동 유도가 같은 것을 씁니다.
 *
 * ADR-11 로 로그인 수단은 **카카오 · 네이버 · 로컬(이메일+비밀번호) 3종**이고, 카페24는
 * 로그인이 아니라 회원의 쇼핑몰 계정 연동으로 빠졌습니다 — 그래서 이 시트에 카페24
 * 버튼이 없습니다(§2 W-06 B). 여기서 로그인하면 게스트 자산이 회원으로 이관됩니다(UC-07).
 *
 * 시트를 한 벌로 두는 이유: 로그인 진입점이 결과·크레딧·랜딩 세 곳이라 각자 만들면
 * "여기선 네이버가 있고 저기선 없는" 상태가 생깁니다. 문구 하나 바뀔 때 세 군데를
 * 고쳐야 하는 구조를 처음부터 만들지 않습니다.
 */

import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { ApiError, isApiError } from '../api/client'
import { useAuthorizeRedirect, useLocalAuth } from '../api/queries'
import { rememberAuthReturn } from '../app/authReturn'
import { authWelcomeBalance, authWelcomeMessage } from '../app/authWelcome'
import FloatingField from '../app/FloatingField'
import { formatRetryAfter } from '../app/retryAfter'
import { useModalDialog } from '../app/useModalDialog'
import type { SocialProvider } from '../api/types'

/** 서버 제약과 같은 값(app/routers/auth.py RegisterRequest) — 왕복 없이 먼저 걸러 줍니다. */
const EMAIL_MAX = 254
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

/**
 * 소셜 버튼은 **두 회사의 디자인 가이드가 지배합니다** — 우리 판단이 들어갈 자리가
 * 거의 없습니다. 색·심볼·간격이 전부 규정이고, 자산 출처는 `public/brand/NOTICE.md`.
 *
 * 심볼이 없던 동안 카카오 규정을 어기고 있었습니다 — 「심볼 없이 카카오 로그인 버튼을
 * 구성할 수 없습니다」(카카오 로그인 디자인 가이드). 네이버도 로고를 필수로 봅니다.
 *
 * 지금 지키는 규정:
 *   카카오 — 컨테이너 `#FEE500`, 심볼은 형태·비율·색 변경 불가. 심볼은 좌측 정렬
 *            하거나 레이블과 함께 가운데 정렬할 수 있어(가이드) 가운데를 씁니다.
 *   네이버 — 배경 `#03A94D`·로고·레이블 흰색(가이드 «지정 컬러» 표). 완성형 로고는
 *            16px 이상, 가운데 정렬이면 로고–레이블 간격 8px.
 *
 * `#03C75A` 로 두고 있었는데 그건 **옛 스펙**입니다(2025-12 개정 애셋 기준 `#03A94D`).
 * 문구는 둘 다 바꿔도 됩니다 — 네이버가 명시적으로 허용하고("문구는 변경이 가능해요"),
 * 카카오도 레이블은 규정 대상이 아닙니다.
 *
 * **심볼 크기는 18px 과 16px 로 다릅니다.** 두 회사가 자기 버튼에서 쓰는 값이 그렇고
 * (카카오 표준 버튼 45px 안의 심볼 18×17, 네이버 완성형 48px 안의 N 16×16 — 각 사
 * 공식 애셋에서 실측), 눈으로도 그게 맞습니다.
 *
 * 처음엔 둘 다 18px 로 맞췄는데 네이버가 눈에 띄게 커 보였습니다. 상자가 같아도
 * **잉크 면적이 다르기 때문**입니다 — 카카오는 말풍선이라 타원+꼬리로 상자의 68% 만
 * 차고, 네이버 N 은 정사각을 79% 채웁니다. 같은 18px 이면 네이버 쪽 면적이 1.22배가
 * 됩니다. 16px 로 내리면 0.97배로, 사실상 같아집니다.
 *
 * 그러니 이건 우리 취향 보정이 아니라 각 가이드의 자기 숫자로 돌아온 것입니다.
 * 16px 은 네이버가 완성형에 규정한 **하한**이기도 해서 더 줄일 수는 없습니다.
 */
const SOCIAL: {
  provider: SocialProvider
  label: string
  className: string
  symbol: string
  /** Tailwind 는 클래스 문자열을 정적으로 훑으므로 크기를 문자열로 들고 있어야 합니다. */
  symbolClass: string
}[] = [
  {
    provider: 'kakao',
    label: '카카오로 계속하기',
    // 레이블 #191919 는 카카오가 실제로 내려주는 버튼 PNG 에서 잰 값입니다. 가이드
    // 본문은 «#000000 85%» 라고 적지만 그 둘이 어긋나고, 우리는 그 PNG 에서 심볼을
    // 잘라 쓰므로 **같은 파일의 값**으로 맞춥니다 — 안 그러면 심볼만 더 진합니다.
    className: 'bg-[#FEE500] text-[#191919] hover:brightness-95 motion-safe:active:scale-[0.99]',
    symbol: '/brand/kakao-symbol.png',
    // 36×34 자산을 절반으로 — 정확히 2배 자산이라 축소에 군더더기가 없습니다.
    symbolClass: 'h-[17px] w-[18px]',
  },
  {
    provider: 'naver',
    label: '네이버로 계속하기',
    className: 'bg-[#03A94D] text-white hover:brightness-95 motion-safe:active:scale-[0.99]',
    symbol: '/brand/naver-symbol.svg',
    symbolClass: 'h-4 w-4',
  },
]

/** 로그인 계열 실패를 사용자 언어로. 서버 message 는 영어라 그대로 보여줄 수 없습니다. */
function authErrorMessage(error: unknown, mode: 'login' | 'register'): string {
  if (isApiError(error, 'INVALID_CREDENTIALS')) return '이메일 또는 비밀번호가 맞지 않아요.'
  if (isApiError(error, 'EMAIL_TAKEN')) return '이미 가입된 이메일이에요. 로그인으로 이어서 하세요.'
  if (isApiError(error, 'ALREADY_MEMBER')) return '이미 로그인되어 있어요.'
  if (isApiError(error, 'VALIDATION_ERROR')) {
    return `이메일 형식과 비밀번호 길이(${PASSWORD_MIN}~${PASSWORD_MAX}자)를 확인해 주세요.`
  }
  if (isApiError(error, 'RATE_LIMITED')) {
    const retryAfter = error instanceof ApiError ? error.retryAfter : null
    return mode === 'login'
      ? `로그인 시도가 너무 많았어요. ${formatRetryAfter(retryAfter)} 다시 시도해 주세요.`
      : `가입 시도가 너무 많았어요. ${formatRetryAfter(retryAfter)} 다시 시도해 주세요.`
  }
  if (error instanceof Error) return error.message
  return '로그인하지 못했어요.'
}

/**
 * **여기서 크레딧을 약속하지 마세요.** 로그인은 두 경로로 갈리는데 그중 하나에서 거짓이
 * 됩니다.
 *
 *   승격 — 기존 회원이 없으면 **게스트 행 자체**가 회원이 됩니다. 잔액이 그대로 남습니다.
 *   병합 — 기존 계정으로 로그인하면 자산 다섯 종만 그 계정으로 옮겨지고
 *          `credit_balance` 는 **안 옮깁니다**(`app/routers/auth.py` 병합 분기).
 *          게스트가 들고 있던 무료 크레딧은 죽은 행에 남아 사라집니다.
 *
 * 이 시트는 **로그인 전**에 뜨므로 어느 쪽일지 우리가 모릅니다. 그래서 두 경로 모두에서
 * 참인 말만 합니다 — 결과와 반려견 프로필은 어느 쪽이든 따라갑니다.
 *
 * 반대로 「사라질 수 있어요」라고 미리 겁주지도 않습니다. 승격이 다수인데 그쪽에는 없는
 * 손실을 예고하는 셈이고, 사라지는 양도 오늘은 최대 1개입니다(게스트가 크레딧을 벌 경로가
 * 없어 잔액이 가입 시 받는 무료 1개뿐입니다).
 *
 * 백엔드가 병합 이관을 붙이면(이슈 #11 L6, 「파일럿 후」) 그때 다시 약속해도 됩니다. 그전에
 * 되돌리지 마세요 — 목이 오래도록 게스트 잔액을 그대로 돌려주는 바람에 이 거짓이 브라우저
 * 에서 **항상 참으로 보였습니다**(`mocks/handlers.ts` `MERGED_ACCOUNT_BALANCE`).
 */
export default function AccountSheet({
  onClose,
  title = '누띠 계정으로 이어서',
  description = '만든 결과를 보관함에 저장하고 다른 기기에서도 열어 보세요.',
}: {
  onClose: () => void
  title?: string
  description?: string
}) {
  const location = useLocation()
  const authorize = useAuthorizeRedirect()
  const localAuth = useLocalAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  // 로그인 진입점이 세 곳(W-01 헤더 · W-06 저장 · W-10 연동)이라, 여기가 새면
  // 세 화면 모두에서 가려진 배경 버튼에 키보드가 닿습니다.
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)

  const done = localAuth.data

  function startSocial(provider: SocialProvider) {
    // 프로바이더로 나갔다가 /auth/callback 으로 돌아오는 전체 페이지 이동이라,
    // 지금 화면 주소를 남겨 두지 않으면 돌아올 곳을 잃습니다.
    rememberAuthReturn(`${location.pathname}${location.search}`)
    authorize.mutate(provider)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const trimmed = email.trim()
    if (!trimmed.includes('@') || trimmed.length > EMAIL_MAX) {
      setFormError('이메일 주소를 확인해 주세요.')
      return
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setFormError(`비밀번호는 ${PASSWORD_MIN}~${PASSWORD_MAX}자로 입력해 주세요.`)
      return
    }
    localAuth.mutate({ mode, email: trimmed, password })
  }

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
        aria-labelledby="account-sheet-title"
        tabIndex={-1}
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 outline-none desktop:max-w-sm desktop:rounded-2xl"
      >
        {done ? (
          <>
            <h2 id="account-sheet-title" className="text-base font-bold">
              로그인됐어요
            </h2>
            {/*
              문구는 소셜 로그인 모달과 한 벌입니다(app/authWelcome.ts). 같은 사건에
              대한 같은 알림인데 여기만 손대면 앱이 두 가지로 말하게 됩니다.
            */}
            <p className="mt-1 text-sm text-ink-2">{authWelcomeMessage(done.merged)}</p>
            <p className="mt-1 text-sm text-ink-2">{authWelcomeBalance(done.credit_balance)}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
            >
              계속하기
            </button>
          </>
        ) : (
          <>
            <h2 id="account-sheet-title" className="text-base font-bold">
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-2">{description}</p>

            {/*
              누른 쪽만 «진행 중»으로 보여야 합니다. 두 버튼이 `authorize` 라는 mutation
              하나를 공유하므로 `isPending` 은 카카오를 눌러도 네이버 자리에서 true 입니다 —
              예전엔 그걸 `disabled:opacity-50` 으로 받아서 **안 누른 쪽까지 같이 흐려졌고**,
              폰에서는 두 개가 같이 눌린 것처럼 보였습니다. 어느 쪽을 눌렀는지는 mutation 의
              `variables`(= 넘긴 provider)가 알고 있으니 그걸로 가릅니다.

              `disabled` 는 둘 다 그대로 둡니다 — 프로바이더로 나가는 중에 다른 쪽을 눌러
              OAuth 를 두 번 시작하는 것은 막아야 합니다. 못 누르는 티를 색으로 내지 않을
              뿐이고, 어차피 1초 안에 페이지가 넘어갑니다.
            */}
            <div className="mt-4 space-y-2">
              {SOCIAL.map((social) => {
                const busy = authorize.isPending && authorize.variables === social.provider
                return (
                  <button
                    key={social.provider}
                    type="button"
                    disabled={authorize.isPending}
                    aria-busy={busy}
                    onClick={() => startSocial(social.provider)}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${busy ? 'opacity-50' : ''} ${social.className}`}
                  >
                    {/*
                      `gap-2` = 8px 입니다. 네이버가 가운데 정렬일 때 규정한 그 값이고
                      (카카오는 간격을 수치로 묶지 않습니다), 두 버튼을 같은 간격으로
                      둡니다.

                      심볼은 «이동 중…» 일 때도 남깁니다 — 같은 버튼이 상태만 바뀐
                      것인데 로고가 사라지면 다른 버튼으로 갈아탄 것처럼 보입니다.

                      `alt=""` 는 장식이라는 뜻입니다. 바로 옆 레이블이 이미 «카카오»·
                      «네이버» 라고 말하므로, 대체 텍스트를 넣으면 스크린리더가 회사
                      이름을 두 번 읽습니다.
                    */}
                    <img
                      src={social.symbol}
                      alt=""
                      aria-hidden
                      className={`shrink-0 ${social.symbolClass}`}
                    />
                    {busy ? '이동 중…' : social.label}
                  </button>
                )
              })}
            </div>

            {authorize.isError && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {isApiError(authorize.error, 'ALREADY_MEMBER')
                  ? '이미 로그인되어 있어요.'
                  : '로그인 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.'}
              </p>
            )}

            <div className="my-4 flex items-center gap-3 text-xs text-ink-3">
              <span className="h-px flex-1 bg-rule" />
              또는 이메일로
              <span className="h-px flex-1 bg-rule" />
            </div>

            {/* 탭이 아니라 한 폼 + 모드 전환입니다 — 입력한 이메일을 유지한 채 넘어갑니다. */}
            <div role="tablist" aria-label="이메일 로그인 방식" className="flex gap-1 text-sm">
              {(['login', 'register'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => {
                    setMode(value)
                    setFormError(null)
                    localAuth.reset()
                  }}
                  className={`flex-1 rounded-lg px-3 py-2 font-semibold ${
                    mode === value
                      ? 'bg-brand text-paper'
                      : 'border border-rule text-ink-2 hover:border-brand-2 hover:text-brand'
                  }`}
                >
                  {value === 'login' ? '로그인' : '가입'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-3 space-y-2">
              <FloatingField
                label="이메일"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                placeholder="example@email.com"
                autoComplete="email"
                maxLength={EMAIL_MAX}
                required
              />
              <FloatingField
                /*
                  가입일 때만 길이를 라벨에 답니다. 로그인 칸에 «8자 이상» 이 붙으면
                  이미 만든 비밀번호에 대한 조건처럼 읽혀서 거짓말이 됩니다.
                */
                label={mode === 'register' ? `비밀번호 (${PASSWORD_MIN}자 이상)` : '비밀번호'}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                maxLength={PASSWORD_MAX}
                required
              />

              {/*
                이슈 #17 — MVP 에는 비밀번호 재설정도 이메일 인증도 없습니다. 가입 이메일의
                소유를 증명할 방법이 없어 **분실 시 계정과 누적 크레딧을 되찾을 수단이
                아예 없습니다**. 가입 버튼 위에 두는 이유: 누른 뒤에 알리면 고지가 아닙니다.
              */}
              {mode === 'register' && (
                <p className="rounded-lg border border-rule bg-surface-2 px-3 py-2 text-xs text-ink-2">
                  지금은 비밀번호 찾기를 제공하지 않아요. 비밀번호를 잊으면 계정과 크레딧을
                  되찾을 수 없으니 꼭 기억해 주세요.
                </p>
              )}

              <button
                type="submit"
                disabled={localAuth.isPending}
                className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
              >
                {localAuth.isPending
                  ? '처리 중…'
                  : mode === 'register'
                    ? '가입하고 시작하기'
                    : '로그인'}
              </button>
            </form>

            {(formError || localAuth.isError) && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {formError ?? authErrorMessage(localAuth.error, mode)}
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
