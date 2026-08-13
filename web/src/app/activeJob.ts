/**
 * 이 탭이 «지켜보던» job 하나 (W-05 노트3 의 뒷면).
 *
 * W-05 는 "나가서 둘러보기"로 사용자를 내보냅니다 — 크레딧은 이미 나갔고 서버는 계속
 * 그리는 중이라 나가도 되는 게 맞습니다. 그런데 나가는 순간 화면에서 그 job 이 통째로
 * 사라집니다. 진행 상황도, 끝났다는 사실도, 돌아갈 길도 없습니다. 알림은 MVP 에서
 * 뺐으므로(FR-W05-04) 그 자리를 대신하는 건 «같은 주소로 다시 오면 남아 있다» 하나인데,
 * 주소를 외워 두는 사용자는 없습니다. 그래서 **탭 안에 머무는 동안만이라도** 그 job 을
 * 따라다니게 합니다(app/JobStatusBar.tsx).
 *
 * sessionStorage 인 이유는 idempotency.ts · uploadDraft.ts 와 같습니다 — 새로고침을
 * 건너야 하고(리로드 한 번에 상태 바가 사라지면 그건 없는 것과 같습니다), 탭을 닫으면
 * 같이 끝나야 합니다. localStorage 였다면 내일 새 탭을 연 사람에게 어제 job 의 상태 바가
 * 떠 있고, 그 job 은 이미 봤거나 관심이 끝난 것입니다. 창을 닫은 뒤의 복원은 여전히
 * 주소(Q7)의 몫이고 여기가 대신하지 않습니다.
 *
 * **하나만 기억합니다.** 목록이 아닙니다 — 새 job 을 시작하면 그게 지금 기다리는
 * 것이고, 화면 아래에 상태 바가 여러 줄 쌓이는 건 이 앱의 흐름(한 번에 한 장)에도
 * 맞지 않습니다.
 */

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'nutti.active-job'

const listeners = new Set<() => void>()
let current: string | null = sessionStorage.getItem(STORAGE_KEY)

function emit(): void {
  for (const listener of listeners) listener()
}

/** W-05 가 «만드는 중»인 job 을 보고 있는 동안 계속 부릅니다. 같은 값이면 아무 일도 없습니다. */
export function rememberActiveJob(jobId: string): void {
  if (current === jobId) return
  current = jobId
  sessionStorage.setItem(STORAGE_KEY, jobId)
  emit()
}

/**
 * 더 이상 따라다닐 이유가 없어졌을 때.
 *
 * `jobId` 를 받는 형태인 이유: 놓아 주는 쪽(결과 화면)은 **자기 job** 만 놓아야 합니다.
 * 인자 없이 지우게 두면, 예전 job 의 결과 주소를 열어 둔 채 새 job 을 시작한 경우
 * 늦게 도착한 정리가 방금 시작한 job 을 지웁니다.
 */
export function forgetActiveJob(jobId: string): void {
  if (current !== jobId) return
  current = null
  sessionStorage.removeItem(STORAGE_KEY)
  emit()
}

export function useActiveJobId(): string | null {
  return useSyncExternalStore(subscribe, () => current)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
