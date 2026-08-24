/**
 * W-04 확인 단계의 «어떤 이름이 그림에 박히는가» 예고 (screens/W04Upload.tsx · PR #98).
 *
 * 막으려는 결함: 워커가 프리셋 프롬프트의 `[pet name]` 을 치환하면서부터
 * (app/worker.py) 스타일 3종은 **결과물 안에 글자로 이름을 인쇄합니다**. 저장된
 * 강아지를 안 고르고 만들면 «우리 아이» 가 박혀 나오는데, 그건 크레딧이 나간 뒤에야
 * 결과 화면에서 처음 보입니다 — 되돌릴 수 없고, 왜 그렇게 됐는지도 화면 어디에도
 * 없었습니다.
 *
 * 화면만 보는 QA 로는 «안내 문구가 없다» 를 알아채기 어렵습니다(없는 것은 눈에 띄지
 * 않습니다). 그래서 문구의 **유무와 내용**을 단언으로 잡아 둡니다.
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { StyleDetail } from '../api/types'
import W04Upload from './W04Upload'

/**
 * 스타일 상세만 덮어씁니다 — 업로드·펫·크레딧은 기본 목 그대로 답합니다.
 *
 * «이름이 인쇄되는가» 는 이제 서버가 계산한 `uses_pet_name` 입니다(이슈 #101 →
 * 백엔드 #111). 예전에는 여기에 `code` 를 넘겨 프론트 하드코딩 목록을 자극했는데,
 * 그 목록이 #110 의 프롬프트 교체를 놓치면서 실제로 틀린 적이 있습니다 — 계약
 * 필드로 옮긴 지금은 테스트도 그 필드를 직접 말해야 같은 것을 검증합니다.
 */
function mockStyle(overrides: Partial<StyleDetail> = {}) {
  server.use(
    http.get('*/v1/styles/:styleId', () =>
      HttpResponse.json({
        id: 7,
        code: '찜질방',
        name: '찜질방',
        credit_cost: 1,
        examples: [],
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
        uses_pet_name: false,
        uses_breed: false,
        input_fields: [],
        ...overrides,
      } satisfies StyleDetail),
    ),
  )
}

function renderUpload(query = '') {
  return renderWithProviders(
    <Routes>
      <Route path="/upload" element={<W04Upload />} />
    </Routes>,
    { route: `/upload?style_id=7${query}` },
  )
}

/**
 * 확인 단계로 넘어가는 길 C — W-06 "이 사진으로 다른 스타일"(FR-W06-07).
 *
 * `pet_id` 는 백엔드 #111 이 채운 필드입니다(`source_image.pet_profile_id`). 여기서
 * 목이 그 값을 정직하게 답해야 이 경로가 «누구 이름이 박히는가» 를 아는 상태가 됩니다.
 */
const REUSE_JOB_ID = 'b3e13c4a-2f1e-4a3a-9b1e-0000000000fe'

function mockReuseJob(petId: string | null) {
  server.use(
    http.get('*/v1/jobs/:jobId', () =>
      HttpResponse.json({
        job_id: REUSE_JOB_ID,
        status: 'succeeded',
        style_id: 3,
        upload_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        pet_id: petId,
        custom_prompt: null,
        credit_cost: 1,
        queued_at: '2026-08-20T10:00:00+09:00',
        started_at: '2026-08-20T10:00:02+09:00',
        progress: null,
        eta_seconds: null,
        status_message: null,
        source_image_url: 'https://cdn.example.test/reuse.jpg',
        results: [{ index: 0, image_url: 'https://cdn.example.test/result.jpg' }],
        error_code: null,
      }),
    ),
  )
}

/** 확인 단계로 넘어가는 길 A — 새 사진을 올립니다(`POST /v1/uploads`). */
async function uploadPhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  expect(input).not.toBeNull()
  await userEvent.upload(input as HTMLInputElement, new File(['x'], 'dog.jpg', { type: 'image/jpeg' }))
  // 목이 품질 체크 체감으로 700ms 를 씁니다(mocks/handlers.ts) — 기본 1초로는 아슬합니다.
  return screen.findByRole('button', { name: /이대로 만들기/ }, { timeout: 5000 })
}

describe('W-04 · 그림에 들어가는 이름', () => {
  /*
    업로드 초안은 sessionStorage 에 남습니다(api/uploadDraft.ts) — 402 왕복에서 사진을
    잃지 않으려고 일부러 그렇게 만든 것입니다. 테스트 사이에 안 지우면 다음 테스트가
    **앞 테스트의 사진으로 확인 단계에서 시작**해, 사진 선택 화면을 아예 못 밟습니다.
  */
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('이름이 인쇄되는 스타일이면 폴백을 예고하지 않고 이름을 요구한다', async () => {
    /*
      예전에는 «이대로 만들면 그림에 «우리 아이» 라는 이름이 들어갑니다» 였습니다.
      사실이긴 했지만 **아무도 원하지 않는 결과를 예고하는** 문장이었습니다 — 피규어
      패키지에 «우리 아이» 가 인쇄된 결과를 받으려고 이 스타일을 고른 사람은 없는데
      크레딧은 똑같이 나갑니다. 예고 대신 받습니다.
    */
    mockStyle({ code: '식빵', name: '식빵', uses_pet_name: true })
    const { container } = renderUpload()

    await uploadPhoto(container)

    expect(screen.getByLabelText('아이 이름을 넣어 주세요')).toBeInTheDocument()
    expect(screen.queryByText(/이대로 만들면 그림에/)).not.toBeInTheDocument()
    expect(screen.queryByText(/우리 아이/)).not.toBeInTheDocument()

    /*
      이름 입력은 **버튼 앞**에 있어야 합니다. 기본 저장 폼은 만들기 버튼 아래에
      있어서, 거기까지 내려가기 전에 버튼을 누르는 게 자연스러운 순서입니다 —
      그 순서로는 이름을 넣을 기회가 사실상 없습니다.
    */
    const form = screen.getByLabelText('아이 이름을 넣어 주세요')
    const start = screen.getByRole('button', { name: /이대로 만들기/ })
    expect(form.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 이름 입력이 한 화면에 둘이면 어느 쪽이 그림에 들어가는지 화면이 스스로 헷갈립니다.
    expect(screen.queryByLabelText('이 강아지 저장하기')).not.toBeInTheDocument()
  })

  it('이름 없이 만들기를 누르면 요청이 안 나가고 이유를 말한다', async () => {
    /*
      **이 파일의 새 핵심입니다.** 예전에는 이름 없이도 통과했고, 그 결과가
      «우리 아이» 가 인쇄된 그림 + 나간 크레딧이었습니다. 폴백을 예고하는 것과
      폴백으로 진행시키는 것은 다른 문제이고, 예고를 지웠으면 진행도 막아야 합니다.

      «보이는가» 가 아니라 **«요청이 나갔는가»** 를 단언합니다 — 문구만 띄우고
      요청이 나가면 결함이 그대로 남습니다.

      버튼을 비활성으로 두지 않는 것은 이 화면의 규칙입니다(노트3) — 회색 버튼은 왜
      못 누르는지 말하지 않습니다. 눌리되, 누르면 이유를 답합니다.
    */
    let posted = 0
    server.use(
      http.post('*/v1/jobs', () => {
        posted += 1
        return HttpResponse.json({ job_id: 'job_x', status: 'queued' }, { status: 202 })
      }),
    )
    mockStyle({ code: '식빵', name: '식빵', uses_pet_name: true })
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    expect(start).toBeEnabled()
    await userEvent.click(start)

    expect(await screen.findByRole('alert')).toHaveTextContent(/아이 이름을 넣어야/)
    expect(posted).toBe(0)
  })

  it('이름을 저장하면 그대로 진행된다', async () => {
    // 막기만 하고 풀리지 않으면 그건 막은 게 아니라 고장입니다.
    let posted = 0
    server.use(
      http.post('*/v1/jobs', () => {
        posted += 1
        return HttpResponse.json({ job_id: 'job_x', status: 'queued' }, { status: 202 })
      }),
    )
    mockStyle({ code: '식빵', name: '식빵', uses_pet_name: true })
    const { container } = renderUpload()
    const start = await uploadPhoto(container)

    await userEvent.type(screen.getByPlaceholderText('이름 (예: 콩이)'), '뽀식')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    // 저장되면 `petId` 가 생겨 판정이 스스로 풀립니다 — 받침 있는 이름으로 확인합니다.
    expect(await screen.findByText('뽀식')).toBeInTheDocument()
    await userEvent.click(start)
    await waitFor(() => expect(posted).toBe(1))
  })

  it('이름이 안 들어가는 스타일에서는 이름 얘기를 하지 않는다', async () => {
    mockStyle()
    const { container } = renderUpload()

    await uploadPhoto(container)

    expect(screen.queryByText(/그림에/)).not.toBeInTheDocument()
    expect(screen.queryByText('«우리 아이»')).not.toBeInTheDocument()
    // 평소의 저장 폼(노트2)은 그대로 있습니다 — 이 변경이 걷어낸 게 아닙니다.
    expect(screen.getByLabelText('이 강아지 저장하기')).toBeInTheDocument()
  })

  it('강아지가 붙어 있는데 이름을 아직 모르면 «우리 아이» 라고 하지 않는다', async () => {
    /*
      브라우저에서 실제로 잡힌 창입니다: 초안 복원은 `petId` 를 sessionStorage 에서
      즉시 되살리는데 `GET /v1/pets` 는 그 뒤에 옵니다. 그 사이에 폴백 이름을 그리면
      화면이 **먼저 거짓말을 하고 나중에 정정**하고, 그 순간 버튼을 누른 사용자에게는
      정정이 도착하지 않습니다.

      목록에 없는 id 로 못 박아 그 창을 고정합니다 — 다른 탭에서 삭제된 강아지가
      만드는 상태와 같습니다(그때는 창이 아예 안 닫힙니다).
    */
    sessionStorage.setItem(
      'nutti.upload-draft',
      JSON.stringify({
        styleId: 7,
        petId: 'ffffffff-0000-4000-8000-00000000dead',
        upload: {
          upload_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          image_url: null,
          blocking_issue: null,
          warnings: [],
          breed_estimate: null,
        },
      }),
    )
    mockStyle({ code: '식빵', name: '식빵', uses_pet_name: true })
    renderUpload()

    expect(await screen.findByText('저장된 강아지의 이름이 그림에 들어갑니다.')).toBeInTheDocument()
    expect(screen.queryByText('«우리 아이»')).not.toBeInTheDocument()
    // 이미 붙어 있는 강아지에게 이름을 또 물어보지 않습니다.
    expect(screen.queryByLabelText('이름 넣고 만들기')).not.toBeInTheDocument()
  })

  it('저장된 강아지로 들어오면 그 이름을 그대로 예고한다', async () => {
    mockStyle({ code: '3D_피규어', name: '3D 피규어', uses_pet_name: true, uses_breed: true })
    renderUpload()

    /*
      «콩이» 는 `latest_upload_id` 가 있어 업로드 단계를 건너뜁니다(FR-W04-02).
      그 사진은 이미 이 강아지에 붙어 있으므로(`source_image.pet_profile_id`)
      워커가 넣을 이름도 «콩이» 입니다 — 화면이 «우리 아이» 라고 하면 거짓말입니다.
    */
    const chip = await screen.findByRole('button', { name: '콩이 — 최근 사진으로 바로 만들기' })
    await userEvent.click(chip)

    /*
      이름 뒤에 조사를 붙이지 않는 형식입니다 — `«{petName}» 라는` 은 받침 있는 이름
      에서 틀립니다(«뽀식» 라는 ✗). 목이 «콩이» 만 줘서 여태 안 걸리던 자리입니다.
    */
    expect(await screen.findByText('콩이')).toBeInTheDocument()
    expect(screen.getByText(/그림에 들어갈 이름/)).toBeInTheDocument()
    expect(screen.queryByText(/우리 아이/)).not.toBeInTheDocument()
    // 이미 붙어 있는 강아지에게 이름을 또 물어보지 않습니다.
    expect(screen.queryByLabelText('아이 이름을 넣어 주세요')).not.toBeInTheDocument()
  })

  /*
    "이 사진으로 다른 스타일"(FR-W06-07) 경로는 오래 **모르는 상태**였습니다.
    `GET /v1/jobs/{id}` 가 `pet_id` 를 안 주던 시절이라 화면은 «저장된 강아지가 있으면
    그 이름이, 없으면 우리 아이가» 라고 양쪽을 다 말했고, 이름을 넣을 기회는 만들기
    버튼 **아래**의 기본 저장 폼으로 밀려 있었습니다 — 거기까지 내려가기 전에 버튼을
    누르는 게 자연스러운 순서라, 사실상 기회가 없는 자리입니다.

    백엔드 #111 이 그 필드를 채웠으므로 두 갈래 모두 단정할 수 있어야 합니다.
  */
  describe('재사용 경로(from_job)', () => {
    it('사진에 붙은 강아지가 있으면 그 이름을 단정한다', async () => {
      // petList[0] = 콩이 (mocks/fixtures.ts).
      mockReuseJob('b6f9e6b0-0000-4000-8000-000000000001')
      mockStyle({ code: '식빵', name: '식빵', uses_pet_name: true })
      renderUpload(`&from_job=${REUSE_JOB_ID}`)

      /*
        `GET /v1/pets` 가 도착해야 이름이 채워집니다. 그 전까지는 «저장된 강아지의
        이름이…» 가 떠 있으므로, 기본 1 초로는 전체 스위트에서 아슬아슬합니다 —
        아래 `prefill` 테스트가 같은 이유로 경고를 달아 둔 자리와 같은 창입니다.
      */
      await waitFor(() => expect(screen.getByText('콩이')).toBeInTheDocument(), {
        timeout: 5000,
      })
      expect(screen.getByText(/그림에 들어갈 이름/)).toBeInTheDocument()
      expect(screen.queryByText(/우리 아이/)).not.toBeInTheDocument()
      // 흐린 문구가 남아 있으면 그건 이 값을 안 읽고 있다는 뜻입니다.
      expect(screen.queryByText(/저장된 강아지가 있으면/)).not.toBeInTheDocument()
      expect(screen.queryByLabelText('아이 이름을 넣어 주세요')).not.toBeInTheDocument()
    })

    it('붙은 강아지가 없으면 그 자리에서 이름을 받는다', async () => {
      mockReuseJob(null)
      mockStyle({ code: '식빵', name: '식빵', uses_pet_name: true })
      renderUpload(`&from_job=${REUSE_JOB_ID}`)

      expect(await screen.findByLabelText('아이 이름을 넣어 주세요')).toBeInTheDocument()
      expect(screen.queryByText(/우리 아이/)).not.toBeInTheDocument()

      // 이름 입력이 만들기 버튼 **앞**에 있어야 실제로 쓸 기회가 됩니다.
      const form = screen.getByLabelText('아이 이름을 넣어 주세요')
      const start = screen.getByRole('button', { name: /이대로 만들기/ })
      expect(form.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(screen.queryByLabelText('이 강아지 저장하기')).not.toBeInTheDocument()
    })

    it('붙은 강아지 이름으로 `prefill` 입력 칸을 채운다', async () => {
      /*
        이슈 #114 의 `prefill: "pet_name"` 칸(식빵 = «반려견 이름»). 강아지를 모르던
        동안 이 경로만 빈 칸으로 떴습니다 — 같은 사진으로 방금 만든 결과에는 «콩이» 가
        박혀 있는데, 스타일만 바꾸면 이름이 사라지는 셈이었습니다.
      */
      mockReuseJob('b6f9e6b0-0000-4000-8000-000000000001')
      mockStyle({
        code: '식빵',
        name: '식빵',
        uses_pet_name: true,
        input_fields: [{ label: '반려견 이름', type: 'text', prefill: 'pet_name' }],
      })
      renderUpload(`&from_job=${REUSE_JOB_ID}`)

      /*
        `findByLabelText` 로 칸을 잡고 값을 단언하면 **전체 스위트에서만 깨집니다** —
        칸은 스타일 응답만으로 그려지는데 이름은 `GET /v1/pets` 가 도착해야 채워지고,
        칸을 찾은 순간이 그 사이일 수 있습니다(파일 하나만 돌리면 빨라서 안 걸립니다).
        값 자체를 기다리는 쿼리로 잡아 그 창을 없앱니다.
      */
      expect(await screen.findByDisplayValue('콩이')).toHaveAccessibleName('반려견 이름')
    })
  })
})
