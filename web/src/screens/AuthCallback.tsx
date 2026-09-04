/**
 * `/auth/callback/{kakao|naver}` — OAuth 복귀 지점 (PR #21).
 *
 * 프로바이더 콘솔에 등록하는 redirect_uri 가 **이 프론트 라우트**입니다(§3 인증).
 * 여기서 쿼리의 `code`·`state` 를 백엔드 콜백에 fetch 로 넘겨야 세션이 나옵니다 —
 * 백엔드가 직접 받지 않는 이유는 응답이 JSON 세션이라 브라우저 이동으로는 받을 수
 * 없기 때문입니다.
 *
 * 쇼핑몰(cafe24) 연동은 더 이상 여기로 오지 않습니다 — OAuth 가 아니라 SMS 인증번호
 * 2단계(ShopLinkSheet)라 페이지 이동이 없습니다.
 *
 * **성공은 여기서 그리지 않습니다.** 이 화면이 실제로 그리는 건 «확인 중» 과 실패
 * 셋뿐이고, 로그인이 확정되면 곧바로 로그인 직전 화면으로 되돌린 뒤 알림만 그 위에
 * 모달로 띄웁니다(app/authWelcome.ts 에 이유가 있습니다).
 */

import { startTransition, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isApiError } from '../api/client'
import { auth } from '../api/endpoints'
import { adoptMemberSession } from '../api/queries'
import { takeAuthReturn } from '../app/authReturn'
import { announceAuthWelcome } from '../app/authWelcome'
import type { SocialProvider } from '../api/types'

type Provider = SocialProvider

const PROVIDERS: Provider[] = ['kakao', 'naver']

const PROVIDER_LABEL: Record<Provider, string> = {
  kakao: '카카오',
  naver: '네이버',
}

interface CallbackOutcome {
  merged: boolean
  creditBalance: number
  returnTo: string
}

/**
 * state 는 **일회성 nonce** 라 같은 값으로 두 번 부르면 두 번째는 무조건 401 입니다
 * (app/routers/auth.py — nonce 선소비 커밋). StrictMode 의 이중 마운트가 정확히 그
 * 상황을 만들므로, 진행 중인 요청을 state 로 묶어 한 번만 나가게 합니다.
 *
 * 실패한 약속도 지우지 않습니다 — 재시도해도 소비된 nonce 라 결과가 같고, 같은 401 을
 * 한 번 더 만들 뿐입니다. 회복 경로는 재시도가 아니라 "처음부터 다시 로그인"입니다.
 */
const inFlight = new Map<string, Promise<CallbackOutcome>>()

function runCallback(
  provider: Provider,
  code: string,
  state: string,
  client: QueryClient,
): Promise<CallbackOutcome> {
  const key = `${provider}:${state}`
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = (async (): Promise<CallbackOutcome> => {
    const memberSession = await auth.socialCallback(provider, code, state)
    await adoptMemberSession(client, memberSession)
    return {
      merged: memberSession.merged,
      creditBalance: memberSession.credit_balance,
      returnTo: takeAuthReturn('/'),
    }
  })()

  inFlight.set(key, promise)
  return promise
}

export default function AuthCallback() {
  const params = useParams()
  const [search] = useSearchParams()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)

  const provider = PROVIDERS.find((value) => value === params.provider) ?? null
  const code = search.get('code')
  const state = search.get('state')
  // 사용자가 프로바이더 동의 화면에서 취소하면 code 대신 error 가 옵니다(카카오·네이버 공통).
  const denied = search.get('error')

  useEffect(() => {
    if (!provider || denied || !code || !state) return
    let alive = true
    runCallback(provider, code, state, client).then(
      (result) => {
        if (!alive) return
        /*
          둘을 `startTransition` 으로 묶습니다. 사용자에게는 «복귀 화면 + 그 위의 알림»
          이 하나의 장면이지만, 알림은 평범한 setState 고 라우터 이동은 그렇지 않아서
          그냥 나란히 부르면 **커밋이 갈립니다** — 아직 «확인 중…» 스피너가 떠 있는
          위에 모달이 먼저 뜨고 뒤 화면이 나중에 갈리는 순간이 실제로 나옵니다.
          한 전환 안에 넣으면 같은 커밋에 들어가 한 번만 움직입니다.

          이동은 `replace` 입니다 — 콜백 주소를 히스토리에 남기면 뒤로가기가 이미 소비된
          nonce 로 되돌아가 «로그인 정보가 만료됐어요» 를 띄웁니다.
        */
        startTransition(() => {
          announceAuthWelcome({ merged: result.merged, creditBalance: result.creditBalance })
          navigate(result.returnTo, { replace: true })
        })
      },
      (cause) => alive && setError(cause),
    )
    return () => {
      alive = false
    }
  }, [provider, denied, code, state, client, navigate])

  const label = provider ? PROVIDER_LABEL[provider] : '로그인'

  if (!provider) {
    return <CallbackFrame title="알 수 없는 로그인 경로예요" body="주소를 다시 확인해 주세요." />
  }

  if (denied) {
    return (
      <CallbackFrame
        title={`${label} 로그인을 취소했어요`}
        body="로그인하지 않아도 계속 만들 수 있어요. 저장하려면 나중에 다시 시도해 주세요."
      />
    )
  }

  if (!code || !state) {
    return (
      <CallbackFrame
        title="로그인 정보가 없어요"
        body="주소가 잘려서 돌아온 것 같아요. 처음부터 다시 로그인해 주세요."
      />
    )
  }

  if (error) {
    return <CallbackFrame title={failureTitle(error)} body={failureBody(error)} />
  }

  /*
    남는 건 «아직 확인 중» 하나입니다. 성공하면 위 effect 가 복귀 화면으로 이동시키므로
    이 컴포넌트는 그대로 사라집니다 — 성공 카드를 그릴 자리가 없습니다.

    이 대기 화면만 카드 껍데기(CallbackFrame)를 쓰지 않습니다. 저 껍데기는 실패 넷이
    쓰는 모양이라, 정상 경로에서 스쳐 지나가는 이 한 순간까지 같은 카드로 그리면
    «로그인하자마자 뭔가 떴다» 는 인상이 남습니다. 여기서 할 말은 기다리라는 것뿐입니다.
  */
  return (
    <div className="flex screen-min-h items-center justify-center bg-paper px-4 py-16">
      <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
        <span
          aria-hidden
          className="h-4 w-4 rounded-full border-2 border-rule-strong border-t-brand motion-safe:animate-spin"
        />
        {label} 확인 중…
      </p>
    </div>
  )
}

function failureTitle(error: unknown): string {
  if (isApiError(error, 'UNAUTHORIZED')) return '로그인 정보가 만료됐어요'
  return '로그인하지 못했어요'
}

function failureBody(error: unknown): string {
  // state 는 5분 만료 · 1회용입니다 — 뒤로가기나 새로고침으로 이 주소를 다시 열면 여기 옵니다.
  if (isApiError(error, 'UNAUTHORIZED')) {
    return '로그인 확인용 정보가 만료됐거나 이미 사용됐어요. 처음부터 다시 시도해 주세요.'
  }
  if (error instanceof Error) return error.message
  return '잠시 뒤 다시 로그인해 주세요.'
}

/**
 * **막다른 길 전용 껍데기입니다.** 이제 여기 오는 건 넷 다 실패 — 알 수 없는 경로 ·
 * 사용자 취소 · 잘린 주소 · 만료된 nonce — 이고, 넷 모두 이 화면에서 할 수 있는 일이
 * 없어 「처음으로」 하나만 답니다. 성공을 이 모양으로 그리지 않는 이유가 그것입니다.
 */
function CallbackFrame({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex screen-min-h items-center justify-center bg-paper px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 text-center">
        <h1 className="text-base font-bold">{title}</h1>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        <Link
          to="/"
          className="mt-4 block rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99]"
        >
          처음으로
        </Link>
      </div>
    </div>
  )
}
