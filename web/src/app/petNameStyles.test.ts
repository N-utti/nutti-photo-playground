/**
 * 프론트가 들고 있는 «이름이 그림에 들어가는 스타일» 목록을 **프롬프트 원문과 대조**
 * 합니다 (app/petNameStyles.ts · PR #98).
 *
 * 막으려는 결함: 이 목록은 서버 응답이 아니라 저장소 안의 사실을 옮겨 적은 것입니다.
 * 프롬프트에 `[pet name]` 이 새로 들어가거나 빠지면 화면의 안내가 **조용히 틀립니다**
 * — 안내가 없는 스타일이 결과물에 «우리 아이» 를 박아 내보내거나, 이름이 안 들어가는
 * 스타일에서 이름 얘기를 하게 됩니다. 둘 다 눈으로 보는 QA 로는 결과가 나오기 전까지
 * 안 걸립니다.
 *
 * 한계: 여기서 보는 건 `seeds/prompts/*.txt` 이지 DB 가 아닙니다. 운영이 DB 에서 직접
 * 프롬프트를 고치면 이 테스트는 통과하면서 화면만 틀립니다 — 계약 필드
 * (`uses_pet_name`)가 오면 목록도 이 테스트도 필요 없어집니다.
 */

/*
  node 타입은 이 파일에서만 엽니다.

  앱 tsconfig 는 `types: ["vite/client"]` 라 화면 코드에 `fs`·`process` 가 없습니다 —
  그게 맞습니다. 여기만 예외인 이유는 읽어야 할 대상이 **번들 밖의 저장소 파일**이라서
  입니다. vite 의 `import.meta.glob` 으로 가져오는 길은 막혀 있습니다: `seeds/` 가
  web/ 바깥이라 `server.fs.allow` 에 걸립니다("Denied ID"). 그걸 열면 개발 서버가
  저장소 전체를 서빙하게 되므로, 테스트 하나를 위해 치를 대가가 아닙니다.
*/
/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { petNameStyleCodes, usesPetName, PET_NAME_FALLBACK } from './petNameStyles'

/**
 * 저장소 루트의 `seeds/prompts`.
 *
 * `import.meta.url` 로 잡지 않습니다 — vitest 가 넘기는 값이 file: 스킴이 아니라
 * `fileURLToPath` 가 던집니다. cwd 는 실행 위치(web/ 또는 저장소 루트)에 따라 다르므로
 * 위로 올라가며 찾고, 못 찾으면 `readdirSync` 가 던져 조용히 통과하지 않게 둡니다.
 */
function findPromptDir(): string {
  let dir = process.cwd()
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = join(dir, 'seeds', 'prompts')
    if (existsSync(candidate)) return candidate
    dir = dirname(dir)
  }
  return join(process.cwd(), 'seeds', 'prompts')
}

const PROMPT_FILES = readdirSync(findPromptDir()).filter((file) => file.endsWith('.txt'))

function codesWithPlaceholderInPrompts(): string[] {
  const dir = findPromptDir()
  return PROMPT_FILES.filter((file) => readFileSync(join(dir, file), 'utf8').includes('[pet name]'))
    .map((file) => file.replace(/\.txt$/, ''))
    .sort()
}

describe('이름이 그림에 들어가는 스타일', () => {
  it('목록이 프롬프트 원문의 [pet name] 과 정확히 같다', () => {
    // 프롬프트를 한 장도 못 읽었으면 위 비교는 «빈 배열 vs 빈 배열» 이 아니라 그냥
    // 아무것도 검증하지 않은 것입니다 — 39종이 잡혔는지 먼저 확인합니다.
    expect(PROMPT_FILES.length).toBeGreaterThan(30)
    expect(petNameStyleCodes()).toEqual(codesWithPlaceholderInPrompts())
  })

  it('시드 코드로 판정하고, 스타일을 아직 못 받았으면 아니오다', () => {
    expect(usesPetName('식빵')).toBe(true)
    // 표시명(`code.replace("_", " ")`)이 아니라 **코드**로 봅니다 — 둘은 밑줄만 다릅니다.
    expect(usesPetName('3D_피규어')).toBe(true)
    expect(usesPetName('3D 피규어')).toBe(false)
    expect(usesPetName('찜질방')).toBe(false)
    expect(usesPetName(undefined)).toBe(false)
    expect(usesPetName(null)).toBe(false)
  })

  it('폴백 호칭이 워커와 같은 값이다', () => {
    // app/worker.py 의 `pet_name = "우리 아이"` — 여기가 갈리면 화면이 예고한 글자와
    // 그림에 박히는 글자가 달라집니다.
    expect(PET_NAME_FALLBACK).toBe('우리 아이')
  })
})
