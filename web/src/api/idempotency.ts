/**
 * Idempotency-Key 수명 관리 (docs/05-api-spec.md §1, §4 시나리오3).
 *
 * 규칙이 두 방향으로 갈리는 지점이라 한 곳에 모읍니다 — 흩어 놓으면 반드시 틀립니다.
 *
 *   402 INSUFFICIENT_CREDIT 후 재시도 → **같은 키**
 *     아직 job 이 만들어지지 않았으므로 원래 시도의 키를 그대로 씁니다(§4 시나리오3 4단계).
 *
 *   W-06 "다시 만들기" → **새 키**
 *     같은 키를 재사용하면 서버가 원래 job 을 그대로 돌려주므로(§1) 새 결과가 나오지 않습니다.
 *
 * 즉 키는 "요청 1건"이 아니라 **"사용자의 생성 의도 1건"**에 붙습니다. 의도가 살아 있는 동안
 * (크레딧을 채우고 돌아오는 동안 포함) 같은 키, 새 의도면 새 키.
 */

const STORAGE_KEY = 'nutti.job-attempt'

export interface JobAttempt {
  /** Idempotency-Key 헤더에 그대로 실리는 UUID. */
  key: string
  /** 어떤 생성 의도인지 — 재시도가 같은 의도인지 대조하는 용도. */
  intent: JobIntent
}

export interface JobIntent {
  style_id: number | null
  upload_id: string
  pet_id: string | null
  custom_prompt: string | null
  /**
   * 스타일 입력값 (이슈 #114). **의도의 일부입니다** — 402 시트에서 크레딧을 받고
   * 돌아와 «의상» 을 버섯에서 초밥으로 바꿨다면 그건 다른 그림을 주문한 것이므로,
   * 같은 키로 보내면 서버가 첫 주문을 그대로 돌려줍니다(멱등 재생). 값이 달라지면
   * 새 키가 나가야 합니다.
   */
  inputs?: Record<string, string>
}

/**
 * 새 생성 의도를 시작합니다. W-04 "이대로 만들기", W-08 "만들기",
 * W-06 "다시 만들기"가 전부 여기로 들어옵니다 — 매번 새 키가 나옵니다.
 */
export function beginJobAttempt(intent: JobIntent): JobAttempt {
  const attempt: JobAttempt = { key: crypto.randomUUID(), intent }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt))
  return attempt
}

/**
 * 진행 중인 의도를 그대로 이어받습니다. 402 오버레이에서 크레딧을 채운 뒤
 * 재시도할 때 호출합니다. 저장된 의도가 없거나 다른 의도면 null 을 반환하므로,
 * 호출부는 그때 beginJobAttempt 로 새로 시작해야 합니다.
 *
 * sessionStorage 에 두는 이유: 오버레이가 떠 있는 동안 사용자가 인스타 팔로우를
 * 하러 나갔다 돌아오면서 페이지가 리로드될 수 있는데, 메모리에만 있으면 키가
 * 날아가 같은 의도에 새 키가 붙습니다(= 크레딧 이중 차감 가능).
 */
export function resumeJobAttempt(intent: JobIntent): JobAttempt | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as JobAttempt
    return sameIntent(saved.intent, intent) ? saved : null
  } catch {
    return null
  }
}

/** job 이 실제로 만들어진 뒤 호출 — 키의 수명이 끝납니다. */
export function clearJobAttempt(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

function sameIntent(a: JobIntent, b: JobIntent): boolean {
  return (
    a.style_id === b.style_id &&
    a.upload_id === b.upload_id &&
    a.pet_id === b.pet_id &&
    a.custom_prompt === b.custom_prompt &&
    sameInputs(a.inputs, b.inputs)
  )
}

/**
 * 라벨 순서는 의도가 아닙니다 — 같은 값이면 같은 그림이 나옵니다. `JSON.stringify`
 * 로 비교하면 폼이 칸을 채운 순서가 키를 가르게 되고, 402 왕복 한 번이 아무것도
 * 안 바꿨는데도 새 키를 받게 됩니다(= 이중 차감 가능).
 */
function sameInputs(a?: Record<string, string>, b?: Record<string, string>): boolean {
  const left = a ?? {}
  const right = b ?? {}
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => left[key] === right[key])
}
