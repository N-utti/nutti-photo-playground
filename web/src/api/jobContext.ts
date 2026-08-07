/**
 * job 을 만들 때 쓴 재료(스타일·업로드)를 job_id 로 되찾기 위한 로컬 색인.
 *
 * 왜 필요한가: `GET /v1/jobs/{job_id}` 응답에 `style_id` 도 `upload_id` 도 없었습니다.
 * 그런데 W-06 의 "다시 만들기"(FR-W06-04, P0)와 "이 사진으로 다른 스타일"
 * (FR-W06-07)은 둘 다 그 두 값을 요구합니다 — 결과 화면만 보고는 무엇으로 무엇을
 * 만들었는지 알 수 없어 재생성이 불가능합니다.
 *
 * **현재 상태(이슈 #9)**: A안이 채택돼 §3 에는 `style_id`·`upload_id` 가 들어갔지만
 * 백엔드 구현은 아직 올라오지 않았습니다. 그래서 읽는 쪽은 `resolveJobContext` 로
 * **서버 값을 먼저 보고 없을 때만 이 색인**을 씁니다. 구현이 착지하면 남는 용도는
 * `customPrompt` 하나뿐이며(아래 주석 참고) 그것까지 응답에 실리면 이 파일과
 * `rememberJobContext` 호출부를 함께 지웁니다.
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
   * **재료 색인과 수명이 다릅니다.** 위 세 필드는 이슈 #9 구현이 착지하면 서버가
   * 답하게 되지만, 이 값은 `GET /v1/jobs/{job_id}` 응답에 `created_at` 이 아예
   * 없어서(§3) 서버가 대신 답해 줄 수 없습니다. W-05 가 FR-EDGE-02(60초 초과 =
   * 백그라운드 전환)를 판정하는 유일한 근거라, #9 로 이 파일을 지울 때도 이 필드는
   * 남습니다. 계약 공백은 별도 이슈로 올려 뒀습니다.
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
 * `customPrompt` 만 예외적으로 로컬을 계속 봅니다 — job 응답에 `custom_prompt` 가
 * 없어서(§3) 서버 값만으로는 W-08 커스텀 job 을 같은 문구로 다시 돌릴 수도, 비용
 * 2크레딧을 맞게 표시할 수도 없습니다. 이 갭은 이슈 #9 에 남겼습니다.
 */
export function resolveJobContext(
  jobId: string,
  job?: { style_id?: number | null; upload_id?: string; source_image_url?: string } | null,
): JobContext | null {
  const local = readJobContext(jobId)
  if (!job?.upload_id) return local

  return {
    styleId: job.style_id ?? null,
    uploadId: job.upload_id,
    sourceImageUrl: job.source_image_url ?? local?.sourceImageUrl ?? null,
    customPrompt: local?.customPrompt ?? null,
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
