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
import { libraryItems, petList, uploadNoDog, uploadOk, uploadWarned } from './fixtures'

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

/**
 * `?pet_id=` — 보관함(W-09)에서 강아지를 골라 들어오는 진입.
 *
 * 서버는 여기서도 같은 체인을 탑니다: 펫 → **그 펫의 최신 업로드** → 견종
 * (`app/routers/results.py` `_resolve_pet_and_estimate`). 목이 이 경로를 오랫동안
 * 상수(정상 케이스)로 답해서, W-09 가 링크를 단 뒤에도 나머지 갈래가 브라우저에서
 * 한 번도 안 밟혔습니다.
 */
describe('목 · GET /v1/calculator-link?pet_id=', () => {
  const linkForPet = async (petId: string) => fetch(`/v1/calculator-link?pet_id=${petId}`)

  it('사진이 있는 강아지는 그 사진의 추정을 따라간다', async () => {
    const pet = petList[0]
    expect(pet.latest_upload_id).toBe(uploadOk.upload_id)

    const link = await (await linkForPet(pet.id)).json()

    expect(link.breed_code).toBe(uploadOk.breed_estimate?.label)
    // 이름은 저장된 강아지가 있을 때만 붙습니다.
    expect(link.calculator_url).toContain(`name=${pet.name}`)
  })

  it('사진이 한 장도 없는 강아지는 견종이 비어 온다 (FR-EDGE-10)', async () => {
    /*
      **이 갈래가 목에 없던 것입니다.** «두부» 는 `latest_upload_id: null` 이라 추정할
      사진 자체가 없고, 서버는 `breed_code: null` 을 답합니다 — 계산기 1단계부터입니다.
      목이 여기에 토이푸들을 채워 넣는 동안 W-09 → W-07 은 늘 정상 케이스만 보였고,
      «사진에서 토이푸들로 봤어요» 가 **사진이 없는 강아지에게** 떴습니다.
    */
    const pet = petList[1]
    expect(pet.latest_upload_id).toBeNull()

    const link = await (await linkForPet(pet.id)).json()

    expect(link.breed_code).toBeNull()
    expect(link.size_label).toBeNull()
    expect(link.calculator_url).not.toContain('breed=')
    // 견종은 몰라도 이름은 압니다 — 저장된 강아지니까요.
    expect(link.calculator_url).toContain(`name=${pet.name}`)
  })

  it('없는 강아지는 폴백이 아니라 404 다', async () => {
    // 마이페이지에서 강아지를 지운 뒤 히스토리·북마크로 돌아오는 자리입니다. 200 을
    // 주면 지워진 강아지로 앱 밖 계산기에 넘어가고, 거기서는 되돌릴 곳이 없습니다.
    const response = await linkForPet('b6f9e6b0-0000-4000-8000-000000000404')

    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })
})

/**
 * `?job_id=` 로 들어온 **시드 job** — 보관함에서 연 과거 결과입니다.
 *
 * 이 경로는 W-06 계산기 배너가 씁니다. 서버는 `job.source_image.pet_profile_id` 로 펫을
 * 찾아 URL 에 `name=` 을 넣는데, 목이 그 자리를 비워 두면 **콩이 것을 열어도 배너가
 * «우리 아이는» 이라고** 부릅니다 — 이름 없는 경우를 위한 폴백이 이름을 아는 결과를
 * 덮는 것이라, 보관함에서 «콩이» 로 필터까지 걸고 들어온 사용자에게 특히 이상합니다.
 */
describe('목 · GET /v1/calculator-link?job_id= (보관함 시드)', () => {
  it('보관함에서 연 결과는 그 강아지 이름을 부른다', async () => {
    const item = libraryItems[0]
    const pet = petList.find((entry) => entry.id === item.pet_id)
    expect(pet).toBeDefined()

    const link = await (await fetch(`/v1/calculator-link?job_id=${item.job_id}`)).json()

    expect(link.calculator_url).toContain(`name=${pet!.name}`)
  })

  it('펫 없이 만든 결과는 이름을 지어내지 않는다', async () => {
    // 시드에 `pet_id: null` 항목이 하나 있습니다(펫을 지운 뒤 남은 결과 · 이슈 #12 결정4).
    // 여기서 이름이 붙으면 화면이 **남의 강아지 이름**을 부르게 됩니다.
    const orphan = libraryItems.find((item) => item.pet_id === null)
    expect(orphan).toBeDefined()

    const link = await (await fetch(`/v1/calculator-link?job_id=${orphan!.job_id}`)).json()

    expect(link.calculator_url).not.toContain('name=')
  })
})
