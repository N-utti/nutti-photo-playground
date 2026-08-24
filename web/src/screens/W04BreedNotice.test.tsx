/**
 * W-04 의 견종 예고 (screens/W04Upload.tsx `BreedNotice` · 백엔드 #131 A안 → PR #137).
 *
 * 막으려는 결함이 **양방향**입니다.
 *
 * 한쪽은 «한 번도 안 일어나는 일을 예고하는 것». 이슈 #131 이 닫히기 전까지 워커는
 * `pet_profile.breed_label` 하나만 봤고 그 컬럼을 쓰는 API 가 없어서(`app/routers/pets.py`
 * 는 `name` 만 받습니다) `[breed]` 는 늘 «강아지» 로 떨어졌습니다. 3D_피규어 프롬프트가
 * 그 경우 라벨을 통째로 빼므로, 그때 «견종도 인쇄됩니다» 라고 썼다면 사용자는 «토이푸들»
 * 을 기대하고 크레딧을 썼을 것입니다. 그래서 W-03 은 `uses_breed` 를 안 그렸습니다.
 *
 * 다른 쪽은 그 반대 — PR #137 로 워커가 `source_image.breed_estimate["label"]` 을 보게
 * 됐으니 **이제는 말하지 않는 것이 거짓말**입니다. 사진에 따라 갈리는 값이라 그 판정을
 * 할 수 있는 유일한 자리가 여기입니다(W-03 은 사진을 받기 전입니다).
 *
 * 그래서 이 파일이 단언하는 건 «문구가 뜨는가» 가 아니라 **«그림에 실제로 들어갈 값과
 * 같은 말을 하는가»** 입니다. 화면이 보는 값과 워커가 쓸 값이 같은 행이라는 것
 * (`source_image.breed_estimate`)이 이 문구가 참일 수 있는 근거 전부입니다.
 */

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { BreedEstimate, StyleDetail, UploadResult } from '../api/types'
import W04Upload from './W04Upload'

/** 3D_피규어 — 지금 `uses_breed` 가 참인 **유일한** 스타일입니다(실서버 실측). */
function mockStyle(usesBreed: boolean) {
  server.use(
    http.get('*/v1/styles/:styleId', () =>
      HttpResponse.json({
        id: 7,
        code: '3D_피규어',
        name: '3D 피규어',
        credit_cost: 1,
        examples: [],
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
        // 이름 예고는 이 파일의 주제가 아닙니다 — 두 플래그가 **독립**임을 여기서도
        // 지킵니다. 같이 켜 두면 어느 문구를 보고 통과했는지 알 수 없어집니다.
        uses_pet_name: false,
        uses_breed: usesBreed,
        input_fields: [],
      } satisfies StyleDetail),
    ),
  )
}

function mockUpload(breedEstimate: BreedEstimate | null) {
  server.use(
    http.post('*/v1/uploads', () =>
      HttpResponse.json({
        upload_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        image_url: 'https://cdn.example.test/up.jpg',
        blocking_issue: null,
        warnings: [],
        breed_estimate: breedEstimate,
      } satisfies UploadResult),
    ),
  )
}

function renderUpload() {
  return renderWithProviders(
    <Routes>
      <Route path="/upload" element={<W04Upload />} />
      <Route path="/jobs/:jobId/waiting" element={<p>대기 화면</p>} />
    </Routes>,
    { route: '/upload?style_id=7' },
  )
}

async function uploadPhoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  await userEvent.upload(
    input as HTMLInputElement,
    new File(['x'], 'dog.jpg', { type: 'image/jpeg' }),
  )
  return screen.findByRole('button', { name: /이대로 만들기/ }, { timeout: 5000 })
}

describe('W-04 · 견종 예고', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('견종을 인쇄하지 않는 스타일에서는 아무 말도 안 한다', async () => {
    // 41종 중 40종이 여기입니다 — 그쪽 화면은 한 글자도 달라지면 안 됩니다.
    mockStyle(false)
    mockUpload({ code: 'toy_poodle', label: '토이푸들', confidence: 0.82 })
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(screen.queryByText(/견종도 함께 들어갑니다/)).not.toBeInTheDocument()
  })

  it('이 사진에서 잡힌 견종을 그대로 말한다', async () => {
    mockStyle(true)
    mockUpload({ code: 'toy_poodle', label: '토이푸들', confidence: 0.82 })
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(await screen.findByText(/토이푸들/)).toBeInTheDocument()
    expect(screen.getByText(/견종도 함께 들어갑니다/)).toBeInTheDocument()
  })

  it('견종을 못 잡았으면 아무 말도 안 한다 — 못 찾았다고도 안 한다', async () => {
    /*
      워커가 «강아지» 로 떨어뜨리고 3D_피규어 프롬프트가 라벨을 통째로 빼므로, 결과물에
      견종이 안 들어가는 게 맞습니다. 그런데 W-03 이 견종을 예고하지 않으므로 사용자에게는
      정정할 기대 자체가 없습니다 — «못 찾았어요» 는 고칠 수도 없는 걱정만 만듭니다.
    */
    mockStyle(true)
    mockUpload(null)
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(screen.queryByText(/견종도 함께 들어갑니다/)).not.toBeInTheDocument()
    expect(screen.queryByText(/견종/)).not.toBeInTheDocument()
  })

  it('label 만 비어도 말하지 않는다 — 세 필드는 각각 null 이 될 수 있다', async () => {
    /*
      서버가 비전 응답을 그대로 흘려보내므로(`app/routers/uploads.py` `BreedEstimate`)
      `code`·`confidence` 만 오고 `label` 이 비는 조합이 계약상 가능합니다. 그때 워커가
      쓸 값은 «강아지» 입니다 — `code` 를 대신 그리면 화면에만 «toy_poodle» 이 뜨고
      그림에는 아무것도 안 들어갑니다.
    */
    mockStyle(true)
    mockUpload({ code: 'toy_poodle', label: null, confidence: 0.82 })
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(screen.queryByText(/견종도 함께 들어갑니다/)).not.toBeInTheDocument()
    expect(screen.queryByText(/toy_poodle/)).not.toBeInTheDocument()
  })

  it('confidence 가 낮아도 말한다 — 워커가 안 거른다', async () => {
    /*
      **여기서만 «믿을 만한 것» 을 골라 내면 안 됩니다.** 워커는 라벨이 있으면 값이
      무엇이든 그대로 프롬프트에 넣습니다(app/worker.py) — 0.41 이든 0.9 든 같습니다.
      화면이 임계값을 두면 «안 들어간다» 고 해 놓고 그림에는 «믹스견» 이 찍힙니다.
      목의 `uploadWarned` 가 실제로 0.41 을 들고 있는 조합입니다.
    */
    mockStyle(true)
    mockUpload({ code: 'mixed', label: '믹스견', confidence: 0.41 })
    const { container } = renderUpload()
    await uploadPhoto(container)

    expect(await screen.findByText(/믹스견/)).toBeInTheDocument()
  })
})
