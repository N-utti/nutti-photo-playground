/**
 * Idempotency-Key 의 수명 (api/idempotency.ts · 05-api-spec §1, §4 시나리오3).
 *
 * 여기서 틀리면 **돈이 틀립니다.** 규칙이 두 방향으로 갈리기 때문입니다:
 *
 *   402 후 재시도    → **같은 키** (아직 job 이 없으므로 원래 시도를 이어갑니다)
 *   «다시 만들기»    → **새 키**  (같은 키면 서버가 원래 job 을 돌려줘 새 결과가 안 나옵니다)
 *
 * 둘을 뒤집으면 증상이 정반대인데 둘 다 조용합니다. 같은 키를 새 키로 바꾸면 크레딧이
 * 두 번 나가고, 새 키를 같은 키로 바꾸면 «다시 만들기» 가 아무리 눌러도 같은 사진을
 * 돌려줍니다. 화면에는 둘 다 «정상 동작» 으로 보입니다.
 *
 * 키는 "요청 1건" 이 아니라 **"사용자의 생성 의도 1건"** 에 붙습니다. 그래서 아래
 * 테스트는 키 값 자체보다 «어떤 의도를 같은 것으로 보는가» 를 봅니다.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { beginJobAttempt, clearJobAttempt, resumeJobAttempt, type JobIntent } from './idempotency'

const INTENT: JobIntent = {
  style_id: 8,
  upload_id: 'up_01HQZX',
  pet_id: 'pet_7f3a',
  custom_prompt: null,
}

beforeEach(() => {
  // 저장소는 모듈 밖의 상태라 테스트끼리 새어 나갑니다.
  sessionStorage.clear()
})

describe('beginJobAttempt', () => {
  it('의도를 저장하고 키를 발급한다', () => {
    const attempt = beginJobAttempt(INTENT)

    expect(attempt.key).toBeTruthy()
    expect(attempt.intent).toEqual(INTENT)
    // 저장까지 돼야 리로드를 건너 이어받을 수 있습니다.
    expect(resumeJobAttempt(INTENT)?.key).toBe(attempt.key)
  })

  it('부를 때마다 새 키를 낸다 — «다시 만들기» 가 이 경로다', () => {
    /*
      같은 의도로 불러도 새 키입니다. W-06 «다시 만들기» 는 재료가 완전히 같은
      재생성이라 의도 필드가 전부 일치하는데, 여기서 키를 재사용하면 서버가 §1 에 따라
      원래 job 을 그대로 돌려줍니다 — 눌러도 아무것도 안 바뀌는 버튼이 됩니다.
    */
    const first = beginJobAttempt(INTENT)
    const second = beginJobAttempt(INTENT)

    expect(second.key).not.toBe(first.key)
  })
})

describe('resumeJobAttempt', () => {
  it('같은 의도면 원래 키를 그대로 이어받는다 — 402 후 재시도가 이 경로다', () => {
    /*
      §4 시나리오3 4단계. 크레딧을 받으러 나갔다 돌아온 뒤의 재시도라, 아직 job 이
      만들어지지 않았으므로 **원래 시도의 키**를 씁니다. 여기서 새 키가 나가면 서버는
      두 건의 다른 생성으로 보고 크레딧을 두 번 차감합니다.
    */
    const started = beginJobAttempt(INTENT)

    expect(resumeJobAttempt(INTENT)?.key).toBe(started.key)
  })

  it('저장된 것이 없으면 null', () => {
    // 호출부는 이때 beginJobAttempt 로 새로 시작합니다.
    expect(resumeJobAttempt(INTENT)).toBeNull()
  })

  it('job 이 만들어져 키를 비운 뒤에는 null', () => {
    beginJobAttempt(INTENT)
    clearJobAttempt()

    expect(resumeJobAttempt(INTENT)).toBeNull()
  })

  it('저장본이 깨져 있어도 던지지 않고 null', () => {
    /*
      스키마가 바뀐 뒤 남은 옛 저장본이나 손으로 만진 값입니다. 여기서 예외가 나가면
      W-04 가 **렌더 도중에** 죽습니다 — 사진을 다시 올리면 되는 상황이 흰 화면이 됩니다.
    */
    sessionStorage.setItem('nutti.job-attempt', '{ 이건 JSON 이 아닙니다')

    expect(resumeJobAttempt(INTENT)).toBeNull()
  })

  describe('의도가 하나라도 다르면 이어받지 않는다', () => {
    /*
      한 필드씩 어긋뜨려 봅니다. 대조가 느슨해지면(예: upload_id 만 비교) 사진을 바꿔
      올린 재시도가 **앞 사진의 키**를 물고 나가, 서버가 §1 대로 옛 job 을 돌려줍니다 —
      방금 올린 사진이 아니라 이전 사진의 결과가 나옵니다.
    */
    const CASES: { name: string; intent: JobIntent }[] = [
      { name: '스타일', intent: { ...INTENT, style_id: 9 } },
      { name: '업로드', intent: { ...INTENT, upload_id: 'up_OTHER' } },
      { name: '강아지', intent: { ...INTENT, pet_id: 'pet_other' } },
      { name: '문구', intent: { ...INTENT, custom_prompt: '눈 오는 날' } },
      // W-08 직접 만들기는 스타일 없이 문구로 갑니다 — null 과 값의 차이도 다른 의도입니다.
      { name: '스타일 없음', intent: { ...INTENT, style_id: null } },
      { name: '강아지 없음', intent: { ...INTENT, pet_id: null } },
    ]

    it.each(CASES)('$name 이 다르면 null', ({ intent }) => {
      beginJobAttempt(INTENT)

      expect(resumeJobAttempt(intent)).toBeNull()
    })
  })
})
