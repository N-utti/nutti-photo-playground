/**
 * 목의 보관함 (mocks/handlers.ts `GET·DELETE /v1/library`).
 *
 * 백엔드 PR #156·#157 이 착지하면서 이 엔드포인트에 **화면이 볼 수 없는 규칙**이 여럿
 * 생겼습니다 — 회원 전용 403, 커서 형식, `pet_id` 파싱, 삭제 개수 상한. 화면 테스트는
 * 목록이 오느냐 마느냐만 보므로 이 규칙들이 목에 실제로 서 있는지는 아무도 안 봅니다.
 *
 * 그중 커서가 특히 조용합니다. 목은 오래 **오프셋**으로 페이지를 끊었는데, 그러면
 * 1페이지에서 한 장을 지운 뒤 «더 보기» 를 눌렀을 때 뒤가 한 칸 당겨져 **한 장이 통째로
 * 건너뛰어집니다.** 실서버에는 없는 버그라(keyset — 마지막 항목의 위치를 값으로 기억),
 * 프론트는 있지도 않은 페이지네이션 결함을 쫓게 됩니다.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { mockAsMember } from './handlers'

interface Page {
  months: { label: string; items: { result_id: string; created_at: string }[] }[]
  next_cursor: string | null
}

const flat = (page: Page) => page.months.flatMap((month) => month.items.map((i) => i.result_id))

async function library(query = ''): Promise<Response> {
  return fetch(`/v1/library${query}`)
}

async function page(query = ''): Promise<Page> {
  return (await library(query)).json()
}

describe('목 · GET /v1/library', () => {
  it('게스트에게는 목록이 아니라 403 MEMBER_ONLY 를 준다', async () => {
    // 보관함은 회원 기능입니다(app/routers/library.py). 여기서 200 을 주면 W-09 의
    // `MemberOnlyNotice` 는 브라우저에서 한 번도 안 뜨는 화면이 됩니다.
    const response = await library()

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('MEMBER_ONLY')
  })

  describe('회원', () => {
    beforeEach(() => mockAsMember())

    it('커서는 오프셋이 아니라 직전 페이지 마지막 항목의 result_id 다', async () => {
      const first = await page()

      expect(first.next_cursor).toBe(flat(first).at(-1))
    })

    it('1페이지에서 지운 뒤 다음 페이지를 받아도 항목이 건너뛰어지지 않는다', async () => {
      /*
        **이 파일의 핵심입니다.** 오프셋 커서면 여기서 한 장이 사라집니다 — 그리고
        사라진 장은 어느 화면에도 안 나타나므로, 사용자는 자기 사진 한 장이 없어진 걸
        보관함을 통째로 훑기 전에는 모릅니다.

        서버가 커서 스코프에서 `deleted_at` 을 빼 두는 이유도 이것입니다: 1페이지의
        마지막 항목을 지운 뒤 그 값을 커서로 다시 보내도 유효해야 합니다.
      */
      const before = await page()
      const expected = flat(await page(`?cursor=${before.next_cursor}`))

      const target = flat(before).at(-1)
      const deleted = await fetch('/v1/library', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [target] }),
      })
      expect(deleted.status).toBe(204)

      // 지운 게 커서 그 자체인데도 같은 값으로 이어집니다 — 그리고 이어지는 내용도 같습니다.
      const after = await page(`?cursor=${before.next_cursor}`)
      expect(flat(after)).toEqual(expected)
    })

    it('스코프 밖의 커서는 400 이다', async () => {
      // 서버는 커서를 소유·pet 스코프에서 조회합니다 — 없으면 조용히 1페이지를 주는 게
      // 아니라 400 입니다. 목이 0 으로 흘리면 «커서를 잃어버린 목록» 이 무한히 처음부터
      // 다시 옵니다.
      const response = await library('?cursor=e5f6a7b8-0000-4000-8000-000000009999')

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
    })

    it('uuid 가 아닌 pet_id 는 빈 목록이 아니라 400 이다', async () => {
      // `uuid.UUID(pet_id)` 파싱 실패. **없는 펫과 다릅니다** — 지워진 펫의 id 는 형식이
      // 맞으므로 빈 목록으로 오고(이슈 #33), W-09 는 그때만 필터를 «전체» 로 걷습니다.
      const response = await library('?pet_id=pet_deleted_0000')

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
    })

    it('지워진 펫을 가리키는 pet_id 는 빈 목록이다', async () => {
      const response = await library('?pet_id=b6f9e6b0-0000-4000-8000-000000000404')

      expect(response.status).toBe(200)
      expect((await response.json()).months).toEqual([])
    })
  })
})

describe('목 · DELETE /v1/library', () => {
  it('게스트는 지울 수 없다 (403 MEMBER_ONLY)', async () => {
    const response = await fetch('/v1/library', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['e5f6a7b8-0000-4000-8000-000000000001'] }),
    })

    expect(response.status).toBe(403)
  })

  it('한 요청 100개를 넘기면 400 이다', async () => {
    /*
      `DeleteLibraryRequest.ids: Field(max_length=100)` — pydantic 이 걸러 냅니다.
      화면이 그보다 많이 고를 수 있으면 «삭제하지 못했어요 · 다시 시도» 로 끝나는데,
      다시 눌러도 영영 같은 답입니다(W09Library `DELETE_LIMIT` 이 막는 이유).
    */
    mockAsMember()
    const ids = Array.from({ length: 101 }, (_, i) => `e5f6a7b8-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const response = await fetch('/v1/library', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
  })
})
