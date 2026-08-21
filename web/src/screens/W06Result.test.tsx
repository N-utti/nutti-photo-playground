/**
 * W-06 · 결과 화면의 실패 표시 (screens/W06Result.tsx · FR-EDGE-01).
 *
 * 화면 전체가 아니라 **실패 패널 한 갈래**만 봅니다. W-06 은 표면적이 가장 넓고
 * (공유 · 재생성 · 계산기 · 쇼핑몰) 폴링만으로도 목 잔액이 움직이는 화면이라, 넓게
 * 잡으면 테스트가 화면보다 부서지기 쉬워집니다. 대신 여기 고른 갈래에는 **실측
 * 크래시 이력**이 있습니다.
 *
 * `error_code` 는 서버 컬럼이 자유 텍스트라 문서에 없는 값이 옵니다. 문구 표를 그냥
 * 인덱싱하면 그 한 값에 결과 화면이 통째로 죽고, 그때 사용자가 보는 건 «돈만 나가고
 * 사진도 잃었다» 입니다 — 크레딧은 이미 자동 반환됐는데도요. 화면이 죽으면 그
 * 사실을 알릴 자리조차 사라집니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { Job } from '../api/types'
import W06Result from './W06Result'

const JOB_ID = 'job_01HQZX'

function failedJob(errorCode: string): Job {
  const at = new Date(Date.now() - 30_000).toISOString()
  return {
    job_id: JOB_ID,
    status: 'failed',
    style_id: 8,
    upload_id: 'up_01HQZX',
    pet_id: null,
    custom_prompt: null,
    // 실패해도 0 이 되지 않습니다 — 반환은 별도 트랜잭션이라 이 값은 그대로입니다.
    credit_cost: 1,
    queued_at: at,
    started_at: at,
    progress: null,
    eta_seconds: null,
    status_message: null,
    source_image_url: 'https://cdn.example.test/up_01HQZX.jpg',
    results: null,
    error_code: errorCode,
  }
}

function renderResult(job: Job) {
  server.use(http.get(`*/v1/jobs/${JOB_ID}`, () => HttpResponse.json(job)))
  // 결과 화면은 계산기 배너와 인기 스타일도 부릅니다 — 이 파일의 주제가 아니라 잠재웁니다.
  server.use(http.get('*/v1/styles', () => HttpResponse.json({ sections: [] })))

  return renderWithProviders(
    <Routes>
      <Route path="/jobs/:jobId" element={<W06Result />} />
    </Routes>,
    { route: `/jobs/${JOB_ID}` },
  )
}

describe('W-06 · 실패한 결과', () => {
  it('모델 오류는 사진 탓을 하지 않는다', async () => {
    renderResult(failedJob('GENERATION_FAILED'))

    expect(await screen.findByText('만들기에 실패했어요')).toBeInTheDocument()
    expect(screen.getByText(/모델 쪽 오류였어요/)).toBeInTheDocument()
  })

  it('안전 필터 차단은 그렇다고 말한다', async () => {
    // 이건 실제로 사진·스타일을 바꿔야 풀리는 실패라, 다른 안내를 해야 합니다.
    renderResult(failedJob('SAFETY_BLOCKED'))

    expect(await screen.findByText('이 사진은 만들 수 없었어요')).toBeInTheDocument()
    expect(screen.getByText(/안전 필터에 걸렸어요/)).toBeInTheDocument()
  })

  it('문서에 없는 오류 코드에도 화면이 죽지 않는다', async () => {
    /*
      **이 파일의 핵심입니다.** `error_code` 는 서버 컬럼이 자유 텍스트라 `JobErrorCode`
      유니온 밖의 값이 실제로 옵니다. 문구 표를 그냥 인덱싱하면 `undefined.title` 에서
      터지고, 결과 화면이 통째로 죽습니다.

      폴백이 `GENERATION_FAILED` 인 이유: 모르는 코드에 대해 우리가 확실히 아는 건
      «만들기가 실패했고 크레딧은 돌아왔다» 뿐입니다. `SAFETY_BLOCKED` 로 폴백하면
      사진 탓이 아닌 실패에 사진 탓을 하게 됩니다.
    */
    renderResult(failedJob('PROVIDER_ERROR'))

    expect(await screen.findByText('만들기에 실패했어요')).toBeInTheDocument()
    // 사진 탓을 하는 문구로 새지 않아야 합니다.
    expect(screen.queryByText('이 사진은 만들 수 없었어요')).not.toBeInTheDocument()
  })

  it('실패해도 크레딧이 돌아왔다는 사실과 다시 시도할 길을 함께 준다', async () => {
    /*
      실패 화면에서 이 두 줄이 빠지면 «돈만 나가고 사진도 잃었다» 가 됩니다. 실제로는
      자동 반환됐고 원본도 남아 있어서 다시 시도하면 됩니다 — 그걸 말해 주는 게
      이 화면이 하는 일의 절반입니다.
    */
    renderResult(failedJob('PROVIDER_ERROR'))

    expect(await screen.findByText('크레딧은 자동으로 돌려드렸어요')).toBeInTheDocument()

    /*
      버튼은 «다시 시도» 옆에 값을 함께 답니다. 그 값은 **이 job 이 실제로 낸 값**
      (`credit_cost`)이라야 합니다 — 실패해도 0 이 되지 않으므로(자동 반환은 트랜잭션만
      쌓습니다) 실패 화면도 같은 값을 말할 수 있습니다. 지어낸 숫자를 쓰면 커스텀(2)과
      프리셋(1)이 섞이는 순간 어긋납니다.
    */
    expect(screen.getByRole('button', { name: /다시 시도/ })).toHaveAccessibleName(/1 크레딧/)
    // 원본을 그대로 보여 줍니다 — 사진을 다시 올리게 하지 않는다는 표시입니다.
    expect(screen.getByAltText('업로드한 사진')).toBeInTheDocument()
  })
})
