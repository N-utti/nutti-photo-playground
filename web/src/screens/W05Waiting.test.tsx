/**
 * W-05 · 생성 대기 (screens/W05Waiting.tsx · FR-EDGE-02).
 *
 * 이 화면이 떠 있는 동안 **크레딧은 이미 나갔습니다.** 그래서 여기서 잘못 판단하면
 * 값이 비쌉니다 — 서버가 잠깐 답을 못 준 것뿐인데 «결과를 불러올 수 없습니다» 로
 * 화면을 헐어 버리면, 사용자는 아직 살아 있는 작업을 포기하고 나갑니다.
 *
 * 반대 방향도 있습니다. 1분을 넘겨 놓고 계속 «거의 다 됐어요» 라고 하면 그건 위로가
 * 아니라 거짓말이고, 사용자는 언제까지 기다려야 할지 모르는 채로 붙잡힙니다.
 *
 * 둘 다 **눈으로 잡기 어렵습니다** — 재현하려면 서버를 일부러 죽이거나 60초를 실제로
 * 기다려야 하고, 그러고도 «지금 화면이 맞는 건가» 를 판단할 기준이 사람 머릿속에만
 * 있습니다. 여기서는 응답 한 줄이면 됩니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import type { Job } from '../api/types'
import W05Waiting from './W05Waiting'

const JOB_ID = 'job_01HQZX'

/** 방금 시작해 절반쯤 진행된 job. `startedSecondsAgo` 로 경과를 조절합니다. */
function processingJob(startedSecondsAgo: number, overrides: Partial<Job> = {}): Job {
  const startedAt = new Date(Date.now() - startedSecondsAgo * 1_000).toISOString()
  return {
    job_id: JOB_ID,
    status: 'processing',
    style_id: 8,
    upload_id: 'up_01HQZX',
    pet_id: null,
    custom_prompt: null,
    credit_cost: 1,
    queued_at: startedAt,
    started_at: startedAt,
    progress: 40,
    eta_seconds: 20,
    status_message: '레고 블록을 쌓는 중…',
    source_image_url: 'https://cdn.example.test/up_01HQZX.jpg',
    results: null,
    error_code: null,
    ...overrides,
  }
}

/** 대기 화면과 결과 라우트를 함께 세웁니다 — 종료 시 어디로 가는지 보려면 둘 다 필요합니다. */
function renderWaiting() {
  return renderWithProviders(
    <Routes>
      <Route path="/jobs/:jobId/waiting" element={<W05Waiting />} />
      <Route path="/jobs/:jobId" element={<h1>결과 화면</h1>} />
    </Routes>,
    { route: `/jobs/${JOB_ID}/waiting` },
  )
}

/** 인기 스타일은 이 화면의 주제가 아니라 «기다리는 동안» 칸입니다. 빈 목록으로 고정합니다. */
function silenceStyles() {
  server.use(http.get('*/v1/styles', () => HttpResponse.json({ sections: [] })))
}

describe('W-05 · 생성 대기', () => {
  it('서버가 준 진행 문구와 남은 초를 그대로 말한다', async () => {
    silenceStyles()
    server.use(http.get(`*/v1/jobs/${JOB_ID}`, () => HttpResponse.json(processingJob(2))))
    renderWaiting()

    // 노트2 — "생성 중"이 아니라 스타일별 문구입니다. 운영이 W-11 에서 관리합니다.
    expect(await screen.findByText('레고 블록을 쌓는 중…')).toBeInTheDocument()
    // 노트1 — 무한 스피너 대신 숫자. 체감 시간이 배로 늘지 않게.
    expect(screen.getByText(/약 \d+초/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '생성 진행률' })).toBeInTheDocument()
  })

  it('60초를 넘기면 «거의 다 됐어요» 를 접고 나가도 된다고 말한다 (FR-EDGE-02)', async () => {
    /*
      실패가 아니라 «정상이지만 오래 걸리는 중» 입니다. 크레딧도 정상 차감이라 되돌릴
      것이 없고, 사용자가 할 수 있는 일은 기다리거나 나가거나 둘뿐입니다. 그래서 이
      시점에 정직하게 권할 수 있는 건 «기다려 주세요» 가 아니라 «나가도 됩니다» 쪽이고,
      「나가서 둘러보기」가 주 버튼으로 올라옵니다.
    */
    silenceStyles()
    server.use(
      http.get(`*/v1/jobs/${JOB_ID}`, () =>
        HttpResponse.json(processingJob(90, { eta_seconds: 0, progress: 99 })),
      ),
    )
    renderWaiting()

    expect(await screen.findByText('예상보다 오래 걸리고 있어요')).toBeInTheDocument()
    expect(screen.queryByText('거의 다 됐어요')).not.toBeInTheDocument()

    // 주 버튼 승격은 색으로 드러납니다 — 평소에는 테두리만 있는 보조 버튼입니다.
    expect(screen.getByRole('link', { name: '나가서 둘러보기' })).toHaveClass('bg-brand')
    // 초과 뒤에는 «나가도 작업은 계속돼요» 안내가 위 박스로 대체됩니다.
    expect(screen.queryByText(/나가도 작업은 계속돼요/)).not.toBeInTheDocument()
  })

  it('아직 60초 전이면 나가도 된다고만 하고 초과 안내는 없다', async () => {
    silenceStyles()
    server.use(http.get(`*/v1/jobs/${JOB_ID}`, () => HttpResponse.json(processingJob(5))))
    renderWaiting()

    expect(await screen.findByText(/나가도 작업은 계속돼요/)).toBeInTheDocument()
    expect(screen.queryByText('예상보다 오래 걸리고 있어요')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '나가서 둘러보기' })).not.toHaveClass('bg-brand')
  })

  it('일시적 서버 오류에는 화면을 헐지 않는다', async () => {
    /*
      **이 파일의 핵심입니다.** 진행 상황을 이미 받아 둔 상태에서 5xx 가 오면 그건
      job 의 상태가 아니라 우리 쪽 사정입니다. 폴링은 그 사이에도 상한 간격으로 계속
      두드리는 중이라 곧 스스로 따라잡습니다.

      여기서 «결과를 불러올 수 없습니다» 로 넘어가면 사용자는 살아 있는 작업을 포기하고
      나가는데, 크레딧은 이미 나간 뒤입니다. 대신 아무 말 없이 멈춘 것처럼 보이지도
      않게 연결 상태를 한 줄로 말합니다.
    */
    silenceStyles()
    let served = 0
    server.use(
      http.get(`*/v1/jobs/${JOB_ID}`, () => {
        served += 1
        // 첫 응답만 성공 — 그 뒤로는 서버가 답을 못 주는 상태입니다.
        if (served === 1) return HttpResponse.json(processingJob(3))
        return HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 503 })
      }),
    )
    renderWaiting()

    await screen.findByText('레고 블록을 쌓는 중…')

    expect(
      await screen.findByText(/연결이 잠시 불안정해요/, undefined, { timeout: 10_000 }),
    ).toBeInTheDocument()
    // 진행 상황은 그대로 남아 있어야 합니다 — 화면이 헐리지 않았다는 증거입니다.
    expect(screen.getByText('레고 블록을 쌓는 중…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /결과를 불러올 수 없습니다/ })).not.toBeInTheDocument()
  }, 15_000)

  it('없는 job 은 다시 물어도 답이 같으므로 안내로 넘긴다', async () => {
    /*
      404 는 5xx 와 성격이 다릅니다 — job 이 없거나 남의 것이라 계속 때려도 답이
      바뀌지 않습니다. 여기서 폴링을 붙들고 있으면 존재하지 않는 주소에서 영원히
      돌고, 그동안 복원 실패 안내(이슈 #5)는 영영 뜨지 않습니다.
    */
    silenceStyles()
    server.use(
      http.get(`*/v1/jobs/${JOB_ID}`, () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
      ),
    )
    renderWaiting()

    expect(await screen.findByRole('heading', { name: '결과를 찾을 수 없습니다' })).toBeInTheDocument()
  })

  it('끝나면 결과 화면이 주인이 된다', async () => {
    silenceStyles()
    server.use(
      http.get(`*/v1/jobs/${JOB_ID}`, () =>
        HttpResponse.json(processingJob(20, { status: 'succeeded', progress: 100, eta_seconds: 0 })),
      ),
    )
    renderWaiting()

    expect(await screen.findByRole('heading', { name: '결과 화면' })).toBeInTheDocument()
  })
})
