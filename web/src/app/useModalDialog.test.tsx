/**
 * 시트가 **실제로** 모달인지 (app/useModalDialog.ts · PR #93).
 *
 * 이 파일이 있는 이유는 이 결함이 **눈으로 안 보이기 때문**입니다. 시트에
 * `useModalDialog` 를 안 달아도 화면은 멀쩡하고, 마우스로는 아무 차이가 없습니다.
 * 드러나는 건 키보드뿐인데, 원래 상태는 이랬습니다 — 402 오버레이가 떠 있는데 Tab
 * 한 번이면 포커스가 **오버레이 뒤**의 «다시 만들기 · 1 크레딧» 으로 나갔고, 보이지도
 * 않는 그 버튼이 눌리면 잔액은 그대로니 같은 402 를 다시 맞았습니다.
 *
 * 그래서 여기서 검사하는 건 «훅을 호출했는가» 가 아니라 **«뒤 화면 버튼에 키보드가
 * 닿는가»** 입니다. 훅을 어떻게 고쳐 쓰든 그 답이 «닿는다» 로 바뀌면 실패해야 합니다.
 *
 * 새 시트를 만들면 아래 `CASES` 에 한 줄 추가하세요. 시트마다 따로 쓰지 않는 이유는
 * 이게 시트 하나의 성질이 아니라 **모든 시트에 걸리는 규칙**이기 때문입니다 —
 * 한 벌로 두면 새 시트가 규칙 밖에 남는 걸 «추가를 깜빡했다» 로 만들 수 있습니다.
 */

import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AccountSheet from '../screens/AccountSheet'
import InsufficientCreditOverlay from '../screens/InsufficientCreditOverlay'
import LogoutConfirm from '../screens/LogoutConfirm'
import { renderWithProviders } from '../test/render'
import { WelcomeDialog } from './AuthWelcomeDialog'

/** 시트가 가리는 뒤 화면의 버튼. 402 를 낸 그 버튼 자리입니다. */
const BEHIND = '다시 만들기 · 1 크레딧'

type Case = {
  name: string
  sheet: (onClose: () => void) => ReactElement
  /** 열린 직후 시트 안에 반드시 있는 글자. 데이터를 읽는 시트는 이걸로 기다립니다. */
  settled: string
}

const CASES: Case[] = [
  {
    name: '로그인 시트',
    sheet: (onClose) => <AccountSheet onClose={onClose} />,
    settled: '카카오로 계속하기',
  },
  {
    name: '크레딧 부족 오버레이',
    // 잔액이 모자란 쪽으로 엽니다 — «다시 시도» 가 없는, 402 직후의 그 상태입니다.
    sheet: (onClose) => <InsufficientCreditOverlay required={1} balance={0} onClose={onClose} />,
    settled: '오늘의 무료',
  },
  {
    /*
      확인 창 계열(app/ConfirmDialog.tsx)의 대표.

      로그아웃 · 보관함 삭제 · 펫 프로필 삭제/이름 변경이 같은 껍데기를 쓰므로 여기서
      한 번 밟으면 넷 다 밟습니다. 로그아웃을 대표로 세운 건 이것만 화면 상태 없이
      혼자 서기 때문입니다 — 나머지 셋은 선택 모드에 들어가거나 펫 목록이 있어야
      열리고, 그 경로는 각 화면의 테스트가 볼 몫입니다.

      이 계열은 PR #93 이 «새 시트를 만들면 CASES 에 한 줄 추가하세요» 를 남긴 뒤에
      생겼는데 셋 다 등록되지 않았고, 셋 다 가둠이 없었습니다. 사람 규칙이 세 번
      연속 안 지켜진 것이라 지금은 modalContract.test.ts 가 소스를 직접 훑습니다.
    */
    name: '확인 창 (로그아웃)',
    sheet: (onClose) => <LogoutConfirm onClose={onClose} />,
    settled: '로그아웃할까요?',
  },
  {
    /*
      소셜 로그인 복귀 알림(app/AuthWelcomeDialog.tsx). 이건 사용자가 **연 적 없는**
      창이라 가둠이 더 필요합니다 — 프로바이더에서 막 돌아온 참이라 포커스가 어디에
      있는지 아무도 모르는 상태에서 뜹니다. 새는 순간 첫 Tab 이 뒤 화면의 아무 버튼으로
      갑니다. 그 뒤 화면은 결과일 수도 있어서 «다시 만들기 · 1 크레딧» 이 그 자리입니다.
    */
    name: '로그인 알림',
    sheet: (onClose) => (
      <WelcomeDialog welcome={{ merged: true, creditBalance: 3 }} onClose={onClose} />
    ),
    settled: '로그인됐어요',
  },
]

/** 뒤 화면 + 시트를 함께 세웁니다. 시트만 렌더하면 «밖으로 새는지» 를 물을 수 없습니다. */
async function openSheet(testCase: Case, onClose: () => void = vi.fn()) {
  const user = userEvent.setup()
  const view = renderWithProviders(
    <>
      <button type="button">{BEHIND}</button>
      {testCase.sheet(onClose)}
    </>,
  )
  // 시트 안의 데이터가 다 도착한 뒤에 키를 눌러야 합니다 — 로딩 중에는 탭 대상이
  // 아직 없어서, 가둠이 깨져 있어도 «나갈 곳이 없어» 통과할 수 있습니다.
  await screen.findByText(testCase.settled)
  return { user, view, dialog: screen.getByRole('dialog'), behind: screen.getByRole('button', { name: BEHIND }) }
}

describe.each(CASES)('$name', (testCase) => {
  it('열리면 포커스가 시트 안으로 들어온다', async () => {
    const { dialog } = await openSheet(testCase)

    // body 에 남아 있으면 첫 Tab 이 그대로 뒤 화면으로 갑니다 — 원래의 그 결함입니다.
    expect(dialog).toHaveFocus()
  })

  it('Tab 을 계속 눌러도 뒤 화면 버튼에 닿지 않는다', async () => {
    const { user, dialog, behind } = await openSheet(testCase)

    // 시트 안의 탭 대상 수보다 넉넉히 돕니다 — 한 바퀴 돌아 처음으로 되돌아와야 합니다.
    for (let press = 0; press < 20; press += 1) {
      await user.tab()
      expect(behind).not.toHaveFocus()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Shift+Tab 으로도 뒤 화면 버튼에 닿지 않는다', async () => {
    const { user, dialog, behind } = await openSheet(testCase)

    for (let press = 0; press < 20; press += 1) {
      await user.tab({ shift: true })
      expect(behind).not.toHaveFocus()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Escape 로 닫힌다', async () => {
    const onClose = vi.fn()
    const { user } = await openSheet(testCase, onClose)

    await user.keyboard('{Escape}')

    // W-03 스타일 시트는 Escape 로 닫힙니다. 같은 앱에서 시트마다 규칙이 갈리면
    // 사용자는 어느 쪽이 되는지 매번 시험해 봐야 합니다.
    expect(onClose).toHaveBeenCalled()
  })

  it('떠 있는 동안 배경 스크롤이 잠기고, 사라지면 풀린다', async () => {
    const { view } = await openSheet(testCase)

    expect(document.body.style.overflow).toBe('hidden')

    view.unmount()

    // 잠금이 남으면 시트를 닫은 뒤 화면 전체가 스크롤되지 않습니다.
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
