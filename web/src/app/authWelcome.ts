/**
 * 로그인 직후 «무엇이 옮겨졌는지» 를 한 번만 알립니다.
 *
 * 원래 소셜 로그인의 이 알림은 `/auth/callback/{provider}` 가 **페이지 하나를 통째로
 * 써서** 그렸습니다. 문제는 그 껍데기가 «로그인 정보가 만료됐어요» 같은 실패 화면과
 * 완전히 같은 것이었다는 점입니다 — 빈 종이 위의 카드 한 장, 내비도 뒤 화면도 없는
 * 상태. 로그인에 **성공한** 사람이 그걸 보고 «어, 에러인가?» 하고 멈췄습니다. 게다가
 * 아직 자기가 있던 화면으로 돌아온 게 아니라, 「계속하기」를 한 번 더 눌러야 하던 일이
 * 이어졌습니다.
 *
 * 이메일 로그인은 처음부터 이러지 않았습니다 — `screens/AccountSheet.tsx` 가 시트 안의
 * 문구만 바꿔 끼우고 뒤 화면은 그대로 서 있습니다. 소셜만 달랐던 이유는 OAuth 가 전체
 * 페이지 이동이라 그 시트가 이미 사라졌기 때문이지, 알릴 내용이 달라서가 아닙니다.
 * 그래서 콜백은 **곧바로 로그인 직전 화면으로 되돌리고**, 알림은 그 위에 뜨는 모달로
 * 옮깁니다(app/AuthWelcomeDialog.tsx). 두 로그인이 같은 모양이 됩니다.
 *
 * 값을 라우터 state(히스토리)가 아니라 여기 모듈 변수에 두는 이유: 히스토리에 실으면
 * 돌아간 그 주소를 새로고침하거나 뒤로 갔다 오는 것만으로 «로그인됐어요» 가 다시
 * 뜹니다. 이건 한 번 쓰고 사라져야 하는 알림이고, 모듈 변수는 탭을 새로 고치는 순간
 * 함께 없어져서 그 수명이 정확히 맞습니다. 콜백 → 복귀 화면은 같은 JS 문맥 안의
 * 클라이언트 이동이라 값이 살아서 건너갑니다.
 */

import { useEffect, useState } from 'react'

export interface AuthWelcome {
  /**
   * 기존 계정으로 로그인해 게스트 자산이 **옮겨진** 경우(true)와, 게스트 행 자체가
   * 회원으로 승격된 경우(false). 사용자가 보게 될 문장이 갈립니다.
   */
  merged: boolean
  creditBalance: number
}

let pending: AuthWelcome | null = null
const subscribers = new Set<(value: AuthWelcome | null) => void>()

function set(next: AuthWelcome | null): void {
  pending = next
  for (const notify of subscribers) notify(next)
}

/** 로그인이 확정된 순간 부릅니다. 같은 값으로 두 번 불러도(StrictMode) 결과는 같습니다. */
export function announceAuthWelcome(welcome: AuthWelcome): void {
  set(welcome)
}

/** 사용자가 알림을 닫았을 때. 테스트에서는 모듈 상태를 비우는 데도 씁니다. */
export function dismissAuthWelcome(): void {
  set(null)
}

export function useAuthWelcome(): AuthWelcome | null {
  const [value, setValue] = useState<AuthWelcome | null>(pending)

  useEffect(() => {
    // 마운트 전에 이미 알려졌을 수 있습니다 — 콜백이 announce 한 뒤 이동하기 때문에
    // 순서상 이쪽이 나중일 수 있습니다(sessionStatus.ts 와 같은 이유).
    setValue(pending)
    subscribers.add(setValue)
    return () => {
      subscribers.delete(setValue)
    }
  }, [])

  return value
}

/**
 * 소셜·이메일 두 경로가 쓰는 **한 벌의 문구**.
 *
 * AccountSheet 헤더의 «여기서 크레딧을 약속하지 마세요» 와 같은 제약이 여기 걸립니다 —
 * 병합이면 `credit_balance` 는 따라오지 않으므로, 두 경로 모두에서 참인 말만 합니다.
 * 문구를 갈라 두면 한쪽만 고쳐지고, 같은 사건에 대해 앱이 두 가지로 말하게 됩니다.
 */
export function authWelcomeMessage(merged: boolean): string {
  return merged
    ? '이전에 만든 결과와 반려견 프로필을 이 계정으로 옮겼어요.'
    : '지금까지 만든 결과가 이 계정에 그대로 남아 있어요.'
}

/** ADR-02 로 잔액은 음수일 수 있습니다 — 판정은 원값으로, **표시만** 0 으로 막습니다. */
export function authWelcomeBalance(creditBalance: number): string {
  return `보유 크레딧 ${Math.max(0, creditBalance)}개`
}
