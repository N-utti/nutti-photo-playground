/**
 * 그림 안에 **아이 이름이 인쇄되는** 스타일 (PR #98).
 *
 * 워커가 프리셋 프롬프트의 `[pet name]` 을 생성 직전에 치환합니다(app/worker.py) —
 * 출처는 `source_image.pet_profile_id` → `PetProfile.name`, 없으면 `"우리 아이"`.
 * 그래서 이 스타일들은 **사진을 어디에 붙였는지가 결과물의 글자를 바꿉니다**:
 * 저장된 강아지를 고르지 않고 만들면 그림에 «우리 아이» 가 박혀서 나오고, 크레딧은
 * 이미 나간 뒤입니다. 화면이 말해 주지 않으면 사용자는 결과를 보고서야 압니다.
 *
 * **왜 코드를 프론트가 들고 있는가**: `GET /v1/styles` 도 `/styles/{id}` 도 이 사실을
 * 내려주지 않습니다(§3). 프롬프트 원문은 애초에 클라이언트로 오지 않으므로 지금은
 * 서버 응답만 보고 알아낼 방법이 없습니다 — 계약 필드(`uses_pet_name`)를 이슈 #101 로
 * 요청해 뒀고, 그게 오면 이 파일과 짝 테스트를 함께 지웁니다.
 *
 * **그때까지의 안전장치**: 이 목록은 `seeds/prompts/*.txt` 에서 `[pet name]` 을 가진
 * 파일과 같아야 하고, 그걸 `petNameStyles.test.ts` 가 매번 대조합니다. 프롬프트에
 * 이름이 새로 들어가거나 빠지면 테스트가 먼저 깨집니다. 다만 운영이 **DB 에서 직접**
 * 프롬프트를 고치면 저장소는 그 사실을 모릅니다 — 이 목록이 조용히 틀리는 유일한
 * 경로이고, 계약 필드가 필요한 이유이기도 합니다.
 */

/** 프로필이 없을 때 워커가 넣는 고정 호칭 (app/worker.py 와 같은 값). */
export const PET_NAME_FALLBACK = '우리 아이'

/**
 * 시드 코드 그대로입니다 — `GET /v1/styles` 의 `code` 와 같은 값이고, 표시명
 * (`name`)은 `code.replace("_", " ")` 라 밑줄만 다릅니다(scripts/seed_styles.py).
 */
const PET_NAME_STYLE_CODES: ReadonlySet<string> = new Set(['3D_피규어', '식빵', '이모티콘'])

/** 스타일 상세를 아직 못 받았으면 `undefined` 가 들어옵니다 — 그때는 «아니오» 입니다. */
export function usesPetName(code: string | null | undefined): boolean {
  return code != null && PET_NAME_STYLE_CODES.has(code)
}

/** 테스트가 목록 자체를 대조하려고 씁니다. 화면에서는 `usesPetName` 만 쓰세요. */
export function petNameStyleCodes(): string[] {
  return [...PET_NAME_STYLE_CODES].sort()
}
