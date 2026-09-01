/**
 * W-06 «다시 만들기» 가 스타일 입력을 들고 가는가 (screens/W06Result.tsx · 이슈 #127).
 *
 * 막으려는 결함: #114 로 W-04 에서 고른 값이 실제로 전송되는데, **재생성만** 그 값을
 * 통째로 버렸습니다. 재생성 재료를 job 응답만으로 조립하는데 `JobResponse` 에
 * `input_values` 가 없어서입니다(#127) — 안 실으면 서버가 스키마의 `default` 로
 * 채우므로 「히메갸루」로 만든 결과가 「2000년대 갸루」로 다시 만들어집니다. 같은 버튼,
 * 같은 크레딧, 다른 그림이고 화면에는 이유가 안 보였습니다.
 *
 * 계약이 없어도 닫히는 절반이 있습니다: **말없이 바꾸지 않는 것**. 그래서 이 파일은
 * 「무엇으로 만드는지 화면이 말하는가」와 「그 값이 그대로 요청에 실리는가」를 봅니다.
 * W04UploadInputs.test.tsx 와 같은 이유로 «보이는가» 가 아니라 «무엇이 나갔는가» 가
 * 단언 대상입니다 — 폼만 그려 놓고 요청에서 빼면 결함이 그대로 남습니다.
 *
 * ---------------------------------------------------------------------------
 * 백엔드 PR #139 로 `job.inputs` 가 오면서 **나머지 절반**도 닫힙니다: 되살리기.
 * 그래서 이 파일이 보는 게 하나 늘었습니다 — 「지난번 값을 되살리는가」.
 *
 * 픽스처의 기본값은 `inputs: null` 입니다. 그게 흔해서가 아니라(고를 게 있는 스타일
 * 이면 서버는 최소한 `{}` 를 줍니다) **되살리기를 보는 테스트가 값을 직접 적게**
 * 하려는 것입니다. 그래야 어느 테스트가 무엇을 전제하는지 본문만 읽고 알 수 있고,
 * 되살리기와 무관한 테스트(요청 조립·검증·잠금)는 그 축에 휘둘리지 않습니다.
 * `null` 자체도 실제 상태입니다 — 이 필드가 생기기 전에 만든 job 이 그렇습니다.
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { Job, StyleDetail, StyleInputField } from '../api/types'
import W06Result from './W06Result'

const JOB_ID = 'job_01HQZY'
const STYLE_ID = 12

/** 「갸루」의 실제 모양 — #127 본문이 든 그 스타일입니다(seeds/style_inputs.json). */
const GYARU: StyleInputField = {
  label: '스타일',
  type: 'choice',
  allow_custom: false,
  default: '2000년대 갸루',
  options: [{ value: '2000년대 갸루' }, { value: '히메갸루' }, { value: '망바' }],
}
/** 「입덕직캠」의 이름 칸 — 프리필이 그림에 인쇄될 이름입니다(#127 «한 겹 더 나쁜» 쪽). */
const IDOL_NAME: StyleInputField = {
  label: '반려견 이름 (3자 이내)',
  type: 'text',
  max_length: 3,
  prefill: 'pet_name',
}

function succeededJob(overrides: Partial<Job> = {}): Job {
  const at = new Date(Date.now() - 30_000).toISOString()
  return {
    job_id: JOB_ID,
    status: 'succeeded',
    style_id: STYLE_ID,
    upload_id: 'up_01HQZY',
    pet_id: null,
    breed: null,
    custom_prompt: null,
    // 위 머리말 참고 — 되살리기를 보는 테스트만 이 값을 직접 적습니다.
    inputs: null,
    credit_cost: 1,
    queued_at: at,
    started_at: at,
    progress: 100,
    eta_seconds: 0,
    status_message: null,
    source_image_url: 'https://cdn.example.test/up_01HQZY.jpg',
    results: [{ index: 0, image_url: 'https://cdn.example.test/result_01HQZY.jpg' }],
    error_code: null,
    ...overrides,
  }
}

function mockStyle(fields: StyleInputField[], delayMs = 0) {
  server.use(
    http.get('*/v1/styles/:styleId', async () => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      return HttpResponse.json({
        id: STYLE_ID,
        code: '갸루',
        name: '갸루',
        credit_cost: 1,
        examples: [],
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
        uses_pet_name: false,
        uses_breed: false,
        input_fields: fields,
      } satisfies StyleDetail)
    }),
  )
}

/** `POST /v1/jobs` 로 나간 본문 — 이 파일의 단언 대상입니다. */
function captureJobRequest(): { body: Record<string, unknown> | null } {
  const captured: { body: Record<string, unknown> | null } = { body: null }
  server.use(
    http.post('*/v1/jobs', async ({ request }) => {
      captured.body = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ job_id: 'job_next', status: 'queued' }, { status: 202 })
    }),
  )
  return captured
}

function renderResult(job: Job = succeededJob()) {
  server.use(http.get(`*/v1/jobs/${JOB_ID}`, () => HttpResponse.json(job)))
  // 결과 화면은 계산기 배너와 인기 스타일도 부릅니다 — 이 파일의 주제가 아니라 잠재웁니다.
  server.use(http.get('*/v1/styles', () => HttpResponse.json({ sections: [] })))

  return renderWithProviders(
    <Routes>
      <Route path="/jobs/:jobId" element={<W06Result />} />
      <Route path="/jobs/:jobId/waiting" element={<p>대기 화면</p>} />
    </Routes>,
    { route: `/jobs/${JOB_ID}` },
  )
}

const regenerateButton = () => screen.findByRole('button', { name: /다시 만들기/ })

describe('W-06 · 다시 만들기의 스타일 입력', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('스키마가 없는 스타일에서는 옵션 줄도 없고 요청도 그대로다', async () => {
    // 39종 중 14종이 빈 배열입니다 — 그쪽 동선은 한 글자도 달라지면 안 됩니다.
    mockStyle([])
    const captured = captureJobRequest()
    renderResult()

    await userEvent.click(await regenerateButton())

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toBeUndefined()
    expect(screen.queryByLabelText('스타일 옵션')).not.toBeInTheDocument()
  })

  it('화면에 적힌 값이 그대로 요청의 inputs 로 나간다', async () => {
    /*
      **이 파일의 핵심입니다.** 예전에는 여기서 `inputs` 가 아예 안 나갔고, 서버가
      `default` 로 채웠습니다. 지금은 화면이 «스타일: 2000년대 갸루» 라고 적어 두고
      그 값을 그대로 보냅니다 — 보여 준 것과 보낸 것이 갈라지면, 서버 default 가
      바뀌는 날 화면은 그대로인데 결과만 조용히 달라집니다.
    */
    mockStyle([GYARU])
    const captured = captureJobRequest()
    renderResult()

    expect(await screen.findByText('스타일: 2000년대 갸루')).toBeInTheDocument()
    await userEvent.click(await regenerateButton())

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 스타일: '2000년대 갸루' })
  })

  it('지난번 값을 되살려 접힌 줄에 적고, 그대로 다시 보낸다', async () => {
    /*
      **#127 본문 그 자체입니다.** 「히메갸루」로 만든 결과에서 «다시 만들기» 를 누르면
      「2000년대 갸루」(스키마 default)가 나오던 것 — 같은 버튼, 같은 크레딧, 다른 그림.

      접힌 줄과 요청을 **함께** 봅니다. 하나만 보면 절반이 남습니다: 줄만 고치면 화면이
      말한 값과 다른 게 나가고, 요청만 고치면 무엇으로 만드는지 안 보인 채 나갑니다.
    */
    mockStyle([GYARU])
    const captured = captureJobRequest()
    renderResult(succeededJob({ inputs: { 스타일: '히메갸루' } }))

    expect(await screen.findByText('스타일: 히메갸루')).toBeInTheDocument()
    expect(screen.getByText('지난번에 만든 값 그대로예요')).toBeInTheDocument()

    await userEvent.click(await regenerateButton())
    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 스타일: '히메갸루' })
  })

  it('서버가 값을 모르면 기본값이라고 적는다', async () => {
    // `inputs: null` 은 이 필드가 생기기 전에 만든 job 입니다. 그 사실을 안 적으면
    // 접힌 줄이 방금 만든 그림의 설정처럼 읽히고, 화면이 또 한 번 조용히 거짓말을 합니다.
    mockStyle([GYARU])
    renderResult()

    expect(await screen.findByText('지난번 값은 불러올 수 없어 기본값이에요')).toBeInTheDocument()
    expect(screen.queryByText('지난번에 만든 값 그대로예요')).not.toBeInTheDocument()
  })

  it('지금 스키마에 없는 라벨은 되살리지 않는다', async () => {
    /*
      `inputs` 는 job 을 **만들던 시점의** 스키마로 판정된 값이라, 운영이 그 뒤 칸을
      바꾸면 없어진 라벨이 남습니다. 그대로 그리면 접힌 줄에는 적히는데 요청에는
      안 실리고(`inputsForRequest` 가 스키마를 순회), 실려도 서버가 조용히 버립니다
      (백엔드 PR #139) — 화면에 적힌 값과 실제로 나갈 값이 갈라집니다.
    */
    mockStyle([GYARU])
    const captured = captureJobRequest()
    renderResult(succeededJob({ inputs: { 스타일: '히메갸루', 없어진칸: '버섯' } }))

    expect(await screen.findByText('스타일: 히메갸루')).toBeInTheDocument()
    expect(screen.queryByText(/없어진칸/)).not.toBeInTheDocument()

    await userEvent.click(await regenerateButton())
    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 스타일: '히메갸루' })
  })

  it('되살린 값을 고치면 «지난번 값 그대로» 라고 말하지 않는다', async () => {
    // 고친 뒤에도 그 줄을 띄우면, 방금 사용자가 바꾼 값을 두고 지난번 값이라고
    // 말하는 셈입니다 — 이 파일이 막으려는 «조용한 거짓말» 과 같은 종류입니다.
    mockStyle([GYARU])
    renderResult(succeededJob({ inputs: { 스타일: '히메갸루' } }))

    expect(await screen.findByText('지난번에 만든 값 그대로예요')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '변경' }))
    await userEvent.click(screen.getByRole('button', { name: '망바' }))

    expect(screen.getByText('스타일: 망바')).toBeInTheDocument()
    expect(screen.queryByText('지난번에 만든 값 그대로예요')).not.toBeInTheDocument()
  })

  it('«변경» 으로 고친 값이 요청에 실린다', async () => {
    mockStyle([GYARU])
    const captured = captureJobRequest()
    renderResult()

    await userEvent.click(await screen.findByRole('button', { name: '변경' }))
    await userEvent.click(screen.getByRole('button', { name: '히메갸루' }))
    // 접힌 줄도 같이 따라옵니다 — 접고 나서 무엇으로 만드는지 계속 보여야 합니다.
    expect(screen.getByText('스타일: 히메갸루')).toBeInTheDocument()

    await userEvent.click(await regenerateButton())
    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ 스타일: '히메갸루' })
  })

  it('스키마가 도착하기 전에는 버튼이 잠긴다', async () => {
    /*
      스키마를 모르는 창을 «칸이 없다» 로 단정하면, 그 사이에 누른 사용자만 값이
      통째로 빠진 요청을 보내게 됩니다 — 크레딧은 이미 나간 뒤라 되돌릴 수 없습니다.
      링크로 처음 연 결과에서 실제로 생기는 창입니다(캐시가 비어 있음).
    */
    mockStyle([GYARU], 150)
    renderResult()

    const button = await screen.findByRole('button', { name: /옵션 불러오는 중/ })
    expect(button).toBeDisabled()
    expect(await regenerateButton()).toBeEnabled()
  })

  it('프리필 칸은 이 사진에 붙은 강아지 이름으로 나간다', async () => {
    /*
      #127 이 «한 겹 더 나쁘다» 고 적은 쪽입니다. 이 칸을 비운 채 보내면 워커가
      채우긴 하지만(app/worker.py), 무엇이 인쇄될지는 화면에 안 보입니다. 이름은
      `job.pet_id` → `GET /v1/pets` 로 알아냅니다 — 그 사진에 이미 붙어 있는 값이라
      새로 연결하는 것은 없고, 화면이 사실을 말할 수 있게 될 뿐입니다.
    */
    mockStyle([IDOL_NAME])
    server.use(
      http.get('*/v1/pets', () =>
        HttpResponse.json({
          items: [{ id: 'pet_1', name: '콩이', thumbnail_url: null, latest_upload_id: 'up_01HQZY' }],
        }),
      ),
    )
    const captured = captureJobRequest()
    renderResult(succeededJob({ pet_id: 'pet_1' }))

    expect(await screen.findByText('반려견 이름 (3자 이내): 콩이')).toBeInTheDocument()
    await userEvent.click(await regenerateButton())

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ '반려견 이름 (3자 이내)': '콩이' })
  })

  it('`inputs` 가 비어도 프리필 칸은 강아지 이름으로 다시 채운다', async () => {
    /*
      **`inputs: {}` 는 「아무 값도 안 썼다」가 아닙니다.** `default` 가 없는 `prefill`
      칸은 서버가 저장하지 않으므로(`_resolve_input_values` 가 `continue`) 이 스키마
      에서는 빈 객체가 정상 응답입니다 — 값은 워커가 그때 채웁니다(app/worker.py).

      되살린 값으로 폼을 **덮어쓰면** 이 칸이 빈 채로 남고, 이름이 인쇄되는 스타일에서
      화면이 «우리 아이» 라고 잘못 말합니다. 그래서 기본값 → 지난번 값 순으로 합칩니다.
    */
    mockStyle([IDOL_NAME])
    server.use(
      http.get('*/v1/pets', () =>
        HttpResponse.json({
          items: [{ id: 'pet_1', name: '콩이', thumbnail_url: null, latest_upload_id: 'up_01HQZY' }],
        }),
      ),
    )
    const captured = captureJobRequest()
    renderResult(succeededJob({ pet_id: 'pet_1', inputs: {} }))

    expect(await screen.findByText('반려견 이름 (3자 이내): 콩이')).toBeInTheDocument()
    await userEvent.click(await regenerateButton())

    await waitFor(() => expect(captured.body).not.toBeNull())
    expect(captured.body?.inputs).toEqual({ '반려견 이름 (3자 이내)': '콩이' })
  })

  it('규칙을 어긴 값이면 폼을 펼쳐 보여 주고 요청은 안 나간다', async () => {
    /*
      프리필이 규칙을 어기는 경우가 실제로 있습니다 — 「입덕직캠」은 3자 제한인데
      저장된 이름은 그대로 들어옵니다. 접힌 채로 «고칠 곳이 있어요» 만 띄우면 어디를
      고치라는 말인지 알 수 없어서, 막는 김에 같이 펼칩니다.
    */
    mockStyle([IDOL_NAME])
    server.use(
      http.get('*/v1/pets', () =>
        HttpResponse.json({
          items: [
            { id: 'pet_1', name: '초코라떼', thumbnail_url: null, latest_upload_id: 'up_01HQZY' },
          ],
        }),
      ),
    )
    const captured = captureJobRequest()
    renderResult(succeededJob({ pet_id: 'pet_1' }))

    await userEvent.click(await regenerateButton())

    expect(await screen.findByText('3자 이내로 써 주세요.')).toBeInTheDocument()
    expect(screen.getByText('위 옵션에서 고칠 곳이 있어요.')).toBeInTheDocument()
    expect(captured.body).toBeNull()
  })
})
