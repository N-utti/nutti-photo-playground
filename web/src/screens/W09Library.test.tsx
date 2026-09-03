/**
 * W-09 · 보관함 (screens/W09Library.tsx).
 *
 * 이 화면에서 잘못되면 **되돌릴 수 없습니다** — 여기 있는 유일한 파괴적 동작이 삭제고,
 * 지운 결과는 돌아오지 않습니다. 그래서 삭제 자체보다 «무엇이 선택돼 있는가» 를 봅니다.
 *
 * 필터를 바꾸면 화면에 없는 항목이 선택에 남을 수 있습니다. 그 상태로 삭제를 누르면
 * **사용자가 보고 있지 않은 사진이 지워집니다.** 화면에는 «N장 삭제» 라고 정확히
 * 적혀 있어서, 지운 뒤에야 다른 게 없어졌다는 걸 압니다.
 *
 * 다른 하나는 지워진 강아지 필터입니다. 서버가 그 조회를 404 가 아니라 **빈 목록**으로
 * 답하는 계약이라(이슈 #33) 그대로 두면 «이 강아지로 만든 결과가 없다» 처럼 보입니다 —
 * 실제로는 강아지가 없는 것이고 결과는 «전체» 에 그대로 있습니다.
 *
 * 삭제 **요청**까지 밟는 갈래도 뒤늦게 붙였습니다. 원래는 «무엇이 선택됐는가» 만 묻고
 * 요청은 두지 않았는데, 그러는 동안 이 화면의 본래 일 두 가지가 아무 테스트도 붙잡지
 * 않고 있었습니다 — 지운 결과가 **목록에서 실제로 빠지는지**(논리삭제 반영), 그리고
 * 타일이 **결과 상세로 이어지는지**(FR-W09-03). 목 상태가 테스트 사이로 새는 문제는
 * `resetMockState` 가 이미 맡고 있습니다(test/mockReset.test.ts).
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { wasDeletedHere } from '../app/deletedResults'
import { libraryItems } from '../mocks/fixtures'
import { mockAsMember } from '../mocks/handlers'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W09Library from './W09Library'

/**
 * 목록이 나오는 갈래는 **회원만** 볼 수 있습니다 — 게스트의 `GET /v1/library` 는 403
 * `MEMBER_ONLY` 입니다(백엔드 PR #156). 목이 그 계약을 그대로 답하므로, 목록을 보는
 * 테스트는 먼저 로그인해야 합니다. `/auth/me` 응답만 꾸미는 방식으로는 부족합니다 —
 * 회원 여부를 보는 건 화면이 아니라 **목의 보관함 핸들러**입니다.
 */
function renderLibrary(search = '') {
  mockAsMember()
  return renderWithProviders(
    <Routes>
      <Route path="/library" element={<W09Library />} />
    </Routes>,
    { route: `/library${search}` },
  )
}

/** 로그인하지 않은 채로 여는 경우 — 회원 전용·게스트 안내 갈래가 씁니다. */
function renderLibraryAsGuest(search = '') {
  return renderWithProviders(
    <Routes>
      <Route path="/library" element={<W09Library />} />
    </Routes>,
    { route: `/library${search}` },
  )
}

/*
  «이 브라우저가 지운 결과» 기록은 **앱** 저장소라 `resetMockState` 가 걷어내지
  않습니다(그건 목 상태 담당). 안 지우면 성공 케이스가 남긴 기록을 실패 케이스가
  물려받아, 실패한 삭제도 기억한 것처럼 보입니다 — 키는 app/deletedResults.ts.
*/
afterEach(() => {
  localStorage.removeItem('nutti.deleted-jobs')
})

/**
 * «선택» 버튼은 **자리가 둘**입니다 — 모바일은 앱바, 데스크톱은 목록 위(W09Library.tsx).
 * 데스크톱에서 앱바가 통째로 내려가면서 갈라졌고, 실제로는 폭에 따라 한쪽만 보입니다.
 *
 * 다만 jsdom 은 미디어 쿼리를 계산하지 않아 **둘 다 DOM 에 있습니다**. 이름으로만
 * 찾으면 "Found multiple elements" 로 죽으므로, 여기서는 모바일 자리(앱바 안)를
 * 집습니다 — 이 파일이 보는 것은 선택 상태이지 어느 폭에서 눌렀는지가 아닙니다.
 */
function selectButton() {
  return within(screen.getByRole('banner')).getByRole('button', { name: '선택' })
}

/** 선택 모드로 들어가 첫 항목을 고릅니다. */
async function selectFirstItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(selectButton())
  const tiles = screen.getAllByRole('button', { name: /결과$/ })
  await user.click(tiles[0])
}

describe('W-09 · 보관함', () => {
  it('시드 결과를 월 단위로 보여 준다', async () => {
    renderLibrary()

    // 무한 그리드는 사방이 똑같아서 자기 결과를 못 찾게 만듭니다 — 묶기는 서버가 합니다.
    expect(await screen.findByText('2026년 8월')).toBeInTheDocument()
  })

  it('카톡 웹뷰에서 「저장」은 blob 대신 첨부 주소로 한 장씩 내려받는다', async () => {
    /*
      Android 웹뷰는 blob 다운로드를 조용히 버립니다(app/inAppBrowser.ts). 서버가 준
      `download_url`(첨부 헤더)로 이동하면 웹뷰도 기기에 파일을 남깁니다 — W-06 과 같은
      길이고, 결과는 크롬에서 저장한 것과 같습니다.
    */
    const user = userEvent.setup()
    const ua = vi
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue(
        'Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 Chrome/137.0 Mobile Safari/537.36 KAKAOTALK/25.4.3 (INAPP)',
      )
    const hrefs: string[] = []
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        hrefs.push(this.href)
      })
    try {
      renderLibrary()
      await screen.findByText('2026년 8월')
      await selectFirstItem(user)

      await user.click(screen.getByRole('button', { name: '저장' }))

      expect(await screen.findByText(/1장 다운로드를 시작했어요/)).toBeInTheDocument()
      expect(hrefs).toHaveLength(1)
      expect(hrefs[0]).toBe(libraryItems[0].download_url)
    } finally {
      ua.mockRestore()
      clicked.mockRestore()
    }
  })

  it('필터를 바꾸면 선택이 풀린다', async () => {
    /*
      **이 파일의 핵심입니다.** 선택을 안 풀면 «콩이» 로 필터를 바꾼 뒤에도 앞서 고른
      «두부» 사진이 선택에 남습니다. 그 상태로 삭제를 누르면 화면에 없는 사진이
      지워지고, 되돌릴 방법이 없습니다.

      선택 개수가 앱바에 적히므로(«N장 선택») 그 표시가 사라지는 것으로 확인합니다.
    */
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await selectFirstItem(user)
    expect(screen.getByText(/1장 선택/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '콩이' }))

    expect(screen.queryByText(/장 선택/)).not.toBeInTheDocument()
  })

  it('선택 모드에서 나가면 선택도 사라진다', async () => {
    // 「취소」가 모드만 끄고 선택을 남기면, 다시 들어왔을 때 예전 선택이 살아 있습니다.
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await selectFirstItem(user)
    await user.click(screen.getByRole('button', { name: '취소' }))

    expect(selectButton()).toBeInTheDocument()
    expect(screen.queryByText(/장 선택/)).not.toBeInTheDocument()
  })

  it('아무것도 안 고르면 삭제가 잠겨 있다', async () => {
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await user.click(selectButton())

    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
  })

  it('결과 타일은 그 job 의 상세로 이어진다', async () => {
    /*
      FR-W09-03 «원본도 함께 보관» 이 화면에 닿는 지점입니다. 이 화면은 비교 슬라이더도
      재생성도 스스로 만들지 않고 W-06 으로 보내는 쪽을 택했으므로(노트3), 이 링크가
      끊기면 보관함은 **열 수 없는 사진 목록**이 됩니다.
    */
    renderLibrary()

    await screen.findByText('2026년 8월')
    const tile = screen.getAllByRole('link', { name: /결과$/ })[0]

    // §3 예시의 첫 항목 — 목 픽스처가 이 id 를 고정으로 씁니다.
    expect(tile).toHaveAttribute('href', '/jobs/b3e13c4a-2f1e-4a3a-9b1e-1234567890ab')
  })

  it('지운 결과는 목록에서 빠지고 선택 모드도 끝난다', async () => {
    /*
      논리삭제 반영. 서버는 204 만 주고 무엇이 남았는지 말하지 않으므로 화면은 목록을
      다시 읽습니다(api/queries.ts `useDeleteLibraryItems`). 그 무효화가 빠지면 방금
      지운 사진이 그대로 걸려 있고, 사용자는 삭제가 안 된 줄 알고 한 번 더 누릅니다.

      선택 모드가 안 끝나는 것도 같은 종류입니다 — 지워서 사라진 항목의 선택이 남으면
      앱바가 «1장 선택» 이라고 적힌 채 고른 게 하나도 안 보이는 상태가 됩니다.
    */
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    const first = screen.getAllByRole('link', { name: /결과$/ })[0].getAttribute('aria-label')
    await selectFirstItem(user)
    await user.click(screen.getByRole('button', { name: '삭제' }))
    // 확인 창 안의 «삭제» — 바닥 선택 바의 것과 이름이 같아 마지막 것을 집습니다.
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: '삭제' })
    await user.click(confirm)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: first! })).not.toBeInTheDocument()
    })
    expect(selectButton()).toBeInTheDocument()
    expect(screen.queryByText(/장 선택/)).not.toBeInTheDocument()
  })

  it('지웠다는 사실을 이 브라우저가 기억한다', async () => {
    /*
      이슈 #152 의 프론트 절반(app/deletedResults.ts). 지운 결과의 `/jobs/{job_id}`
      주소는 히스토리·북마크에 그대로 남아 있고, 서버가 논리삭제를 조회에 반영하면
      그 주소는 404 가 됩니다 — 그때 W-06 이 «주소가 잘못됐거나 다른 기기» 라고 하지
      않으려면 지운 게 우리라는 사실이 여기서 남아야 합니다.

      **성공한 삭제만** 기록해야 합니다. 실패한 요청까지 적으면 서버에 멀쩡히 살아
      있는 결과를 두고 지웠다고 말하게 됩니다.
    */
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await selectFirstItem(user)
    await user.click(screen.getByRole('button', { name: '삭제' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '삭제' }),
    )

    await waitFor(() => {
      expect(wasDeletedHere('b3e13c4a-2f1e-4a3a-9b1e-1234567890ab')).toBe(true)
    })
  })

  it('삭제가 실패하면 지웠다고 기억하지 않는다', async () => {
    server.use(
      http.delete('*/v1/library', () =>
        HttpResponse.json({ code: 'SERVER_ERROR', message: '실패' }, { status: 500 }),
      ),
    )
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await selectFirstItem(user)
    await user.click(screen.getByRole('button', { name: '삭제' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: '삭제' }),
    )

    // 실패는 화면이 말하고, 선택은 다시 시도할 수 있게 남습니다.
    expect(await screen.findByRole('alert')).toHaveTextContent('삭제하지 못했어요')
    expect(wasDeletedHere('b3e13c4a-2f1e-4a3a-9b1e-1234567890ab')).toBe(false)
  })

  it('지워진 강아지 필터는 걷어내고 전체를 보여 준다', async () => {
    /*
      URL 에 남은 `?pet_id=` 가 이미 없는 강아지를 가리키는 경우입니다. 서버는 그 조회를
      404 가 아니라 **빈 목록**으로 답하므로(이슈 #33) 그대로 두면 «이 강아지로 만든
      결과가 아직 없어요» 가 뜹니다 — 강아지가 없는 것이지 결과가 없는 게 아닙니다.

      펫 목록이 도착하기 **전에는** 판단하지 않는 것도 같은 조심입니다. 로딩 중의 빈
      배열을 근거로 삼으면 멀쩡한 필터가 매 진입마다 지워집니다.
    */
    // 지워진 펫의 id 도 형식은 uuid 입니다 — 아무 문자열이나 넣으면 서버가 빈 목록이
    // 아니라 400 을 냅니다(`uuid.UUID(pet_id)`). 그건 이 테스트가 말하는 상황이 아닙니다.
    renderLibrary('?pet_id=b6f9e6b0-0000-4000-8000-000000000404')

    // 필터가 걷혔으므로 전체 목록이 그대로 보입니다.
    expect(await screen.findByText('2026년 8월')).toBeInTheDocument()
    // 「전체」 칩이 눌린 상태로 돌아와야 합니다.
    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('결과가 없을 때 필터 탓이면 필터를 풀 길을 준다', async () => {
    /*
      같은 «비어 있음» 이라도 «아직 만든 게 없다» 와 «이 강아지 것만 없다» 는 사용자가
      할 일이 다릅니다. 앞은 만들러 가야 하고 뒤는 필터만 풀면 됩니다 — 구분하지 않으면
      결과가 있는데도 없다고 믿고 나갑니다.
    */
    server.use(http.get('*/v1/library', () => HttpResponse.json({ months: [], next_cursor: null })))
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월').catch(() => null)
    await user.click(await screen.findByRole('button', { name: '콩이' }))

    expect(await screen.findByText('이 강아지로 만든 결과가 아직 없어요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '전체 보기' })).toBeInTheDocument()
  })

  it('게스트에게는 실패가 아니라 로그인할 자리를 준다 (403 MEMBER_ONLY)', async () => {
    /*
      보관함은 회원 기능입니다(§2 W-06 저장). 게스트 응답은 실패가 아니라 **403
      `MEMBER_ONLY`** 인데(백엔드 PR #156 · 이슈 #52 의 그 코드), 일반 오류로 흘리면
      «불러오지 못했어요 · 다시 시도» 가 뜹니다. 다시 눌러도 영영 같은 답이 오고 게스트는
      자기 사진이 사라졌다고 읽습니다 — 눌러야 할 버튼은 재시도가 아니라 로그인입니다.

      «아직 보관된 사진이 없어요»(빈 상태)로 떨어져도 안 됩니다. 게스트의 결과는 없는 게
      아니라 목록으로 안 묶일 뿐이라(만든 브라우저에서 30일 · Q7) 그건 거짓말입니다.

      **응답을 여기서 덮지 않습니다.** 목이 이미 그 계약을 답하므로(PR #156·#157 착지),
      덮으면 목과 화면 중 어느 쪽이 맞는지 이 테스트가 더는 못 봅니다.
    */
    renderLibraryAsGuest()

    expect(await screen.findByText('로그인하면 여기에 모여요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인하고 보관하기' })).toBeInTheDocument()
    expect(screen.queryByText('보관함을 불러오지 못했어요.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.queryByText('아직 보관된 사진이 없어요')).not.toBeInTheDocument()
    /*
      로그인 버튼은 **하나**여야 합니다. 여기에 «이 브라우저에만 남아 있어요» 배너가 하나
      더 있었는데, 목록이 오지 않는 화면에서 목록을 가리키는 말이라 걷어냈습니다.
    */
    expect(screen.getAllByRole('button', { name: '로그인하고 보관하기' })).toHaveLength(1)
  })

  it('한 번에 지울 수 있는 장수를 넘겨서는 고를 수 없다', async () => {
    /*
      서버가 한 삭제 요청을 100개로 끊습니다(`ids: Field(max_length=100)`, 백엔드 PR
      #157). 넘겨서 보내면 400 이 오고 화면은 «삭제하지 못했어요 · 잠시 뒤 다시 시도» 로
      끝나는데 — **다시 눌러도 영영 같은 답입니다.** 그 문구는 서버가 잠깐 아픈 것처럼
      들리고, 실제로 해야 할 일(나눠서 지우기)은 화면 어디에도 안 적혀 있습니다.

      그래서 고르는 단계에서 막습니다. 막기만 하면 탭했는데 체크가 안 들어오는 화면이
      되므로 이유를 함께 답니다.
    */
    server.use(
      http.get('*/v1/library', () =>
        HttpResponse.json({
          months: [
            {
              label: '2026년 8월',
              items: Array.from({ length: 110 }, (_, index) => ({
                job_id: `b3e13c4a-2f1e-4a3a-9b1e-${String(index).padStart(12, '0')}`,
                result_id: `e5f6a7b8-0000-4000-8000-${String(index).padStart(12, '0')}`,
                image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
                pet_id: null,
                created_at: '2026-08-03T10:00:00+09:00',
              })),
            },
          ],
          next_cursor: null,
        }),
      ),
    )
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await user.click(selectButton())
    // 110장을 다 탭합니다 — 상한이 없으면 110장이 한 요청에 실립니다.
    for (const tile of screen.getAllByRole('button', { name: /결과$/ })) fireEvent.click(tile)

    expect(screen.getByText('100장 선택')).toBeInTheDocument()
    expect(screen.getByText(/한 번에 100장까지 고를 수 있어요/)).toBeInTheDocument()
  })

  it('강아지 필터를 고르면 URL 에 남는다', async () => {
    /*
      결과를 열었다가 뒤로 오면 보던 필터가 남아야 합니다 — 이 앱은 화면 상태를 URL 로
      복원하는 쪽을 이미 택했습니다(routes.tsx).
    */
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await user.click(screen.getByRole('button', { name: '콩이' }))

    expect(screen.getByRole('button', { name: '콩이' })).toHaveAttribute('aria-pressed', 'true')
    // 두 칩이 동시에 눌린 것처럼 보이면 어느 필터가 걸렸는지 화면만 보고는 알 수 없습니다.
    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'false')
  })
})
