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

import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    inputs: null,
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

function succeededJob(): Job {
  const at = new Date(Date.now() - 30_000).toISOString()
  return {
    ...failedJob('GENERATION_FAILED'),
    status: 'succeeded',
    queued_at: at,
    started_at: at,
    progress: 100,
    eta_seconds: 0,
    // Q4 확정으로 1요청 1장 — 배열이지만 길이는 항상 1입니다.
    results: [{ index: 0, image_url: 'https://cdn.example.test/result_01HQZX.jpg' }],
    error_code: null,
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

      `find` 로 기다리는 이유: 스타일 입력 스키마(`GET /v1/styles/{id}`)가 도착하기
      전까지 버튼이 «옵션 불러오는 중…» 으로 잠깁니다(이슈 #127 · W06Result Regenerate).
      스키마를 모르는 채 누르면 고른 값이 빠진 요청이 나가기 때문입니다.
    */
    expect(await screen.findByRole('button', { name: /다시 시도/ })).toHaveAccessibleName(
      /1 크레딧/,
    )
    // 원본을 그대로 보여 줍니다 — 사진을 다시 올리게 하지 않는다는 표시입니다.
    expect(screen.getByAltText('업로드한 사진')).toBeInTheDocument()
  })
})

/**
 * 두 번째 갈래 — **결과를 자르지 않는가** (백엔드 #110 착지분).
 *
 * jsdom 은 레이아웃을 안 돌리므로 실제 잘림은 못 봅니다. 대신 자르기를 만드는 두
 * 조건(고정 비율 프레임 + `object-cover`)이 결과 이미지에 다시 붙는 것을 막습니다.
 * 이건 눈으로 잡기 어려운 종류의 회귀입니다: 목이 정사각 결과를 주던 동안에는
 * `aspect-square` 가 붙어 있어도 화면이 멀쩡해 보였고, 실제로 그렇게 지내 왔습니다.
 * 목을 3:4 로 바꿔 둔 지금도 «조금 커 보이는 사진» 과 «위아래가 잘린 사진» 은
 * 스크린샷으로 구분되지 않습니다 — 잘린 쪽에 이름이 인쇄돼 있는데도요.
 */
describe('W-06 · 결과 프레임', () => {
  it('결과 이미지를 고정 비율로 자르지 않는다', async () => {
    renderResult(succeededJob())

    const result = await screen.findByAltText('변환 결과')
    // 프레임 높이는 이 한 장이 만듭니다 — 채워 넣는 이미지가 아니라 흐름 안의 요소.
    expect(result).not.toHaveClass('object-cover')
    expect(result).not.toHaveClass('absolute')

    const frame = result.parentElement
    expect(frame).not.toBeNull()
    expect(frame?.className).not.toMatch(/\baspect-/)
  })

  it('겹쳐 놓는 원본 쪽은 계속 프레임에 맞춰 자른다', async () => {
    /*
      두 장을 같은 틀에 겹쳐야 «같은 자리 비교» 가 성립합니다. 원본까지 제 비율대로
      두면 슬라이더 아래에서 두 사진이 어긋나 버립니다. 잘려도 되는 쪽은 이미 손에
      있는 원본이지 방금 크레딧을 쓰고 받은 결과가 아닙니다.
    */
    renderResult(succeededJob())

    expect(await screen.findByAltText('원본')).toHaveClass('object-cover')
  })

  /*
    프레임 높이를 결과 이미지에 맡긴 대가입니다 — 그 한 장이 안 오면 높이가 0 이 되고,
    겹쳐 놓은 원본(`absolute inset-0`)까지 같이 사라집니다. 정사각 프레임 시절에는
    결과가 깨져도 원본은 보였으니, 이건 위 두 테스트가 지키는 결정이 **끌고 들어온**
    회귀입니다. 그래서 같은 갈래에 둡니다: 위 둘을 지키려다 이걸 깨면 안 됩니다.
  */
  it('결과 이미지를 못 받아 오면 원본과 다시 불러올 길이 남는다', async () => {
    renderResult(succeededJob())

    // jsdom 은 이미지를 실제로 받지 않으므로 실패를 직접 만들어 줍니다.
    fireEvent.error(await screen.findByAltText('변환 결과'))

    expect(screen.getByText('결과 이미지를 불러오지 못했어요')).toBeInTheDocument()
    // 사진이 전부 사라지면 «돈만 나가고 사진도 잃었다» 로 읽힙니다.
    expect(screen.getByAltText('업로드한 사진')).toBeInTheDocument()
  })

  it('다시 불러오기는 크레딧을 쓰지 않고 그 자리를 되돌린다', async () => {
    /*
      옆에 있는 «다시 만들기» 는 새 job 이고 크레딧이 나갑니다. 못 받아 온 이유가
      연결 문제였다면 그 값을 낼 이유가 없습니다 — 이 버튼이 그 구분입니다.
    */
    const user = userEvent.setup()
    renderResult(succeededJob())

    fireEvent.error(await screen.findByAltText('변환 결과'))
    await user.click(screen.getByRole('button', { name: '다시 불러오기' }))

    expect(await screen.findByAltText('변환 결과')).toBeInTheDocument()
    expect(screen.queryByText('결과 이미지를 불러오지 못했어요')).not.toBeInTheDocument()
  })
})

/**
 * 세 번째 갈래 — **저장이 거짓말하지 않는가**.
 *
 * 공유 패널의 미리보기는 저장할 그 파일과 같은 URL 입니다(PR #73 — 서버는 공유용
 * 사본을 만들지 않습니다). 그러니 미리보기가 안 떴다는 건 «저장을 눌러도 실패한다»
 * 는 뜻이고, 그건 누르기 전에 알 수 있는 사실입니다. 그냥 두면 `saveImage` 의
 * 폴백이 새 탭을 열고 화면은 «길게 눌러 저장해 주세요» 라고 안내합니다 — 사용자는
 * 시키는 대로 하다가 저장할 게 없다는 걸 알게 됩니다(app/saveImage.test.ts 가
 * 그 갈래를 따로 봅니다).
 */
describe('W-06 · 공유 패널', () => {
  it('공유 이미지가 안 뜨면 저장을 권하지 않는다', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`*/v1/jobs/${JOB_ID}/share`, () =>
        HttpResponse.json({ share_image_url: 'https://cdn.example.test/result_01HQZX.jpg' }),
      ),
    )
    renderResult(succeededJob())

    await user.click(await screen.findByRole('button', { name: '인스타 공유' }))
    fireEvent.error(await screen.findByAltText('저장할 결과 이미지'))

    expect(screen.getByText('이미지를 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이미지 저장' })).toBeDisabled()
    // 볼 그림이 없는데 «저장해서 올려 주세요» 는 안내가 아니라 딴소리입니다.
    expect(screen.queryByText(/저장해서 인스타그램에 올려 주세요/)).not.toBeInTheDocument()
  })
})
