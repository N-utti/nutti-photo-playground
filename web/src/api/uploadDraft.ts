/**
 * W-04 업로드 결과의 임시 보관.
 *
 * 왜 필요한가: 402 INSUFFICIENT_CREDIT 을 만나면 크레딧을 받으러 가야 하는데,
 * W-10 이 인라인 시트로 들어오기 전까지(Phase 3) 그건 실제 화면 이동입니다.
 * 돌아왔을 때 업로드부터 다시 시키면 같은 사진을 두 번 올리게 되고, 무엇보다
 * `upload_id` 가 새로 발급돼 idempotency.ts 가 지키려던 "같은 의도 = 같은 키"가
 * 깨집니다(= 크레딧 이중 차감 가능). 그래서 의도의 나머지 절반인 업로드 결과도
 * 키와 같은 수명으로 붙잡아 둡니다.
 *
 * sessionStorage 인 이유도 idempotency.ts 와 같습니다 — 탭 수명과 같이 가야 하고,
 * 다음 방문까지 남으면 지난 사진이 되살아납니다.
 */

import type { UploadResult } from './types'

const STORAGE_KEY = 'nutti.upload-draft'

export interface UploadDraft {
  /** 어떤 스타일 맥락에서 올린 사진인지. 스타일이 다르면 복원하지 않습니다. */
  styleId: number | null
  petId: string | null
  upload: UploadResult
  /**
   * 스타일 입력값 (이슈 #114). 사진과 같은 이유로 함께 붙잡습니다 — 크레딧을 받으러
   * 나갔다 돌아온 사용자가 «청문회» 자막 두 줄을 다시 쓰게 만들면, 그 왕복은 사진을
   * 다시 올리게 하는 것과 같은 종류의 손실입니다. 스키마 없는 스타일에서는 생략.
   */
  inputs?: Record<string, string>
  /** 고르거나 직접 쓴 견종. 입력값과 같은 이유로 함께 붙잡습니다. */
  breed?: string
}

export function writeUploadDraft(draft: UploadDraft): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
}

export function readUploadDraft(): UploadDraft | null {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UploadDraft
  } catch {
    return null
  }
}

export function clearUploadDraft(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
