/**
 * job 을 만들 때 쓴 재료(스타일·업로드)를 job_id 로 되찾기 위한 로컬 색인.
 *
 * 왜 필요한가: `GET /v1/jobs/{job_id}` 응답에 `style_id` 도 `upload_id` 도 없습니다
 * (05-api-spec §3). 그런데 W-06 의 "다시 만들기"(FR-W06-04, P0)와 "이 사진으로 다른
 * 스타일"(FR-W06-07)은 둘 다 그 두 값을 요구합니다 — 결과 화면만 보고는 무엇으로
 * 무엇을 만들었는지 알 수 없어 재생성이 불가능합니다. 백엔드 이슈로 올렸고, 응답에
 * 두 필드가 붙으면 이 파일은 통째로 지웁니다.
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
  map[jobId] = context

  const keys = Object.keys(map)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete map[stale]

  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function readJobContext(jobId: string): JobContext | null {
  return readMap()[jobId] ?? null
}
