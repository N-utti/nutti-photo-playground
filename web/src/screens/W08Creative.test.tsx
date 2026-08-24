/**
 * W-08 · 직접 만들기 (screens/W08Creative.tsx · FR-W08-03 · FR-EDGE-13).
 *
 * 여기서 보는 건 **2중 방어의 이음매**입니다. 화면 필터(`app/promptFilter`)가 첫 겹이고
 * 서버 블로클리스트가 둘째 겹인데, 두 목록은 일부러 다릅니다 — 합치면 방어가 한 겹으로
 * 줄고, 서버가 자기 목록을 바꿔도 화면은 옛 규칙으로 통과시킵니다.
 *
 * 다르다는 건 **화면을 통과하고 서버에서 막히는 문장이 존재한다**는 뜻입니다. 그때
 * 서버 원문(`input_filter_blocked`)을 그대로 띄우면 사용자는 무엇을 고쳐야 할지 알 수
 * 없습니다. 그 격차를 사용자 쪽에서 봉합하는 게 `serverRejection` 이고, 이 파일이
 * 지키는 건 그 봉합입니다.
 *
 * 나머지 하나는 **버튼이 실제로 잠기는가**입니다. 안내 문구만 뜨고 버튼이 눌리면 크레딧이
 * 나갑니다 — 결제 전에 돌려보낸다는 이 겹의 존재 이유가 무너집니다.
 */

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { writeUploadDraft } from '../api/uploadDraft'
import W08Creative from './W08Creative'

/** W-04 에서 사진을 올리고 넘어온 상태를 만듭니다 — 그게 이 화면의 정상 진입입니다. */
function withPhoto() {
  writeUploadDraft({
    styleId: null,
    petId: null,
    upload: {
      upload_id: 'up_01HQZX',
      image_url: 'https://cdn.example.test/up_01HQZX.jpg',
      blocking_issue: null,
      warnings: [],
      breed_estimate: null,
    },
  })
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('W-08 · 직접 만들기', () => {
  it('사진이 없으면 문구부터 받지 않는다', async () => {
    // 사진 없이 문장만 받아 두면 다음 화면에서 «사진을 올려 주세요» 를 다시 만납니다.
    renderWithProviders(<W08Creative />)

    expect(await screen.findByText('사진을 먼저 올려 주세요')).toBeInTheDocument()
    expect(screen.queryByLabelText('우리 애를 무엇으로 만들까요?')).not.toBeInTheDocument()
  })

  it('막히는 문구는 안내를 띄우고 버튼까지 잠근다', async () => {
    /*
      안내만 띄우고 버튼이 살아 있으면 사용자는 그냥 누릅니다. 그러면 서버가 막긴
      하지만 그건 둘째 겹이고, 이 겹이 존재하는 이유(결제 전에 돌려보내기)는
      무너집니다. 문구와 잠금이 **함께** 걸려야 합니다.
    */
    withPhoto()
    const user = userEvent.setup()
    renderWithProviders(<W08Creative />)

    const input = await screen.findByLabelText('우리 애를 무엇으로 만들까요?')
    await user.type(input, '시바견으로 만들어줘')

    expect(await screen.findByRole('alert')).toHaveTextContent('품종을 바꾸는 요청은 만들 수 없어요')
    expect(screen.getByRole('button', { name: /만들기/ })).toBeDisabled()
  })

  it('빈 입력에는 안내를 띄우지 않지만 버튼은 잠겨 있다', async () => {
    /*
      두 조건이 각자 일합니다 — `promptRejectionReason` 은 빈 입력을 «사유 없음» 으로
      보고(입력창에 손도 대기 전에 빨간 글씨가 뜨면 안 됩니다), 버튼 잠금은 화면이
      `!prompt.trim()` 으로 따로 겁니다. 둘 중 하나만 남으면 빈 채로 생성되거나
      멀쩡한 첫 화면이 경고부터 띄웁니다.
    */
    withPhoto()
    renderWithProviders(<W08Creative />)

    await screen.findByLabelText('우리 애를 무엇으로 만들까요?')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /만들기/ })).toBeDisabled()
  })

  it('통과하는 문구면 버튼이 열린다', async () => {
    // 과차단은 조용합니다 — 막힌 사용자는 다시 시도하지 않으므로 아무도 모릅니다.
    withPhoto()
    const user = userEvent.setup()
    renderWithProviders(<W08Creative />)

    await user.type(await screen.findByLabelText('우리 애를 무엇으로 만들까요?'), '눈 오는 날 산책')

    expect(screen.getByRole('button', { name: /만들기/ })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('서버가 막으면 서버 원문 대신 같은 한국어 안내로 답한다', async () => {
    /*
      **이 파일의 핵심입니다.** 화면 필터를 통과하고 서버 블로클리스트에 걸리는 문장이
      실제로 있습니다(두 목록이 일부러 다릅니다). 그때 `input_filter_blocked` 를 그대로
      띄우면 사용자는 무엇을 고쳐야 하는지 알 수 없습니다.

      «크레딧은 차감되지 않았어요» 를 함께 말하는 것도 같은 이유입니다 — 서버가 차감
      **앞에서** 막았다는 사실을 모르면, 막힌 사용자는 돈만 나갔다고 여깁니다.
    */
    withPhoto()
    server.use(
      http.post('*/v1/jobs', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'prompt rejected by input filter',
              detail: { reason: 'input_filter_blocked' },
            },
          },
          { status: 400 },
        ),
      ),
    )

    const user = userEvent.setup()
    renderWithProviders(<W08Creative />)

    // 화면 필터는 통과하는 문장입니다(색상어 단독은 의상 요청이라 허용).
    await user.type(await screen.findByLabelText('우리 애를 무엇으로 만들까요?'), '색깔만 바꿔줘')
    await user.click(screen.getByRole('button', { name: /만들기/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('품종 · 털색을 바꾸는 요청은 만들 수 없어요')
    expect(alert).toHaveTextContent('크레딧은 차감되지 않았어요')
    // 서버 영문 메시지가 새어 나가면 안 됩니다.
    expect(alert).not.toHaveTextContent('input filter')
  })

  it('크레딧이 모자라면 오버레이로 받을 길을 연다', async () => {
    /*
      §4 시나리오3 — 화면을 이동하지 않고 인라인으로 받습니다. 여기서 그냥 에러 문구를
      띄우면 사용자는 방금 쓴 문장을 잃고 크레딧 화면으로 나가야 합니다.
    */
    withPhoto()
    server.use(
      http.post('*/v1/jobs', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INSUFFICIENT_CREDIT',
              message: '크레딧이 부족합니다',
              detail: { required: 2, balance: 0 },
            },
          },
          { status: 402 },
        ),
      ),
    )

    const user = userEvent.setup()
    renderWithProviders(<W08Creative />)

    await user.type(await screen.findByLabelText('우리 애를 무엇으로 만들까요?'), '눈 오는 날 산책')
    await user.click(screen.getByRole('button', { name: /만들기/ }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('서버가 알려 준 비용이 2 가 아니면 버튼 라벨까지 그 값으로 정정한다', async () => {
    /*
      커스텀 비용은 서버 설정(`app_setting.custom_prompt_credit_cost`)이고 이 화면은
      그 값을 읽을 경로가 없습니다(이슈 #149) — 그래서 2 를 적어 두고 시작합니다.
      402 의 `required` 가 실제 값을 알려 주는 **유일한 순간**입니다.

      오버레이만 고치면 «3 크레딧이 필요해요» 를 읽고 크레딧을 받아 돌아온 사용자가
      여전히 «만들기 · 2 크레딧» 을 누릅니다 — 서버가 방금 정정해 준 숫자를 화면이
      계속 부인하는 셈이고, 그러면 정정의 값이 절반으로 줄어듭니다.
    */
    withPhoto()
    server.use(
      http.post('*/v1/jobs', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INSUFFICIENT_CREDIT',
              message: '크레딧이 부족합니다',
              detail: { required: 3, balance: 1 },
            },
          },
          { status: 402 },
        ),
      ),
    )

    const user = userEvent.setup()
    renderWithProviders(<W08Creative />)

    await user.type(await screen.findByLabelText('우리 애를 무엇으로 만들까요?'), '눈 오는 날 산책')
    // 배우기 전에는 추정치입니다 — 그 자체는 틀린 게 아니라 아직 모르는 상태입니다.
    expect(screen.getByRole('button', { name: '만들기 · 2 크레딧' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '만들기 · 2 크레딧' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toHaveTextContent('3 크레딧이 필요한데')
    expect(await screen.findByRole('button', { name: '만들기 · 3 크레딧' })).toBeInTheDocument()
  })
})
