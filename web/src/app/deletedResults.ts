/**
 * 이 브라우저가 보관함에서 지운 결과의 job_id (이슈 #152 의 프론트 절반).
 *
 * 보관함 삭제는 **논리삭제**입니다 — 서버는 `deleted_at` 만 찍고 R2 객체는 배치가
 * 나중에 지웁니다(06-architecture §4). 그런데 지금은 그 `deleted_at` 을 `/jobs`
 * 조회가 안 봅니다(이슈 #152): 방금 지운 사진이 `/jobs/{job_id}` 로 그대로 열리고
 * 저장·공유 버튼까지 붙어 있어, 삭제 확인 창의 «되돌릴 수 없어요» 가 그 자리에서
 * 거짓이 됩니다.
 *
 * 그 필터가 붙으면 같은 주소는 404 가 되고, W-06 은 그걸 «주소가 잘못됐거나, 다른
 * 기기·브라우저에서 만든 결과» 로 설명합니다(JobUnavailable 'not-found'). 자기가
 * 지운 사람에게는 둘 다 틀린 말입니다 — 앞의 것은 삭제가 안 된 척하고, 뒤의 것은
 * 자기가 한 일을 주소·기기 탓으로 돌립니다. 게스트에게는 «지금 로그인해도 이 결과는
 * 돌아오지 않아요» 라는 로그인 유도까지 붙어서, **본인이 지운 사진**을 두고 잃어버린
 * 것처럼 말하게 됩니다.
 *
 * 서버는 "왜 없는지" 를 말해 주지 않습니다(404 는 없다는 사실뿐입니다). 그 이유를
 * 아는 건 지우기를 누른 이 브라우저뿐이라, 여기서 기억해 둡니다. **삭제가 204 로
 * 끝난 것만** 적습니다 — 실패한 삭제까지 적으면 살아 있는 결과를 지웠다고 말하게
 * 됩니다.
 *
 * `result_id` 가 아니라 `job_id` 를 적는 이유: 되짚는 쪽이 `/jobs/{job_id}` 화면이고
 * job 응답의 `results[]` 에는 `result_id` 가 없습니다(§3 — `{index, image_url}`).
 * 지금은 1요청 1장이라(Q4) 둘이 1:1 이고, 한 job 에 결과가 여럿이 되면 «일부만 지운
 * job» 이 생기지만 그때도 이 기록은 **404 를 설명할 때만** 쓰이므로 안전합니다 —
 * 서버가 200 으로 주는 job 은 그대로 그립니다.
 *
 * localStorage 인 이유는 이 오해가 나중에 오기 때문입니다. 지운 직후보다 며칠 뒤
 * 북마크·공유 링크로 다시 여는 쪽이 흔하고, sessionStorage 였다면 탭을 닫는 순간
 * 설명할 근거가 사라집니다. 탈퇴 시에는 `nutti.` 접두사 청소가 같이 걷어갑니다
 * (api/localTraces.ts).
 */

const STORAGE_KEY = 'nutti.deleted-jobs'

/**
 * 최근 것부터 이만큼만 남깁니다. 이 기록은 «왜 404 인지» 를 한 줄 다르게 말하려고
 * 두는 것이라 무제한으로 쌓을 이유가 없고, 아주 오래전에 지운 결과의 주소를 다시
 * 여는 사람은 이미 그 사진을 기억하지 못합니다.
 */
const LIMIT = 200

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // 손상된 값 하나가 보관함 삭제를 통째로 막으면 안 됩니다 — 기록은 부가 정보입니다.
    return []
  }
}

/** 보관함 삭제가 204 로 끝난 뒤 부릅니다. 같은 id 는 최신 쪽 하나로 접힙니다. */
export function rememberDeletedJobs(jobIds: string[]): void {
  if (jobIds.length === 0) return
  const merged = [...new Set([...jobIds, ...read()])].slice(0, LIMIT)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // 저장소가 꽉 찼거나 막힌 브라우저. 설명이 한 줄 덜 친절해질 뿐입니다.
  }
}

export function wasDeletedHere(jobId: string | undefined): boolean {
  return jobId !== undefined && read().includes(jobId)
}
