/**
 * 탈퇴 시 흔적 삭제 (api/localTraces.ts · 이슈 #123).
 *
 * 접두사로 쓸어내는 방식이라, 검증할 것은 «범위» 입니다 — 앱 키는 남김없이 지우고,
 * 목의 개발용 키와 남의 키는 건드리지 않는가.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { clearLocalTraces } from './localTraces'

describe('clearLocalTraces', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('두 저장소의 앱 키를 모두 지운다', () => {
    localStorage.setItem('nutti.session.token', 't')
    localStorage.setItem('nutti.session.kind', 'member')
    localStorage.setItem('nutti.session.refresh', 'r')
    sessionStorage.setItem('nutti.upload-draft', '{}')
    sessionStorage.setItem('nutti.job-attempt', '{}')
    sessionStorage.setItem('nutti.active-job', 'job_1')
    sessionStorage.setItem('nutti.auth.return', '/credits')

    clearLocalTraces()

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('키가 여러 개여도 하나도 건너뛰지 않는다', () => {
    /*
      순회하면서 지우면 인덱스가 밀려 **한 칸씩 건너뜁니다** — 절반만 지워지고 나머지는
      조용히 남습니다. 키가 하나뿐인 테스트로는 영영 안 걸리는 종류라 여러 개로 봅니다.
    */
    for (let i = 0; i < 8; i += 1) sessionStorage.setItem(`nutti.key-${i}`, String(i))

    clearLocalTraces()

    expect(sessionStorage.length).toBe(0)
  })

  it('목의 개발용 상태와 남의 키는 건드리지 않는다', () => {
    // 목 상태까지 지우면 탈퇴를 밟아 볼 때마다 시나리오가 풀려 검증 자체를 못 합니다.
    localStorage.setItem('nutti.mock.jobs', '{}')
    sessionStorage.setItem('nutti.mock.state', '{}')
    localStorage.setItem('other-app.token', 'keep')

    clearLocalTraces()

    expect(localStorage.getItem('nutti.mock.jobs')).toBe('{}')
    expect(sessionStorage.getItem('nutti.mock.state')).toBe('{}')
    expect(localStorage.getItem('other-app.token')).toBe('keep')
  })
})
