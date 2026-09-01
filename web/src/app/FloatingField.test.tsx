/**
 * 떠 있는 라벨 입력칸 (app/FloatingField.tsx).
 *
 * 막으려는 결함은 «라벨이 뜬 채로 굳는 것» 입니다. 라벨을 올릴지 말지는 React 상태가
 * 아니라 CSS 의 `:placeholder-shown` 이 정합니다 — 브라우저 자동완성처럼 `onChange` 가
 * 울지 않는 경로에서도 라벨이 따라 올라가야 하기 때문입니다. 그런데 그 선택자는
 * **placeholder 속성이 비어 있으면 영영 거짓**이라, 빈 문자열이 들어오는 순간 모든 칸이
 * 라벨을 올린 채로 굳고 빈 칸에 라벨만 떠 있게 됩니다. 화면으로는 «왜 다 떠 있지?» 로만
 * 보이고 원인이 CSS 한 줄에 있어 찾기 어렵습니다. 그래서 속성 자체를 여기서 봅니다.
 *
 * 두 번째로 보는 것은 바탕색입니다. 올라간 라벨은 테두리를 **덮어서** 자리를 만들고,
 * 덮개 색이 칸의 바탕과 다르면 라벨 뒤에 이음매가 남습니다. 둘이 같은 값을 쓰는지는
 * 화면으로는 미세해서 놓치기 쉬우니(흰색 대 크림) 여기서 못박습니다.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FloatingField from './FloatingField'

describe('떠 있는 라벨 입력칸', () => {
  it('라벨이 칸의 접근성 이름이다 — 자리만 옮기지 이름을 잃지 않는다', () => {
    render(<FloatingField label="이메일" type="email" />)

    expect(screen.getByLabelText('이메일')).toHaveAttribute('type', 'email')
  })

  it('placeholder 를 안 넘겨도 비어 있지 않다', () => {
    render(<FloatingField label="이메일" />)

    // 빈 문자열이면 `:placeholder-shown` 이 영영 거짓이라 라벨이 올라간 채로 굳습니다.
    expect(screen.getByLabelText('이메일').getAttribute('placeholder')).not.toBe('')
  })

  it('넘긴 placeholder 는 그대로 쓴다 — 포커스했을 때 보일 형식 예시입니다', () => {
    render(<FloatingField label="이메일" placeholder="example@email.com" />)

    expect(screen.getByLabelText('이메일')).toHaveAttribute('placeholder', 'example@email.com')
  })

  it('라벨 덮개와 칸이 같은 바탕색을 쓴다 — 화면 바탕을 바꿔도 같이 간다', () => {
    render(<FloatingField label="쇼핑몰 아이디" surfaceClass="bg-paper" />)

    const field = screen.getByLabelText('쇼핑몰 아이디')
    const cover = document.querySelector('label[for]')
    expect(field.className).toContain('bg-paper')
    expect(cover?.className).toContain('bg-paper')
  })
})
