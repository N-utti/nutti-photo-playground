/**
 * W-05 · 생성 대기 (docs/wireframe-spec-v0.5.html#p05)
 *
 * 반영한 노트:
 *   1. 남은 초를 숫자로 — 무한 스피너는 체감 시간을 배로 늘립니다
 *   2. 진행 문구는 서버가 스타일별로 내려줍니다(`status_message`)
 *   3. 이탈 허용 — 창을 닫아도 서버는 계속 처리
 *
 * 문구에서 **의도적으로 뺀 것**: 와이어프레임의 "알림 받고 나가기 / 완성되면
 * 알려드릴게요". 완료 알림은 MVP 제외(FR-W05-04)라 지킬 수 없는 약속이고, 이슈 #5 가
 * 정확히 이 과약속을 지적했습니다. PO 결정(B+A)에 따라 알림 대신 **같은 브라우저에서
 * 30일 안에 다시 오면 결과가 남아 있다**는, 실제로 지켜지는 범위만 말합니다.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { isFatalJobError, useJobPolling, useStyles } from '../api/queries'
import { useGuestSessionReset } from '../app/guestSession'
import Thumbnail from '../app/Thumbnail'
import JobUnavailable from './JobUnavailable'
import type { Job } from '../api/types'

/**
 * 여기를 넘기면 «백그라운드 전환»입니다 — FR-EDGE-02 · NFR-PERF-01(목표 20–40초,
 * 60초 초과 시 타임아웃 정책).
 *
 * 넘겨도 화면이 하는 일은 기다림 그대로입니다. 크레딧은 정상 차감이고(FR-EDGE-02)
 * 서버는 계속 그리고 있으므로 취소할 것도, 되돌릴 것도 없습니다. 바뀌는 건 **말**
 * 하나뿐입니다: 여기서부터는 남은 초를 세는 게 아니라 "나가도 된다"를 말해야 합니다.
 */
const OVERDUE_AFTER_MS = 60_000

/**
 * 진행 중일 때만 1초마다 리렌더를 부릅니다.
 *
 * 폴링이 멈춰 있는 동안 화면을 움직이게 하는 유일한 시계입니다 — 종료 상태에서는
 * 곧바로 결과 화면으로 넘어가므로 타이머를 붙잡고 있을 이유가 없습니다.
 */
function useSecondsTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [active])

  return now
}

/**
 * 폴링 사이를 메우는 표시값.
 *
 * `progress`·`eta_seconds` 는 폴링 시점에만 갱신되므로 그대로 그리면 다음 폴링까지
 * 막대와 숫자가 통째로 멈춥니다. 12초짜리 작업에서 그 정지가 실측 8초였고, 그러면
 * "남은 초를 숫자로"(노트1)가 안심이 아니라 고장 신호로 읽힙니다. 그래서 마지막
 * 응답을 기준으로 경과분만큼 깎아서 보여 줍니다.
 *
 * 막대가 99 에서 멈추는 건 의도입니다 — 100% 와 완료 판정은 서버만 할 수 있고,
 * 여기서 100 을 그리면 결과가 아직 없는데 다 됐다고 말하는 화면이 됩니다. eta 가
 * 0 이하로 내려간 뒤에는 근거가 없으므로 보간하지 않고 서버 값에 그대로 둡니다.
 *
 * 반환값은 **그 순간의 추정치**라 뒤로 갈 수 있습니다 — 서버 progress 가 단계별로
 * 뛰면(0 → 30 → 100) 보간이 다음 단계를 앞질러 있다가 폴링에서 되감깁니다.
 * 막대에 그리기 전에 호출부가 단조 증가로 눌러 줍니다(useMonotonic).
 */
function smooth(
  job: { progress: number | null; eta_seconds: number | null } | undefined,
  sincePollSeconds: number,
): { progress: number; remaining: number | null } {
  const basis = job?.progress ?? 0
  const eta = job?.eta_seconds ?? null
  if (eta === null) return { progress: basis, remaining: null }

  const elapsed = Math.max(0, sincePollSeconds)
  const remaining = Math.max(0, Math.round(eta - elapsed))
  if (eta <= 0) return { progress: basis, remaining }

  const ratio = Math.min(1, elapsed / eta)
  return { progress: Math.min(99, Math.round(basis + (100 - basis) * ratio)), remaining }
}

/**
 * 진행률이 뒤로 가지 않게 눌러 둡니다.
 *
 * 되감기는 막대는 사용자에게 "뭔가 잘못됐다"로 읽힙니다 — 실제로는 추정이 한 번
 * 앞질렀을 뿐인데도요. 서버 progress 자체는 단조 증가이므로 여기서 잃는 정보가
 * 없습니다. `resetKey`(job_id)가 바뀌면 다음 job 이라 바닥을 되돌립니다.
 *
 * 렌더 중 setState 는 React 가 명시적으로 허용하는 "이전 렌더에서 파생된 상태
 * 조정" 패턴입니다 — 같은 커밋 안에서 즉시 다시 렌더되므로 화면에 중간값이
 * 새어 나가지 않습니다.
 */
/**
 * 경과를 재기 시작한 기준 시각 — **서버 우선**(PR #60).
 *
 * 서버가 `started_at`(워커가 집은 시각)과 `queued_at`(큐에 들어간 시각)을 답하게
 * 되면서 이 화면은 처음으로 «실제로 언제 시작했는지»를 알게 됐습니다. 그전에는 이
 * 브라우저에서 만든 job 만 로컬 색인으로 알 수 있었고, 링크로 받은 job 은 화면에
 * 도착한 순간부터 셌습니다.
 *
 * `started_at ?? queued_at` 인 이유: FR-EDGE-02 판정은 §3 이 **`started_at` 기준**으로
 * 규정합니다(큐 대기는 «생성 처리» 시간이 아니라는 NFR-PERF-01 정의). 그래서 워커가
 * 집은 뒤에는 오직 `started_at` 만 봅니다. 다만 아직 안 집힌 job 에 그 규칙을 그대로
 * 적용하면 3분째 큐에 앉아 있어도 화면은 «약 24초»를 계속 띄웁니다 — 60초를 넘긴
 * 뒤에도 «거의 다 됐어요»를 띄우지 않기로 한 것과 정확히 같은 종류의 거짓말이라,
 * 대기 중에는 `queued_at` 으로 같은 판정을 겁니다. 어느 쪽이든 화면이 하는 말은
 * "오래 걸리는 중이니 나가도 된다" 하나로 같습니다.
 *
 * **첫 응답이 오기 전**에만 화면 도착 시각으로 대신 잽니다. 그건 실제보다 늦게
 * 판정하는 쪽이라 없는 지연을 지어내지 않습니다. 예전에는 그 자리에 로컬 색인
 * (`api/jobContext.ts`)이 하나 더 있었는데, 서버 시각이 착지하면서(PR #60) 이
 * 브라우저에서 만든 job 에만 답하던 그 값이 할 일이 없어져 지웠습니다(이슈 #81).
 *
 * `resetKey`(job_id)가 바뀌면 다시 잽니다. "다시 만들기"로 이 화면이 재사용될 때
 * 이전 job 의 기준을 물려받으면 새 job 이 시작하자마자 초과로 보입니다.
 */
function useStartedAt(jobId: string | undefined, job: Job | undefined): number {
  const [state, setState] = useState(() => ({ key: jobId, at: Date.now() }))

  const arrival = state.key === jobId ? state.at : Date.now()
  if (state.key !== jobId) setState({ key: jobId, at: arrival })

  const server = job?.started_at ?? job?.queued_at
  const parsed = server != null ? Date.parse(server) : Number.NaN
  return Number.isFinite(parsed) ? parsed : arrival
}

function useMonotonic(value: number, resetKey: string | undefined): number {
  const [floor, setFloor] = useState(0)
  const [key, setKey] = useState(resetKey)

  if (key !== resetKey) {
    setKey(resetKey)
    setFloor(0)
    return value
  }
  if (value > floor) {
    setFloor(value)
    return value
  }
  return floor
}

export default function W05Waiting() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const guestReset = useGuestSessionReset()

  const { data: job, error, dataUpdatedAt } = useJobPolling(jobId ?? null)
  const { data: popular } = useStyles({ section: 'popular', limit: 3 })

  const running = job != null && job.status !== 'succeeded' && job.status !== 'failed'
  const now = useSecondsTick(running)

  // 아래 `if (error)` 보다 위에 있어야 합니다 — 조기 반환 뒤에서 부르면 훅 순서가
  // 렌더마다 달라집니다.
  const estimate = smooth(job, running ? (now - dataUpdatedAt) / 1_000 : 0)
  const progress = useMonotonic(estimate.progress, jobId)
  const remaining = estimate.remaining

  // FR-EDGE-02 — 60초를 넘기면 이 화면은 «곧 끝난다»를 스스로 말할 근거를 잃습니다.
  // 남은 초가 0 에 붙은 뒤에도 계속 «거의 다 됐어요»를 띄우면 그건 안심이 아니라
  // 멈춘 화면이고(노트1 이 스피너를 뺀 이유와 같습니다), 그 자리에서 해야 할 말은
  // "오래 걸리는 중이니 나가도 된다" 쪽으로 바뀝니다.
  const startedAt = useStartedAt(jobId, job)
  const overdue = running && now - startedAt > OVERDUE_AFTER_MS

  // 종료 상태면 결과 화면이 주인입니다. replace 인 이유: 뒤로가기로 이미 끝난
  // 대기 화면에 돌아오면 다시 결과로 튕겨 나가 되돌아갈 수가 없습니다.
  useEffect(() => {
    if (job && (job.status === 'succeeded' || job.status === 'failed')) {
      navigate(`/jobs/${job.job_id}`, { replace: true })
    }
  }, [job, navigate])

  // 회복 가능한 에러(5xx·네트워크 단절)인데 이미 받아 둔 진행 상황이 있으면 화면을
  // 헐지 않습니다. 폴링은 그 사이에도 상한 간격으로 계속 두드리는 중이라 곧 스스로
  // 따라잡고, 그 몇 초 때문에 «새로 만들기»밖에 없는 막다른 화면으로 보내면 아직
  // 살아 있는 작업을 사용자가 포기합니다 — 크레딧은 이미 나간 뒤입니다.
  // 대신 아무 말 없이 멈춘 것처럼 보이지 않게 연결 상태를 한 줄로 말합니다.
  const reconnecting = error != null && job != null && !isFatalJobError(error)

  if (error && !reconnecting) {
    const status = error instanceof ApiError ? error.status : 0
    return (
      <JobUnavailable
        reason={guestReset ? 'guest-reset' : status === 404 || status === 401 ? 'not-found' : 'error'}
        detail={status >= 500 ? error.message : undefined}
      />
    )
  }

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center border-b border-rule bg-surface px-4 py-3">
        <h1 className="text-base font-bold">만드는 중</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {/* 원본은 흐리게 — 결과를 미리 본 것 같은 착각을 주지 않으면서 맥락은 남깁니다. */}
        {job?.source_image_url && (
          <img
            src={job.source_image_url}
            alt=""
            className="aspect-square w-full rounded-xl bg-surface-2 object-cover blur-sm"
          />
        )}

        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="생성 진행률"
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-rule"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          {/* 노트2 — "생성 중"이 아니라 "레고 블록을 쌓는 중". 문구는 운영이 W-11 에서 관리합니다. */}
          <span className="truncate text-sm font-semibold">
            {job?.status_message ?? '준비하는 중…'}
          </span>
          {/* 노트1 — 남은 초를 숫자로. 0 에 닿았는데 아직 안 끝났으면 숫자 대신 말로
              바꿉니다 — "약 0초"가 계속 떠 있으면 그게 곧 멈춘 화면입니다.
              60초를 넘긴 뒤(overdue)에는 그 "거의 다 됐어요"마저 접습니다. 1분을
              넘겨 놓고 계속 «거의»라고 말하면 그건 위로가 아니라 거짓말이고, 아래
              안내가 같은 자리에서 사실대로 말합니다. 서버가 여전히 유효한 숫자를
              주는 동안은(remaining > 0) 초과 상태에서도 그대로 보여 줍니다 — 얼마나
              더 걸리는지가 곧 «나갈까 기다릴까»의 판단 재료입니다. */}
          {remaining != null && !(overdue && remaining === 0) && (
            <span
              className={`shrink-0 text-sm text-ink-3 ${
                remaining > 0 ? 'font-mono tabular-nums' : ''
              }`}
            >
              {remaining > 0 ? `약 ${remaining}초` : '거의 다 됐어요'}
            </span>
          )}
        </div>

        {/* 서버가 잠깐 답을 못 주는 중입니다. 폴링이 계속 돌고 있어 사용자가 할 일은
            없지만, 진행률과 숫자가 아무 설명 없이 얼어 있으면 그게 곧 고장 신호로
            읽힙니다 — 노트1 이 스피너를 뺀 이유와 같습니다. */}
        {reconnecting && (
          <p className="mt-1 text-xs text-ink-3">
            연결이 잠시 불안정해요. 작업은 계속되는 중이고, 연결되면 바로 이어서 보여 드릴게요.
          </p>
        )}

        {/* FR-EDGE-02 · 백그라운드 전환.
            «실패»가 아니라 «정상이지만 오래 걸리는 중»입니다 — 크레딧도 정상 차감이라
            되돌릴 것이 없고, 사용자가 할 수 있는 유일한 일이 «기다리거나 나가거나»
            둘뿐입니다. 그래서 경고색을 쓰지 않고, 대신 사라진 남은 초 자리를 이
            안내가 대신 채웁니다. 알림은 여전히 약속하지 않습니다(FR-W05-04). */}
        {overdue && (
          <div className="mt-3 rounded-lg border border-rule-strong bg-surface px-3 py-3">
            <p className="text-sm font-semibold">예상보다 오래 걸리고 있어요</p>
            <p className="mt-0.5 text-sm text-ink-2">
              작업은 계속 진행 중이에요. 창을 닫아도 멈추지 않고, 이 브라우저에서 이 주소로
              다시 오면 결과를 볼 수 있어요.
            </p>
          </div>
        )}

        {/* 노트3 — 이탈은 막지 않습니다. 다만 알림은 없으므로 약속하지 않습니다.
            60초를 넘긴 뒤에는 이게 주 버튼입니다 — 그 시점에 우리가 정직하게 권할 수
            있는 건 «기다려 주세요»가 아니라 «나가도 됩니다» 쪽입니다. */}
        <Link
          to="/styles"
          className={`mt-5 block rounded-xl px-4 py-3 text-center text-sm font-semibold motion-safe:active:scale-[0.99] ${
            overdue
              ? 'bg-brand text-paper hover:bg-brand-deep'
              : 'border border-rule-strong bg-surface hover:border-brand-2 hover:bg-surface-2 hover:text-brand'
          }`}
        >
          나가서 둘러보기
        </Link>
        {!overdue && (
          <p className="mt-2 text-center text-xs text-ink-3">
            나가도 작업은 계속됩니다. 이 브라우저에서 이 주소로 다시 오면 결과를 볼 수 있어요.
          </p>
        )}

        {/* 노트4 — 결과를 보기 전이라 광고 밀도는 W-06 보다 낮게. 카드 3장까지만. */}
        {popular && popular.sections[0]?.styles.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold">기다리는 동안</h2>
            <ul className="mt-2 grid grid-cols-3 gap-3">
              {popular.sections[0].styles.slice(0, 3).map((style) => (
                <li key={style.id}>
                  <Link
                    to={`/styles/${style.id}`}
                    className="block overflow-hidden rounded-lg border border-rule bg-surface hover:border-brand-2"
                  >
                    <Thumbnail
                      src={style.thumbnail_url}
                      alt={style.name}
                      loading="lazy"
                      className="aspect-square w-full bg-surface-2 object-cover"
                    />
                    <span className="block truncate px-2 py-1 text-xs">{style.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
