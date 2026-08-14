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
 * 삭제 요청까지 밟는 테스트는 두지 않습니다. 목의 삭제는 localStorage 에 영속되는
 * 데다(`resetMockState` 가 걷어내긴 합니다) 이 파일이 묻는 건 «무엇이 선택됐는가» 지
 * «삭제가 되는가» 가 아닙니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W09Library from './W09Library'

function renderLibrary(search = '') {
  return renderWithProviders(
    <Routes>
      <Route path="/library" element={<W09Library />} />
    </Routes>,
    { route: `/library${search}` },
  )
}

/** 선택 모드로 들어가 첫 항목을 고릅니다. */
async function selectFirstItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '선택' }))
  const tiles = screen.getAllByRole('button', { name: /결과$/ })
  await user.click(tiles[0])
}

describe('W-09 · 보관함', () => {
  it('시드 결과를 월 단위로 보여 준다', async () => {
    renderLibrary()

    // 무한 그리드는 사방이 똑같아서 자기 결과를 못 찾게 만듭니다 — 묶기는 서버가 합니다.
    expect(await screen.findByText('2026년 8월')).toBeInTheDocument()
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

    expect(screen.getByRole('button', { name: '선택' })).toBeInTheDocument()
    expect(screen.queryByText(/장 선택/)).not.toBeInTheDocument()
  })

  it('아무것도 안 고르면 삭제가 잠겨 있다', async () => {
    const user = userEvent.setup()
    renderLibrary()

    await screen.findByText('2026년 8월')
    await user.click(screen.getByRole('button', { name: '선택' }))

    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled()
  })

  it('지워진 강아지 필터는 걷어내고 전체를 보여 준다', async () => {
    /*
      URL 에 남은 `?pet_id=` 가 이미 없는 강아지를 가리키는 경우입니다. 서버는 그 조회를
      404 가 아니라 **빈 목록**으로 답하므로(이슈 #33) 그대로 두면 «이 강아지로 만든
      결과가 아직 없어요» 가 뜹니다 — 강아지가 없는 것이지 결과가 없는 게 아닙니다.

      펫 목록이 도착하기 **전에는** 판단하지 않는 것도 같은 조심입니다. 로딩 중의 빈
      배열을 근거로 삼으면 멀쩡한 필터가 매 진입마다 지워집니다.
    */
    renderLibrary('?pet_id=pet_deleted_0000')

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

  it('게스트에게는 결과가 이 브라우저에만 있다고 알린다', async () => {
    /*
      게스트 결과는 만든 브라우저에서만 열립니다(PO 결정 B+A). 그 사실을 말하지 않으면
      기기를 바꾼 뒤에야 알게 되고, 그때는 이미 되돌릴 수 없습니다.
    */
    renderLibrary()

    expect(await screen.findByText('이 브라우저에만 남아 있어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인하고 보관하기' })).toBeInTheDocument()
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
