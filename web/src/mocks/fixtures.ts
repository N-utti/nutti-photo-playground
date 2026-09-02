/**
 * docs/05-api-spec.md §3 의 JSON 예시를 그대로 옮긴 픽스처.
 *
 * 값을 임의로 바꾸지 마세요 — 이 파일이 §3 과 일치하는 동안에만 목이 계약을 대변합니다.
 * §3 이 바뀌면 여기도 같이 바꾸고, 백엔드가 실제 응답을 내기 시작하면 목을 끕니다.
 */

import type {
  Credits,
  LedgerEntry,
  LibraryItem,
  Pet,
  StyleCard,
  StyleCatalog,
  StyleDetail,
  StyleInputField,
  UploadResult,
} from '../api/types'
import styleInputManifest from './styleInputs.json'

/*
  스타일 입력 스키마(이슈 #114)는 **백엔드 매니페스트의 사본**입니다 —
  `seeds/style_inputs.json` 을 그대로 복사한 것이고, 시드가 그 파일을 그대로
  `style.input_fields` 에 넣습니다(scripts/seed_styles.py). 목이 스키마를 지어내면
  «서버가 낼 수 없는 폼» 위에서 화면을 만들게 되므로, 사본이 원본과 같은지는
  fixtures.test.ts 가 매번 대조합니다.

  `_comment` 는 매니페스트의 설명 줄이지 스타일 코드가 아닙니다.
*/
const STYLE_INPUTS: Record<string, StyleInputField[]> = Object.fromEntries(
  Object.entries(styleInputManifest as Record<string, unknown>).filter(
    ([code]) => code !== '_comment',
  ),
) as Record<string, StyleInputField[]>

/*
  `uses_pet_name`·`uses_breed` 는 서버가 **활성 프롬프트 원문**에서 계산합니다
  (app/routers/styles.py — `[pet name]`·`[breed]` 포함 여부). 프롬프트는 목이 가질 수
  없으니 결과값만 옮기고, `seeds/prompts/*.txt` 와 일치하는지는 fixtures.test.ts 가
  대조합니다. 예전에 프론트가 이 목록을 로직으로 들고 있다가 #110 의 프롬프트 교체를
  놓친 적이 있어서(이모티콘), 목록 자체보다 **대조가 있다는 사실**이 중요합니다.
*/
const PET_NAME_CODES = new Set(['3D_피규어', '식빵'])
const BREED_CODES = new Set(['3D_피규어'])

/**
 * 회색 박스 플레이스홀더. 와이어프레임(docs/wireframe-spec-v0.5.html)이
 * 실제 이미지 없이 `.img` 빈 박스로 그려져 있으므로 목도 같은 수준으로 둡니다.
 * 외부 이미지 호스트에 의존하지 않도록 data URI 로 만듭니다.
 *
 * 크기가 인자인 이유는 **비율이 화면을 가르기 때문**입니다 — 아래 두 상수 참고.
 * 기본값 정사각은 «비율이 상관없는 자리»(썸네일·예시)에만 씁니다.
 */
export function placeholderImage(
  label: string,
  tone = '#E1E2DC',
  size: { width: number; height: number } = { width: 400, height: 400 },
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
    <rect width="${size.width}" height="${size.height}" fill="${tone}"/>
    <text x="50%" y="50%" font-family="sans-serif" font-size="20" fill="#7D8179"
      text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * 결과 이미지는 **정사각이 아닙니다** (백엔드 #110 착지분).
 *
 * #110 이전의 유일한 실생성 경로는 `openai.images.edit(size="1024x1024")` 였고,
 * 그때는 결과가 언제나 정사각이었습니다. #110 이 그 앞에 fal 큐 경로를 붙이면서
 * (`FAL_KEY` 가 있으면 이쪽이 우선) 크기 지정이 `image_size: "auto"` — 즉 **모델이
 * 정하는 값**으로 바뀌었고, 프롬프트 원문이 캔버스를 직접 요구합니다:
 * 3D_피규어는 "vertical 3:4", 이모티콘은 "square canvas (1:1)". 워커의 서명 합성
 * (`_sign_and_encode_jpeg`)은 받은 크기를 그대로 두므로 그 비율이 그대로 나옵니다.
 *
 * `GenerationResult` 에는 width·height 컬럼이 없고 §3 job 응답도 크기를 안 주므로,
 * 프론트가 비율을 미리 아는 방법은 없습니다 — 이미지가 도착해야 알 수 있습니다.
 * 목이 계속 정사각만 내면 W-06 비교 슬라이더가 결과를 자르는지 아닌지를 브라우저에서
 * 한 번도 확인할 수 없어서, 실서버에 붙이는 날에야 잘린 결과를 보게 됩니다.
 */
export const RESULT_SIZE = { width: 400, height: 533 }

/**
 * 원본은 사용자 카메라가 정합니다 — 정사각인 쪽이 오히려 드뭅니다(휴대폰 기본 4:3).
 * 결과와 비율이 갈려야 W-06 비교 슬라이더에서 «어느 쪽을 자르는가»가 드러납니다.
 */
export const SOURCE_SIZE = { width: 400, height: 300 }

// ---------------------------------------------------------------- 스타일

/*
  스타일만 §3 예시가 아니라 **DB 실물**을 옮깁니다 (PR #95, scripts/seed_styles.py).

  §3 의 `lego-minifig`·`ghibli-watercolor` 는 스펙을 쓰던 시점의 **가상 코드**였고,
  시드가 착지한 지금 서버에는 없는 스타일입니다. 나머지 66 건은 애초에 규모만 맞추려고
  지어낸 것이었습니다. 실데이터가 생긴 뒤로는 그 목이 «서버가 낼 수 없는 카탈로그»가
  됩니다 — 섹션 7개(실제 4개), 전체 68개(실제 39개), 이름은 전부 "여름 스타일 3".

  이 차이는 화면에 그대로 나타납니다: 섹션명에 공백·가운뎃점이 들어가고(앵커 id),
  이름이 "어릴적나와우리아이" 처럼 띄어쓰기 없이 길고(카드 truncate), 비용은 전 스타일
  1 크레딧입니다. 목이 지어낸 이름을 주는 동안에는 셋 다 목 위에서 안 드러납니다.
*/
const SEED_SECTIONS: { name: string; codes: string[] }[] = [
  {
    name: '피규어·장난감',
    codes: [
      '3D_피규어',
      '레고',
      '프라모델',
      '인형뽑기',
      '스노우볼',
      '띠부씰',
      '이모티콘',
      '미니분신',
      '우리아이굿즈샵',
      '사물코스튬',
    ],
  },
  {
    name: '컨셉 사진관',
    codes: [
      '90년대가족사진관',
      '조선시대',
      '르네상스초상화',
      '취업아이',
      '갸루',
      '입덕직캠',
      '견생네컷',
      '거울셀카',
      '어릴적나와우리아이',
      '반려견의인화',
    ],
  },
  {
    name: '아트',
    codes: ['색연필드로잉', '하찮은크레파스', '메이플스토리', '아이소메트릭방', '우리아이라떼아트', '괴수'],
  },
  {
    name: '일상 유머',
    codes: [
      '식빵',
      '찜질방',
      '청문회',
      '퐁퐁견',
      '호캉스',
      '영화관',
      '새벽에몰래',
      '모래구멍',
      '수중샷',
      '반려견항공샷',
      '손바닥위반려견',
      '왕코클로즈업',
      '유리얼빡샷',
    ],
  },
]

/*
  id 는 **화면 순서와 다릅니다**.

  시드는 `sorted(dir.glob("*.txt"))` 로 파일명 순회하며 행을 만들고(id = 그 순서),
  `sort_order` 는 SECTION_MAP 순서로 따로 넣습니다. `GET /v1/styles` 는 sort_order 로
  정렬하므로 둘이 갈립니다 — 화면 첫 카드 "3D 피규어" 의 id 는 1 이 아닙니다.
  목이 id 를 화면 순서대로 매기면 «id 순 = 진열 순» 이라는 사실이 아닌 가정을
  프론트가 밟아도 여기서는 안 걸립니다.
*/
const CODES_BY_FILENAME = SEED_SECTIONS.flatMap((section) => section.codes).sort()

export const styleCatalog: StyleCatalog = (() => {
  const sections = SEED_SECTIONS.map(({ name, codes }) => {
    const styles: StyleCard[] = codes.map((code) => ({
      id: CODES_BY_FILENAME.indexOf(code) + 1,
      code,
      // 시드가 넣는 표시명은 파일명 그대로입니다 — `code.replace("_", " ")`.
      name: code.replace(/_/g, ' '),
      /*
        **전 스타일 채워져 있습니다** (백엔드 PR #141 · 이슈 #140).

        `thumbnail_url` 은 서버가 `example_keys[0]` 으로 만드는 값입니다
        (app/routers/styles.py). 시드가 프롬프트만 넣던 시절에는 전부 null 이었고
        실서버 카탈로그가 39칸 회색 자리표시자였는데, 이제 `scripts/seed_styles.py` 가
        `seeds/thumbnails/{code}.jpg` 를 올리고 `example_keys` 까지 채웁니다.

        2026-08-24 로컬 실측: 39/39 이미지가 뜨고 자리표시자 0 개. 그러니 여기서 null 을
        주면 **목이 실서버보다 나쁜 상태**를 그리게 됩니다 — 예전과 정반대 방향의 거짓말.
        썸네일이 없는 상태는 계약상 아직 가능하므로(예시 이미지 없는 스타일) 시나리오
        `styles:no-images` 로 남겨 둡니다.
      */
      thumbnail_url: placeholderImage(code.replace(/_/g, ' ')),
      credit_cost: 1, // 시드는 전 스타일 1 로 넣습니다(운영이 DB 에서 조정).
      uses_pet_name: PET_NAME_CODES.has(code),
      uses_breed: BREED_CODES.has(code),
      // 25종만 스키마를 갖고 나머지는 빈 배열입니다 — 빈 쪽이 기존 플로우 그대로입니다.
      input_fields: STYLE_INPUTS[code] ?? [],
    }))
    return { name, count: styles.length, styles }
  })

  const total = sections.reduce((sum, s) => sum + s.styles.length, 0)
  return { sections, total_count: total }
})()

/**
 * 예시 이미지가 **한 장도 없는** 스타일들 (시나리오 `styles:no-images`).
 *
 * 시드가 썸네일을 채운 지금(PR #141) 실서버에서는 안 나오는 상태지만, 계약상으로는
 * 여전히 가능합니다 — `thumbnail_url` 은 `example_keys` 가 비면 null 이고, 그 컬럼을
 * 강제하는 건 아무것도 없습니다. 기본 목에서 빠진 이 상태를 여기 남겨 두지 않으면
 * W-02 의 자리표시자와 W-03 의 캐러셀 생략을 브라우저에서 한 번도 못 밟습니다.
 */
export const styleCatalogNoImages: StyleCatalog = {
  sections: styleCatalog.sections.map((section) => ({
    ...section,
    styles: section.styles.map((style) => ({ ...style, thumbnail_url: null })),
  })),
  total_count: styleCatalog.total_count,
}

/**
 * 상세 응답의 예시·궁합 태그 상태 (시나리오로 갈아 끼웁니다).
 *
 * 예전에는 «비었다 / 채워졌다» 하나였는데, 그 스위치가 **세 값을 묶고 있었습니다**:
 * 썸네일 · 예시 · 궁합 태그. PR #141 로 앞의 둘만 채워지면서 셋이 서로 다른 상태가
 * 됐고, 하나로 두면 서버가 낼 수 없는 조합이 나옵니다.
 *
 *   - `seeded`    지금 실서버 — 예시 **1 장**, 궁합 태그 없음 (2026-08-24 실측)
 *   - `none`      예시 이미지가 없는 스타일 — 캐러셀 생략
 *   - `rich`      운영이 예시를 더 올리고 궁합 태그를 채운 뒤 — 캐러셀 페이저·궁합 칩
 *
 * `rich` 를 남기는 이유는 `example_keys` 가 리스트라서입니다. 시드는 코드당 1 장을
 * 넣지만 운영이 더 올리면 그날로 다장이 되고, 그때 처음 나타나는 UI(페이저 · «1 / 6»)
 * 가 있습니다 — 1 장짜리 기본 목만 두면 그 경로를 영영 못 밟습니다.
 */
export type StyleImageState = 'seeded' | 'none' | 'rich'

export function styleDetailFor(
  styleId: number,
  images: StyleImageState = 'seeded',
): StyleDetail | null {
  const card = styleCatalog.sections.flatMap((s) => s.styles).find((s) => s.id === styleId)
  if (!card) return null
  return {
    id: card.id,
    code: card.code,
    name: card.name,
    credit_cost: card.credit_cost,
    /*
      `thumbnail_url` 과 `examples` 는 **같은 `example_keys` 에서 나옵니다** —
      전자는 `example_keys[0]`, 후자는 전부(app/routers/styles.py). 그래서 이 둘이
      어긋나면 목이 서버가 낼 수 없는 조합을 만듭니다. 아래 세 갈래 모두 그 규칙을
      지킵니다: `examples[0]` 이 곧 카드의 썸네일이고, 빈 배열이면 썸네일도 null 입니다.
    */
    examples:
      images === 'none'
        ? []
        : images === 'rich'
          ? [
              placeholderImage(card.name),
              ...Array.from({ length: 5 }, (_, i) =>
                placeholderImage(`${card.name} 예시 ${i + 2}`),
              ),
            ]
          : [placeholderImage(card.name)],
    /*
      시드는 `fit_tags` 를 안 건드립니다(모델 기본값 `[]`). PR #141 이 채운 건 썸네일
      뿐이라 **이건 여전히 빈 배열입니다** — 2026-08-24 실측으로 확인했습니다. 채우는
      경로(`POST`/`PATCH /v1/admin/styles` 의 `fit_tags`)는 PR #182 로 열렸지만, 운영이
      실제로 넣기 전까지 실서버는 계속 빈 배열입니다. 그래서 기본 갈래는 `[]` 로 두고
      채워진 스타일은 `images === 'rich'` 로만 밟습니다.
    */
    fit_tags:
      images === 'rich'
        ? [
            { label: '소형견', score: 'good' },
            { label: '대형견', score: 'good' },
            { label: '검은 털', score: 'caution' },
          ]
        : [],
    /*
      2026-08-25 로컬 실측값입니다(`GET /v1/styles/4` · `/11` → 48).

      전에는 24 였고 «시드가 안 건드리는 컬럼 기본값» 이라고 적혀 있었는데, 백엔드
      #146 이 그 전제를 바꿨습니다 — 이제 `scripts/seed_styles.py` 가 `_AVG_SECONDS = 48`
      (실측 중앙값 47.4초, fal gpt-image-2 n=19)로 **기존 행까지 백필합니다**. 시드
      출력이 `skip:` 이라 안 건드리는 것처럼 보이지만 그 분기도 `avg_seconds` 를
      `update()` 합니다.

      **숫자만 보고 따라 고치지 마세요.** 이 값은 «스크립트 상수» 가 아니라 «그 스크립트를
      돌린 뒤의 DB» 를 대변합니다. 시드를 다시 돌리지 않은 서버는 여전히 24 이고, 목이
      먼저 48 을 말하면 서버를 앞질러 거짓말하는 게 됩니다. 바꿀 때는 시드 → API 실측 →
      이 값 순서로(절차는 인수인계 05번 §3 #134 행).
    */
    avg_duration_seconds: 48,
    output_count: 1, // Q4 확정 — 1요청 1장(§3 예시도 1).
    // 상세는 카드와 같은 값을 냅니다(app/routers/styles.py 의 두 응답 모델).
    uses_pet_name: card.uses_pet_name,
    uses_breed: card.uses_breed,
    input_fields: card.input_fields,
  }
}

// ---------------------------------------------------------------- 업로드 케이스
//
// §3 예시는 정상·경고·차단 3개만 보여 주지만, **판정 코드는 §1 표에 5개**가 있습니다
// (`QUALITY_WARNING`·`NOT_A_DOG`·`MULTI_SUBJECT`·`HUMAN_FACE_DETECTED`·`CAT_DETECTED`).
// 예시 3개만 목에 넣어 두면 W-04 의 `WarningCard` 가 코드별로 다른 조언을 준비해 놨는데도
// (FR-EDGE-06·08·09) 그중 셋이 목 위에서 한 번도 안 그려집니다 — 화면은 멀쩡해 보이고
// 분기는 영영 검증되지 않는, 이 프로젝트에서 이미 두 번 나온 실패 모양입니다.

export const uploadOk: UploadResult = {
  upload_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  image_url: placeholderImage('업로드 원본', undefined, SOURCE_SIZE),
  blocking_issue: null,
  warnings: [],
}

export const uploadWarned: UploadResult = {
  upload_id: '9c858901-8a57-4791-81fe-4c455b099bc9',
  image_url: placeholderImage('업로드 원본', undefined, SOURCE_SIZE),
  blocking_issue: null,
  warnings: [
    { code: 'QUALITY_WARNING', message: '얼굴이 조금 어두워요', detail: { issues: ['dark'] } },
  ],
}

/** FR-EDGE-08 · 강아지가 없는 사진 — 경고만, 진행 허용. */
export const uploadNoDog: UploadResult = {
  upload_id: 'c1d2e3f4-0000-4000-8000-00000000ed08',
  image_url: placeholderImage('업로드 원본', undefined, SOURCE_SIZE),
  blocking_issue: null,
  warnings: [
    { code: 'NOT_A_DOG', message: '강아지를 찾지 못했어요', detail: { issues: ['no_subject'] } },
  ],
}

/** FR-EDGE-09 · 여러 마리 — "함께 변환" 안내 후 진행 허용. */
export const uploadMultiSubject: UploadResult = {
  upload_id: 'c1d2e3f4-0000-4000-8000-00000000ed09',
  image_url: placeholderImage('업로드 원본', undefined, SOURCE_SIZE),
  blocking_issue: null,
  warnings: [
    { code: 'MULTI_SUBJECT', message: '강아지가 두 마리 보여요', detail: { count: 2 } },
  ],
}

/**
 * FR-EDGE-06 · 사람 얼굴 — `app_setting.human_face_policy` 가 갈라놓는 **한 코드의 두 얼굴**.
 *
 * `warn` 이면 `warnings[]`, `block` 이면 `blocking_issue` 로 같은 코드가 내려옵니다(§1).
 * 프론트가 정하는 값이 아니라 서버 설정이라 목에서도 시나리오 둘로 나눠 둡니다 —
 * 한쪽만 두면 «정책이 block 인 매장에서 이 화면이 어떻게 보이는가»를 못 봅니다.
 */
export const uploadHumanFaceWarned: UploadResult = {
  upload_id: 'c1d2e3f4-0000-4000-8000-00000000ed06',
  image_url: placeholderImage('업로드 원본', undefined, SOURCE_SIZE),
  blocking_issue: null,
  warnings: [
    { code: 'HUMAN_FACE_DETECTED', message: '사람 얼굴이 함께 담겼어요', detail: { faces: 1 } },
  ],
}

export const uploadHumanFaceBlocked: UploadResult = {
  upload_id: null,
  image_url: null,
  blocking_issue: {
    code: 'HUMAN_FACE_DETECTED',
    message: '사람 얼굴이 담긴 사진은 지금 만들 수 없어요. 강아지만 나온 사진을 골라주세요.',
  },
  warnings: [],
}

export const uploadBlocked: UploadResult = {
  upload_id: null,
  image_url: null,
  blocking_issue: {
    code: 'CAT_DETECTED',
    message: '누띠는 강아지 전용이에요. 다른 사진을 골라주세요.',
  },
  warnings: [],
}

// ---------------------------------------------------------------- 펫 · 크레딧 · 보관함

/**
 * `latest_upload_id` 를 한쪽만 채웁니다(이슈 #9 A안).
 *
 * 둘 다 값이 있으면 "업로드 만료·삭제로 스킵이 안 되는" 경로(FR-W04-02 폴백)를 목
 * 위에서 한 번도 못 밟습니다 — 콩이는 바로 만들기, 두부는 사진을 새로 올리는 쪽입니다.
 */
export const petList: Pet[] = [
  {
    id: 'b6f9e6b0-0000-4000-8000-000000000001',
    name: '콩이',
    thumbnail_url: placeholderImage('콩이'),
    latest_upload_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    // 지난번에 이 강아지로 만들 때 고른 견종 — W-04 가 미리 채우는 경로를 목에서 밟게 합니다.
    breed: '토이푸들',
  },
  {
    id: 'd1a2b3c4-0000-4000-8000-000000000002',
    name: '두부',
    // 두 null 은 서로 다른 사안입니다 — 썸네일 없음(`thumbnail_key` 빈 행)은
    // 자리 표시자 경로를, latest_upload_id 없음은 스킵 불가 경로를 각각 만듭니다.
    thumbnail_url: null,
    latest_upload_id: null,
    breed: null,
  },
  {
    /*
      **사진은 없는데 견종은 아는 강아지.** 실서버는 계산기 링크를 만들 때 강아지에
      저장된 견종(`pet_profile.breed_label`)을 1순위로 보고, 없을 때만 그 강아지의 최신
      사진에 적힌 견종으로 내려갑니다(app/routers/results.py, 백엔드 PR #211). 이 조합이
      없으면 목이 그 순서를 뒤집어도 드러나지 않습니다 — 콩이는 사진과 견종이 **둘 다**
      있는 데다 그 견종이 하필 `SEED_BREED` 와 같은 값이라, 어느 쪽을 읽든 결과가 같기
      때문입니다. 두부는 반대로 둘 다 없어서 역시 못 가릅니다.

      견종을 「웰시코기」로 둔 것도 그래서입니다. `SEED_BREED` 와 다르고 계산기 목록
      안에 있는 값이라, 순서가 틀리면 견종이 사라지고 맞으면 «중형» 까지 따라옵니다.
    */
    id: 'e5f6a7b8-0000-4000-8000-000000000003',
    name: '보리',
    thumbnail_url: placeholderImage('보리'),
    latest_upload_id: null,
    breed: '웰시코기',
  },
]

export const initialCredits: Credits = {
  balance: 11,
  /*
    실서버 실측값입니다 — `app_setting` 에 `custom_prompt_credit_cost` 행이 없어서
    `GET /v1/credits` 가 폴백 2 를 내려 줍니다(app/credits.py). 그 행을 만드는 수단은
    PR #186 이 열었지만(`PATCH /v1/admin/settings/{key}`, 없으면 새로 만듭니다) 운영이
    아직 안 눌러서 폴백 그대로입니다 — 즉 이 값은 «정책값» 이 아니라 «미설정» 입니다.
    «2 가 아닌 서버» 는 시나리오 `credit:custom-cost-3` 으로 밟습니다 — handlers.ts 의
    customPromptCost().
  */
  custom_prompt_credit_cost: 2,
  earn_actions: [
    { action: 'order', amount: 20, status: 'available', cta: '쇼핑몰 →' },
    // 미연동이 기본값입니다 — done 으로 고정해 두면 연동 CTA(카페24 authorize → 콜백 +3)를
    // 목 위에서 한 번도 밟아 볼 수 없습니다. 연동 콜백이 done 으로 바꿔 줍니다.
    { action: 'link_account', amount: 3, status: 'available', cta: '연동하기' },
    { action: 'follow_ig', amount: 2, status: 'available', cta: '받기' },
    { action: 'daily', amount: 1, status: 'tomorrow', cta: '내일 다시' },
  ],
}

export const ledgerEntries: LedgerEntry[] = [
  { reason: 'generation_charge', ref_label: '레고', occurred_on: '2026-08-03', amount: -1 },
  { reason: 'order_reward', ref_label: '#20260802', occurred_on: '2026-08-02', amount: 20 },
  /*
    ref_label 은 서버가 스타일명으로 채웁니다 — 시드에 없는 이름("지브리")을 쓰면 목에서만
    존재하는 스타일이 원장에 남습니다. 금액도 2 → 1 입니다: 반환은 차감액과 같은 값이고,
    시드가 넣은 39종은 전부 1 크레딧이라 2 가 나올 수 있는 스타일이 지금은 없습니다.
  */
  { reason: 'generation_refund', ref_label: '스노우볼', occurred_on: '2026-08-02', amount: 1 },
  { reason: 'link_account', ref_label: null, occurred_on: '2026-07-28', amount: 3 },
  { reason: 'daily_free', ref_label: null, occurred_on: '2026-07-28', amount: 1 },
  // §3 예시에는 없지만 서버가 실제로 내려주는 사유입니다(app/models.py CreditReason) —
  // 세이프티 차단 반환. 목에 없으면 W-10 B 의 라벨 표에 이 값이 있는지 확인할 길이 없습니다.
  { reason: 'safety_block_refund', ref_label: '레고', occurred_on: '2026-07-27', amount: 1 },
  /*
    주문 취소 회수 (FR-EDGE-05 · 04-erd §3.2 `order_clawback`). 같은 이유로 넣습니다 —
    `ledgerFormat.ts` 에 «주문 취소» 라벨이 **적혀만** 있고 목이 그 행을 못 만들어서,
    이 표에서 그 라벨이 실제로 나오는지도 음수 표기(−, U+2212 · `text-danger`)가
    맞는지도 확인할 길이 없었습니다. 원장에서 **금액이 큰 음수**는 여기서만 나옵니다
    (생성 차감은 −1·−2 라 자릿수가 다릅니다).

    바로 위 `order_reward` 와 같은 주문(`#20260802`)입니다 — 짝이 안 맞으면 표가
    «받은 적 없는 주문을 회수당한» 이력을 보여 주게 됩니다.
  */
  { reason: 'order_clawback', ref_label: '#20260802', occurred_on: '2026-07-26', amount: -20 },
]

/**
 * 보관함 시드 — §3 예시 1건(첫 항목, 값 그대로)에 과거 결과를 더 얹은 목록입니다.
 *
 * 1건만 두면 W-09 를 이루는 세 축을 목 위에서 **한 번도 밟을 수 없습니다** — 월 섹션
 * 그룹핑(FR-W09-02)에는 달이 둘 이상 필요하고, 강아지 필터(FR-W09-01)에는 펫이 갈리는
 * 항목이, 커서 페이지네이션에는 한 페이지를 넘기는 개수가 필요합니다.
 *
 * `pet_id: null` 항목을 하나 섞어 둡니다 — 펫을 지운 뒤 남은 결과(이슈 #12 결정4)가
 * «전체»에서만 보이는 상태이고, 이게 W-12 삭제 확인 문구가 약속한 결과입니다.
 *
 * 응답 조립(월 묶기·필터·커서)은 픽스처가 아니라 핸들러가 합니다 — 서버가 하는 일이라서.
 */
export const libraryItems: LibraryItem[] = [
  // §3 예시 그대로. id 두 개와 시각을 바꾸지 마세요.
  {
    job_id: 'b3e13c4a-2f1e-4a3a-9b1e-1234567890ab',
    result_id: 'e5f6a7b8-0000-4000-8000-000000000001',
    image_url: placeholderImage('결과 1', undefined, RESULT_SIZE),
    pet_id: petList[0].id,
    created_at: '2026-08-03T10:00:00+09:00',
  },
  ...[
    { day: '2026-08-02', pet: petList[0].id },
    { day: '2026-08-02', pet: petList[1].id },
    { day: '2026-08-01', pet: petList[1].id },
    { day: '2026-07-30', pet: petList[0].id },
    { day: '2026-07-28', pet: null },
    { day: '2026-07-27', pet: petList[1].id },
    { day: '2026-07-21', pet: petList[0].id },
  ].map((row, index) => {
    const serial = String(index + 2).padStart(12, '0')
    return {
      job_id: `b3e13c4a-2f1e-4a3a-9b1e-${serial}`,
      result_id: `e5f6a7b8-0000-4000-8000-${serial}`,
      image_url: placeholderImage(`결과 ${index + 2}`, undefined, RESULT_SIZE),
      pet_id: row.pet,
      created_at: `${row.day}T10:00:00+09:00`,
    }
  }),
]
