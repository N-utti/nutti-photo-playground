/**
 * 402 를 만나 크레딧을 받으러 나갔다 돌아왔을 때의 업로드 결과 (api/uploadDraft.ts).
 *
 * 이건 «편의» 가 아니라 idempotency.ts 와 한 쌍입니다. 돌아온 사용자에게 업로드부터
 * 다시 시키면 `upload_id` 가 새로 발급되고, 그러면 의도가 달라져 키도 새로 나갑니다 —
 * 같은 사진 한 장에 크레딧이 두 번 나갈 수 있는 경로가 그렇게 열립니다.
 *
 * 그래서 여기서 지키는 건 「왕복을 건너 살아남는가」와 「깨진 저장본에 죽지 않는가」
 * 둘입니다. 후자가 중요한 이유는 이 값을 읽는 자리가 W-04 **렌더 도중**이라,
 * 예외가 나가면 사진을 다시 올리면 될 상황이 흰 화면이 되기 때문입니다.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { clearUploadDraft, readUploadDraft, writeUploadDraft, type UploadDraft } from './uploadDraft'

const DRAFT: UploadDraft = {
  styleId: 8,
  petId: 'pet_7f3a',
  upload: {
    upload_id: 'up_01HQZX',
    image_url: 'https://cdn.example.test/up_01HQZX.jpg',
    blocking_issue: null,
    warnings: [],
  },
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('uploadDraft', () => {
  it('쓴 그대로 읽힌다', () => {
    writeUploadDraft(DRAFT)

    // 왕복에서 무언가 떨어지면 «사진은 남았는데 스타일 맥락이 사라진» 복원이 됩니다.
    expect(readUploadDraft()).toEqual(DRAFT)
  })

  it('저장한 적 없으면 null', () => {
    expect(readUploadDraft()).toBeNull()
  })

  it('비운 뒤에는 null', () => {
    /*
      job 이 만들어졌거나 사용자가 다른 사진으로 갈아탄 시점입니다. 안 지우면 다음
      방문에서 **지난 사진이 되살아납니다** — 올린 적 없는 사진이 확인 화면에 뜹니다.
    */
    writeUploadDraft(DRAFT)
    clearUploadDraft()

    expect(readUploadDraft()).toBeNull()
  })

  it('저장본이 깨져 있어도 던지지 않고 null', () => {
    sessionStorage.setItem('nutti.upload-draft', '{"styleId": 8, 여기서 깨짐')

    expect(readUploadDraft()).toBeNull()
  })

  it('스타일 없이 올린 것(W-08)도 그대로 오간다', () => {
    // 직접 만들기는 스타일이 없습니다. `null` 이 «값이 없음» 으로 살아남아야 합니다.
    const noStyle: UploadDraft = { ...DRAFT, styleId: null, petId: null }
    writeUploadDraft(noStyle)

    const restored = readUploadDraft()
    expect(restored?.styleId).toBeNull()
    expect(restored?.petId).toBeNull()
  })
})
