/**
 * 커스텀 프롬프트 비용을 말하는 **세 화면이 같은 값을 말하는지** (app/customPromptCost.ts).
 *
 * 막으려는 결함은 화면 하나짜리가 아닙니다. 이 숫자는 W-02 카탈로그 하단 링크 · W-04
 * 업로드 후 링크 · W-08 만들기 버튼의 **문장 안에** 들어 있었고, 값의 출처가 프론트
 * 상수(`CUSTOM_PROMPT_COST_ESTIMATE = 2`)였습니다. 2 는 `app_setting` 행이 없을 때의
 * 서버 폴백이라 «지금 맞는 것» 이 우연이었고, 운영이 그 행을 넣는 날 화면 셋이 각자
 * 다른 시점에 틀리기 시작합니다 — 그중 둘은 요청을 보내기 전이라 스스로 배울 방법도
 * 없었습니다(이슈 #149 → PR #151 이 `GET /v1/credits` 에 노출).
 *
 * 그래서 여기서 보는 것은 «2 가 어디에도 안 박혀 있는가» 입니다. 서버가 3 이라고 하면
 * 세 화면 전부 3 이라고 말해야 하고, 아직 모르면 **아무 숫자도 말하지 않아야** 합니다.
 * 화면 파일 셋 중 하나만 고치는 실수가 정확히 이 파일에서 걸립니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { writeUploadDraft } from '../api/uploadDraft'
import { initialCredits } from '../mocks/fixtures'
import W02StyleCatalog from '../screens/W02StyleCatalog'
import W04Upload from '../screens/W04Upload'
import W08Creative from '../screens/W08Creative'

/** 목을 화면 없이 직접 부를 때의 오리진 (test/mockReset.test.ts 와 같은 이유). */
const MOCK_BASE = 'http://localhost/v1'

/** 운영이 `app_setting.custom_prompt_credit_cost` 를 3 으로 넣어 둔 서버. */
function mockCost(cost: number) {
  server.use(
    http.get('*/v1/credits', () =>
      HttpResponse.json({ ...initialCredits, custom_prompt_credit_cost: cost }),
    ),
  )
}

/** 잔액을 아예 못 읽는 상태 — 비용도 같이 모릅니다. */
function mockCreditsDown() {
  server.use(
    http.get('*/v1/credits', () =>
      HttpResponse.json({ error: { code: 'INTERNAL', message: '일시적인 오류' } }, { status: 500 }),
    ),
  )
}

/** W-08 의 정상 진입 상태 — W-04 가 남긴 업로드 초안. */
function withPhoto() {
  writeUploadDraft({
    styleId: null,
    petId: null,
    upload: {
      upload_id: 'up_01HQZX',
      image_url: 'https://cdn.example.test/up_01HQZX.jpg',
      blocking_issue: null,
      warnings: [],
    },
  })
}

/**
 * W-04 의 링크는 **스타일을 아직 안 고른** 확인 단계에만 뜹니다(사진부터 올린 경로).
 * 그래서 `style_id` 없이 렌더하고 사진을 실제로 올려야 그 자리에 도달합니다.
 */
async function renderUploadWithPhoto() {
  const { container } = renderWithProviders(
    <Routes>
      <Route path="/upload" element={<W04Upload />} />
    </Routes>,
    { route: '/upload' },
  )
  const input = container.querySelector('input[type="file"]')
  expect(input).not.toBeNull()
  await userEvent.upload(
    input as HTMLInputElement,
    new File(['x'], 'dog.jpg', { type: 'image/jpeg' }),
  )
  // 목이 품질 체크 체감으로 700ms 를 씁니다(mocks/handlers.ts).
  await screen.findByRole('link', { name: /스타일 고르기/ }, { timeout: 5000 })
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('커스텀 프롬프트 비용 · 서버가 말한 값', () => {
  it('W-02 카탈로그 링크가 서버 값을 그대로 적는다', async () => {
    mockCost(3)
    renderWithProviders(<W02StyleCatalog />, { route: '/styles' })

    expect(
      await screen.findByRole('link', { name: '원하는 걸 직접 써서 만들기 · 3 크레딧' }),
    ).toBeInTheDocument()
  })

  it('W-04 링크가 서버 값을 그대로 적는다', async () => {
    mockCost(3)
    await renderUploadWithPhoto()

    expect(
      await screen.findByRole('link', { name: '원하는 걸 직접 써서 만들기 · 3 크레딧' }),
    ).toBeInTheDocument()
  })

  it('W-08 버튼이 요청을 보내기 전에 이미 서버 값을 적는다', async () => {
    /*
      예전에는 이 화면이 402 를 맞아야만 실제 비용을 배웠습니다 — 잔액이 넉넉한
      사용자는 끝까지 «2 크레딧» 을 읽고 3 을 결제했습니다. 요청 **전에** 맞아야
      합니다.
    */
    mockCost(3)
    withPhoto()
    renderWithProviders(<W08Creative />)

    expect(await screen.findByRole('button', { name: '만들기 · 3 크레딧' })).toBeInTheDocument()
  })
})

describe('커스텀 프롬프트 비용 · 모를 때', () => {
  it('W-02·W-04 링크는 모르는 동안 숫자를 지어내지 않는다', async () => {
    /*
      로딩 중에 2 를 그려 두면 화면이 먼저 단정하고 나중에 정정합니다. 그 사이에
      누른 사람은 자기가 본 적 없는 값으로 결제합니다 — 비용이 빠진 라벨은 «모른다»
      로 읽히지만 틀린 숫자는 거짓말로 읽힙니다.
    */
    mockCreditsDown()
    renderWithProviders(<W02StyleCatalog />, { route: '/styles' })

    const link = await screen.findByRole('link', { name: /직접 써서 만들기/ })
    expect(link).toHaveAccessibleName('원하는 걸 직접 써서 만들기')
    expect(link.textContent).not.toMatch(/크레딧/)
  })

  it('W-08 버튼은 모르는 동안 숫자 없이도 눌린다', async () => {
    /*
      비용을 모른다고 버튼을 잠그면 `GET /v1/credits` 가 실패한 사용자에게 이 화면이
      막다른 길이 됩니다. 서버는 여전히 만들 수 있고, 부족하면 402 가 답합니다.
    */
    mockCreditsDown()
    withPhoto()
    renderWithProviders(<W08Creative />)

    await userEvent.type(
      await screen.findByLabelText('우리 애를 무엇으로 만들까요?'),
      '눈 오는 날 산책',
    )
    const button = screen.getByRole('button', { name: '만들기' })
    expect(button).toBeEnabled()
  })
})

describe('목이 말하는 비용과 빼 가는 비용', () => {
  it('`GET /v1/credits` 의 값과 `POST /v1/jobs` 의 차감액이 같다', async () => {
    /*
      목의 두 핸들러가 각자 숫자를 적고 있으면, 브라우저에서 «2 크레딧» 이라고 말해
      놓고 3 이 빠지는 화면이 **정상으로 보입니다**. 실서버는 두 곳이 같은 헬퍼를
      부르므로(app/credits.py `custom_prompt_credit_cost`) 목도 하나여야 합니다.

      시나리오 `credit:custom-cost-3` 은 그 «2 가 아닌 서버» 를 만드는 장치입니다 —
      잔액이 1 로 떨어지므로 차감액은 402 의 `required` 로 확인합니다.
    */
    localStorage.setItem('nutti.mock.scenario', 'credit:custom-cost-3')
    try {
      // 상대 경로는 node 의 fetch 가 파싱하지 못합니다(test/mockReset.test.ts 주석).
      const announced = await fetch(`${MOCK_BASE}/credits`).then((res) => res.json())
      const rejected = await fetch(`${MOCK_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'test-custom-cost' },
        body: JSON.stringify({
          style_id: null,
          upload_id: 'up_01HQZX',
          pet_id: null,
          custom_prompt: '눈 오는 날 산책',
        }),
      }).then((res) => res.json())

      expect(rejected.error.code).toBe('INSUFFICIENT_CREDIT')
      // 값을 못 박아 둡니다 — 둘 다 `undefined` 인 채로 같아지는 통과를 막습니다.
      expect(announced.custom_prompt_credit_cost).toBe(3)
      expect(announced.custom_prompt_credit_cost).toBe(rejected.error.detail.required)
    } finally {
      localStorage.removeItem('nutti.mock.scenario')
    }
  })
})
