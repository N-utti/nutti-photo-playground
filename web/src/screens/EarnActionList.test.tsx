/**
 * 크레딧 획득 경로 목록 (screens/EarnActionList.tsx · FR-W10-01~05).
 *
 * W-10 전체 화면과 402 오버레이가 **같은 목록**을 씁니다. 두 벌로 만들면 "여기선 받을
 * 수 있고 저기선 없는" 상태가 반드시 생기기 때문입니다(§4 시나리오3).
 *
 * 두 가지가 조용히 깨집니다.
 *
 * 하나는 **줄 순서**입니다. 서버 배열 순서를 그대로 그리면 주문 보상이 아래로 밀릴 수
 * 있는데, 그건 이 화면에서 유일하게 매출로 직결되는 줄이고 최상단·최대치인 게 설계입니다
 * (노트2). 목이 지금 그 순서로 주고 있어서 정렬을 지워도 화면은 멀쩡해 보입니다.
 *
 * 다른 하나는 **게스트에게 무엇을 약속하는가**입니다. 게스트가 「쇼핑몰 →」로 나가
 * 주문하면, 돌아와도 받을 계정이 없습니다. 그래서 네 줄 전부 로그인 CTA 로 옵니다
 * (PR #58 · 이슈 #52). 목이 그 상태를 만들어 주므로 여기서 밟을 수 있습니다.
 */

import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import EarnActionList from './EarnActionList'

/**
 * 화면에 보이는 순서대로 획득 줄의 제목을 읽습니다.
 *
 * 제목 옆의 금액(`+20`)도 같은 문단에 있어 함께 잡힙니다. 떼어내지 않는 이유는 그게
 * 순서와 함께 검증되어야 하는 값이기 때문입니다 — 줄은 제자리인데 금액이 어긋나면
 * 그것도 같은 종류의 결함입니다.
 */
function rowTitles(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('p')?.textContent?.trim() ?? '')
    .filter(Boolean)
}

/**
 * 회원 상태로 봅니다.
 *
 * `/auth/me` 만 덮으면 부족합니다 — `/credits` 핸들러는 응답을 만들 때 목 **내부의**
 * 로그인 상태를 보고 획득 목록을 전부 `login_required` 로 갈아 끼우기 때문입니다
 * (handlers.ts `guestAware`). 그래서 두 응답을 함께 세워야 회원이 보는 화면이 됩니다.
 *
 * 실제로 로그인시키지 않는 이유는 그게 목 상태를 바꾸기 때문입니다. 여기서는 응답만
 * 덮어쓰므로 `resetHandlers` 가 걷어가고, 뒤따르는 테스트에 아무것도 남기지 않습니다.
 */
function asMember() {
  server.use(
    http.get('*/v1/auth/me', () =>
      HttpResponse.json({ ...guestMe(), kind: 'member', nickname: '콩이엄마', providers: ['kakao'] }),
    ),
    http.get('*/v1/credits', () =>
      HttpResponse.json({
        balance: 11,
        earn_actions: [
          { action: 'order', amount: 20, status: 'available', cta: '쇼핑몰 →' },
          { action: 'link_account', amount: 3, status: 'available', cta: '연동하기' },
          { action: 'follow_ig', amount: 2, status: 'available', cta: '받기' },
          // 시드 기본값 — «오늘 몫은 이미 받은 상태» 입니다.
          { action: 'daily', amount: 1, status: 'tomorrow', cta: '내일 다시' },
        ],
      }),
    ),
  )
}

describe('EarnActionList', () => {
  it('회원에게 네 경로를 정해진 순서로 보여 준다', async () => {
    asMember()
    renderWithProviders(<EarnActionList />)

    expect(await screen.findByText('누띠 주문하기')).toBeInTheDocument()
    expect(rowTitles()).toEqual([
      '누띠 주문하기 +20',
      '쇼핑몰 계정 연동 +3',
      '인스타 팔로우 +2',
      '오늘의 무료 +1',
    ])
  })

  it('서버가 순서를 바꿔 줘도 주문 보상이 맨 위에 남는다', async () => {
    /*
      **이 파일의 핵심입니다.** 목이 이미 «맞는» 순서로 주기 때문에, 화면의 정렬을
      통째로 지워도 평소에는 아무 일도 일어나지 않습니다. 서버가 순서를 바꾸는 날에야
      드러나고, 그때 밀려나는 건 매출로 직결되는 줄입니다.

      그래서 일부러 뒤집힌 응답을 줍니다.
    */
    asMember()
    server.use(
      http.get('*/v1/credits', () =>
        HttpResponse.json({
          balance: 11,
          earn_actions: [
            { action: 'daily', amount: 1, status: 'tomorrow', cta: '내일 다시' },
            { action: 'follow_ig', amount: 2, status: 'available', cta: '받기' },
            { action: 'link_account', amount: 3, status: 'available', cta: '연동하기' },
            { action: 'order', amount: 20, status: 'available', cta: '쇼핑몰 →' },
          ],
        }),
      ),
    )
    renderWithProviders(<EarnActionList />)

    await screen.findByText('누띠 주문하기')
    expect(rowTitles()).toEqual([
      '누띠 주문하기 +20',
      '쇼핑몰 계정 연동 +3',
      '인스타 팔로우 +2',
      '오늘의 무료 +1',
    ])
  })

  it('게스트에게는 네 줄 전부 로그인으로 안내한다', async () => {
    /*
      주문 줄까지 「로그인」이어야 합니다(PR #58). 게스트에게 「쇼핑몰 →」를 그대로
      보여 주면, 나가서 실제로 주문한 사람에게 **받지 못할 보상을 약속한** 셈이 됩니다 —
      돌아왔을 때 크레딧이 쌓일 계정이 없습니다.
    */
    // 목의 기본값이 이미 게스트지만, 이 테스트가 무엇을 전제하는지 코드로 적어 둡니다.
    server.use(http.get('*/v1/auth/me', () => HttpResponse.json(guestMe())))
    renderWithProviders(<EarnActionList />)

    await screen.findByText('누띠 주문하기')

    expect(screen.getAllByRole('button', { name: '로그인' })).toHaveLength(4)
    expect(screen.queryByRole('link', { name: '쇼핑몰 →' })).not.toBeInTheDocument()
  })

  it('불러오지 못하면 빈 목록이 아니라 실패를 말한다', async () => {
    /*
      «받을 수 있는 게 없다» 로 뭉개면 사용자는 실제로 받을 수 있는 크레딧을 놓칩니다.
      복구 경로(다시 시도)도 함께 줍니다.
    */
    server.use(
      http.get('*/v1/credits', () => HttpResponse.json({ error: { code: 'HTTP_ERROR' } }, { status: 500 })),
    )
    renderWithProviders(<EarnActionList />)

    expect(await screen.findByText('받을 수 있는 크레딧을 불러오지 못했어요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('오늘 몫을 이미 받았으면 받기 버튼을 내린다', async () => {
    /*
      시드 기본값이 `daily: tomorrow` 입니다 — «오늘 몫은 이미 받은 상태». 여기에
      「받기」가 남아 있으면 누를 때마다 409 를 맞습니다.

      회원으로 봐야 하는 이유: 게스트에게는 이 줄도 `login_required` 라 「로그인」이
      먼저 걸려서, 정작 검사하려던 «이미 받음» 분기를 밟지 못합니다.
    */
    asMember()
    renderWithProviders(<EarnActionList />)

    await screen.findByText('오늘의 무료')
    expect(screen.getByText('내일 다시')).toBeInTheDocument()
  })
})

/** 목의 기본 게스트 응답과 같은 모양. 회원 전환 전 상태입니다. */
function guestMe() {
  return {
    member_id: '8f14e457-4d09-41c2-9d70-1a2b3c4d5e6f',
    kind: 'guest',
    email: null,
    nickname: null,
    providers: [],
    cafe24_linked: false,
    credit_balance: 11,
  }
}
