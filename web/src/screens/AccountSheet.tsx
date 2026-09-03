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
 * 시트 머리는 **누띠 워드마크 한 줄**입니다. 예전엔 「누띠 계정으로 이어서」 + 「로그인하면
 * 만든 결과가 보관함에 쌓이고…」 두 줄이었는데, 그 값어치 설명이 진입점 일곱 곳 중 네
 * 곳에서 글자만 다르고 같은 말이었습니다. 로고가 대신 서면 «누구의 계정인가» 는 한눈에
 * 전해지고, 문구 자리는 정말 할 말이 있는 화면만 씁니다.
 *
 * `description` 은 그래서 **선택**이고 기본값이 없습니다. 넣을 값은 「보관함에 남아요」류의
 * 일반 안내가 아니라 **«왜 지금 이 창이 떴는가»** 여야 합니다 — 예: 크레딧 받기는 회원만
 * 할 수 있다는 사실(EarnActionList). 그게 없으면 안 넣는 편이 낫습니다.
 *
 * 로고로 바꿔도 `<h2>` 는 남아 있습니다. 대화상자는 이름이 있어야 하고(`aria-labelledby`),
 * 이름을 지우면 스크린리더가 «대화상자» 라고만 읽습니다. 그래서 제목은 글자로 두되
 * 시각적으로만 감추고(`sr-only`), 로고 쪽을 장식으로 돌립니다 — 둘 다 읽히면 회사 이름이
 * 두 번 나옵니다(소셜 버튼 심볼에 `alt=""` 를 준 것과 같은 이유).
 *
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
  description,
}: {
  onClose: () => void
  description?: string
}) {
  const location = useLocation()
  const authorize = useAuthorizeRedirect()
  const localAuth = useLocalAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  /*
    이메일 폼은 접혀서 시작합니다.

    예전에는 탭 둘 + 입력 둘 + 제출 버튼이 **항상** 펼쳐져 있어서, 소셜 두 개가 주
    경로인데도 시트의 절반 넘게를 이메일이 차지했습니다(시트 높이 510px). 접으면
    시트가 «수단 세 개» 라는 한 가지 질문만 던집니다.

    이메일 사용자에게는 탭이 한 번 늘어납니다. 그 대가로 다수인 소셜 사용자가 매번
    폼을 지나쳐 보지 않아도 됩니다.
  */
  const [emailOpen, setEmailOpen] = useState(false)
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
            <h2 id="account-sheet-title" className="text-lg font-bold">
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
            <h2 id="account-sheet-title" className="sr-only">
              누띠 계정으로 이어서
            </h2>
            {/*
              워드마크 원본이 1540×396(=3.89:1)이라 높이만 잡으면 폭은 따라옵니다. 앱바가
              쓰는 14px 보다 키운 이유는 여기가 시트의 유일한 머리이기 때문입니다 — 앱바에선
              옆에 「놀이터」가 붙어 한 덩어리지만, 여기서는 혼자 섭니다.

              `mt-2` 는 시트 안쪽 여백(`p-5` = 20px)에 8px 을 더해 28px 을 만듭니다. 아래로는
              버튼 묶음의 `mt-6` 이 24px 을 냅니다 — **12px 이 아니라 24px 이어야 하는 이유**는
              버튼끼리의 간격이 `space-y-3`(12px)이기 때문입니다. 로고 아래가 그와 같으면
              로고가 머리가 아니라 «버튼 목록의 첫 칸» 처럼 읽힙니다.
            */}
            <img
              src="/brand/nutti-wordmark.svg"
              alt=""
              aria-hidden
              width={70}
              height={18}
              className="mx-auto mt-2 h-6 w-auto"
            />
            {description && <p className="mt-3 text-center text-sm text-ink-2">{description}</p>}

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
            {/*
              버튼 높이 52px = `py-3.5`(14px) 두 번 + `text-base` 의 행간 24px.

              44px 이었습니다. WCAG 의 탭 타깃 **하한**이지 목표가 아니고, 무엇보다 같은
              앱의 주 버튼(W-01 「사진 올리고 무료로 1장 만들기」)이 이미 52px 이라 로그인만
              작을 근거가 없었습니다. 레이블도 그 버튼과 같은 16px 로 맞춥니다.
            */}
            <div className="mt-6 space-y-3">
              {SOCIAL.map((social) => {
                const busy = authorize.isPending && authorize.variables === social.provider
                return (
                  <button
                    key={social.provider}
                    type="button"
                    disabled={authorize.isPending}
                    aria-busy={busy}
                    onClick={() => startSocial(social.provider)}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-base font-semibold ${busy ? 'opacity-50' : ''} ${social.className}`}
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

                      **버튼을 52px 로 키우면서도 심볼은 그대로 뒀습니다.** 키우고 싶은
                      쪽이 자연스럽지만 카카오 심볼이 래스터(36×34 PNG)라 그럴 수 없습니다 —
                      18px 로 두면 2배 화면에서 36 device px, 즉 원본과 1:1 입니다. 21px 로
                      올리면 42px 을 36px 에서 늘리는 셈이라 흐려집니다. 네이버는 벡터라
                      키울 수 있지만 혼자 키우면 위쪽 주석의 잉크 면적 균형(18 대 16)이
                      깨져서 네이버만 커 보입니다. 둘 다 각 사 가이드의 하한 이상입니다.
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

              {/*
                이메일도 **같은 스택의 버튼 한 개**입니다 — 여기어때 로그인 화면과 같은
                구성이고, 시트가 던지는 질문을 «수단을 고르세요» 하나로 만듭니다.

                누르면 이 버튼이 사라지고 그 자리에 폼이 섭니다. 사라지는 트리거에
                `aria-expanded` 를 달지 않는 이유는 그 값이 **항상 false 로만 읽히기**
                때문입니다(펼친 순간 버튼이 없어짐). 대신 펼쳐진 첫 칸으로 포커스를
                옮겨(`autoFocus`) 스크린리더가 새로 생긴 것을 읽게 합니다.

                세로 여백만 `py-3.5`(14px)가 아니라 **13px** 입니다. 이 버튼에는 테두리가
                있어서 위아래 1px 씩이 높이에 더해지고, 그대로 두면 소셜 둘은 52px 인데
                이것만 54px 이 됩니다. 13 + 24(행간) + 13 + 2(테두리) = 52 로 맞춥니다.
              */}
              {!emailOpen && (
                <button
                  type="button"
                  onClick={() => setEmailOpen(true)}
                  className="w-full rounded-xl border border-rule-strong px-4 py-[13px] text-base font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
                >
                  이메일로 계속하기
                </button>
              )}
            </div>

            {authorize.isError && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {isApiError(authorize.error, 'ALREADY_MEMBER')
                  ? '이미 로그인되어 있어요.'
                  : '로그인 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.'}
              </p>
            )}

            {emailOpen && (
              <>
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
                      className={`flex-1 rounded-xl px-3 py-2 font-semibold ${
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
                    /*
                  펼쳐지면서 마운트되는 칸이라 `autoFocus` 가 «펼친 순간» 과 정확히
                  같습니다. 시트는 이미 열려 있었고 사용자가 방금 「이메일로 계속하기」를
                  눌렀으므로, 포커스를 빼앗는 게 아니라 누른 결과로 데려가는 것입니다.
                */
                    autoFocus
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
                    <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">
                      지금은 비밀번호 찾기를 제공하지 않아요. 비밀번호를 잊으면 계정과 크레딧을
                      되찾을 수 없으니 꼭 기억해 주세요.
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={localAuth.isPending}
                    className="w-full rounded-xl bg-brand px-4 py-3.5 text-base font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
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
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="mt-2 w-full py-2 text-sm text-ink-3 hover:text-ink"
            >
              나중에 하기
            </button>
          </>
        )}
      </div>
    </div>
  )
}
