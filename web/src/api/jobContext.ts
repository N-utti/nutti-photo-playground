/**
 * job 을 만들 때 쓴 재료(스타일·업로드)를 job_id 로 되찾기 위한 로컬 색인.
 *
 * 왜 필요한가: `GET /v1/jobs/{job_id}` 응답에 `style_id` 도 `upload_id` 도 없었습니다.
 * 그런데 W-06 의 "다시 만들기"(FR-W06-04, P0)와 "이 사진으로 다른 스타일"
 * (FR-W06-07)은 둘 다 그 두 값을 요구합니다 — 결과 화면만 보고는 무엇으로 무엇을
 * 만들었는지 알 수 없어 재생성이 불가능합니다.
 *
 * **현재 상태**: PR #60 으로 `style_id`·`upload_id` 구현이 착지했습니다. 읽는 쪽은
 * `resolveJobContext` 로 **서버 값을 먼저 보고 없을 때만 이 색인**을 씁니다. 남은
 * 용도는 예고대로 `customPrompt` 하나뿐이며(아래 주석 참고) 그것까지 응답에 실리면
 * 이 파일과 `rememberJobContext` 호출부를 함께 지웁니다 — **이슈 #81**.
 *
 * 그 응답이 **PR #83 으로 올라와 있고 아직 미머지**입니다. `resolveJobContext` 는
 * 이미 `job.custom_prompt` 를 먼저 보므로, 착지하는 순간 이 파일 없이도 커스텀
 * job 의 «다시 만들기»가 성립합니다. 그때 남는 일은 삭제뿐입니다 — 아래 세 값이
 * 전부 서버 값의 폴백일 뿐이라(`sourceImageUrl`←`source_image_url`,
 * `startedAt`←`queued_at`/`started_at`) 지울 때 잃는 건 «옛 브라우저 저장분» 하나입니다.
 *
 * localStorage 인 이유: 게스트 복원 자체가 **동일 브라우저 한정**이고(이슈 #5 PO
 * 결정, 30일) 세션 토큰도 localStorage 에 있습니다. 탭을 닫았다 URL 로 돌아오는 게
 * 바로 Q7 이 약속한 시나리오라 sessionStorage 로는 부족합니다.
 */

const STORAGE_KEY = 'nutti.job-context'

/** 색인은 편의 기능이라 무한정 쌓을 이유가 없습니다. 오래된 것부터 버립니다. */
const MAX_ENTRIES = 20

export interface JobContext {
  styleId: number | null
  uploadId: string
  /** 원본 이미지. 다른 스타일로 재사용할 때 W-04 를 다시 그리는 데 씁니다. */
  sourceImageUrl: string | null
  /**
   * W-08 커스텀 프롬프트로 만든 job 이면 그 문구. 이게 없으면 결과 화면의 "다시
   * 만들기"가 스타일도 문구도 없는 요청을 보내고, 비용도 2 가 아니라 1 로 보입니다.
   * 예전에 저장된 항목에는 이 필드가 없으므로 읽는 쪽에서 `?? null` 로 다룹니다.
   */
  customPrompt?: string | null
  /**
   * 이 job 을 만든 시각(ms). `rememberJobContext` 가 직접 찍으므로 호출부는 넘기지
   * 않습니다.
   *
   * **이제는 폴백입니다**(PR #60). 오래 비어 있던 계약 공백 — job 응답에 시각이 아예
   * 없어 이 브라우저에서 만든 job 만 경과를 알 수 있던 문제 — 를 `queued_at`·
   * `started_at` 이 메웠습니다(이슈 #41). W-05 는 서버 값을 먼저 보고, 없을 때만 이
   * 값으로 내려갑니다. 링크로 받은 job 도 이제 제대로 판정됩니다.
   */
  startedAt?: number
}

type ContextMap = Record<string, JobContext>

function readMap(): ContextMap {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as ContextMap
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function rememberJobContext(jobId: string, context: JobContext): void {
  const map = readMap()
  delete map[jobId] // 다시 넣어 삽입 순서를 최신으로 올립니다.
  // startedAt 은 **여기서 덮어씁니다**. "다시 만들기"는 이전 job 의 맥락을 그대로
  // 넘겨 오므로(W-06 Regenerate), 넘어온 값을 그대로 두면 새 job 이 이전 job 의
  // 시작 시각을 물려받아 만들자마자 «오래 걸리는 중»으로 보입니다.
  map[jobId] = { ...context, startedAt: Date.now() }

  const keys = Object.keys(map)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete map[stale]

  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function readJobContext(jobId: string): JobContext | null {
  return readMap()[jobId] ?? null
}

/**
 * 재생성 재료의 단일 진입점 — **서버 우선, 로컬 폴백**(이슈 #9).
 *
 * `job.upload_id` 가 오면 그 값이 진실입니다. 로컬 색인은 이 브라우저에서 만든
 * job 에만 있으므로, 서버가 답하기 시작하면 다른 기기·다른 탭에서 연 결과도
 * 재생성할 수 있게 됩니다.
 *
 * `customPrompt` 도 이제 **서버가 먼저**입니다 — PR #83 이 `custom_prompt` 를 응답에
 * 실으면서(이슈 #81) 다른 기기·다른 탭에서 연 커스텀 job 도 같은 문구로 다시 돌릴 수
 * 있게 됩니다. 다만 그 PR 이 아직 미머지라 **키가 아예 없는 응답**이 실서버에서 오고,
 * 그때는 예전처럼 로컬 색인으로 내려갑니다.
 *
 * `?? null` 이 아니라 `undefined` 만 폴백으로 치는 이유: 서버가 **명시적 `null`** 을
 * 주는 건 «프리셋 job 이라 문구가 없다» 또는 «로그가 지워졌다»는 **답**입니다(#83 본문).
 * 그걸 로컬 값으로 덮으면, 서버가 «없다»고 말한 job 에 이 브라우저의 옛 기억을 얹어
 * 스타일 job 을 커스텀으로 되돌리는 요청이 나갑니다.
 */
export function resolveJobContext(
  jobId: string,
  job?: {
    style_id?: number | null
    upload_id?: string
    source_image_url?: string
    custom_prompt?: string | null
  } | null,
): JobContext | null {
  const local = readJobContext(jobId)
  if (!job?.upload_id) return local

  return {
    styleId: job.style_id ?? null,
    uploadId: job.upload_id,
    sourceImageUrl: job.source_image_url ?? local?.sourceImageUrl ?? null,
    customPrompt: job.custom_prompt !== undefined ? job.custom_prompt : (local?.customPrompt ?? null),
    startedAt: local?.startedAt,
  }
}

/**
 * 이 job 이 시작된 시각. 이 브라우저에서 만든 job 이 아니면 `null` 입니다.
 *
 * 서버가 `created_at` 을 주지 않으므로(§3) 링크로 받은 job·다른 기기에서 만든
 * job 은 경과를 알 수 없습니다. 호출부(W-05)는 그때 화면 도착 시각으로 대신
 * 재는데, 그건 실제보다 **늦게** 판정하는 쪽이라 없는 지연을 지어내지 않습니다.
 */
export function readJobStartedAt(jobId: string): number | null {
  return readJobContext(jobId)?.startedAt ?? null
}
