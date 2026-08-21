/**
 * 목 픽스처가 **백엔드의 실물 시드와 같은 말을 하는지** 대조합니다
 * (mocks/fixtures.ts · 이슈 #114 · 이슈 #101).
 *
 * 막으려는 결함: 스타일 입력 스키마(`input_fields`)와 이름·견종 인쇄 플래그
 * (`uses_pet_name`·`uses_breed`)는 목이 지어낼 수 없는 값입니다. 전자는 시드가
 * `seeds/style_inputs.json` 을 그대로 컬럼에 넣고(scripts/seed_styles.py), 후자는
 * 서버가 활성 프롬프트에서 `[pet name]`·`[breed]` 를 찾아 계산합니다
 * (app/routers/styles.py). 목이 이 둘을 임의로 적으면 «서버가 낼 수 없는 폼» 위에서
 * 화면을 만들게 되고, 그 차이는 실서버에 붙이는 날에야 드러납니다.
 *
 * 이건 새 안전장치가 아니라 **자리를 옮긴 안전장치**입니다. 같은 대조를 예전에는
 * `app/petNameStyles.test.ts` 가 프론트 하드코딩 목록에 걸어 두고 있었고, 실제로
 * #110 의 프롬프트 교체(이모티콘)를 잡아냈습니다. 판정이 서버 계약 필드로 옮겨 가면서
 * 그 목록은 지웠지만, 목은 여전히 값을 들고 있으므로 대조도 여기로 따라옵니다.
 *
 * 한계는 그대로입니다: 여기서 보는 건 저장소의 시드이지 DB 가 아닙니다. 운영이 DB 에서
 * 프롬프트나 스키마를 직접 고치면 이 테스트는 통과하면서 목만 낡습니다.
 */

/*
  node 타입은 이 파일에서만 엽니다 — 읽어야 할 대상이 **번들 밖의 저장소 파일**입니다.
  vite 의 `import.meta.glob` 으로 가져오는 길은 막혀 있습니다: `seeds/` 가 web/ 바깥이라
  `server.fs.allow` 에 걸립니다("Denied ID"). 그걸 열면 개발 서버가 저장소 전체를
  서빙하게 되므로, 테스트 하나를 위해 치를 대가가 아닙니다.
*/
/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { styleCatalog } from './fixtures'
import mockManifest from './styleInputs.json'

/**
 * 저장소 루트를 찾습니다.
 *
 * `import.meta.url` 로 잡지 않습니다 — vitest 가 넘기는 값이 file: 스킴이 아니라
 * `fileURLToPath` 가 던집니다. cwd 는 실행 위치(web/ 또는 저장소 루트)에 따라 다르므로
 * 위로 올라가며 찾습니다.
 */
function repoPath(...parts: string[]): string {
  let dir = process.cwd()
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(join(dir, 'seeds'))) return join(dir, ...parts)
    dir = dirname(dir)
  }
  return join(process.cwd(), ...parts)
}

const PROMPT_DIR = repoPath('seeds', 'prompts')
const PROMPT_FILES = readdirSync(PROMPT_DIR).filter((file) => file.endsWith('.txt'))

function codesWithPlaceholder(placeholder: string): string[] {
  return PROMPT_FILES.filter((file) =>
    readFileSync(join(PROMPT_DIR, file), 'utf8').includes(placeholder),
  )
    .map((file) => file.replace(/\.txt$/, ''))
    .sort()
}

const cards = styleCatalog.sections.flatMap((section) => section.styles)

describe('목 픽스처 · 백엔드 시드 대조', () => {
  /*
    프롬프트를 한 장도 못 읽었다면 아래 비교들은 «빈 배열 vs 빈 배열» 이 되어
    아무것도 검증하지 않은 채 통과합니다 — 39종이 잡혔는지 먼저 확인합니다.
  */
  it('시드 프롬프트와 스타일 카드를 실제로 읽었다', () => {
    expect(PROMPT_FILES.length).toBeGreaterThan(30)
    expect(cards.length).toBe(PROMPT_FILES.length)
  })

  it('입력 스키마 사본이 seeds/style_inputs.json 과 완전히 같다', () => {
    const source = JSON.parse(readFileSync(repoPath('seeds', 'style_inputs.json'), 'utf8'))
    expect(mockManifest).toEqual(source)
  })

  it('스키마를 가진 스타일과 빈 스타일이 매니페스트대로 갈린다', () => {
    const manifest = { ...(mockManifest as Record<string, unknown>) }
    delete manifest._comment

    const withFields = cards
      .filter((card) => card.input_fields.length > 0)
      .map((card) => card.code)
      .sort()
    expect(withFields).toEqual(Object.keys(manifest).sort())

    // 스키마의 키는 전부 실재하는 스타일이어야 합니다 — 오타 하나면 그 폼은 영영 안 뜹니다.
    for (const code of Object.keys(manifest)) {
      expect(cards.some((card) => card.code === code)).toBe(true)
    }
  })

  it('uses_pet_name 이 프롬프트의 [pet name] 과 정확히 같다', () => {
    const flagged = cards
      .filter((card) => card.uses_pet_name)
      .map((card) => card.code)
      .sort()
    expect(flagged).toEqual(codesWithPlaceholder('[pet name]'))
  })

  it('uses_breed 가 프롬프트의 [breed] 와 정확히 같다', () => {
    const flagged = cards
      .filter((card) => card.uses_breed)
      .map((card) => card.code)
      .sort()
    expect(flagged).toEqual(codesWithPlaceholder('[breed]'))
  })
})
