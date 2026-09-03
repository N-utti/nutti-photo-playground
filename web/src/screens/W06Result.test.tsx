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

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberDeletedJobs } from '../app/deletedResults'
import { kakaoExternalOpenUrl } from '../app/inAppBrowser'
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
    breed: null,
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
 * 세 번째 갈래 — **버튼이 한 번에 끝까지 가는가**.
 *
 * 예전에는 「인스타 공유」가 아래에 패널을 펼치고 진짜 동작(저장·공유 시트)이 그 안에
 * 한 번 더 있었습니다. 즉 두 번 눌러야 했고 첫 클릭의 성과는 «화면이 길어졌다» 뿐이라,
 * 결과 화면에서 가장 짧아야 할 두 동선에 계단이 하나씩 끼어 있었습니다. 여기서 세는
 * 것은 문구가 아니라 **한 번의 클릭이 파일까지 닿는가** 입니다 — 중간 패널이 되살아나면
 * 이 테스트들이 먼저 깨집니다.
 *
 * `POST /jobs/{id}/share` 는 계속 지납니다. 지금 응답은 결과 URL 과 같지만(PR #73)
 * 인스타 전용 합성이 생기면 값이 갈라질 자리가 거기라(api/types.ts ShareResult),
 * `results[0].image_url` 을 질러 쓰면 그날 조용히 다른 파일이 저장됩니다.
 */
describe('W-06 · 저장·공유 버튼', () => {
  const SHARE_URL = 'https://cdn.example.test/result_01HQZX.jpg'

  function mockShare() {
    server.use(
      http.post(`*/v1/jobs/${JOB_ID}/share`, () =>
        HttpResponse.json({ share_image_url: SHARE_URL }),
      ),
    )
  }

  it('「이미지 저장」 한 번이 share 를 지나 파일까지 간다', async () => {
    /*
      클릭 하나로 두 가지가 일어나야 합니다: share 왕복(주소 확보)과 그 주소의 fetch.
      둘 중 하나라도 빠지면 «저장했다» 는 말만 남습니다 — 실제 저장은 `saveImage` 가
      blob 앵커로 하고(app/saveImage.test.ts 가 그쪽을 봅니다) 여기서는 이 화면이
      그 함수까지 도달하는지만 셉니다.
    */
    const user = userEvent.setup()
    let sharePosts = 0
    let imageFetches = 0
    server.use(
      http.post(`*/v1/jobs/${JOB_ID}/share`, () => {
        sharePosts += 1
        return HttpResponse.json({ share_image_url: SHARE_URL })
      }),
      http.get(SHARE_URL, () => {
        imageFetches += 1
        return HttpResponse.arrayBuffer(new Uint8Array([255, 216, 255]).buffer, {
          headers: { 'Content-Type': 'image/jpeg' },
        })
      }),
    )
    renderResult(succeededJob())

    await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

    await waitFor(() => expect(imageFetches).toBe(1))
    expect(sharePosts).toBe(1)
    // 중간에 «공유 패널» 을 펼치고 거기서 다시 누르게 하지 않습니다.
    expect(screen.queryByAltText('저장할 결과 이미지')).not.toBeInTheDocument()
  })

  it('서버가 이미지를 못 주면 저장했다고 말하지 않는다', async () => {
    /*
      만료된 서명 URL·파기된 파일이 여기로 옵니다. `saveImage` 는 응답이 온 실패와
      응답 자체가 없는 실패를 갈라 돌려주는데(전자는 새 탭을 열어도 오류 페이지),
      화면이 그 구분을 무시하고 «길게 눌러 저장하세요» 라고 하면 사용자는 오류
      페이지를 누르고 있게 됩니다.
    */
    const user = userEvent.setup()
    mockShare()
    server.use(http.get(SHARE_URL, () => new HttpResponse(null, { status: 404 })))
    renderResult(succeededJob())

    await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    )
    expect(screen.queryByText(/길게 눌러 저장/)).not.toBeInTheDocument()
  })

  it('iOS 에서는 「이미지 저장」이 시트로 간다 — 갤러리에 넣는 유일한 길', async () => {
    /*
      iOS 에서 blob 다운로드는 사진 앱이 아니라 파일 앱으로 떨어집니다. 저장 버튼이
      공유 시트를 열어야(시트의 「이미지 저장」) 갤러리에 들어갑니다. 저장 의도이므로
      공유 버튼과 달리 text 를 싣지 않습니다 — 실으면 시트에서 카톡을 고른 사람의
      입력창에 홍보 문구가 미리 채워집니다.
    */
    const user = userEvent.setup()
    const restoreUa = withUserAgent(UA_IOS_SAFARI)
    const sheet = withFileSheet()
    mockShare()
    countImageFetches()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

      await waitFor(() => expect(sheet.shared).toHaveLength(1))
      expect(sheet.shared[0].files?.[0]).toBeInstanceOf(File)
      expect(sheet.shared[0]).not.toHaveProperty('text')
    } finally {
      sheet.restore()
      restoreUa()
    }
  })

  it('데스크톱은 시트가 파일까지 돼도 「이미지 저장」이 다운로드다 — Windows 크롬·macOS 사파리가 이 모양', async () => {
    /*
      `canShare({files})` 는 데스크톱에서도 true 가 됩니다. 거기서 시트를 열면 Windows
      공유 창에는 «저장» 항목이 없어 저장 버튼이 저장을 못 하게 됩니다(리뷰 2026-09-03).
      갤러리 문제는 iOS 만의 것이라 `saveViaShareSheet` 가 iOS 에서만 시트를 씁니다.
    */
    const user = userEvent.setup()
    const sheet = withFileSheet() // jsdom UA 는 데스크톱
    mockShare()
    const fetches = countImageFetches()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

      await waitFor(() => expect(fetches()).toBe(1))
      expect(sheet.shared).toHaveLength(0)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally {
      sheet.restore()
    }
  })

  it('파일 공유가 되는 브라우저에서는 「공유」가 OS 공유 시트로 이미지를 넘긴다', async () => {
    /*
      인스타그램은 웹에서 대신 게시할 수 없어서, 모바일에서 게시물/스토리로 가는 가장 짧은
      길은 Web Share API 로 **파일**을 넘기는 것입니다(app/shareImage.ts). blob 을 File 로
      감싸 share 에 넘겨야 하고, URL 만 넘기면 인스타는 공유 대상에 뜨지 않습니다.
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
    mockShare()
    server.use(
      http.get(SHARE_URL, () =>
        HttpResponse.arrayBuffer(new Uint8Array([255, 216, 255]).buffer, {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      ),
    )
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))

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

  /**
   * 파일 공유가 되는 브라우저를 세우고, `navigator.share` 의 동작만 갈아끼웁니다.
   * 아래 세 갈래는 전부 여기서만 갈립니다 — 화면·목은 같습니다.
   */
  function withShareSheet(share: () => void | Promise<void>): () => void {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => share() })
    return () => {
      delete (navigator as { canShare?: unknown }).canShare
      delete (navigator as { share?: unknown }).share
    }
  }

  function countImageFetches(): () => number {
    let fetches = 0
    server.use(
      http.get(SHARE_URL, () => {
        fetches += 1
        return HttpResponse.arrayBuffer(new Uint8Array([255, 216, 255]).buffer, {
          headers: { 'Content-Type': 'image/jpeg' },
        })
      }),
    )
    return () => fetches
  }

  it('활성화 창이 지나 시트가 거절되면 다시 누르라 하고, 그 두 번째는 사진을 다시 받지 않는다', async () => {
    /*
      `navigator.share()` 는 사용자 제스처의 **활성화 창 안에서** 불려야 하는데 파일 받기가
      그 앞에 있습니다(app/shareImage.ts). 회선이 느리면 WebKit 이 `NotAllowedError` 로
      거절하는데, 그걸 `failed` 로 접으면 화면은 «저장한 뒤 올려 주세요» 라고 말합니다 —
      사진은 이미 손에 있고 한 번 더 누르면 되는 사람을 다른 길로 보내는 겁니다.

      그래서 **두 번째 탭에서 `imageFetches` 가 그대로 1 인지까지** 봅니다. 안내가 「한 번
      더 눌러 주세요」인데 그 두 번째도 같은 왕복을 다시 하면 같은 이유로 또 거절당하고,
      안내 자체가 거짓말이 됩니다. 이 확률은 PR #215(`no-store` — 캐시 히트 0)와
      PR #213(품질 92·4:4:4 — 파일이 커짐)이 함께 올려놨습니다.
    */
    const user = userEvent.setup()
    let shareCalls = 0
    const restore = withShareSheet(() => {
      shareCalls += 1
      if (shareCalls === 1) throw new DOMException('user gesture required', 'NotAllowedError')
    })
    mockShare()
    const imageFetches = countImageFetches()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '공유 시트가 열리기 전에 닫혔어요 — 한 번 더 눌러 주세요.',
      )
      expect(imageFetches()).toBe(1)

      await user.click(screen.getByRole('button', { name: '공유' }))

      await waitFor(() => expect(shareCalls).toBe(2))
      // 캐시에서 바로 갑니다. 여기가 2 가 되면 위 안내가 지킬 수 없는 약속이 됩니다.
      expect(imageFetches()).toBe(1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('시트를 그냥 닫은 것은 실패가 아니라 아무 말도 하지 않는다', async () => {
    /*
      `AbortError` 는 사용자가 «취소» 를 누른 것입니다. 여기에 안내를 띄우면 방금 스스로
      그만둔 사람에게 뭔가 잘못됐다고 말하는 셈입니다.
    */
    const user = userEvent.setup()
    const restore = withShareSheet(() => {
      throw new DOMException('share canceled', 'AbortError')
    })
    mockShare()
    countImageFetches()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))

      await waitFor(() =>
        expect(screen.getByRole('button', { name: '공유' })).not.toBeDisabled(),
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      restore()
    }
  })

  it('사진을 못 받으면 저장해서 올리라고 한다', async () => {
    /*
      활성화 만료와 갈라 두는 쪽입니다 — 사진이 손에 없으니 다시 눌러도 같은 자리에서
      막힙니다. 라이브에서 이 갈래를 만들던 게 PR #215 가 고친 CORS 캐시 오염이고,
      서버가 못 주는 경우(만료된 서명·지워진 파일)도 여기로 옵니다.
    */
    const user = userEvent.setup()
    const restore = withShareSheet(() => undefined)
    mockShare()
    server.use(http.get(SHARE_URL, () => new HttpResponse(null, { status: 404 })))
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '공유 시트를 열지 못했어요 — 「이미지 저장」으로 저장한 뒤 올려 주세요.',
      )
    } finally {
      restore()
    }
  })

  it('OS 시트가 없는 브라우저에서도 「공유」는 같은 자리에 있고, 누르면 자체 공유 시트가 뜬다', async () => {
    /*
      jsdom 기본값이 곧 데스크톱입니다(`navigator.share` 없음). 예전엔 이 자리가
      «인스타그램 열기» 링크였는데, 카톡 웹뷰에서 그걸 본 사용자가 «공유가 왜 없냐» 로
      읽었습니다(2026-09-03). 버튼은 어디서나 같고 갈리는 건 누른 뒤입니다 — OS 시트가
      없으면 인스타 열기·링크 복사를 담은 자체 시트(인앱 웹뷰에서만 외부 브라우저 열기가
      더해짐). 카톡 보내기는 앱 키 없는 sharer 주소가 401 이라 없습니다.
    */
    const user = userEvent.setup()
    mockShare()
    renderResult(succeededJob())

    expect(screen.queryByRole('link', { name: '인스타그램 열기' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: '공유' }))

    expect(await screen.findByRole('dialog', { name: '공유' })).toBeInTheDocument()
    // 카카오톡 보내기는 없습니다 — SDK 없는 sharer 주소는 앱 키 없이 401(2026-09-03 실측).
    expect(screen.queryByRole('link', { name: /카카오톡/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /인스타그램 열기/ })).toHaveAttribute(
      'href',
      'https://www.instagram.com/',
    )
    expect(screen.getByRole('button', { name: '이미지 링크 복사' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /외부 브라우저/ })).not.toBeInTheDocument()
  })

  it('파일은 못 넘기지만 navigator.share 는 있는 브라우저에서는 「공유」가 이미지 링크를 OS 시트로 넘긴다', async () => {
    /*
      일부 웹뷰가 이 모양입니다 — 시트는 있는데 파일은 못 받습니다. 파일 갈래(`files`)
      로 취급하면 canShare 가 거절해 «failed» 가 되고, 시트 없음(`none`)으로 취급하면
      되는 OS 시트를 안 씁니다. 가운데 갈래(`link`)가 있어야 합니다.
    */
    const user = userEvent.setup()
    const shared: ShareData[] = []
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push(data)
      },
    })
    mockShare()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))

      await waitFor(() => expect(shared).toHaveLength(1))
      expect(shared[0].url).toBe(SHARE_URL)
      expect(shared[0].files).toBeUndefined()
      expect(shared[0].text).toMatch(/@nutti_official/)
    } finally {
      delete (navigator as { share?: unknown }).share
    }
  })

  // ---- 인앱 웹뷰 갈래 (app/inAppBrowser.ts) — 실제 UA 에서 따온 값들 ----
  const UA_IOS_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'
  const UA_KAKAO_ANDROID =
    'Mozilla/5.0 (Linux; Android 15; SM-S938N Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 Chrome/137.0.7151.61 Mobile Safari/537.36 KAKAOTALK/25.4.3 (INAPP)'
  const UA_KAKAO_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.8.0 (INAPP)'
  const UA_INSTAGRAM_ANDROID =
    'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 Instagram 334.0.0.42.95 Android'
  const UA_INSTAGRAM_IOS_OLD =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 13_7 like Mac OS X) AppleWebKit/605.1.15 Instagram 334.0.0.42.95'

  function withUserAgent(ua: string): () => void {
    const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    return () => spy.mockRestore()
  }

  /** 파일까지 되는 OS 시트를 세우고 payload 를 모읍니다. */
  function withFileSheet(): { shared: ShareData[]; restore: () => void } {
    const shared: ShareData[] = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push(data)
      },
    })
    return {
      shared,
      restore: () => {
        delete (navigator as { canShare?: unknown }).canShare
        delete (navigator as { share?: unknown }).share
      },
    }
  }

  it('카톡 Android 웹뷰(시트 없음)의 「이미지 저장」은 이미지 URL 을 외부 브라우저로 넘긴다', async () => {
    /*
      Android 웹뷰는 navigator.share 가 없고 blob 다운로드도 파일을 안 만듭니다(카톡은
      «다운로드 중» 토스트만). 성공한 척 대신 공식 스킴으로 크롬에 이미지를 엽니다 —
      페이지가 아니라 이미지인 이유는 게스트 세션이 웹뷰에 갇혀 있어서입니다.
    */
    const user = userEvent.setup()
    const restoreUa = withUserAgent(UA_KAKAO_ANDROID)
    mockShare()
    const fetches = countImageFetches()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

      expect(await screen.findByText(/외부 브라우저에 이미지를 열었어요/)).toBeInTheDocument()
      // 웹뷰 안에서 blob 을 받아 봐야 버려집니다 — 받지도 않습니다.
      expect(fetches()).toBe(0)
      expect(screen.queryByText(/저장했어요/)).not.toBeInTheDocument()
    } finally {
      restoreUa()
    }
  })

  it('인스타 Android 웹뷰도 같은 길(인텐트 URL)로 나간다', async () => {
    const user = userEvent.setup()
    const restoreUa = withUserAgent(UA_INSTAGRAM_ANDROID)
    mockShare()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

      expect(await screen.findByText(/외부 브라우저에 이미지를 열었어요/)).toBeInTheDocument()
    } finally {
      restoreUa()
    }
  })

  it('나갈 스킴이 없는 웹뷰(인스타 iOS 구형, 시트 없음)는 안내줄로 물러난다', async () => {
    const user = userEvent.setup()
    const restoreUa = withUserAgent(UA_INSTAGRAM_IOS_OLD)
    mockShare()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

      expect(await screen.findByText(/오른쪽 위 메뉴\(⋯\)/)).toBeInTheDocument()
      expect(screen.queryByText(/외부 브라우저에 이미지를 열었어요/)).not.toBeInTheDocument()
    } finally {
      restoreUa()
    }
  })

  it('시트가 파일까지 되는 카톡 iOS 웹뷰에서는 「이미지 저장」이 kakaotalk:// 가 아니라 시트로 간다', async () => {
    // 가드 순서 — 인앱 여부보다 «시트로 저장이 되는가» 가 먼저입니다. 뒤집으면 iOS 카톡
    // 사용자 전부가 갤러리 대신 크롬으로 튕깁니다.
    const user = userEvent.setup()
    const restoreUa = withUserAgent(UA_KAKAO_IOS)
    const sheet = withFileSheet()
    mockShare()
    countImageFetches()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '이미지 저장' }))

      await waitFor(() => expect(sheet.shared).toHaveLength(1))
      expect(sheet.shared[0].files?.[0]).toBeInstanceOf(File)
      expect(sheet.shared[0]).not.toHaveProperty('text')
      expect(screen.queryByText(/외부 브라우저에 이미지를 열었어요/)).not.toBeInTheDocument()
    } finally {
      sheet.restore()
      restoreUa()
    }
  })

  it('카톡 Android 웹뷰의 「공유」는 자체 시트 맨 위에 외부 브라우저 링크(이미지 URL)를 두고, 인스타 링크는 없다', async () => {
    // 웹뷰 안의 instagram.com 은 인스타 안의 인스타 — 바로 그게 오동작으로 읽힌 버튼입니다.
    const user = userEvent.setup()
    const restoreUa = withUserAgent(UA_KAKAO_ANDROID)
    mockShare()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))

      const dialog = await screen.findByRole('dialog', { name: '공유' })
      const links = within(dialog).getAllByRole('link')
      expect(links[0]).toHaveAccessibleName(/외부 브라우저에서 이미지 열기/)
      expect(links[0]).toHaveAttribute('href', kakaoExternalOpenUrl(SHARE_URL))
      expect(within(dialog).queryByRole('link', { name: /인스타그램 열기/ })).not.toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: '닫기' })).toBeInTheDocument()
    } finally {
      restoreUa()
    }
  })

  it('시트가 없는 브라우저의 「공유」는 share_click 만 세고 share_sheet 는 안 센다', async () => {
    // share_sheet 는 OS 시트의 결과(outcome)를 세는 자리 — 자체 시트에는 그 값이 없습니다.
    const user = userEvent.setup()
    const beacon = vi.spyOn(events, 'track').mockResolvedValue(undefined)
    mockShare()
    try {
      renderResult(succeededJob())

      await user.click(await screen.findByRole('button', { name: '공유' }))
      await screen.findByRole('dialog', { name: '공유' })

      const types = beacon.mock.calls.map(([body]) => body.event_type)
      expect(types.filter((type) => type === 'share_click')).toHaveLength(1)
      expect(types).not.toContain('share_sheet')
    } finally {
      beacon.mockRestore()
    }
  })

  it('게스트에게 보관함으로 가는 길을 남긴다', async () => {
    /*
      계정 연동을 권하던 자리가 예전에는 「저장」 버튼이었습니다(FR-W06-09 · W-06 B).
      그 버튼이 파일 저장으로 바뀌었으므로 거기서 로그인 시트를 띄우면 «이미지 저장»
      을 눌렀는데 로그인을 요구하는 화면이 됩니다. 대신 안내 줄로 옮겼는데, 옮기다
      **잃어버리면** 게스트는 결과가 사라진다는 사실조차 모른 채 화면을 떠납니다.
      목 기본 세션이 게스트입니다(mocks/handlers.ts).
    */
    const user = userEvent.setup()
    renderResult(succeededJob())

    await user.click(await screen.findByRole('button', { name: '로그인' }))

    expect(
      await screen.findByText(/로그인하면 지금 결과가 보관함에 남고/),
    ).toBeInTheDocument()
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

    expect(screen.queryByRole('button', { name: '이미지 저장' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '공유' })).not.toBeInTheDocument()
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
