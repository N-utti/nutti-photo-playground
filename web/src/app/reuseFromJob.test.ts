/**
 * "이 사진으로 다른 스타일" 의 재사용 규칙 중 순수한 부분 (app/reuseFromJob.ts).
 *
 * 훅(`useReuseFromJob`)은 라우터·쿼리가 붙어 있어 화면 테스트가 볼 몫이고, 여기서는
 * 그 안쪽의 두 함수만 봅니다 — W-02 · W-03 · W-04 · W-06 · W-08 이 **전부 공유**하는
 * 규칙이라 여기가 틀리면 다섯 화면이 함께 틀립니다.
 *
 * 무엇이 걸린 문제인가: 맥락이 한 번 끊기면 사용자는 방금 쓴 사진을 **다시 올리게
 * 되고**, 그 순간 `upload_id` 가 새로 발급돼 재사용 자체가 무산됩니다. 화면에는
 * "업로드 화면이 떴다" 로만 보여서 끊긴 지점을 되짚기 어렵습니다.
 */

import { describe, expect, it } from 'vitest'
import { contextFromJob, REUSE_PARAM, withReuse } from './reuseFromJob'
import type { Job } from '../api/types'

/** 프리셋으로 만든 성공 job. 재사용 재료가 다 들어 있는 상태입니다. */
const JOB = {
  job_id: 'job_01HQZX',
  status: 'succeeded',
  style_id: 8,
  upload_id: 'up_01HQZX',
  source_image_url: 'https://cdn.example.test/up_01HQZX.jpg',
  custom_prompt: null,
  pet_id: null,
} as Job

describe('contextFromJob', () => {
  it('job 응답에서 재료를 그대로 옮긴다', () => {
    expect(contextFromJob(JOB)).toEqual({
      styleId: 8,
      uploadId: 'up_01HQZX',
      sourceImageUrl: 'https://cdn.example.test/up_01HQZX.jpg',
      customPrompt: null,
      petId: null,
    })
  })

  it('사진에 붙은 강아지도 함께 나른다', () => {
    /*
      백엔드 #111 착지분. W-04 가 이 값으로 «그림에 어떤 이름이 박히는가» 를 말하고
      `prefill: "pet_name"` 칸을 채웁니다 — 여기서 떨어뜨리면 재사용 경로만 그 둘을
      모르는 채로 결제 화면까지 갑니다.
    */
    const withPet = { ...JOB, pet_id: 'pet_01HQZX' } as Job

    expect(contextFromJob(withPet)?.petId).toBe('pet_01HQZX')
  })

  it('옛 응답처럼 pet_id 가 아예 없으면 «붙은 강아지 없음» 으로 읽는다', () => {
    // undefined 가 그대로 새면 «모른다» 와 «없다» 가 한 값이 되고, 화면이 그 둘을
    // 다른 문구로 갈라 씁니다(W-04 PetNameNotice).
    const legacy = { ...JOB, pet_id: undefined } as unknown as Job

    expect(contextFromJob(legacy)?.petId).toBeNull()
  })

  it('응답이 아직 없으면 null', () => {
    // 로딩 중을 «재사용 불가» 로 단정하면 화면이 먼저 거짓말하고 나중에 정정합니다.
    expect(contextFromJob(undefined)).toBeNull()
    expect(contextFromJob(null)).toBeNull()
  })

  it('upload_id 가 비어 있으면 재료가 못 된다', () => {
    /*
      타입상 `upload_id` 는 `string` 이지만 `contextFromJob` 은 빈 값을 방어합니다
      (`!job?.upload_id`). 응답이 계약을 지킨다는 보장이 우리 쪽에 없어서인데, 그
      방어가 리팩터링에 지워지지 않았는지 봅니다.

      여기서 «재료가 있다» 고 답하면 W-04 가 사진 없는 확인 화면을 그립니다 — 무엇을
      만드는지 안 보이는 채로 결제 버튼만 남습니다.
    */
    expect(contextFromJob({ ...JOB, upload_id: '' })).toBeNull()
  })

  it('커스텀 문구로 만든 job 은 문구를 함께 나른다', () => {
    // W-08 재생성이 같은 문구로 다시 만들려면 이 값이 살아야 합니다(PR #83).
    const custom = { ...JOB, style_id: null, custom_prompt: '벚꽃 배경으로' } as Job

    expect(contextFromJob(custom)).toMatchObject({ styleId: null, customPrompt: '벚꽃 배경으로' })
  })

  it('스타일도 문구도 없는 job 도 재료 자체는 만든다', () => {
    /*
      프롬프트 로그가 job 보다 먼저 지워지면(`on_delete=SET_NULL`) 서버도 문구를
      모릅니다. 그래도 **사진은 있으므로** 재료는 성립합니다 — 여기서 null 을 내면
      "다른 스타일 고르기" 까지 막힙니다. 재생성이 불가하다는 판정은 호출부
      (W-06 `Regenerate`)가 `styleId === null && !customPrompt` 로 따로 합니다.
    */
    const orphan = { ...JOB, style_id: null, custom_prompt: null } as Job

    expect(contextFromJob(orphan)).not.toBeNull()
    expect(contextFromJob(orphan)?.uploadId).toBe('up_01HQZX')
  })
})

describe('withReuse', () => {
  it('쿼리가 없는 주소에는 ? 로 붙인다', () => {
    expect(withReuse('/styles', 'job_01HQZX')).toBe(`/styles?${REUSE_PARAM}=job_01HQZX`)
  })

  it('이미 쿼리가 있으면 & 로 잇는다', () => {
    /*
      «?» 를 두 번 붙이면 뒤쪽이 통째로 무시돼 스타일 선택이 사라집니다. 실제로
      `/upload?style_id=8` 에 이어 붙는 자리라(W-03) 이 분기가 늘 쓰입니다.
    */
    expect(withReuse('/upload?style_id=8', 'job_01HQZX')).toBe(
      `/upload?style_id=8&${REUSE_PARAM}=job_01HQZX`,
    )
  })

  it('재사용 중이 아니면 주소를 손대지 않는다', () => {
    // 평소 탐색에까지 빈 파라미터가 붙으면 주소가 지저분해지고 캐시 키도 갈립니다.
    expect(withReuse('/styles', null)).toBe('/styles')
  })

  it('job id 를 인코딩한다', () => {
    // 서버가 주는 값이라 지금은 안전하지만, 그대로 이어 붙이면 주소가 깨질 수 있습니다.
    expect(withReuse('/styles', 'a b&c')).toBe(`/styles?${REUSE_PARAM}=a%20b%26c`)
  })
})
