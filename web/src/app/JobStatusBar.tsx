/**
 * 만드는 중인 job 을 따라다니는 상태 바 (W-05 "나가서 둘러보기"의 뒷면).
 *
 * W-05 는 이탈을 막지 않습니다(노트3) — 크레딧은 이미 나갔고 서버는 계속 그리는
 * 중이라, 90초를 넘긴 뒤에는 오히려 «나가도 된다»가 주 버튼입니다. 그런데 정작 나가면
 * 그 job 이 화면에서 통째로 사라졌습니다. 몇 %인지도, 끝났는지도, 돌아갈 길도 없이요.
 * 알림은 MVP 에서 뺐으므로(FR-W05-04) 그 자리를 메우던 건 «같은 주소로 다시 오면
 * 남아 있다» 한 줄인데, 주소를 외워 두는 사용자는 없습니다. 그래서 나가서 둘러보는
 * 동안 이 한 줄이 따라다닙니다 — 알림이 아니라 **이미 열려 있는 창 안에서만** 하는
 * 약속이라 지킬 수 있습니다.
 *
 * **어디에 다는가.** 여기만 RootLayout 이 직접 답니다 — 탭바·크레딧 배지가 «화면이
 * 직접 붙이는» 규칙을 따르는 것과 반대입니다(app/TabBar.tsx 주석). 이유는 조건이
 * «어느 화면인가»가 아니기 때문입니다. 이건 화면과 무관하게 «지금 만드는 중인 job 이
 * 있는가» 하나로 결정되고, 화면마다 붙이게 하면 새 화면이 생길 때마다 조용히 빠집니다
 * — 그러면 하필 그 화면에서 job 이 사라지는, 고치기 전보다 더 나쁜 상태가 됩니다.
 *
 * 대신 그 job 을 **이미 보고 있는 화면**에서는 비킵니다(W-05 대기 · W-06 결과). 같은
 * 진행률을 두 번 그리는 것도 이상하지만, 결과를 보는 중에 «완성됐어요, 보러 가기»가
 * 아래에 떠 있으면 그건 안내가 아니라 잘못 만든 화면입니다.
 */

import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  invalidateAfterJobSettled,
  isFatalJobError,
  useJobPolling,
} from '../api/queries'
import { forgetActiveJob, useActiveJobId } from './activeJob'
import { useJobProgress } from './jobProgress'
import Thumbnail from './Thumbnail'
import type { Job } from '../api/types'

export default function JobStatusBar() {
  const jobId = useActiveJobId()
  const { pathname } = useLocation()

  if (jobId == null) return null
  // 그 job 의 화면 위에서는 그 화면이 주인입니다.
  if (pathname === `/jobs/${jobId}` || pathname === `/jobs/${jobId}/waiting`) return null

  // 훅은 전부 아래 컴포넌트 안에 있습니다 — 여기서 부르면 상태 바가 없는 동안에도
  // 폴링이 돕니다. 조건이 렌더 여부가 되도록 갈라 둡니다.
  return <ActiveJobBar jobId={jobId} />
}

function ActiveJobBar({ jobId }: { jobId: string }) {
  const client = useQueryClient()
  const { data: job, error, dataUpdatedAt } = useJobPolling(jobId)
  const { running, progress, remaining, overdue } = useJobProgress(jobId, job, dataUpdatedAt)

  // 여기서도 정산 후 무효화를 겁니다. W-06 이 하는 것과 같은 일이지만(그쪽 주석 참고)
  // 이 바가 떠 있는 동안은 **결과 화면이 아직 열리지 않은 상태**라, 이걸 빼면 job 이
  // 끝난 뒤에도 앱바 잔액과 보관함이 옛 숫자를 말한 채 사용자가 계속 둘러봅니다.
  const settled = job?.status === 'succeeded' || job?.status === 'failed'
  useEffect(() => {
    if (settled) void invalidateAfterJobSettled(client)
  }, [settled, client])

  // 404·401 은 다시 물어도 답이 같습니다 — 없는 job 이거나 남의 것입니다(게스트 세션
  // 초기화 포함). 따라다닐 대상이 사라졌으므로 여기서 놓아 줍니다. 사유 안내는 그
  // 주소로 들어갔을 때 JobUnavailable 이 하는 일이고, 지나가는 사람 화면 아래에
  // 띄울 말은 아닙니다.
  const gone = error != null && isFatalJobError(error)
  useEffect(() => {
    if (gone) forgetActiveJob(jobId)
  }, [gone, jobId])

  // 첫 응답 전에는 아무 말도 하지 않습니다 — 빈 바가 깜빡였다 채워지면 그 자체가
  // 잡음이고, 어차피 2초 안에 답이 옵니다.
  if (gone || job == null) return null

  const { text, numeric } = note({ running, remaining, overdue, reconnecting: error != null })

  return (
    // 탭바(z-20)보다 위에 오되 시트·확인 모달(z-30)보다는 아래입니다. 모달이 떠 있는데
    // 이 바가 그 위에 남으면 모달 밖으로 나가는 길이 하나 열립니다.
    //
    // 위치는 탭바가 있든 없든 **같습니다**. 탭바가 있는 화면(W-02·W-09)에서만 더
    // 띄우려면 여기가 경로를 알아야 하는데, 그 조건문은 라우트가 늘 때마다 손대야 하고
    // 빠뜨려도 아무도 모릅니다(app/TabBar.tsx 가 화면에 붙이기로 한 것과 같은 이유).
    // 그래서 가장 두꺼운 쪽(탭바 + 안전영역)을 기준으로 한 번만 띄웁니다.
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 px-4">
      {/* 초 단위로 바뀌는 숫자와 막대는 읽어 주지 않습니다(aria-hidden) — 1초마다
          말하는 라이브 영역은 안내가 아니라 방해입니다. 대신 단계 문구와 «완성됐어요»
          처럼 실제로 상태가 바뀔 때만 한 번 읽힙니다. */}
      <div
        role="status"
        className="mx-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-rule-strong bg-surface p-2 shadow-md"
      >
        <Link
          to={running ? `/jobs/${jobId}/waiting` : `/jobs/${jobId}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-surface-2 motion-safe:active:scale-[0.99]"
        >
          {/* 어느 사진인지가 «내 것»을 알아보는 유일한 단서입니다. 완성 전에는 흐리게 —
              W-05 가 원본을 블러로 깔아 둔 것과 같은 이유로, 결과를 미리 본 것 같은
              착각을 주지 않습니다. */}
          <Thumbnail
            src={thumbnail(job)}
            alt=""
            className={`size-10 shrink-0 rounded-lg bg-surface-2 object-cover ${
              job.status === 'succeeded' ? '' : 'blur-[2px]'
            }`}
          />

          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold">{headline(job)}</span>
              <span
                aria-hidden
                className={`shrink-0 text-xs text-ink-3 ${
                  numeric ? 'font-mono tabular-nums' : ''
                }`}
              >
                {text}
              </span>
            </span>

            {running ? (
              <span
                aria-hidden
                className="block h-1 w-full overflow-hidden rounded-full bg-rule"
              >
                <span
                  className="block h-full rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </span>
            ) : (
              <span className="truncate text-xs text-ink-3">
                {job.status === 'succeeded' ? '눌러서 결과 보기' : '눌러서 확인하기'}
              </span>
            )}
          </span>
        </Link>

        {/* 닫을 수 있어야 합니다 — 모든 화면 아래에 눌러 없앨 수 없는 줄이 붙어 있으면
            그건 안내가 아니라 방해입니다. 닫아도 잃는 건 지름길뿐입니다: 만들어진
            결과는 보관함(W-09)에 그대로 있고, 주소도 그대로 삽니다. */}
        <button
          type="button"
          aria-label="상태 숨기기"
          onClick={() => forgetActiveJob(jobId)}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** 성공한 뒤에는 결과가, 그전에는 올린 사진이 «이 job» 을 대표합니다. */
function thumbnail(job: Job): string | null {
  return job.status === 'succeeded' ? (job.results?.[0]?.image_url ?? null) : job.source_image_url
}

/**
 * 실패를 «완성» 옆에 같은 톤으로 두는 게 맞습니다 — 이 바는 통보가 아니라 표시이고,
 * 크레딧이 돌아왔다는 사실과 다시 시도하는 법은 결과 화면이 제대로 말합니다(W-06).
 * 여기서 경고색으로 소리치면 둘러보던 사람을 놀래킬 뿐 할 수 있는 일은 같습니다.
 */
function headline(job: Job): string {
  if (job.status === 'succeeded') return '완성됐어요'
  if (job.status === 'failed') return '만들지 못했어요'
  return job.status_message ?? '만드는 중…'
}

/**
 * 오른쪽 끝의 짧은 한 마디. 규칙은 W-05 의 남은 초와 같습니다 — 0 에 닿으면 숫자
 * 대신 말로, 90초를 넘기면 «거의»라는 말도 접습니다. 여기서 다르게 말하면 같은 job
 * 을 두 화면이 다르게 설명하는 셈입니다.
 */
function note(state: {
  running: boolean
  remaining: number | null
  overdue: boolean
  reconnecting: boolean
}): { text: string; numeric: boolean } {
  const say = (text: string) => ({ text, numeric: false })

  if (!state.running) return say('')
  // 폴링이 계속 두드리는 중이라 사용자가 할 일은 없지만, 숫자가 설명 없이 얼어
  // 있으면 그게 곧 고장 신호입니다(W-05 와 같은 판단).
  if (state.reconnecting) return say('연결 확인 중')
  if (state.overdue && (state.remaining == null || state.remaining === 0)) return say('오래 걸리는 중')
  if (state.remaining == null) return say('')
  // 초는 고정폭으로 — 한 자리씩 줄 때마다 옆 문구가 흔들리면 눈이 그걸 따라갑니다.
  return state.remaining > 0
    ? { text: `약 ${state.remaining}초`, numeric: true }
    : say('거의 다 됐어요')
}
