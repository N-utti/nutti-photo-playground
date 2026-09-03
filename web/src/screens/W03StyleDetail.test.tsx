/**
 * W-03 스타일 상세 시트의 예시 캐러셀 (screens/W03StyleDetail.tsx).
 *
 * 막으려는 결함: 예시가 0 장일 때 라이브 영역이 "적용 예시 1 / 0" 을 읽었습니다.
 * 0 장인데 1 번째라는, 있지도 않은 사진을 세는 말입니다. 트랙은 높이 0 으로 접혀
 * **화면에는 아무 변화가 없으니** 눈으로 보는 QA 로는 영영 안 걸립니다 —
 * 스크린리더에게만 보이는 결함이라 단언으로 잡아 둡니다.
 *
 * 0 장은 예외 상황이 아닙니다. `examples[]` 는 서버가 `example_keys` 로 만드는데
 * (app/routers/styles.py) 시드 스크립트가 그 키를 채우지 않으므로(scripts/seed_styles.py)
 * 지금 실서버의 스타일은 **전부** 0 장입니다.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { StyleDetail } from '../api/types'
import W03StyleDetail from './W03StyleDetail'

/**
 * `usesPetName` 은 서버가 활성 프롬프트에서 계산해 주는 `uses_pet_name` 입니다
 * (이슈 #101 → 백엔드 #111). 예전에는 `code` 를 넘겨 프론트 하드코딩 목록을
 * 자극했는데, 판정이 계약 필드로 옮겨 가면서 테스트도 그 필드를 직접 말합니다.
 */
function mockDetail(examples: string[], usesPetName = false) {
  server.use(
    http.get('*/v1/styles/:styleId', () =>
      HttpResponse.json({
        id: 101,
        code: 'lego-minifig',
        name: '레고 미니피겨',
        credit_cost: 1,
        examples,
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
        uses_pet_name: usesPetName,
        uses_breed: false,
        input_fields: [],
      } satisfies StyleDetail),
    ),
  )
}

/** 시트는 `useParams()` 로 styleId 를 읽으므로 매칭되는 라우트가 있어야 섭니다. */
function renderSheet() {
  return renderWithProviders(
    <Routes>
      <Route path="/styles/:styleId" element={<W03StyleDetail />} />
    </Routes>,
    { route: '/styles/101' },
  )
}

const example = (n: number) => `https://cdn.example.test/example-${n}.jpg`

describe('W-03 예시 캐러셀', () => {
  it('예시가 없으면 장수를 세지 않는다', async () => {
    mockDetail([])
    renderSheet()

    // 시트 본문이 떴는지 먼저 확인 — 스켈레톤을 보고 통과하면 아무것도 검증 못 합니다.
    expect(await screen.findByRole('heading', { name: '레고 미니피겨' })).toBeInTheDocument()
    expect(screen.queryByText(/적용 예시/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('한 장뿐이면 넘길 곳이 있는 척하지 않는다', async () => {
    mockDetail([example(1)])
    renderSheet()

    expect(await screen.findByRole('img', { name: '레고 미니피겨 적용 예시 1' })).toBeInTheDocument()
    // 점 하나짜리 페이저도, "1 / 1" 안내도 넘길 곳이 있다는 거짓말입니다.
    expect(screen.queryByText(/적용 예시 1 \/ 1/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '예시 1' })).not.toBeInTheDocument()
  })

  it('여러 장이면 현재 위치와 전체 장수를 읽어 준다', async () => {
    mockDetail([example(1), example(2), example(3)])
    renderSheet()

    expect(await screen.findByText('적용 예시 1 / 3')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^예시 \d$/ })).toHaveLength(3)
  })
})

/**
 * 이름이 그림에 인쇄되는 스타일의 예고 (PR #98 · 서버 `uses_pet_name`).
 *
 * 이 시트는 «이 스타일로 만들기» 직전의 마지막 설명 자리입니다. 재사용 경로에서는
 * 여기서 W-04 확인 단계까지 한 번에 넘어가므로(FR-W06-07), 여기서 안 말하면 이름이
 * 박힌다는 사실을 처음 보는 곳이 결과 화면이 됩니다.
 */
describe('W-03 · 이름이 들어가는 스타일 예고', () => {
  it('해당 스타일이면 어떤 이름이 인쇄되는지 말한다', async () => {
    mockDetail([], true)
    renderSheet()

    // 정확 일치로 봅니다 — 정규식이면 강조 span 과 그걸 감싼 p 가 함께 걸립니다.
    expect(await screen.findByText('아이 이름이 그림에 들어갑니다')).toBeInTheDocument()
    expect(screen.getByText(/«우리 아이» 가 인쇄됩니다/)).toBeInTheDocument()
  })

  it('그 밖의 스타일에서는 없는 말을 하지 않는다', async () => {
    mockDetail([])
    renderSheet()

    expect(await screen.findByRole('heading', { name: '레고 미니피겨' })).toBeInTheDocument()
    expect(screen.queryByText(/이름이 그림에 들어갑니다/)).not.toBeInTheDocument()
  })
})

/**
 * 시트가 **혼자서** 모달인지 (app/useModalDialog.ts).
 *
 * 다른 시트들은 `app/useModalDialog.test.tsx` 의 `CASES` 에서 한 벌로 검사받는데 이건
 * 거기 못 들어갑니다 — `onClose` 를 받지 않고 `navigate` 로 닫히며, `useParams()` 를
 * 읽어야 해서 매칭되는 라우트도 필요합니다. 그래서 같은 질문을 여기서 따로 묻습니다.
 *
 * 원래 이 시트는 포커스 이동 · Escape · 스크롤 잠금만 손으로 하고 **Tab 가둠이
 * 없었습니다.** 그래도 뒤 화면이 안 눌렸던 건 부모 W02StyleCatalog 이 본문을
 * `<div inert={sheetOpen}>` 으로 감싸 줬기 때문인데, 그건 이 시트가 그 라우트의
 * 자식일 때만 성립합니다. 아래 테스트가 부모 없이 세우는 이유가 그것입니다 —
 * 부모에 기댄 상태로 되돌아가면 여기서 걸립니다.
 */
describe('W-03 시트의 모달 동작', () => {
  /** 시트가 가리는 뒤 화면의 버튼. 부모가 `inert` 로 감싸 주지 않는 자리입니다. */
  const BEHIND = '뒤 화면 버튼'

  async function renderWithBackdrop() {
    mockDetail([])
    const user = userEvent.setup()
    renderWithProviders(
      <>
        <button type="button">{BEHIND}</button>
        <Routes>
          <Route path="/styles/:styleId" element={<W03StyleDetail />} />
        </Routes>
      </>,
      { route: '/styles/101' },
    )

    // 본문이 도착한 뒤에 눌러야 합니다 — 스켈레톤 단계에는 탭 대상이 없어서
    // 가둠이 깨져 있어도 «나갈 곳이 없어» 통과할 수 있습니다.
    await screen.findByRole('heading', { name: '레고 미니피겨' })
    return { user, behind: screen.getByRole('button', { name: BEHIND }), dialog: screen.getByRole('dialog') }
  }

  it('열리면 포커스가 시트 안으로 들어온다', async () => {
    const { dialog } = await renderWithBackdrop()

    expect(dialog).toHaveFocus()
  })

  it('Tab 을 계속 눌러도 뒤 화면 버튼에 닿지 않는다', async () => {
    const { user, dialog, behind } = await renderWithBackdrop()

    for (let press = 0; press < 20; press += 1) {
      await user.tab()
      expect(behind).not.toHaveFocus()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Shift+Tab 으로도 뒤 화면 버튼에 닿지 않는다', async () => {
    const { user, dialog, behind } = await renderWithBackdrop()

    for (let press = 0; press < 20; press += 1) {
      await user.tab({ shift: true })
      expect(behind).not.toHaveFocus()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Escape 로 카탈로그로 돌아간다', async () => {
    const { user } = await renderWithBackdrop()

    await user.keyboard('{Escape}')

    // 이 시트의 «닫기» 는 주소 이동입니다 — 라우트를 벗어나면 시트가 사라집니다.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('떠 있는 동안 배경 스크롤이 잠긴다', async () => {
    await renderWithBackdrop()

    expect(document.body.style.overflow).toBe('hidden')
  })
})

/**
 * 손잡이를 잡아 내려서 닫기 (screens/W03StyleDetail.tsx `useDragToDismiss`).
 *
 * 시트 위의 손잡이 막대는 «잡아 내릴 수 있다» 는 예고입니다. 안 잡히면 그 예고가
 * 거짓이 되고, 사용자는 앱이 멈춘 줄 압니다. 눈으로 하는 QA 로는 «내렸는데 안 닫힘»
 * 만 보이지 어디가 끊겼는지(시작·추적·판정) 안 보이므로 세 지점을 나눠 잡아 둡니다.
 *
 * 좌표를 직접 주려고 fireEvent 를 씁니다 — userEvent 의 포인터 API 는 레이아웃을
 * 아는 브라우저에서나 좌표를 만들 수 있고, jsdom 에는 레이아웃이 없습니다.
 */
describe('W-03 시트 · 손잡이 드래그', () => {
  /** 손잡이는 `aria-hidden` 인 장식이라 역할로 못 찾습니다 — 시트의 첫 자식입니다. */
  const handleOf = (dialog: HTMLElement) => dialog.firstElementChild as HTMLElement

  /**
   * 화면 폭을 정합니다. 드래그는 «바닥에 붙은 시트» 일 때만 있는 동작이라
   * 폭을 안 정하면 jsdom 기본값(1024)이 곧 데스크톱이라 전부 조용히 통과합니다
   * (test/setup.ts 의 matchMedia 대역).
   */
  const setViewport = (width: number) =>
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })

  beforeEach(() => setViewport(390))
  afterEach(() => setViewport(1024))

  async function renderLoaded() {
    mockDetail([])
    renderSheet()
    // 본문이 도착한 뒤에 잡습니다 — 스켈레톤 단계에도 손잡이는 있지만, 그때 닫히는지
    // 물으면 «불러오는 중에 사라졌다» 라는 다른 이야기를 검증하게 됩니다.
    await screen.findByRole('heading', { name: '레고 미니피겨' })
    return { dialog: screen.getByRole('dialog') }
  }

  /** 잡고 → 끌고 → 놓기. `up` 을 생략하면 잡은 채로 둡니다. */
  function drag(handle: HTMLElement, moves: number[], { release = true } = {}) {
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 0 })
    for (const clientY of moves) fireEvent.pointerMove(window, { pointerId: 1, clientY })
    if (release) fireEvent.pointerUp(window, { pointerId: 1, clientY: moves.at(-1) ?? 0 })
  }

  it('끄는 동안 시트가 손가락을 따라 내려온다', async () => {
    const { dialog } = await renderLoaded()

    drag(handleOf(dialog), [40], { release: false })

    expect(dialog.style.transform).toBe('translateY(40px)')
  })

  it('위로는 따라 올라가지 않는다', async () => {
    const { dialog } = await renderLoaded()

    // 시트는 이미 화면 아래 끝에 붙어 있습니다 — 올릴 자리가 없습니다.
    drag(handleOf(dialog), [-60], { release: false })

    expect(dialog.style.transform).toBe('translateY(0px)')
  })

  it('충분히 내리고 놓으면 카탈로그로 돌아간다', async () => {
    const { dialog } = await renderLoaded()

    drag(handleOf(dialog), [40, 90, 140])

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('조금만 내리고 놓으면 제자리로 돌아간다', async () => {
    const { dialog } = await renderLoaded()

    /*
      20px — 손잡이를 잡았다가 마음이 바뀐 정도입니다. 여기서 닫히면 «스타일을
      한 번 더 보려던» 사람이 카탈로그로 튕겨 나갑니다.

      거리 문턱(96px)이 아니라 튕김 문턱(24px)보다 작게 잡았습니다. jsdom 에서는
      이벤트들이 같은 밀리초에 만들어져 «천천히» 를 흉내 낼 수 없어서, 속도로
      닫히는 길을 거리로 막아 두고 묻습니다.
    */
    drag(handleOf(dialog), [12, 20])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // 되돌아가는 길은 CSS transition 이 그립니다 — 값은 지워지고 transition 만 남습니다.
    expect(dialog.style.transform).toBe('')
    expect(dialog.style.transition).toContain('transform')
  })

  it('시스템이 제스처를 가져가면(pointercancel) 닫지 않는다', async () => {
    const { dialog } = await renderLoaded()

    fireEvent.pointerDown(handleOf(dialog), { pointerId: 1, button: 0, clientY: 0 })
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 200 })
    fireEvent.pointerCancel(window, { pointerId: 1, clientY: 200 })

    // 손을 «놓은» 적이 없습니다. 200px 을 내려왔어도 닫힘이 아닙니다.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog.style.transform).toBe('')
  })

  it('데스크톱에는 손잡이가 아예 없다', async () => {
    setViewport(1280)
    const { dialog } = await renderLoaded()

    /*
      ≥1024px 에서 이건 바닥에 붙은 시트가 아니라 화면 한가운데 뜨는 대화상자입니다
      (`desktop:justify-center`). 아래로 «내려놓을» 가장자리가 없어서 예전에는 «끌어도
      안 움직인다» 였는데, 그러면 «잡아 내릴 수 있다» 고 생긴 막대가 안 움직이는
      상태로 남습니다 — 손잡이를 잡히게 만든 이유와 정반대입니다. 그래서 안 그립니다.

      «그리지 않았다» 는 화면 첫 줄로 확인합니다. 손잡이가 남아 있으면 시트는 4px
      막대로 시작하고, 없으면 곧바로 본문(제목 줄)으로 시작합니다.
    */
    expect(dialog.firstElementChild).toContainElement(
      screen.getByRole('heading', { name: '레고 미니피겨' }),
    )
  })

  it('본문을 끌어도 시트가 움직이지 않는다', async () => {
    const { dialog } = await renderLoaded()

    // 본문은 세로 스크롤 영역입니다 — 여기서 드래그를 받으면 스크롤이 닫기가 됩니다.
    fireEvent.pointerDown(screen.getByRole('heading', { name: '레고 미니피겨' }), {
      pointerId: 1,
      button: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 200 })
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 200 })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog.style.transform).toBe('')
  })
})
