/**
 * 결과 복원 실패 안내 (이슈 #5 · FR-EDGE-12).
 *
 * PO 결정(2026-08-03, B+A): 게스트 토큰·자산을 30일로 늘리되 복원은 **동일 브라우저 +
 * 유효 토큰 한정**이고 기기 간 이동은 불가. 그 한계에 부딪힌 사용자에게 이유를 말해
 * 주는 게 이 화면입니다 — 조용히 404 를 띄우면 사용자는 결과가 왜 사라졌는지 알
 * 방법이 없습니다.
 *
 * W-05·W-06 이 공유합니다. 둘 다 URL 의 job_id 하나로 서버 상태를 되살리는 화면이라
 * 실패하는 방식이 같습니다.
 */

import { Link } from 'react-router'
import { auth } from '../api/endpoints'
import { session } from '../api/client'

export type UnavailableReason = 'guest-reset' | 'not-found' | 'error'

const COPY: Record<UnavailableReason, { title: string; body: string }> = {
  'guest-reset': {
    title: '결과를 불러올 수 없습니다',
    body: '게스트 세션이 만료돼 이전 결과에 접근할 수 없어요. 로그인 없이 만든 결과는 만들었던 브라우저에서 30일 동안만 열립니다.',
  },
  'not-found': {
    title: '결과를 찾을 수 없습니다',
    body: '주소가 잘못됐거나, 다른 기기·브라우저에서 만든 결과일 수 있어요. 로그인 없이 만든 결과는 만들었던 브라우저에서만 열립니다.',
  },
  error: {
    title: '결과를 불러오지 못했습니다',
    body: '잠시 후 다시 시도해 주세요.',
  },
}

export default function JobUnavailable({
  reason,
  detail,
}: {
  reason: UnavailableReason
  /** 서버 메시지 등 원인 표시용. 사용자 문구를 대체하지 않고 아래에 덧붙입니다. */
  detail?: string
}) {
  const copy = COPY[reason]
  const isGuest = session.kind !== 'member'

  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <h1 className="text-xl font-bold">{copy.title}</h1>
      <p className="mt-2 text-sm text-ink-2">{copy.body}</p>
      {detail && <p className="mt-1 font-mono text-xs text-ink-3">{detail}</p>}

      <Link
        to="/styles"
        className="mt-6 block rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper"
      >
        새로 만들기
      </Link>

      {/* 기기 간 복원을 원하는 사람에게 지금 줄 수 있는 유일한 답이 계정 연동입니다. */}
      {isGuest && reason !== 'error' && (
        <p className="mt-4 text-xs text-ink-3">
          누띠 계정으로 로그인하면 어느 기기에서나 보관함에서 볼 수 있어요.{' '}
          <a href={auth.cafe24AuthorizeUrl()} className="font-semibold underline">
            로그인
          </a>
        </p>
      )}
    </div>
  )
}
