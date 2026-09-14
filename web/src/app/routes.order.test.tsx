/**
 * 라우터는 부팅 관문이 주소를 걷어 낸 **뒤에** 만들어야 합니다 (app/routes.tsx `createAppRouter`).
 *
 * 먼저 만들면 `?ig=`·`?handoff=` 가 라우터 위치에 남아, 로그인 복귀 주소로 되살아납니다.
 * 이 검사는 «걷어 낸 뒤 만든 라우터는 그 파라미터를 모른다» 만 봅니다 — main.tsx 의 순서가
 * 뒤집히면 여기서는 안 잡히고(모듈 상수로 되돌리면 잡힙니다) 브라우저에서 잡힙니다.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { takeHandoffCode } from './handoff'
import { captureInstagramCode } from './instagramCode'
import { createAppRouter } from './routes'

afterEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.removeItem('nutti.instagram.code')
})

describe('createAppRouter', () => {
  it('주소를 걷어 낸 뒤 만든 라우터의 위치에는 ig·handoff 가 없다', () => {
    window.history.replaceState(null, '', '/?handoff=abc.def&ig=K7M2P9QX&share=1')
    takeHandoffCode()
    captureInstagramCode()

    const router = createAppRouter()
    expect(router.state.location.search).toBe('?share=1')
    router.dispose()
  })
})
