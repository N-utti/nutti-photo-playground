/**
 * `/auth/callback/{kakao|naver|cafe24}` — OAuth 복귀 지점 (PR #21).
 *
 * 프로바이더 콘솔에 등록하는 redirect_uri 가 **이 프론트 라우트**입니다(§3 인증).
 * 여기서 쿼리의 `code`·`state` 를 백엔드 콜백에 fetch 로 넘겨야 세션이 나옵니다 —
 * 백엔드가 직접 받지 않는 이유는 응답이 JSON 세션이라 브라우저 이동으로는 받을 수
 * 없기 때문입니다.
 *
 * 로그인(kakao/naver)과 연동(cafe24)은 **결과가 다릅니다**. 로그인은 토큰을 주고 게스트
 * 자산을 병합·승격하지만(UC-07), 연동은 토큰이 없고 +3 크레딧과 주문 보상 자격만
 * 붙습니다(ADR-11). 같은 화면이 두 결과를 구분해 말해야 사용자가 "로그인이 된 건가"를
 * 헷갈리지 않습니다.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isApiError } from '../api/client'
import { auth } from '../api/endpoints'
import { adoptMemberSession } from '../api/queries'
import { takeAuthReturn } from '../app/authReturn'
import type { SocialProvider } from '../api/types'

type Provider = SocialProvider | 'cafe24'

const PROVIDERS: Provider[] = ['kakao', 'naver', 'cafe24']

const PROVIDER_LABEL: Record<Provider, string> = {
  kakao: '카카오',
  naver: '네이버',
  cafe24: '누띠 쇼핑몰',
}

interface CallbackOutcome {
  /** 연동은 로그인이 아니므로 병합 개념이 없습니다 — cafe24 는 null. */
  merged: boolean | null
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
    if (provider === 'cafe24') {
      const linked = await auth.cafe24Callback(code, state)
      // 토큰은 그대로지만 잔액(+3)·cafe24_linked·원장이 동시에 움직입니다. 획득 목록의
      // 연동 행 상태까지 걸려 있어 관련 키를 일일이 세는 것보다 전부 다시 읽는 게 안전합니다.
      await client.invalidateQueries()
      return { merged: null, creditBalance: linked.credit_balance, returnTo: takeAuthReturn('/credits') }
    }
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
  const [outcome, setOutcome] = useState<CallbackOutcome | null>(null)
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
      (result) => alive && setOutcome(result),
      (cause) => alive && setError(cause),
    )
    return () => {
      alive = false
    }
  }, [provider, denied, code, state, client])

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
    return <CallbackFrame title={failureTitle(error, provider)} body={failureBody(error, provider)} />
  }

  if (!outcome) {
    return <CallbackFrame title={`${label} 확인 중…`} body="잠시만 기다려 주세요." pending />
  }

  return (
    <CallbackFrame
      title={provider === 'cafe24' ? '쇼핑몰 계정을 연동했어요' : '로그인됐어요'}
      body={
        provider === 'cafe24'
          ? `연동 보상 +3 크레딧을 받았어요. 지금부터 주문하시면 주문 보상도 쌓여요. (보유 ${Math.max(0, outcome.creditBalance)}개)`
          : outcome.merged
            ? `이전에 만든 결과와 반려견 프로필을 이 계정으로 옮겼어요. (보유 ${Math.max(0, outcome.creditBalance)}개)`
            : `지금까지 만든 결과가 이 계정에 그대로 남아 있어요. (보유 ${Math.max(0, outcome.creditBalance)}개)`
      }
      action={
        <button
          type="button"
          onClick={() => navigate(outcome.returnTo, { replace: true })}
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper"
        >
          계속하기
        </button>
      }
    />
  )
}

function failureTitle(error: unknown, provider: Provider): string {
  if (isApiError(error, 'CAFE24_ALREADY_LINKED')) return '연동할 수 없는 계정이에요'
  if (isApiError(error, 'UNAUTHORIZED')) return '로그인 정보가 만료됐어요'
  return provider === 'cafe24' ? '연동하지 못했어요' : '로그인하지 못했어요'
}

function failureBody(error: unknown, provider: Provider): string {
  // 두 방향 모두 409 입니다 — 이 쇼핑몰 계정이 남에게 붙어 있거나, 내 계정이 이미 다른
  // 쇼핑몰 계정에 붙어 있거나. 연동 해제가 MVP 에 없어 어느 쪽이든 스스로 풀 수 없습니다.
  if (isApiError(error, 'CAFE24_ALREADY_LINKED')) {
    return '이미 다른 계정과 연동된 쇼핑몰 계정이거나, 이 계정에 다른 쇼핑몰 계정이 연동돼 있어요. 연동 변경은 고객센터로 문의해 주세요.'
  }
  // state 는 5분 만료 · 1회용입니다 — 뒤로가기나 새로고침으로 이 주소를 다시 열면 여기 옵니다.
  if (isApiError(error, 'UNAUTHORIZED')) {
    return '로그인 확인용 정보가 만료됐거나 이미 사용됐어요. 처음부터 다시 시도해 주세요.'
  }
  if (error instanceof Error) return error.message
  return provider === 'cafe24' ? '잠시 뒤 다시 시도해 주세요.' : '잠시 뒤 다시 로그인해 주세요.'
}

function CallbackFrame({
  title,
  body,
  pending = false,
  action,
}: {
  title: string
  body: string
  pending?: boolean
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-rule bg-surface p-5 text-center">
        <h1 className="text-base font-bold">{title}</h1>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        {action}
        {!pending && !action && (
          <Link
            to="/"
            className="mt-4 block rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold"
          >
            처음으로
          </Link>
        )}
      </div>
    </div>
  )
}
