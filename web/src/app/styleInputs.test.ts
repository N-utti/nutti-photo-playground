/**
 * 스타일 입력값의 초기화·검증 (app/styleInputs.ts · 이슈 #114).
 *
 * 이 파일이 지키는 건 «화면이 서버와 같은 판정을 하는가» 입니다. 최종 판정은
 * `app/routers/jobs.py` `_resolve_input_values` 이고 프론트는 그 사본이라, 둘이
 * 갈리면 두 방향 모두 나쁩니다 — 느슨하면 왕복 뒤에 «요청 형식이 올바르지 않습니다»
 * 만 받고(어느 칸인지 화면은 모릅니다), 빡빡하면 서버가 받아 주는 값을 화면이 막습니다.
 *
 * 그래서 아래 케이스는 **실제 매니페스트에 있는 필드 모양**을 씁니다
 * (seeds/style_inputs.json — 띠부씰의 4자리 패턴, 입덕직캠의 3자 제한, 갸루의
 * allow_custom=false). 지어낸 스키마로 통과하는 검증은 실제 스타일에서 갈릴 수 있습니다.
 */

import { describe, expect, it } from 'vitest'
import type { StyleInputField } from '../api/types'
import {
  PET_NAME_FALLBACK,
  fieldError,
  initialInputValues,
  inputErrors,
  inputsForRequest,
  repriseWithPetName,
  restoredInputValues,
} from './styleInputs'

/** 「띠부씰」 — 4자리 숫자 패턴 + 이름 4자 제한(둘 다 실제 매니페스트). */
const SERIAL: StyleInputField = {
  label: '번호 (4자리, 생년월일 월일)',
  type: 'text',
  pattern: '^\\d{4}$',
  default: '0103',
  help: '생년월일 월일 4자리',
}
const SHORT_NAME: StyleInputField = {
  label: '반려견 이름 (4자 이내)',
  type: 'text',
  max_length: 4,
  prefill: 'pet_name',
}
/** 「갸루」 — 목록 밖 값을 허용하지 않는 choice. */
const CLOSED_CHOICE: StyleInputField = {
  label: '스타일',
  type: 'choice',
  allow_custom: false,
  default: '2000년대 갸루',
  options: [{ value: '90년대 코갸루' }, { value: '2000년대 갸루' }],
}
/** 「사물코스튬」 — 목록 밖 값도 받는 choice. */
const OPEN_CHOICE: StyleInputField = {
  label: '의상',
  type: 'choice',
  allow_custom: true,
  default: '버섯',
  options: [{ value: '버섯' }, { value: '옥수수' }],
}

describe('initialInputValues', () => {
  it('default 가 있으면 그 값으로 시작한다', () => {
    // 서버가 어차피 default 로 채웁니다 — 비워 두면 화면만 «아무것도 안 고른» 것처럼 보입니다.
    expect(initialInputValues([CLOSED_CHOICE, SERIAL], null)).toEqual({
      [CLOSED_CHOICE.label]: '2000년대 갸루',
      [SERIAL.label]: '0103',
    })
  })

  it('prefill 칸은 선택된 강아지 이름으로 채운다', () => {
    expect(initialInputValues([SHORT_NAME], '콩이')).toEqual({ [SHORT_NAME.label]: '콩이' })
  })

  it('이름을 모르면 prefill 칸을 비워 둔다 — 폴백을 미리 적어 넣지 않는다', () => {
    /*
      여기에 «우리 아이» 를 적어 넣으면 사용자가 그걸 «내가 고른 값» 으로 읽고 지우지
      않게 됩니다. 정작 그 자리는 나중에 강아지를 저장하면 진짜 이름이 들어갈 자리이고,
      비워 두면 서버·워커가 같은 폴백을 넣습니다(app/worker.py).
    */
    expect(initialInputValues([SHORT_NAME], null)).toEqual({})
    expect(PET_NAME_FALLBACK).toBe('우리 아이')
  })
})

describe('repriseWithPetName', () => {
  it('강아지를 고르면 비어 있던 prefill 칸을 채운다', () => {
    // `GET /v1/pets` 가 스타일 상세보다 늦게 오는 경로(초안 복원)가 이 길로 옵니다.
    expect(repriseWithPetName([SHORT_NAME], {}, null, '콩이')).toEqual({
      [SHORT_NAME.label]: '콩이',
    })
  })

  it('직전 이름 그대로였던 칸은 새 이름으로 갈아 끼운다', () => {
    expect(repriseWithPetName([SHORT_NAME], { [SHORT_NAME.label]: '콩이' }, '콩이', '단지')).toEqual(
      { [SHORT_NAME.label]: '단지' },
    )
  })

  it('사용자가 고쳐 쓴 값은 건드리지 않는다', () => {
    // 방금 받은 입력을 말없이 버리는 화면이 되면 안 됩니다.
    expect(
      repriseWithPetName([SHORT_NAME], { [SHORT_NAME.label]: '뽀식' }, '콩이', '단지'),
    ).toEqual({ [SHORT_NAME.label]: '뽀식' })
  })

  it('강아지 선택을 풀면 프리필 값도 함께 걷힌다', () => {
    expect(repriseWithPetName([SHORT_NAME], { [SHORT_NAME.label]: '콩이' }, '콩이', null)).toEqual(
      {},
    )
  })
})

describe('fieldError', () => {
  it('빈 값은 오류가 아니다 — 서버가 default 로 채우는 자리다', () => {
    expect(fieldError(SERIAL, '')).toBeNull()
    expect(fieldError(SHORT_NAME, undefined)).toBeNull()
  })

  it('max_length 를 넘으면 막는다', () => {
    expect(fieldError(SHORT_NAME, '다섯글자다')).toBe('4자 이내로 써 주세요.')
    expect(fieldError(SHORT_NAME, '네글자면')).toBeNull()
  })

  it('pattern 은 전체 일치로 본다 (서버의 re.fullmatch)', () => {
    /*
      앵커 없이 `new RegExp(pattern).test()` 로 보면 "01034" 가 통과합니다 — 화면은
      괜찮다고 해 놓고 서버만 400 을 내는, 왕복 뒤에 뒤집히는 종류가 됩니다.
    */
    expect(fieldError(SERIAL, '0103')).toBeNull()
    expect(fieldError(SERIAL, '01034')).toBe('형식이 맞지 않아요 — 생년월일 월일 4자리')
    expect(fieldError(SERIAL, '엉뚱')).not.toBeNull()
  })

  it('allow_custom 이 아니면 목록 밖 값을 막고, 맞으면 통과시킨다', () => {
    expect(fieldError(CLOSED_CHOICE, '히메갸루')).toBe('목록에서 골라 주세요.')
    expect(fieldError(CLOSED_CHOICE, '2000년대 갸루')).toBeNull()
  })

  it('allow_custom 이면 목록 밖 값도 통과시킨다', () => {
    // 여기서 막으면 서버가 받아 주는 값을 화면이 거절하는 셈입니다.
    expect(fieldError(OPEN_CHOICE, '붕어빵')).toBeNull()
  })
})

describe('inputErrors · inputsForRequest', () => {
  it('문제가 있는 칸만 라벨로 돌려준다', () => {
    const errors = inputErrors([SERIAL, SHORT_NAME], {
      [SERIAL.label]: '0103',
      [SHORT_NAME.label]: '다섯글자다',
    })
    expect(Object.keys(errors)).toEqual([SHORT_NAME.label])
  })

  it('빈 칸은 보내지 않는다 — 서버가 default 로 채운다', () => {
    expect(inputsForRequest([SERIAL, SHORT_NAME], { [SERIAL.label]: '0103' })).toEqual({
      [SERIAL.label]: '0103',
    })
  })

  it('스키마에 없는 라벨은 떨어뜨린다', () => {
    /*
      스타일을 바꾸면 상태에 옛 라벨이 남습니다. 그대로 보내면 서버는 그 라벨을 조용히
      버리고 생성을 계속합니다(백엔드 PR #139) — 오류 없이 **크레딧이 나가고** 사용자가
      고른 값만 결과에서 사라집니다. 예전에는 400 `unknown_inputs` 라 크레딧이 안 나갔고,
      그래서 이 필터가 이제 유일한 방어선입니다.
    */
    expect(
      inputsForRequest([SERIAL], { [SERIAL.label]: '0103', 의상: '버섯' }),
    ).toEqual({ [SERIAL.label]: '0103' })
  })

  it('보낼 값이 없으면 아예 생략한다', () => {
    expect(inputsForRequest([], {})).toBeUndefined()
    expect(inputsForRequest([SHORT_NAME], { [SHORT_NAME.label]: '  ' })).toBeUndefined()
  })
})

describe('restoredInputValues', () => {
  it('서버가 값을 모르면 빈 객체다 — 기본값이 그대로 살아야 한다', () => {
    // `null` 은 이 필드가 생기기 전에 만든 job(백엔드 PR #139) 또는 커스텀 job 입니다.
    expect(restoredInputValues([CLOSED_CHOICE], null)).toEqual({})
    expect(restoredInputValues([CLOSED_CHOICE], undefined)).toEqual({})
  })

  it('지난번 값을 그대로 돌려준다', () => {
    expect(restoredInputValues([CLOSED_CHOICE], { [CLOSED_CHOICE.label]: '90년대 코갸루' })).toEqual({
      [CLOSED_CHOICE.label]: '90년대 코갸루',
    })
  })

  it('지금 스키마에 없는 라벨은 버린다', () => {
    /*
      `inputs` 는 job 을 만들던 시점의 스키마로 판정된 값이라, 운영이 그 뒤 칸을 바꾸면
      없어진 라벨이 남습니다. 안 버리면 접힌 줄에는 적히는데 `inputsForRequest` 는
      안 싣고, 실려도 서버가 조용히 버립니다 — 화면과 요청이 갈라집니다.
    */
    expect(
      restoredInputValues([CLOSED_CHOICE], {
        [CLOSED_CHOICE.label]: '히메갸루',
        [OPEN_CHOICE.label]: '버섯',
      }),
    ).toEqual({ [CLOSED_CHOICE.label]: '히메갸루' })
  })

  it('빈 값은 되살리지 않는다 — 기본값을 빈 칸으로 덮으면 안 된다', () => {
    // 서버는 빈 값을 저장하지 않지만, 들어와도 `default` 가 있는 칸을 비우면 화면만
    // 비어 보이고 결과에는 default 가 나옵니다.
    expect(restoredInputValues([SERIAL], { [SERIAL.label]: '   ' })).toEqual({})
  })

  it('스키마에 있어도 `inputs` 에 없는 칸은 안 만든다', () => {
    /*
      `default` 없는 `prefill` 칸이 그렇습니다 — 서버가 저장하지 않아 응답에 없고,
      그 자리는 `initialInputValues` 가 강아지 이름으로 채웁니다. 여기서 빈 문자열을
      만들어 두면 그 이름을 덮어써서 폼이 «우리 아이» 라고 잘못 말하게 됩니다.
    */
    expect(restoredInputValues([SHORT_NAME, SERIAL], { [SERIAL.label]: '0103' })).toEqual({
      [SERIAL.label]: '0103',
    })
  })
})
