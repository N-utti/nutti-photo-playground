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

import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberDeletedJobs } from '../app/deletedResults'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { events } from '../api/endpoints'
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

  it('파일 공유가 되는 브라우저에서는 「인스타에 올리기」가 OS 공유 시트로 이미지를 넘긴다', async () => {
    /*
      인스타그램은 웹에서 대신 게시할 수 없어서, 모바일에서 게시물/스토리로 가는 가장 짧은
      길은 Web Share API 로 **파일**을 넘기는 것입니다(app/shareImage.ts). 데스크톱(jsdom
      기본)처럼 파일 공유가 안 되면 버튼이 없어야 하고, 되면 blob 을 File 로 감싸 share 에
      넘겨야 합니다 — URL 만 넘기면 인스타는 공유 대상에 뜨지 않습니다.
    */
    const user = userEvent.setup()
    const shared: ShareData[] = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push(data)
      },
    })
    server.use(
      http.post(`*/v1/jobs/${JOB_ID}/share`, () =>
        HttpResponse.json({ share_image_url: 'https://cdn.example.test/result_01HQZX.jpg' }),
      ),
      http.get('https://cdn.example.test/result_01HQZX.jpg', () =>
        HttpResponse.arrayBuffer(new Uint8Array([255, 216, 255]).buffer, {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      ),
    )
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '인스타 공유' }))
      await user.click(await screen.findByRole('button', { name: '인스타에 올리기' }))

      await waitFor(() => expect(shared).toHaveLength(1))
      expect(shared[0].files?.[0]).toBeInstanceOf(File)
      expect(shared[0].files?.[0].name).toBe(`nutti-${JOB_ID}.jpg`)
      expect(shared[0].text).toMatch(/@nutti_official/)
    } finally {
      // 다른 테스트는 «파일 공유 불가» 브라우저를 전제합니다.
      delete (navigator as { canShare?: unknown }).canShare
      delete (navigator as { share?: unknown }).share
    }
  })
})

/**
 * 네 번째 갈래 — **없는 결과를 무엇 탓으로 설명하는가**.
 *
 * 404 하나에 이유가 여럿 겹칩니다: 주소가 틀렸거나, 다른 기기에서 만들었거나, 게스트
 * 세션이 리셋됐거나, **본인이 보관함에서 지웠거나**. 서버는 «없다» 만 말하고 이유는
 * 말하지 않으므로, 마지막 경우를 아는 건 지우기를 누른 이 브라우저뿐입니다
 * (app/deletedResults.ts · 이슈 #152).
 *
 * 구분이 없으면 자기가 지운 사진 앞에서 «주소가 잘못됐거나 다른 기기·브라우저에서
 * 만든 결과일 수 있어요» 를 읽게 됩니다 — 앱이 자기가 한 일을 사용자 환경 탓으로
 * 돌리는 문장이고, 그 사용자는 없는 문제를 찾아 나섭니다.
 */
describe('W-06 · 열 수 없는 결과', () => {
  afterEach(() => {
    // 앱 저장소라 `resetMockState` 밖입니다(app/deletedResults.ts).
    localStorage.removeItem('nutti.deleted-jobs')
  })

  function renderMissing() {
    server.use(
      http.get(`*/v1/jobs/${JOB_ID}`, () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다' }, { status: 404 }),
      ),
    )
    server.use(http.get('*/v1/styles', () => HttpResponse.json({ sections: [] })))

    return renderWithProviders(
      <Routes>
        <Route path="/jobs/:jobId" element={<W06Result />} />
      </Routes>,
      { route: `/jobs/${JOB_ID}` },
    )
  }

  it('이 브라우저가 지운 결과면 그렇다고 말한다', async () => {
    rememberDeletedJobs([JOB_ID])
    renderMissing()

    expect(await screen.findByRole('heading', { name: '삭제한 결과입니다' })).toBeInTheDocument()
  })

  it('지운 적 없는 결과는 예전처럼 «찾을 수 없습니다»로 남는다', async () => {
    // 기록이 없는 404 까지 삭제로 설명하면, 다른 기기에서 만든 결과를 지웠다고
    // 말하게 됩니다 — 사용자는 하지도 않은 일을 했다고 믿습니다.
    rememberDeletedJobs(['some-other-job'])
    renderMissing()

    expect(await screen.findByRole('heading', { name: '결과를 찾을 수 없습니다' })).toBeInTheDocument()
  })
})

/**
 * 지워진 결과가 **404 로 오지 않는** 경우 (이슈 #152 · 백엔드 PR #157).
 *
 * 위 describe 는 404 를 다룹니다. 그런데 백엔드가 확정한 계약은 다릅니다 — 보관함에서
 * 지운 결과의 job 은 **200 · succeeded · `results: []`** 로 오고, 404 가 되는 건
 * `POST /jobs/{id}/share` 뿐입니다(이슈 #152 코멘트). 파기 배치도 오브젝트만 지우고
 * 행은 남기므로(`scripts/purge_deleted.py`) 시간이 지나도 404 로 바뀌지 않습니다.
 *
 * 이 갈래를 안 잡으면 화면이 **«완성» 이라고 말하면서 빈 자리에 저장·공유 버튼을**
 * 띄웁니다. 눌러 봐야 share 가 404 라 아무 일도 안 일어나고, 사용자는 방금 자기가
 * 지운 사진을 두고 앱이 왜 공유를 권하는지 알 수 없습니다. **없는 것은 눈에 띄지
 * 않아서** 화면만 보는 QA 로는 «버튼이 남아 있다» 를 결함으로 알아채기 어렵습니다.
 */
describe('W-06 · 지워진 결과', () => {
  function removedJob(): Job {
    // 서버가 `deleted_at` 인 결과를 빼고 내려주는 모양 그대로입니다. status 는 그대로
    // succeeded 이고 job 재료(style_id·upload_id·credit_cost)도 전부 살아 있습니다.
    return { ...succeededJob(), results: [] }
  }

  /*
    「다시 만들기」는 스타일 스키마가 도착해야 눌립니다(W06Result `schemaPending` —
    칸을 모르는 채 보내면 값이 통째로 빠진 요청이 나가고 크레딧은 이미 나갑니다).
    그 상세를 안 주면 버튼이 «옵션 불러오는 중…» 에 머물러, 이 describe 가 검증하려는
    «출구가 남아 있는가» 를 못 봅니다.
  */
  function mockStyleDetail() {
    server.use(
      http.get('*/v1/styles/:styleId', () =>
        HttpResponse.json({
          id: 8,
          code: '레고',
          name: '레고',
          credit_cost: 1,
          examples: [],
          fit_tags: [],
          avg_duration_seconds: 48,
          output_count: 1,
          uses_pet_name: false,
          uses_breed: false,
          input_fields: [],
        }),
      ),
    )
  }

  it('«완성» 이 아니라 지운 사진이라고 말한다', async () => {
    renderResult(removedJob())

    expect(await screen.findByText('보관함에서 지운 사진이에요')).toBeInTheDocument()
    // 제목이 본문과 다른 말을 하면 안 됩니다 — 지운 사진을 «완성» 이라고 부르는 셈입니다.
    expect(screen.getByRole('heading', { name: '지운 사진' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '완성' })).not.toBeInTheDocument()
  })

  it('없는 결과를 두고 저장·공유를 권하지 않는다', async () => {
    renderResult(removedJob())
    await screen.findByText('보관함에서 지운 사진이에요')

    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '인스타 공유' })).not.toBeInTheDocument()
  })

  it('원본 사진과 «다시 만들기» 는 남긴다', async () => {
    /*
      지운 건 결과물이고 업로드는 그대로입니다. 사진까지 치우면 «돈만 나가고 사진도
      잃었다» 가 되고, 200 이라 재료(`upload_id`·`style_id`·`inputs`)가 전부 손에
      있으므로 **같은 설정으로 다시 만들 수 있습니다** — 404 화면이 못 주는 출구입니다.
    */
    mockStyleDetail()
    renderResult(removedJob())
    await screen.findByText('보관함에서 지운 사진이에요')

    expect(screen.getByRole('img', { name: '업로드한 사진' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /다시 만들기/ })).toBeInTheDocument()
  })

  it('출구 셋(공유·계산기·쇼핑몰)을 늘어놓지 않는다', async () => {
    /*
      그 배치는 «감정 최고점에 모은다» 는 근거 위에 서 있습니다(FR-W06-08 · 노트6).
      지운 사진을 열었더니 «수제간식 보러가기» 가 뜨면, 와이어프레임 콜아웃이 경고한
      바로 그 모양 — 출구가 광고로 읽히는 화면이 됩니다.
    */
    renderResult(removedJob())
    await screen.findByText('보관함에서 지운 사진이에요')

    expect(screen.queryByText('누띠 수제간식 보러가기')).not.toBeInTheDocument()
    expect(screen.queryByText(/간식량 계산하기/)).not.toBeInTheDocument()
  })
})

/**
 * W-06 · 운영이 스타일을 회수한 뒤 (백엔드 PR #182).
 *
 * `DELETE /v1/admin/styles/{id}` 는 물리 삭제가 아니라 `status: retired` 전환이고,
 * `GET /v1/styles/{id}` 는 public·ab 만 답합니다 — 그래서 **이미 만든 job 의 스타일
 * 상세가 404** 가 되는 상태가 생겼습니다. 그전에는 운영이 DB 를 직접 만져야 나오던
 * 상태라 아무도 안 밟았습니다.
 *
 * 이 갈래가 위험한 건 조용해서입니다. `input_fields` 를 못 받으면 옵션 섹션이 통째로
 * 사라지는데(`fields.length > 0 &&`) 버튼은 그대로 남고, 눌러도 `POST /v1/jobs` 가
 * 같은 이유로 404 라 **아무 일도 안 일어납니다.** 화면만 보는 QA 로는 «옵션이 없는
 * 스타일» 과 구별되지 않습니다.
 */
describe('W-06 · 회수된 스타일', () => {
  /** 아직 살아 있는 스타일. 상세가 와야 버튼이 «옵션 불러오는 중…» 에서 풀립니다. */
  function mockStyleAlive() {
    server.use(
      http.get('*/v1/styles/:styleId', () =>
        HttpResponse.json({
          id: 8,
          code: '레고',
          name: '레고',
          credit_cost: 1,
          examples: [],
          fit_tags: [],
          avg_duration_seconds: 48,
          output_count: 1,
          uses_pet_name: false,
          uses_breed: false,
          input_fields: [],
        }),
      ),
    )
  }

  /** 회수분의 상세. 서버는 목록에서 빼는 것과 같은 404 로 답합니다. */
  function mockStyleRetired() {
    server.use(
      http.get('*/v1/styles/:styleId', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '스타일을 찾을 수 없습니다', detail: {} } },
          { status: 404 },
        ),
      ),
    )
  }

  it('재시도가 영영 안 되는 버튼 대신 사진을 살린 출구를 준다', async () => {
    /*
      버튼을 «잠그는» 것으로는 부족합니다 — 회수는 기다린다고 풀리지 않아서, 잠그면
      막다른 길만 남습니다. 업로드는 그대로 살아 있으므로 `from_job` 을 달아 카탈로그로
      보냅니다(그게 없으면 방금 쓴 사진을 다시 올리게 되고 새 upload_id 가 발급돼
      PR #37 이 막아 둔 함정에 그대로 빠집니다).
    */
    mockStyleRetired()
    renderResult(succeededJob())

    const link = await screen.findByRole('link', { name: '이 사진으로 다른 스타일 고르기' })
    expect(link).toHaveAttribute('href', `/styles?from_job=${JOB_ID}`)
    expect(screen.queryByRole('button', { name: /다시 만들기/ })).not.toBeInTheDocument()
  })

  it('버튼이 사라진 이유를 말한다', async () => {
    // 이 화면에서 다른 결과로 가는 경로는 그 버튼 하나뿐이라(이슈 #26) 사라진 것이
    // 눈에 띕니다. 아무 말도 안 하면 사용자는 자기가 뭘 잘못 눌렀다고 생각합니다.
    mockStyleRetired()
    renderResult(succeededJob())

    expect(
      await screen.findByText('이 스타일은 더 이상 제공되지 않아 같은 설정으로는 다시 만들 수 없어요'),
    ).toBeInTheDocument()
  })

  it('스키마를 «지금만» 못 받은 것은 회수와 다르게 다룬다', async () => {
    /*
      5xx·네트워크는 스타일이 살아 있는데 조회만 실패한 것이라 새로고침이 답입니다.
      여기서 카탈로그로 보내면 멀쩡한 재생성 경로를 화면이 스스로 버리는 셈입니다.
      대신 보내지는 못하게 잠급니다 — 칸을 모르는 채 누르면 값이 통째로 빠진 요청이
      나가고 크레딧은 이미 나간 뒤라, `schemaPending` 과 같은 이유입니다.
    */
    server.use(
      http.get('*/v1/styles/:styleId', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: '', detail: {} } },
          { status: 500 },
        ),
      ),
    )
    renderResult(succeededJob())

    const button = await screen.findByRole('button', { name: '옵션을 불러오지 못했어요' })
    expect(button).toBeDisabled()
    expect(
      screen.queryByRole('link', { name: '이 사진으로 다른 스타일 고르기' }),
    ).not.toBeInTheDocument()
  })

  it('열어 둔 사이에 회수됐으면 클릭이 조용히 실패하지 않는다', async () => {
    /*
      상세는 캐시에 있고(10분) 회수는 그 뒤에 일어난 경우입니다. 버튼은 멀쩡히
      활성이고 눌러야 404 를 만납니다 — 그런데 `onError` 가 402 만 보고 있어서
      **아무 일도 안 일어나던** 자리입니다. 서버 문구(`"Job, upload, or style not
      found"`)는 영문인 데다 셋 중 무엇인지도 말해 주지 않아 그대로 옮기지 않습니다.
    */
    mockStyleAlive()
    server.use(
      http.post('*/v1/jobs', () =>
        HttpResponse.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Job, upload, or style not found',
              detail: {},
            },
          },
          { status: 404 },
        ),
      ),
    )
    renderResult(succeededJob())

    await userEvent.click(await screen.findByRole('button', { name: /다시 만들기/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 스타일이나 사진을 더 이상 쓸 수 없어요. 카탈로그에서 다시 골라 주세요.',
    )
    expect(screen.queryByText(/Job, upload, or style not found/)).not.toBeInTheDocument()
  })
})

/**
 * W-06 · **비콘이 job 을 물고 나가는가** (백엔드 PR #177 착지분).
 *
 * `POST /v1/events` 가 501 스텁이던 동안 이 화면의 `track` 은 사실상 빈 호출이었습니다.
 * 이제는 부를 때마다 `metric_event` 한 행이 쌓이고, W-11 운영 콘솔의 «스타일별 성과» 는
 * 그 행에 붙은 `style_id` 로 계산됩니다. 그런데 이벤트 본문에는 스타일이 없습니다 —
 * 서버는 `properties.job_id` 를 읽어 **본인 소유 job 이면** 거기서 스타일을 끌어옵니다.
 *
 * 그래서 여기서 세는 건 화면이 아니라 **나가는 본문**입니다. 이 배선은 눈으로 못 봅니다:
 * 키를 `jobId` 로 고쳐도, 이 속성을 통째로 빼도 요청은 그대로 204 이고 화면도 그대로고,
 * 몇 주 뒤 콘솔에서 스타일 칸이 비어 있는 것으로만 드러납니다. 되살릴 수 없는 종류의
 * 손실이라 코드 쪽에서 막습니다.
 */
describe('W-06 · 결과 조회 비콘', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('result_view 는 job_id 를 달고 나간다 — 그게 스타일을 붙이는 유일한 경로', async () => {
    const beacon = vi.spyOn(events, 'track').mockResolvedValue(undefined)

    renderResult(succeededJob())
    await screen.findByAltText('변환 결과')

    const views = beacon.mock.calls
      .map(([body]) => body)
      .filter((body) => body.event_type === 'result_view')

    expect(views).toEqual([{ event_type: 'result_view', properties: { job_id: JOB_ID } }])
  })
})
