/**
 * W-04 의 스타일별 입력 폼 (screens/W04Upload.tsx · 이슈 #114).
 *
 * 막으려는 결함: 이 폼이 없던 동안 24종 스타일은 사용자가 무엇을 고르든 서버가 전부
 * `default` 로 채워 만들었습니다 — «의상» 은 늘 버섯이고 «신분» 은 늘 양반이었습니다.
 * 화면에 선택지가 보이는 것만으로는 그게 고쳐지지 않습니다. 고친 값이 실제로
 * `POST /v1/jobs` 의 `inputs` 로 나가는지까지 봐야 같은 결함을 다시 안 만듭니다.
 *
 * 그래서 이 파일은 «보이는가» 가 아니라 **«무엇이 요청에 실렸는가»** 를 단언합니다.
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { StyleDetail, StyleInputField } from '../api/types'
import W04Upload from './W04Upload'

/** 「사물코스튬」의 실제 모양 — choice + allow_custom(seeds/style_inputs.json). */
const COSTUME: StyleInputField = {
  label: '의상',
  type: 'choice',
  allow_custom: true,
  default: '버섯',
  options: [{ value: '버섯' }, { value: '옥수수' }, { value: '붕어빵' }],
}
/** 「입덕직캠」의 이름 칸 — 3자 제한 + 펫 이름 프리필. 제한과 프리필이 부딪히는 자리입니다. */
const IDOL_NAME: StyleInputField = {
  label: '반려견 이름 (3자 이내)',
  type: 'text',
  max_length: 3,
  prefill: 'pet_name',
}
/** 「우리아이라떼아트」 — 설명이 붙은 닫힌 choice. */
const LATTE: StyleInputField = {
  label: '방식',
  type: 'choice',
  allow_custom: false,
  default: '에칭 아트',
  options: [
    { value: '프리푸어', description: '붓는 것만으로 만든 심플한 실루엣' },
    { value: '에칭 아트', description: '꼬치로 그린 세밀한 얼굴 (제일 잘 나와요!)' },
  ],
}

function mockStyle(fields: StyleInputField[], overrides: Partial<StyleDetail> = {}) {
  server.use(
    http.get('*/v1/styles/:styleId', () =>
      HttpResponse.json({
        id: 7,
        code: '사물코스튬',
        name: '사물코스튬',
        credit_cost: 1,
        examples: [],
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
        uses_pet_name: false,
        uses_breed: false,
        input_fields: fields,
        ...overrides,
      } satisfies StyleDetail),
    ),
  )
}

/** `POST /v1/jobs` 로 나간 본문을 붙잡습니다 — 이 파일의 단언 대상입니다. */
function captureJobRequest(): { body: Record<string, unknown> | null; keys: string[] } {
  const captured: { body: Record<string, unknown> | null; keys: string[] } = {
    body: null,
    keys: [],
  }
  server.use(
    http.post('*/v1/jobs', async ({ request }) => {
      captured.body = (await request.json()) as Record<string, unknown>
      captured.keys.push(request.headers.get('Idempotency-Key') ?? '')
      return HttpResponse.json({ job_id: 'job_test', status: 'queued' }, { status: 202 })
    }),
  )
  return captured
}

function renderUpload() {
  return renderWithProviders(
    <Routes>
      <Route path="/upload" element={<W04Upload />} />
      {/* 성공하면 W-05 로 넘어갑니다 — 목적지가 없으면 라우터가 경고를 냅니다. */}
      <Route path="/jobs/:jobId/waiting" element={<p>대기 화면</p>} />
    </Routes>,
    { route: '/upload?style_id=7' },
  )
}

async function uploadPhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  await userEvent.upload(input as HTMLInputElement, new File(['x'], 'dog.jpg', { type: 'image/jpeg' }))
  // 목이 품질 체크 체감으로 700ms 를 씁니다(mocks/handlers.ts).
  return screen.findByRole('button', { name: /이대로 만들기/ }, { timeout: 5000 })
}

describe('W-04 · 스타일별 입력 폼', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('스키마가 없는 스타일에서는 폼을 아예 그리지 않는다', async () => {
    // 39종 중 14종이 빈 배열입니다 — 그쪽은 기존 플로우가 한 글자도 달라지면 안 됩니다.
    mockStyle([])
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(screen.queryByText('이 스타일에서 고를 수 있어요')).not.toBeInTheDocument()
  })

  it('고른 값이 POST /v1/jobs 의 inputs 로 나간다', async () => {
    mockStyle([COSTUME])
    const captured = captureJobRequest()
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    await userEvent.click(screen.getByRole('button', { name: '옥수수' }))
    await userEvent.click(start)

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 의상: '옥수수' })
  })

  it('아무것도 안 고르면 default 를 그대로 실어 보낸다', async () => {
    /*
      서버가 어차피 default 로 채우므로 값 자체는 같습니다. 그래도 화면이 «버섯» 을
      고른 상태로 보여 주는 이상 요청도 그렇게 나가야 합니다 — 보여 준 것과 보낸 것이
      갈라지면 나중에 default 가 바뀌는 날 조용히 다른 그림이 나옵니다.
    */
    mockStyle([COSTUME])
    const captured = captureJobRequest()
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    expect(screen.getByRole('button', { name: '버섯' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(start)

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 의상: '버섯' })
  })

  it('allow_custom 이면 직접 쓴 값이 그대로 나간다', async () => {
    mockStyle([COSTUME])
    const captured = captureJobRequest()
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    await userEvent.click(screen.getByRole('button', { name: '직접 입력' }))
    const input = screen.getByLabelText('의상')
    await userEvent.clear(input)
    await userEvent.type(input, '한복')
    await userEvent.click(start)

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 의상: '한복' })
  })

  it('선택지의 설명은 고른 뒤에 보여 준다', async () => {
    mockStyle([LATTE])
    const { container } = renderUpload()
    await uploadPhoto(container)

    // default 가 «에칭 아트» 라 그 설명이 처음부터 보입니다.
    expect(screen.getByText('꼬치로 그린 세밀한 얼굴 (제일 잘 나와요!)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '프리푸어' }))
    expect(screen.getByText('붓는 것만으로 만든 심플한 실루엣')).toBeInTheDocument()
  })

  it('규칙을 어긴 값이면 만들기가 멈추고 요청이 아예 안 나간다', async () => {
    /*
      서버도 400 으로 막고 크레딧도 안 나가지만, 그 응답은 «요청 형식이 올바르지
      않습니다» 한 줄이라 어느 칸이 틀렸는지 화면이 옮겨 적을 수 없습니다.
    */
    mockStyle([IDOL_NAME])
    const captured = captureJobRequest()
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    const input = screen.getByLabelText('반려견 이름 (3자 이내)')
    // maxLength 속성을 우회해 프리필이 규칙을 어긴 상태를 재현합니다(실제로 생기는 상태).
    ;(input as HTMLInputElement).removeAttribute('maxlength')
    await userEvent.type(input, '네글자이름')
    await userEvent.click(start)

    expect(await screen.findByText('3자 이내로 써 주세요.')).toBeInTheDocument()
    expect(screen.getByText('위 입력에서 고칠 곳이 있어요.')).toBeInTheDocument()
    expect(captured.body).toBeNull()
  })

  it('만지기 전에는 빨간 줄을 긋지 않는다', async () => {
    // 프리필이 규칙을 어기는 경우가 실제로 있어서, 도착하자마자 나무라면 안 됩니다.
    mockStyle([IDOL_NAME])
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(screen.queryByText('3자 이내로 써 주세요.')).not.toBeInTheDocument()
  })

  it('402 뒤에 입력을 바꾸면 다른 의도로 보고 새 멱등키를 쓴다', async () => {
    /*
      §4 시나리오3 — 402 뒤 재시도는 **같은 키**로 가야 이중 차감이 없습니다. 그런데
      그 사이에 «의상» 을 바꿨다면 그건 다른 그림을 주문한 것이라, 같은 키로 보내면
      서버가 첫 주문을 그대로 돌려줍니다(멱등 재생) — 사용자는 바꾼 값이 무시된
      결과를 받습니다. api/idempotency.ts 가 inputs 를 의도에 넣는 이유입니다.

      크레딧을 실제로 채우지는 않습니다. 여기서 볼 것은 «두 요청의 키가 다른가» 이고,
      402 는 화면을 떠나지 않은 채 두 번째 시도를 만들어 내는 가장 짧은 길입니다.
    */
    mockStyle([COSTUME])
    const captured: string[] = []
    server.use(
      http.post('*/v1/jobs', ({ request }) => {
        captured.push(request.headers.get('Idempotency-Key') ?? '')
        return HttpResponse.json(
          {
            error: {
              code: 'INSUFFICIENT_CREDIT',
              message: '크레딧이 부족합니다',
              detail: { required: 1, balance: 0 },
            },
          },
          { status: 402 },
        )
      }),
    )
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    await userEvent.click(start)
    await waitFor(() => expect(captured.length).toBe(1))

    // 오버레이를 닫고 폼으로 돌아옵니다 — 크레딧을 받으러 나갔다 온 사용자의 자리입니다.
    // 오버레이에는 스크림과 하단 버튼 둘 다 «닫기» 입니다 — 어느 쪽이든 같은 onClose 입니다.
    await userEvent.click((await screen.findAllByRole('button', { name: '닫기' }))[0])
    await userEvent.click(screen.getByRole('button', { name: '붕어빵' }))
    await userEvent.click(screen.getByRole('button', { name: /이대로 만들기/ }))
    await waitFor(() => expect(captured.length).toBe(2))

    expect(captured[0]).not.toBe(captured[1])
  })

  it('402 뒤 입력을 그대로 두면 같은 키로 재시도한다', async () => {
    // 위 테스트의 짝 — 아무것도 안 바꿨는데 새 키가 나가면 이중 차감이 열립니다.
    mockStyle([COSTUME])
    const captured: string[] = []
    server.use(
      http.post('*/v1/jobs', ({ request }) => {
        captured.push(request.headers.get('Idempotency-Key') ?? '')
        return HttpResponse.json(
          {
            error: {
              code: 'INSUFFICIENT_CREDIT',
              message: '크레딧이 부족합니다',
              detail: { required: 1, balance: 0 },
            },
          },
          { status: 402 },
        )
      }),
    )
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    await userEvent.click(start)
    await waitFor(() => expect(captured.length).toBe(1))

    // 오버레이에는 스크림과 하단 버튼 둘 다 «닫기» 입니다 — 어느 쪽이든 같은 onClose 입니다.
    await userEvent.click((await screen.findAllByRole('button', { name: '닫기' }))[0])
    await userEvent.click(screen.getByRole('button', { name: /이대로 만들기/ }))
    await waitFor(() => expect(captured.length).toBe(2))

    expect(captured[0]).toBe(captured[1])
  })
})
