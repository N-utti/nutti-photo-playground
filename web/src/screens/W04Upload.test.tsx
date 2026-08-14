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

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W04Upload from './W04Upload'

/** 스타일 상세만 덮어씁니다 — 업로드·펫·크레딧은 기본 목 그대로 답합니다. */
function mockStyle(code: string) {
  server.use(
    http.get('*/v1/styles/:styleId', () =>
      HttpResponse.json({
        id: 7,
        code,
        name: code.replace(/_/g, ' '),
        credit_cost: 1,
        examples: [],
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
      }),
    ),
  )
}

function renderUpload() {
  return renderWithProviders(
    <Routes>
      <Route path="/upload" element={<W04Upload />} />
    </Routes>,
    { route: '/upload?style_id=7' },
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

  it('이름이 인쇄되는 스타일이면, 저장 전에는 «우리 아이» 가 박힌다고 미리 말한다', async () => {
    mockStyle('식빵')
    const { container } = renderUpload()

    await uploadPhoto(container)

    expect(screen.getByText(/이대로 만들면 그림에/)).toBeInTheDocument()
    expect(screen.getByText('«우리 아이»')).toBeInTheDocument()

    /*
      이름 입력은 **버튼 앞**에 있어야 합니다. 기본 저장 폼은 만들기 버튼 아래에
      있어서, 거기까지 내려가기 전에 버튼을 누르는 게 자연스러운 순서입니다 —
      그 순서로는 이름을 넣을 기회가 사실상 없습니다.
    */
    const form = screen.getByLabelText('이름 넣고 만들기')
    const start = screen.getByRole('button', { name: /이대로 만들기/ })
    expect(form.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // 이름 입력이 한 화면에 둘이면 어느 쪽이 그림에 들어가는지 화면이 스스로 헷갈립니다.
    expect(screen.queryByLabelText('이 강아지 저장하기')).not.toBeInTheDocument()
  })

  it('이름이 안 들어가는 스타일에서는 이름 얘기를 하지 않는다', async () => {
    mockStyle('찜질방')
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
    mockStyle('식빵')
    renderUpload()

    expect(await screen.findByText('저장된 강아지의 이름이 그림에 들어갑니다.')).toBeInTheDocument()
    expect(screen.queryByText('«우리 아이»')).not.toBeInTheDocument()
    // 이미 붙어 있는 강아지에게 이름을 또 물어보지 않습니다.
    expect(screen.queryByLabelText('이름 넣고 만들기')).not.toBeInTheDocument()
  })

  it('저장된 강아지로 들어오면 그 이름을 그대로 예고한다', async () => {
    mockStyle('3D_피규어')
    renderUpload()

    /*
      «콩이» 는 `latest_upload_id` 가 있어 업로드 단계를 건너뜁니다(FR-W04-02).
      그 사진은 이미 이 강아지에 붙어 있으므로(`source_image.pet_profile_id`)
      워커가 넣을 이름도 «콩이» 입니다 — 화면이 «우리 아이» 라고 하면 거짓말입니다.
    */
    const chip = await screen.findByRole('button', { name: '콩이 — 최근 사진으로 바로 만들기' })
    await userEvent.click(chip)

    expect(await screen.findByText('«콩이»')).toBeInTheDocument()
    expect(screen.queryByText('«우리 아이»')).not.toBeInTheDocument()
    // 이미 붙어 있는 강아지에게 이름을 또 물어보지 않습니다.
    expect(screen.queryByLabelText('이름 넣고 만들기')).not.toBeInTheDocument()
  })
})
