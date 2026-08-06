/**
 * "이 사진으로 다른 스타일"(FR-W06-07)의 재사용 맥락을 화면 사이로 나르는 규칙.
 *
 * 맥락은 `?from_job=` 쿼리 하나이고, 실제 재료(`upload_id`·원본 URL)는
 * `resolveJobContext` 가 **서버 우선 · 로컬 색인 폴백**으로 답합니다(이슈 #9 A안).
 * 화면이 각자 `searchParams.get('from_job')` 을 읽으면 규칙이 갈라지므로 여기 모읍니다.
 *
 * 왜 W-02·W-03 까지 나르는가: W-06 의 "다른 스타일"은 인기 3개만 보여 줍니다. 그
 * 밖의 스타일을 고르려면 카탈로그로 나가야 하는데, 거기서 맥락이 끊기면 방금 쓴
 * 사진을 **다시 올리게 되고** `upload_id` 가 새로 발급돼 재사용 자체가 무산됩니다
 * (web/README.md 실수하기 쉬운 지점 7번과 같은 함정).
 */

import { useSearchParams } from 'react-router'
import { resolveJobContext, type JobContext } from '../api/jobContext'
import { useJob } from '../api/queries'

export const REUSE_PARAM = 'from_job'

export interface ReuseFromJob {
  /** 쿼리에 실린 값 그대로. 재료를 아직 못 구했어도 링크로는 계속 나릅니다. */
  jobId: string | null
  /** 재사용할 재료. 서버·로컬 어느 쪽도 답하지 못하면 null. */
  context: JobContext | null
  /** 서버 응답을 기다리는 중 — 이때는 "재사용 불가"로 단정하면 안 됩니다. */
  pending: boolean
}

export function useReuseFromJob(): ReuseFromJob {
  const [searchParams] = useSearchParams()
  const jobId = searchParams.get(REUSE_PARAM)

  // 같은 캐시 키(queryKeys.job)를 W-04·W-06 과 공유하므로, 방금 보던 job 이면
  // 요청이 다시 나가지 않습니다. jobId 가 없으면 쿼리 자체가 꺼집니다.
  const { data: job, isPending } = useJob(jobId)
  const context = jobId ? resolveJobContext(jobId, job) : null

  return {
    jobId,
    context,
    // 로컬 색인이 이미 답했으면 기다릴 게 없습니다. disabled 쿼리도 isPending 이
    // true 라서 jobId 검사를 앞에 둡니다.
    pending: jobId !== null && context === null && isPending,
  }
}

/** 재사용 중이면 목적지에 `from_job` 을 이어 붙입니다. 아니면 주소를 그대로 둡니다. */
export function withReuse(to: string, jobId: string | null): string {
  if (!jobId) return to
  return `${to}${to.includes('?') ? '&' : '?'}${REUSE_PARAM}=${encodeURIComponent(jobId)}`
}
