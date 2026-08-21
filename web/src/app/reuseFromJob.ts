/**
 * "이 사진으로 다른 스타일"(FR-W06-07)의 재사용 맥락을 화면 사이로 나르는 규칙.
 *
 * 맥락은 `?from_job=` 쿼리 하나이고, 실제 재료는 **job 응답 그 자체**입니다.
 * 화면이 각자 `searchParams.get('from_job')` 을 읽으면 규칙이 갈라지므로 여기 모읍니다.
 *
 * 왜 W-02·W-03 까지 나르는가: W-06 의 "다른 스타일"은 인기 3개만 보여 줍니다. 그
 * 밖의 스타일을 고르려면 카탈로그로 나가야 하는데, 거기서 맥락이 끊기면 방금 쓴
 * 사진을 **다시 올리게 되고** `upload_id` 가 새로 발급돼 재사용 자체가 무산됩니다
 * (web/README.md 실수하기 쉬운 지점 7번과 같은 함정).
 *
 * **이전에는 `api/jobContext.ts` 라는 localStorage 색인이 절반을 답했습니다.** job
 * 응답에 재료가 없던 시절의 우회였고, 세 번에 걸쳐 계약이 메워지면서(PR #60
 * `style_id`·`upload_id`·시각, PR #83 `custom_prompt`·`credit_cost`) 전부 죽은
 * 폴백이 돼 삭제했습니다 — 이슈 #9·#41·#81. 그 색인은 **만든 브라우저에서만** 답할
 * 수 있었으므로, 지운 결과는 기능 축소가 아니라 반대입니다: 링크로 받은 결과도,
 * 다른 기기에서 연 결과도 이제 똑같이 재생성됩니다.
 */

import { useSearchParams } from 'react-router'
import { useJob } from '../api/queries'
import type { Job } from '../api/types'

export const REUSE_PARAM = 'from_job'

/** 재생성·재사용에 필요한 재료. 전부 job 응답에서 그대로 나옵니다. */
export interface JobContext {
  styleId: number | null
  uploadId: string
  /** 원본 이미지. 다른 스타일로 재사용할 때 W-04 를 다시 그리는 데 씁니다. */
  sourceImageUrl: string
  /**
   * W-08 커스텀 프롬프트로 만든 job 이면 그 문구, 프리셋 job 이면 null (PR #83).
   *
   * 커스텀 job 인데 **null 인 경우가 남습니다** — 프롬프트 로그가 job 보다 먼저
   * 지워지면(`on_delete=SET_NULL`) 서버도 문구를 모릅니다. 그때 같은 요청을 다시
   * 보내면 스타일도 문구도 없는 job 이 나가므로, 호출부는 `styleId === null &&
   * !customPrompt` 를 재생성 불가로 판정합니다(W-06 `Regenerate`).
   */
  customPrompt: string | null
  /**
   * 이 사진에 붙어 있는 강아지 (이슈 #101 2번 → 백엔드 #111 착지분).
   *
   * 재료 중 **유일하게 «생성 요청에 실어 보내는 값» 이 아닌 것**입니다. `POST /v1/jobs`
   * 의 `pet_id` 는 서버가 읽지도 않습니다(`app/routers/jobs.py`: 연결은
   * `source_image.pet_profile_id` 한 곳에만 있습니다). 그런데도 나르는 이유는 W-04 가
   * **화면에 뭐라고 쓸지**를 이 값으로 정하기 때문입니다 — 이름이 인쇄되는 스타일에서
   * 워커가 넣을 이름이 저장된 강아지 이름인지 «우리 아이» 인지가 이 값으로 갈립니다.
   *
   * 이 필드가 없던 동안 W-04 는 재사용 경로에서만 «있으면 그 이름이, 없으면 우리
   * 아이가» 라는 흐린 문구를 따로 들고 있었습니다.
   */
  petId: string | null
}

/**
 * job 응답 → 재사용 재료. 응답이 아직 없으면 null 입니다.
 *
 * 이름을 `resolve` 가 아니라 `from` 으로 둔 건 이제 **고를 출처가 하나뿐**이기
 * 때문입니다 — 서버와 로컬 색인 중 무엇을 볼지 정하던 판정이 사라졌습니다.
 */
export function contextFromJob(job: Job | undefined | null): JobContext | null {
  if (!job?.upload_id) return null

  return {
    styleId: job.style_id,
    uploadId: job.upload_id,
    sourceImageUrl: job.source_image_url,
    customPrompt: job.custom_prompt,
    // 옛 응답에는 없던 필드라 `?? null` 을 둡니다 — undefined 가 새면 «모른다» 와
    // «붙은 강아지가 없다» 가 같은 값이 되고, W-04 가 그 둘을 갈라 씁니다.
    petId: job.pet_id ?? null,
  }
}

export interface ReuseFromJob {
  /** 쿼리에 실린 값 그대로. 재료를 아직 못 구했어도 링크로는 계속 나릅니다. */
  jobId: string | null
  /** 재사용할 재료. 서버가 답하지 못하면 null. */
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
  const context = jobId ? contextFromJob(job) : null

  return {
    jobId,
    context,
    // disabled 쿼리도 isPending 이 true 라서 jobId 검사를 앞에 둡니다.
    pending: jobId !== null && context === null && isPending,
  }
}

/** 재사용 중이면 목적지에 `from_job` 을 이어 붙입니다. 아니면 주소를 그대로 둡니다. */
export function withReuse(to: string, jobId: string | null): string {
  if (!jobId) return to
  return `${to}${to.includes('?') ? '&' : '?'}${REUSE_PARAM}=${encodeURIComponent(jobId)}`
}
