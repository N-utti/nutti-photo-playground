/**
 * W-03 스타일 상세 시트의 예시 캐러셀 (screens/W03StyleDetail.tsx).
 *
 * 막으려는 결함: 예시가 0 장일 때 라이브 영역이 "적용 예시 1 / 0" 을 읽었습니다.
 * 0 장인데 1 번째라는, 있지도 않은 사진을 세는 말입니다. 트랙은 높이 0 으로 접혀
 * **화면에는 아무 변화가 없으니** 눈으로 보는 QA 로는 영영 안 걸립니다 —
 * 스크린리더에게만 보이는 결함이라 단언으로 잡아 둡니다.
 *
 * 0 장은 예외 상황이 아닙니다. `examples[]` 는 서버가 `example_keys` 로 만드는데
 * (app/routers/styles.py) 시드 스크립트가 그 키를 채우지 않으므로(scripts/seed_styles.py)
 * 지금 실서버의 스타일은 **전부** 0 장입니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W03StyleDetail from './W03StyleDetail'

function mockDetail(examples: string[], code = 'lego-minifig') {
  server.use(
    http.get('*/v1/styles/:styleId', () =>
      HttpResponse.json({
        id: 101,
        code,
        name: '레고 미니피겨',
        credit_cost: 1,
        examples,
        fit_tags: [],
        avg_duration_seconds: 24,
        output_count: 1,
      }),
    ),
  )
}

/** 시트는 `useParams()` 로 styleId 를 읽으므로 매칭되는 라우트가 있어야 섭니다. */
function renderSheet() {
  return renderWithProviders(
    <Routes>
      <Route path="/styles/:styleId" element={<W03StyleDetail />} />
    </Routes>,
    { route: '/styles/101' },
  )
}

const example = (n: number) => `https://cdn.example.test/example-${n}.jpg`

describe('W-03 예시 캐러셀', () => {
  it('예시가 없으면 장수를 세지 않는다', async () => {
    mockDetail([])
    renderSheet()

    // 시트 본문이 떴는지 먼저 확인 — 스켈레톤을 보고 통과하면 아무것도 검증 못 합니다.
    expect(await screen.findByRole('heading', { name: '레고 미니피겨' })).toBeInTheDocument()
    expect(screen.queryByText(/적용 예시/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('한 장뿐이면 넘길 곳이 있는 척하지 않는다', async () => {
    mockDetail([example(1)])
    renderSheet()

    expect(await screen.findByRole('img', { name: '레고 미니피겨 적용 예시 1' })).toBeInTheDocument()
    // 점 하나짜리 페이저도, "1 / 1" 안내도 넘길 곳이 있다는 거짓말입니다.
    expect(screen.queryByText(/적용 예시 1 \/ 1/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '예시 1' })).not.toBeInTheDocument()
  })

  it('여러 장이면 현재 위치와 전체 장수를 읽어 준다', async () => {
    mockDetail([example(1), example(2), example(3)])
    renderSheet()

    expect(await screen.findByText('적용 예시 1 / 3')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^예시 \d$/ })).toHaveLength(3)
  })
})

/**
 * 이름이 그림에 인쇄되는 스타일의 예고 (PR #98 · app/petNameStyles.ts).
 *
 * 이 시트는 «이 스타일로 만들기» 직전의 마지막 설명 자리입니다. 재사용 경로에서는
 * 여기서 W-04 확인 단계까지 한 번에 넘어가므로(FR-W06-07), 여기서 안 말하면 이름이
 * 박힌다는 사실을 처음 보는 곳이 결과 화면이 됩니다.
 */
describe('W-03 · 이름이 들어가는 스타일 예고', () => {
  it('해당 스타일이면 어떤 이름이 인쇄되는지 말한다', async () => {
    mockDetail([], '식빵')
    renderSheet()

    // 정확 일치로 봅니다 — 정규식이면 강조 span 과 그걸 감싼 p 가 함께 걸립니다.
    expect(await screen.findByText('아이 이름이 그림에 들어갑니다')).toBeInTheDocument()
    expect(screen.getByText(/«우리 아이» 가 인쇄됩니다/)).toBeInTheDocument()
  })

  it('그 밖의 스타일에서는 없는 말을 하지 않는다', async () => {
    mockDetail([], '찜질방')
    renderSheet()

    expect(await screen.findByRole('heading', { name: '레고 미니피겨' })).toBeInTheDocument()
    expect(screen.queryByText(/이름이 그림에 들어갑니다/)).not.toBeInTheDocument()
  })
})
