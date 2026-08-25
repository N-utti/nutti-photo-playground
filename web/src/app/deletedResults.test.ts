/**
 * 지운 결과 기록 (app/deletedResults.ts · 이슈 #152 의 프론트 절반).
 *
 * 이 모듈은 **부가 정보**입니다 — 404 한 줄을 다르게 설명하려고 둡니다. 그래서 여기서
 * 막을 것은 «기록이 틀리는 것» 보다 «기록이 삭제를 방해하는 것» 쪽입니다. 저장소가
 * 손상됐거나 꽉 찼다고 보관함 삭제 버튼이 예외로 죽으면, 부가 정보가 본 기능을
 * 잡아먹은 셈이 됩니다.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { rememberDeletedJobs, wasDeletedHere } from './deletedResults'

const KEY = 'nutti.deleted-jobs'

afterEach(() => {
  localStorage.removeItem(KEY)
})

describe('deletedResults', () => {
  it('지운 job 을 기억하고, 지운 적 없는 job 과 구분한다', () => {
    rememberDeletedJobs(['job-a', 'job-b'])

    expect(wasDeletedHere('job-a')).toBe(true)
    expect(wasDeletedHere('job-c')).toBe(false)
  })

  it('여러 번 지워도 앞선 기록이 남는다', () => {
    // 삭제는 한 번에 끝나지 않습니다 — 몇 장 지우고 나중에 또 지웁니다. 덮어쓰면
    // 먼저 지운 사진의 주소만 예전 문구로 돌아갑니다.
    rememberDeletedJobs(['job-a'])
    rememberDeletedJobs(['job-b'])

    expect(wasDeletedHere('job-a')).toBe(true)
    expect(wasDeletedHere('job-b')).toBe(true)
  })

  it('없는 id 로는 아무것도 묻지 않는다', () => {
    // `useParams()` 는 `string | undefined` 입니다 — 호출부가 매번 막지 않아도 됩니다.
    expect(wasDeletedHere(undefined)).toBe(false)
  })

  it('저장된 값이 망가져 있어도 터지지 않는다', () => {
    /*
      다른 탭·확장·예전 버전이 남긴 값일 수 있습니다. 여기서 예외가 나면 그 예외는
      **보관함 삭제 성공 콜백** 한가운데서 터집니다 — 서버에서는 지워졌는데 화면은
      선택 모드에 멈춘 채로 오류를 냅니다.
    */
    localStorage.setItem(KEY, '{ 이건 JSON 이 아닙니다')

    expect(() => rememberDeletedJobs(['job-a'])).not.toThrow()
    expect(wasDeletedHere('job-a')).toBe(true)
  })

  it('배열이 아닌 값도 조회를 막지 않는다', () => {
    localStorage.setItem(KEY, '"job-a"')

    expect(wasDeletedHere('job-a')).toBe(false)
  })

  it('무한정 쌓이지 않고, 밀려나는 건 오래전에 적은 쪽이다', () => {
    // 상한이 없으면 오래 쓴 브라우저에서 이 키 하나가 계속 자랍니다. 넘칠 때 최근
    // 기록을 버리면 상한의 의미가 없어집니다 — 방금 지운 사진일수록 그 주소로 다시
    // 돌아올 사람이 많습니다.
    rememberDeletedJobs(['oldest'])
    rememberDeletedJobs(Array.from({ length: 200 }, (_, index) => `later-${index}`))

    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toHaveLength(200)
    expect(wasDeletedHere('later-0')).toBe(true)
    expect(wasDeletedHere('oldest')).toBe(false)
  })
})
