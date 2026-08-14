/**
 * W-10 B · 받은 내역 (screens/W10Ledger.tsx · FR-W10-06/07).
 *
 * 여기서 보는 건 표 자체보다 **`app/ledgerFormat` 이 화면에 실제로 닿는가**입니다.
 * 규칙만 따로 테스트하면 «규칙은 맞는데 화면이 그 규칙을 안 쓰는» 상태를 못 잡습니다 —
 * 실제로 한 번 일어난 일이 그 모양이었습니다(`safety_block_refund` 가 라벨 표에 없어
 * 표에 영문 코드가 찍힘). 시드가 그 사유를 포함하고 있어 통합 확인이 공짜입니다.
 *
 * 이 화면을 고른 또 하나의 이유는 **아무 상태도 바꾸지 않는다**는 것입니다. 목록을
 * 읽기만 하므로 뒤따르는 테스트에 아무것도 남기지 않습니다.
 */

import { screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import W10Ledger from './W10Ledger'

/** 표 본문에서 사유가 `label` 인 줄을 찾습니다. */
function rowFor(label: string): HTMLElement {
  return screen.getByRole('cell', { name: label }).closest('tr') as HTMLElement
}

describe('W-10 B · 받은 내역', () => {
  it('시드 내역을 사유 라벨과 함께 표로 보여 준다', async () => {
    renderWithProviders(<W10Ledger />)

    // 스켈레톤이 아니라 실제 표가 떴는지부터 — 로딩을 보고 통과하면 아무것도 검증 못 합니다.
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '생성' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '주문 확인' })).toBeInTheDocument()
  })

  it('안전 차단 반환을 영문 코드가 아니라 한국어로 적는다', async () => {
    /*
      이 줄이 이 파일의 이유입니다. 서버가 사유를 하나 늘렸는데 `ledgerFormat` 의 표에
      안 넣으면 사용자는 표에서 `safety_block_refund` 를 보게 됩니다. 눈으로 잡으려면
      그 사유가 실제로 발생한 계정으로 내역을 열어야 합니다.
    */
    renderWithProviders(<W10Ledger />)

    expect(await screen.findByRole('cell', { name: '안전 차단 반환' })).toBeInTheDocument()
    expect(screen.queryByText('safety_block_refund')).not.toBeInTheDocument()
  })

  it('차감은 빼기 기호와 danger 색으로, 지급은 + 로 적는다', async () => {
    renderWithProviders(<W10Ledger />)
    await screen.findByRole('table')

    const amount = within(rowFor('생성')).getByText('−1')

    // 하이픈이 아니라 U+2212 — tabular-nums 에서 숫자 열이 흔들리지 않게 하는 규칙입니다.
    expect(amount.textContent?.codePointAt(0)).toBe(0x2212)
    expect(amount).toHaveClass('text-danger')

    expect(within(rowFor('주문 확인')).getByText('+20')).toHaveClass('text-good')
  })

  it('참조 라벨이 없는 줄은 빈칸이 아니라 — 로 채운다', async () => {
    /*
      «매일 무료» 처럼 주문번호가 없는 줄입니다. 빈칸으로 두면 열이 밀린 것처럼 보여
      데이터가 빠졌다는 오해를 부릅니다.
    */
    renderWithProviders(<W10Ledger />)
    await screen.findByRole('table')

    expect(within(rowFor('매일 무료')).getByText('—')).toBeInTheDocument()
  })

  it('내역이 없으면 빈 상태를 말한다', async () => {
    server.use(http.get('*/v1/credits/ledger', () => HttpResponse.json({ items: [], next_cursor: null })))
    renderWithProviders(<W10Ledger />)

    expect(await screen.findByText('아직 받은 내역이 없어요.')).toBeInTheDocument()
    // 표를 빈 헤더만 남겨 두면 «불러오는 중» 처럼 보입니다.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('불러오지 못하면 다시 시도할 길을 준다', async () => {
    server.use(http.get('*/v1/credits/ledger', () => HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 500 })))
    renderWithProviders(<W10Ledger />)

    expect(await screen.findByText('내역을 불러오지 못했어요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    // 실패를 «내역 없음» 으로 뭉개면 «받은 게 없다» 는 거짓말이 됩니다.
    expect(screen.queryByText('아직 받은 내역이 없어요.')).not.toBeInTheDocument()
  })

  it('다음 페이지가 있을 때만 «더 보기» 를 낸다', async () => {
    /*
      목 기본값은 `next_cursor: null` 이라 버튼이 없습니다. 커서가 있을 때만 나오는지
      확인하려면 응답을 덮어써야 합니다 — 없는 페이지를 부르는 버튼이 남아 있으면
      누를 때마다 같은 목록을 다시 받습니다.
    */
    renderWithProviders(<W10Ledger />)
    await screen.findByRole('table')
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()

    server.use(
      http.get('*/v1/credits/ledger', () =>
        HttpResponse.json({
          items: [{ reason: 'daily_free', ref_label: null, occurred_on: '2026-08-01', amount: 1 }],
          next_cursor: 'cursor_2',
        }),
      ),
    )
    renderWithProviders(<W10Ledger />)

    expect(await screen.findByRole('button', { name: '더 보기' })).toBeInTheDocument()
  })
})
