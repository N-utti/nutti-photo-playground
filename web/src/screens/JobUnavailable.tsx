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

import { useState } from 'react'
import { Link } from 'react-router'
import { session } from '../api/client'
import AccountSheet from './AccountSheet'

export type UnavailableReason = 'guest-reset' | 'deleted' | 'not-found' | 'error'

const COPY: Record<UnavailableReason, { title: string; body: string }> = {
  /*
    이 브라우저가 보관함에서 지운 결과(app/deletedResults.ts). 사고가 아니라 사용자가
    시킨 일이라, 이유를 짐작하는 다른 문구와 달리 그냥 사실만 말하고 끝냅니다 —
    «다른 기기일 수 있어요» 도, 로그인 유도도 여기서는 틀립니다.
  */
  deleted: {
    title: '삭제한 결과입니다',
    body: '보관함에서 지운 사진이에요. 지운 결과는 되돌릴 수 없습니다.',
  },
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
  // 여기서는 `/me` 대신 로컬 kind 를 씁니다 — 이 화면 자체가 세션이 깨진 상황이라
  // `/me` 도 401 로 떨어질 수 있고, 그때 로그인 안내를 못 띄우면 본말이 전도됩니다.
  const isGuest = session.kind !== 'member'
  const [loginSheet, setLoginSheet] = useState(false)

  return (
    <div className="mx-auto max-w-md px-5 desktop:px-7 py-16 text-center">
      <h1 className="text-xl font-bold">{copy.title}</h1>
      <p className="mt-2 text-sm text-ink-2">{copy.body}</p>
      {detail && <p className="mt-1 font-mono text-xs text-ink-3">{detail}</p>}

      <Link
        to="/styles"
        className="mt-6 block rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
      >
        새로 만들기
      </Link>

      {/*
        기기 간 복원을 원하는 사람에게 줄 수 있는 유일한 답이 로그인입니다. PR #21 전에는
        시작할 경로가 없어 사실만 알리고 링크를 뺐지만, 이제 여기서 바로 붙일 수 있습니다.

        지금 이 결과가 돌아오지는 않습니다 — 이미 잃은 세션의 자산은 병합 대상이 아닙니다.
        그래서 "복구"가 아니라 **다음부터**라고 말합니다. 여기서 과장하면 로그인한 뒤
        결과가 없는 걸 보고 두 번 실망합니다.

        `deleted` 는 빠집니다 — 본인이 지운 사진을 두고 «앞으로는 계정에 쌓여요» 라고
        하면, 잃어버린 적 없는 것을 잃은 셈 치고 로그인을 권하는 말이 됩니다.
      */}
      {isGuest && reason !== 'error' && reason !== 'deleted' && (
        <>
          <p className="mt-4 text-xs text-ink-3">
            지금 로그인해도 이 결과는 돌아오지 않아요. 다만 앞으로 만드는 결과는 계정에
            쌓여서 다른 기기에서도 열 수 있어요.
          </p>
          <button
            type="button"
            onClick={() => setLoginSheet(true)}
            className="mt-2 text-sm font-semibold text-ink-2 underline hover:text-brand"
          >
            로그인하기
          </button>
        </>
      )}

      {loginSheet && (
        <AccountSheet onClose={() => setLoginSheet(false)} />
      )}
    </div>
  )
}
