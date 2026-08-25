/**
 * 목의 계산기 링크 세 갈래 (mocks/handlers.ts `GET /v1/calculator-link` · FR-EDGE-10/11).
 *
 * 문구 규칙은 `api/calculatorLink.test.ts` 가, 화면은 `screens/W07Calculator.test.tsx` 가
 * 봅니다. 둘 다 응답을 **직접 써 넣고** 시작하므로, 목이 그 응답을 실제로 만들어 낼
 * 수 있는지는 아무도 안 봅니다. 그 빈칸이 위험한 이유는 화면 테스트가 전부 통과해도
 * 브라우저에서는 정상 케이스 하나만 보이는 상태가 가능하기 때문입니다 — 폴백을 못
 * 만드는 목은 폴백이 없는 앱과 구분되지 않습니다.
 *
 * 그래서 여기서는 업로드 → 생성 → 링크까지 **목이 스스로 따라가게** 두고, 견종 후보가
 * 어디서 오는지(비전 라벨)와 계산기 40종 매칭이 실제로 갈라지는지만 봅니다.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { BREED_SIZES, MIX_BREED } from './calculatorBreeds'
import { uploadNoDog, uploadOk, uploadWarned } from './fixtures'

const SCENARIO_KEY = 'nutti.mock.scenario'

afterEach(() => localStorage.removeItem(SCENARIO_KEY))

/** 업로드 → job 생성까지. 목의 견종 색인은 `upload_id` 로 되짚습니다. */
async function jobFromScenario(scenario: string | null): Promise<string> {
  if (scenario) localStorage.setItem(SCENARIO_KEY, scenario)

  const upload = await (await fetch('/v1/uploads', { method: 'POST' })).json()
  const created = await fetch('/v1/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      custom_prompt: null,
      style_id: 1,
      upload_id: upload.upload_id,
      pet_id: null,
    }),
  })
  return (await created.json()).job_id
}

async function linkFor(scenario: string | null) {
  const jobId = await jobFromScenario(scenario)
  return (await fetch(`/v1/calculator-link?job_id=${jobId}`)).json()
}

describe('목 · GET /v1/calculator-link', () => {
  it('계산기 40종에 있는 견종은 이름·크기를 그대로 넘긴다', async () => {
    const label = uploadOk.breed_estimate?.label
    const link = await linkFor(null)

    // 계산기에 코드 체계가 없어 code = label = 한글 견종명입니다(Q9 · PR #122).
    expect(link.breed_code).toBe(label)
    expect(link.breed_label).toBe(label)
    expect(link.size_label).toBe(BREED_SIZES[label!])
    expect(link.calculator_url).toContain(`breed=${label}`)
  })

  it('목록 밖 견종은 믹스견으로 떨어진다 (FR-EDGE-11)', async () => {
    /*
      `upload:warn` 의 추정은 «골든두들» 입니다 — 계산기 40종에 없는 이름이라 여기서
      비로소 폴백이 *일어납니다*. 픽스처에 «믹스견» 을 적어 두면 매칭이 성공할 뿐이라
      이 줄은 통과해도 폴백은 한 번도 안 밟힙니다.
    */
    const warned = uploadWarned.breed_estimate?.label ?? ''
    expect(warned).not.toBe(MIX_BREED)
    expect(warned in BREED_SIZES).toBe(false)

    const link = await linkFor('upload:warn')

    expect(link.breed_code).toBe(MIX_BREED)
    expect(link.breed_label).toBe(MIX_BREED)
    expect(link.size_label).toBe('중형')
  })

  it('강아지를 못 찾은 사진은 세 필드가 다 비고 URL 에서 breed 가 빠진다 (FR-EDGE-10)', async () => {
    // 업로드 경고 하나가 결과 화면 출구까지 이어지는 유일한 경로입니다.
    expect(uploadNoDog.breed_estimate).toBeNull()

    const link = await linkFor('upload:nodog')

    expect(link.breed_code).toBeNull()
    expect(link.breed_label).toBeNull()
    expect(link.size_label).toBeNull()
    expect(link.calculator_url).not.toContain('breed=')
    expect(link.calculator_url).not.toContain('size=')
    // 견종을 몰라도 계산기로 가는 길 자체는 남습니다(UTM 포함).
    expect(link.calculator_url).toContain('utm_campaign=calculator_handoff')
  })
})
