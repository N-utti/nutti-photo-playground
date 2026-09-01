/**
 * W-07 · 계산기로 넘기기 (screens/W07Calculator.tsx · §2 W-07 · FR-EDGE-10/11).
 *
 * 이 화면의 값어치는 **1단계(견종 40종 그리드)를 건너뛰는 것**입니다. 거기가 이탈이
 * 가장 큰 구간이라, 만들 때 견종을 입력했으면 2단계부터 시작시킵니다.
 *
 * 그래서 틀리는 방향이 둘입니다. 견종을 모르는데 안다고 하면 사용자는 남의 강아지
 * 기준으로 계산된 간식량을 받고, 아는데 모른다고 하면 이 출구가 존재할 이유가
 * 없어집니다. 둘 다 화면은 «정상적으로» 보입니다 — 숫자가 틀렸다는 건 계산기까지
 * 넘어가야 알 수 있고, 거기는 우리 앱이 아닙니다.
 *
 * `api/calculatorLink.test.ts` 가 문구 규칙을 따로 보므로 여기서는 **그 규칙이 화면에
 * 닿는지**와 화면 자신의 네 갈래(쿼리 없음 / 로딩 / 실패 / 성공)를 봅니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W07Calculator from './W07Calculator'

function renderAt(search: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/calculator" element={<W07Calculator />} />
    </Routes>,
    { route: `/calculator${search}` },
  )
}

/** 서버가 주는 계산기 링크 응답. 견종을 아는 정상 케이스입니다. */
function mockLink(overrides: Record<string, unknown> = {}) {
  server.use(
    http.get('*/v1/calculator-link', () =>
      HttpResponse.json({
        calculator_url: 'https://nutti.co.kr/calculator.html?name=콩이&breed=토이푸들&size=소형',
        // Q9 확정(PR #122): 계산기에 코드 체계가 없어 code = label = 한글 견종명입니다.
        breed_code: '토이푸들',
        breed_label: '토이푸들',
        size_label: '소형',
        ...overrides,
      }),
    ),
  )
}

describe('W-07 · 계산기로 넘기기', () => {
  it('견종을 알면 이름을 부르고 2단계부터 시작한다고 말한다', async () => {
    mockLink()
    renderAt('?job_id=job_01HQZX')

    expect(await screen.findByRole('heading', { name: '콩이는 하루 몇 g까지 괜찮을까?' })).toBeInTheDocument()
    expect(screen.getByText('입력한 견종 토이푸들 · 소형 · 2단계부터 시작')).toBeInTheDocument()
  })

  it('입력한 값이라고 밝히고 고칠 수 있다고 말한다', async () => {
    /*
      노트4 — 견종 판별은 부정확할 수 있습니다. 단정하면 신뢰를 잃으므로 출처를 밝히고,
      **넘어가기 전에** 되돌릴 길이 있다는 걸 말합니다. 계산기로 넘어간 뒤에 알려 주면
      이미 우리 앱 밖이라 손쓸 수 없습니다.
    */
    mockLink()
    renderAt('?job_id=job_01HQZX')

    expect(await screen.findByText(/입력한 값이에요/)).toBeInTheDocument()
  })

  it('견종을 모르면 단정하지 않고 1단계부터 시작한다 (FR-EDGE-10)', async () => {
    /*
      견종을 입력하지 않으면 필드가 빈 채로 옵니다. 이때 «푸들» 같은 기본값을
      끼워 넣으면 남의 강아지 기준으로 계산된 간식량이 나갑니다 — 이 앱에서 사람이
      실제로 먹이는 양을 정하는 유일한 숫자라 오차의 비용이 다릅니다.
    */
    mockLink({ breed_code: null, breed_label: null, size_label: null, calculator_url: 'https://nutti.co.kr/calculator.html' })
    renderAt('?job_id=job_01HQZX')

    expect(await screen.findByText('견종을 입력하지 않았어요 · 1단계부터 시작')).toBeInTheDocument()
    // 2단계부터라는 약속을 못 지키므로 «입력한 값» 안내도 없어야 합니다.
    expect(screen.queryByText(/입력한 값이에요/)).not.toBeInTheDocument()
  })

  it('믹스견으로 넘길 때는 «입력한 값» 이라고 하지 않는다 (FR-EDGE-11)', async () => {
    /*
      Q9 확정(PR #122) 뒤 이 응답은 두 사연을 한 값으로 보냅니다 — 사용자가 진짜
      믹스견을 골랐거나, 쓴 견종이 계산기 40종에 없어 서버가 대신 넣었거나. 뒤쪽이면
      «입력한 값» 은 사진 탓이 아닌 것을 사진 탓으로 돌리는 말이고, 그러면
      사용자는 고쳐야 할 자리(계산기 1단계)가 아니라 사진을 다시 찍습니다.
    */
    mockLink({ breed_code: '믹스견', breed_label: '믹스견', size_label: '중형' })
    renderAt('?job_id=job_01HQZX')

    expect(
      await screen.findByText('믹스견 · 중형으로 넘겨요 · 2단계부터 시작'),
    ).toBeInTheDocument()
    expect(screen.getByText('계산기 1단계에서 견종을 직접 고를 수 있어요.')).toBeInTheDocument()
    expect(screen.queryByText(/입력한 값이에요/)).not.toBeInTheDocument()
  })

  it('이름을 모르면 «우리 아이»로 묻는다', async () => {
    // 저장된 강아지가 없는 경우입니다 — 게스트 첫 방문이 정확히 여기입니다.
    mockLink({ calculator_url: 'https://nutti.co.kr/calculator.html?breed=토이푸들&size=소형' })
    renderAt('?job_id=job_01HQZX')

    expect(await screen.findByRole('heading', { name: '우리 아이는 하루 몇 g까지 괜찮을까?' })).toBeInTheDocument()
  })

  it('서버가 준 URL 을 가공하지 않고 그대로 건다', async () => {
    /*
      FR-W07-03 — UTM 까지 서버가 붙여 완성해 줍니다. 화면이 파라미터를 다시 조립하면
      유입 경로 집계가 어긋나고, 그건 «이 출구가 쓸모 있는가» 를 판단할 유일한 근거입니다.
    */
    const url = 'https://nutti.co.kr/calculator.html?name=콩이&breed=토이푸들&utm_source=playground'
    mockLink({ calculator_url: url })
    renderAt('?job_id=job_01HQZX')

    expect(await screen.findByRole('link', { name: '간식량 계산하기 →' })).toHaveAttribute('href', url)
  })

  it('쿼리가 없으면 서버에 묻지 않고, 그래도 길은 막지 않는다', async () => {
    /*
      `pet_id` 도 `job_id` 도 없으면 물어볼 게 없습니다(`useCalculatorLink` 가 비활성).
      요청이 나가는지까지 세는 이유: 쿼리 없이도 요청이 나가면 서버는 무엇을 기준으로
      답해야 할지 몰라 400 을 주고, 화면은 «불러오지 못했어요» 를 띄웁니다 — 실패가
      아닌 상황을 실패로 보여 주는 셈입니다.
    */
    const seen = vi.fn()
    server.use(
      http.get('*/v1/calculator-link', () => {
        seen()
        return HttpResponse.json({})
      }),
    )
    renderAt('')

    expect(await screen.findByText('어떤 강아지인지 알 수 없어요')).toBeInTheDocument()
    expect(seen).not.toHaveBeenCalled()
    // 계산기 자체를 막지는 않습니다 — 1단계부터 하면 됩니다.
    expect(screen.getByRole('link', { name: '사진부터 만들기' })).toBeInTheDocument()
  })

  it('불러오지 못하면 다시 시도할 길을 준다', async () => {
    server.use(
      http.get('*/v1/calculator-link', () =>
        HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 500 }),
      ),
    )
    renderAt('?job_id=job_01HQZX')

    expect(await screen.findByText('계산기 링크를 불러오지 못했어요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('없는 강아지는 «다시 시도» 가 아니라 나가는 길을 준다 (404)', async () => {
    /*
      마이페이지에서 강아지를 지운 뒤 `/calculator?pet_id=` 를 히스토리·북마크로 다시
      여는 자리입니다. 서버는 폴백 없이 **404** 를 주는데(`app/routers/results.py`
      `_not_found`), 그걸 일반 오류로 흘리면 «불러오지 못했어요 · 다시 시도» 가 뜹니다 —
      다시 눌러도 영영 같은 답이고, 화면은 고장 난 것처럼 보입니다. 없어진 건 강아지고,
      계산기는 1단계부터 그대로 쓸 수 있습니다.
    */
    server.use(
      http.get('*/v1/calculator-link', () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Pet or job not found', detail: {} } },
          { status: 404 },
        ),
      ),
    )
    renderAt('?pet_id=b6f9e6b0-0000-4000-8000-000000000404')

    expect(await screen.findByText('그 강아지를 찾을 수 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '계산기 1단계부터 하기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.queryByText('계산기 링크를 불러오지 못했어요.')).not.toBeInTheDocument()
  })
})
