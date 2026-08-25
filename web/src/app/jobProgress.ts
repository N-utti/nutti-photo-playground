/**
 * 만드는 중인 job 을 «지금 몇 % · 몇 초 남았나 · 늦었나» 로 옮기는 계산.
 *
 * 원래 W-05 안에 있던 것을 꺼냈습니다. 같은 job 을 동시에 말하는 곳이 둘이 됐기
 * 때문입니다 — 대기 화면(screens/W05Waiting.tsx)과, 거기서 나간 뒤 따라다니는 상태 바
 * (app/JobStatusBar.tsx). 계산이 갈라지면 한쪽은 «약 8초», 다른 쪽은 «약 14초» 를 같은
 * 순간에 말하고, 그건 둘 중 하나가 고장 난 화면으로 읽힙니다. 두 곳은 캐시(queryKey)도
 * 같으므로 이제 서버 응답부터 화면 숫자까지 전 구간이 하나입니다.
 */

import { useEffect, useState } from 'react'
import type { Job } from '../api/types'

/**
 * 여기를 넘기면 «지연 안내»입니다 — FR-EDGE-02 · NFR-PERF-01.
 *
 * 넘겨도 화면이 하는 일은 기다림 그대로입니다. 크레딧은 정상 차감이고(FR-EDGE-02)
 * 서버는 계속 그리고 있으므로 취소할 것도, 되돌릴 것도 없습니다. 바뀌는 건 **말**
 * 하나뿐입니다: 여기서부터는 남은 초를 세는 게 아니라 "나가도 된다"를 말해야 합니다.
 *
 * ---------------------------------------------------------------------------
 * 60초였습니다. 2026-08-24 에 90초로 올렸습니다.
 *
 * 60초는 «목표 20–40초» 를 전제로 잡힌 값이었는데, 생성이 fal 경유 gpt-image-2 로
 * 실제로 돌기 시작한 뒤(백엔드 PR #110) **실측 중앙값이 ~48초**입니다(백엔드 이슈
 * #134 · PR #146, n=19). 즉 60초 기준은 **정상 생성의 상당수를 «예상보다 오래
 * 걸리고 있어요» 로 몰아넣습니다** — 절반 가까이가 48초 근처에서 끝나는데 그중
 * 조금만 느려도 경고가 뜹니다.
 *
 * 그러면 이 안내가 «드물게 뜨는 정직한 신호» 가 아니라 **평소에 뜨는 장식**이 되고,
 * 진짜로 오래 걸리는 job 을 구분해 주지 못합니다. 경고는 자주 틀리면 죽습니다.
 *
 * 이 값은 서버 동작이 아니라 **화면이 언제 말을 바꿀지**를 정하는 프론트 정책입니다.
 * 그래서 #146(스펙 문서·시드 `avg_seconds` 를 48 로) 머지 여부와 무관하게 지금
 * 고칩니다 — 실측 48초는 #146 이 바꾸는 게 아니라 **이미 참인 사실**이고, #146 은
 * 그걸 문서에 적는 PR 입니다. 다만 숫자 90 은 #146 이 제안한 값을 그대로 씁니다
 * (양쪽이 다른 숫자를 들고 있으면 그게 더 나쁩니다).
 *
 * 워커 하드 상한은 별개로 300초입니다(#146 의 NFR-PERF-01). 여기서 90초를 넘긴
 * job 도 그 안에서는 계속 살아 있습니다.
 */
const OVERDUE_AFTER_MS = 90_000

export interface JobProgress {
  /** 아직 끝나지 않은 job 인가. 응답이 오기 전(job === undefined)은 false 입니다. */
  running: boolean
  /** 0–99. 100 과 완료 판정은 서버만 할 수 있습니다(아래 smooth 주석). */
  progress: number
  /** 남은 초. 서버가 `eta_seconds` 를 안 주면 null — 그때는 숫자를 지어내지 않습니다. */
  remaining: number | null
  /** FR-EDGE-02 — 90초를 넘겨 «곧 끝난다»를 말할 근거를 잃은 상태. */
  overdue: boolean
}

/**
 * 폴링 응답 하나를 초 단위로 살려 냅니다.
 *
 * `dataUpdatedAt` 은 그 응답을 받은 시각(TanStack Query)입니다 — 보간의 기준점이라
 * 호출부가 그대로 넘겨 줘야 합니다.
 */
export function useJobProgress(
  jobId: string | undefined,
  job: Job | undefined,
  dataUpdatedAt: number,
): JobProgress {
  const running = job != null && job.status !== 'succeeded' && job.status !== 'failed'
  const now = useSecondsTick(running)

  const estimate = smooth(job, running ? (now - dataUpdatedAt) / 1_000 : 0)
  const progress = useMonotonic(estimate.progress, jobId)
  const startedAt = useStartedAt(jobId, job)

  return {
    running,
    progress,
    remaining: estimate.remaining,
    overdue: running && now - startedAt > OVERDUE_AFTER_MS,
  }
}

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
 * "남은 초를 숫자로"(W-05 노트1)가 안심이 아니라 고장 신호로 읽힙니다. 그래서 마지막
 * 응답을 기준으로 경과분만큼 깎아서 보여 줍니다.
 *
 * 막대가 99 에서 멈추는 건 의도입니다 — 100% 와 완료 판정은 서버만 할 수 있고,
 * 여기서 100 을 그리면 결과가 아직 없는데 다 됐다고 말하는 화면이 됩니다. eta 가
 * 0 이하로 내려간 뒤에는 근거가 없으므로 보간하지 않고 서버 값에 그대로 둡니다.
 *
 * 반환값은 **그 순간의 추정치**라 뒤로 갈 수 있습니다 — 서버 progress 가 단계별로
 * 뛰면(0 → 30 → 100) 보간이 다음 단계를 앞질러 있다가 폴링에서 되감깁니다.
 * 막대에 그리기 전에 단조 증가로 눌러 줍니다(useMonotonic).
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

/**
 * 경과를 재기 시작한 기준 시각 — **서버 우선**(PR #60).
 *
 * 서버가 `started_at`(워커가 집은 시각)과 `queued_at`(큐에 들어간 시각)을 답하게
 * 되면서 이 계산은 처음으로 «실제로 언제 시작했는지»를 알게 됐습니다. 그전에는 이
 * 브라우저에서 만든 job 만 로컬 색인으로 알 수 있었고, 링크로 받은 job 은 화면에
 * 도착한 순간부터 셌습니다.
 *
 * `started_at ?? queued_at` 인 이유: FR-EDGE-02 판정은 §3 이 **`started_at` 기준**으로
 * 규정합니다(큐 대기는 «생성 처리» 시간이 아니라는 NFR-PERF-01 정의). 그래서 워커가
 * 집은 뒤에는 오직 `started_at` 만 봅니다. 다만 아직 안 집힌 job 에 그 규칙을 그대로
 * 적용하면 3분째 큐에 앉아 있어도 화면은 «약 48초»를 계속 띄웁니다 — 90초를 넘긴
 * 뒤에도 «거의 다 됐어요»를 띄우지 않기로 한 것과 정확히 같은 종류의 거짓말이라,
 * 대기 중에는 `queued_at` 으로 같은 판정을 겁니다. 어느 쪽이든 화면이 하는 말은
 * "오래 걸리는 중이니 나가도 된다" 하나로 같습니다.
 *
 * **첫 응답이 오기 전**에만 화면 도착 시각으로 대신 잽니다. 그건 실제보다 늦게
 * 판정하는 쪽이라 없는 지연을 지어내지 않습니다. 예전에는 그 자리에 로컬 색인
 * (`api/jobContext.ts`)이 하나 더 있었는데, 서버 시각이 착지하면서(PR #60) 이
 * 브라우저에서 만든 job 에만 답하던 그 값이 할 일이 없어져 지웠습니다(이슈 #81).
 *
 * `resetKey`(job_id)가 바뀌면 다시 잽니다. "다시 만들기"로 이 계산이 재사용될 때
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
