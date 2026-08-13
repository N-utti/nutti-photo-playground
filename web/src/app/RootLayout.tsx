/**
 * 전 화면 공통 껍데기. 지금 하는 일은 세션 배너와 job 상태 바 둘입니다.
 *
 * 둘 다 «특정 화면의 문제가 아닌 것»이라 여기 있습니다. 세션 상실·발급 제한은 앱
 * 전체가 요청을 못 보내는 상태이고, 만드는 중인 job 은 어느 화면을 보고 있든 계속
 * 진행 중입니다 — 화면마다 따로 처리하면 빠지는 곳이 생기고, 하필 빠진 화면에서
 * 사용자가 그걸 잃습니다.
 */

import { useEffect, useState } from 'react'
import { Outlet, useMatches } from 'react-router'
import { ensureSession, isApiError, retryMemberRotation, session } from '../api/client'
import JobStatusBar from './JobStatusBar'
import { formatRetryAfter } from './retryAfter'
import { clearSessionStatus, useSessionStatus } from './sessionStatus'

export default function RootLayout() {
  return (
    <>
      <DocumentTitle />
      <SessionBanner />
      <Outlet />
      {/* 화면 위에 떠 있는 것이라 흐름의 마지막에 둡니다 — 같은 z 인 탭바와 만나도
          이쪽이 위입니다. 붙이고 뗄 조건은 전부 그 안에 있습니다. */}
      <JobStatusBar />
    </>
  )
}

const SITE_NAME = '누띠 사진 놀이터'

/** 라우트가 `handle.title` 로 선언한 이름 (routes.tsx). */
type TitleHandle = { title?: string }

/**
 * 주소가 바뀌면 `document.title` 도 바꿉니다.
 *
 * SPA 라 index.html 의 <title> 한 줄이 끝까지 갑니다 — 열두 화면이 전부
 * "누띠 사진 놀이터" 였습니다. 그러면 세 군데가 같이 망가집니다:
 *   - 뒤로가기 **길게 누르기** 목록이 전부 같은 줄이라 어디로 돌아가는지 못 고릅니다
 *   - 탭을 여러 개 띄우면 어느 탭이 결과 화면인지 구분되지 않습니다
 *   - 스크린리더는 화면 전환을 제목으로 알리는데, 매번 같은 말을 듣습니다
 *
 * 제목은 라우트에 붙여 둡니다(`handle.title`) — 화면 컴포넌트마다 useEffect 를
 * 흩뿌리면 새 화면에서 빠뜨리기 쉽고, 빠뜨려도 티가 안 납니다.
 */
function DocumentTitle() {
  const matches = useMatches()
  // 가장 깊은 매치부터 거슬러 올라가 첫 title 을 씁니다 — W-03 시트처럼 자식이
  // 제목을 안 가진 경우 부모(카탈로그)의 제목이 그대로 남습니다.
  const label = [...matches]
    .reverse()
    .map((match) => (match.handle as TitleHandle | undefined)?.title)
    .find((title): title is string => Boolean(title))

  useEffect(() => {
    document.title = label ? `${label} · ${SITE_NAME}` : SITE_NAME
  }, [label])

  return null
}

function SessionBanner() {
  const { lost, lostKind, rateLimited, retryAfter, refreshThrottled, refreshRetryAfter } =
    useSessionStatus()
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  /*
    갱신 제한은 «세션이 끊긴» 상태가 아니라서 아래 배너와 섞지 않습니다 (이슈 #11 R3).
    끊김이 함께 걸려 있으면 그쪽이 먼저입니다 — 저쪽은 기다려도 안 풀립니다.
  */
  if (!lost && !rateLimited && refreshThrottled) {
    return <RefreshThrottledBanner seconds={refreshRetryAfter} />
  }
  if (!lost && !rateLimited) return null

  /*
    회원과 게스트는 잃은 것이 다릅니다 (PR #57).

    게스트는 세션 = 자산이라 새로 시작하면 이전 결과가 **정말로 사라집니다**. 회원은
    서버에 그대로 있고 다시 로그인하면 돌아오므로, 같은 문구로 "이전 결과에 접근할 수
    없다"고 말하면 있지도 않은 손실을 통보하는 셈입니다.

    회원 세션이 끊기는 흔한 이유가 **다른 기기 로그인**인 것도 이때 생겼습니다 —
    서버가 회원당 리프레시를 하나만 살려 두기 때문입니다(이슈 #47 B안).
  */
  const memberLost = lost && lostKind === 'member'

  async function retry() {
    setRetrying(true)
    setRetryError(null)
    try {
      session.clear() // 거절된 토큰이 남아 있으면 ensureSession 이 그냥 반환합니다.
      await ensureSession()
      clearSessionStatus()
      // 새 member_id 로 서버 상태가 통째로 달라지므로 캐시를 들고 가지 않습니다.
      window.location.reload()
    } catch (error) {
      setRetryError(
        isApiError(error, 'RATE_LIMITED')
          ? `아직 제한이 풀리지 않았어요. ${formatRetryAfter(error.retryAfter)} 다시 눌러 주세요.`
          : '다시 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      )
      setRetrying(false)
    }
  }

  return (
    <div role="alert" className="border-b border-rule-strong bg-surface px-5 py-3 text-sm">
      <p className="font-semibold">
        {rateLimited
          ? '지금은 새로 시작할 수 없어요'
          : memberLost
            ? '로그인이 만료됐어요'
            : '세션이 만료됐어요'}
      </p>
      <p className="mt-1 text-ink-2">
        {rateLimited
          ? // 서버가 Retry-After 를 함께 내려줍니다(PR #21) — 언제 풀리는지 말해 주면
            // 사용자가 무한정 새로고침하지 않습니다.
            `같은 네트워크에서 새 세션을 너무 자주 만들었어요. ${formatRetryAfter(retryAfter)} 다시 시도하면 됩니다.`
          : memberLost
            ? '다른 기기에서 로그인했거나 로그인한 지 오래됐어요. 계정에 쌓인 결과와 크레딧은 그대로 있으니, 계속하기를 누른 뒤 다시 로그인하면 이어서 쓸 수 있어요.'
            : '로그인 없이 만든 결과는 만들었던 브라우저에서만 열립니다. 새로 시작하면 이전 결과에는 접근할 수 없어요.'}
      </p>
      {retryError && <p className="mt-1 text-danger">{retryError}</p>}
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="mt-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {retrying ? '시작하는 중…' : memberLost ? '계속하기' : '새로 시작하기'}
      </button>
    </div>
  )
}

/**
 * 회원 액세스 갱신이 429 로 막힌 동안의 배너 (이슈 #11 R3).
 *
 * 위 배너와 갈라놓은 이유는 문구가 아니라 **버튼이 하는 일**입니다. 저쪽의 복구는
 * `session.clear()` + 새 세션인데, 여기서 그걸 하면 아직 살아 있는 리프레시를 버려
 * 기다리면 될 일을 재로그인으로 만듭니다. 여기서는 회전만 한 번 더 시도합니다.
 *
 * 잃은 게 없으므로 «데이터가 사라진다» 는 말도 하지 않습니다 — 지금 상태는 잠시
 * 새로고침이 안 되는 것뿐이고, 사용자가 알아야 할 건 «언제 다시 되나» 하나입니다.
 */
function RefreshThrottledBanner({ seconds }: { seconds: number | null }) {
  const [retrying, setRetrying] = useState(false)
  const [failed, setFailed] = useState(false)

  async function retry() {
    setRetrying(true)
    setFailed(false)
    // 성공하면 배너는 이벤트로 내려갑니다(sessionStatus). 화면들은 만료된 액세스로
    // 이미 실패해 있으므로 새로고침으로 한 번에 다시 세웁니다.
    if (await retryMemberRotation()) {
      window.location.reload()
      return
    }
    setFailed(true)
    setRetrying(false)
  }

  return (
    <div role="alert" className="border-b border-rule-strong bg-surface px-5 py-3 text-sm">
      <p className="font-semibold">지금은 로그인을 갱신할 수 없어요</p>
      <p className="mt-1 text-ink-2">
        {`같은 네트워크에서 갱신 요청이 너무 많았어요. 로그인은 그대로 살아 있으니 ${formatRetryAfter(seconds)} 다시 시도하면 이어서 쓸 수 있어요.`}
      </p>
      {/* 실패해도 문구를 새로 만들지 않습니다 — 서버가 새 Retry-After 를 주면 위 문장의
          시간이 이미 갱신돼 있고, 여기서 또 말하면 서로 다른 두 숫자가 같이 보입니다. */}
      {failed && <p className="mt-1 text-danger">아직 풀리지 않았어요.</p>}
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="mt-2 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {retrying ? '시도하는 중…' : '다시 시도'}
      </button>
    </div>
  )
}
