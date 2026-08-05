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
  StyleCatalog,
  StyleDetail,
  UploadResult,
} from '../api/types'

/**
 * 회색 박스 플레이스홀더. 와이어프레임(docs/wireframe-spec-v0.5.html)이
 * 실제 이미지 없이 `.img` 빈 박스로 그려져 있으므로 목도 같은 수준으로 둡니다.
 * 외부 이미지 호스트에 의존하지 않도록 data URI 로 만듭니다.
 */
export function placeholderImage(label: string, tone = '#E1E2DC'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="${tone}"/>
    <text x="50%" y="50%" font-family="sans-serif" font-size="20" fill="#7D8179"
      text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// ---------------------------------------------------------------- 스타일

/**
 * 섹션 구성. 앵커바 칩 목록(#p02 데스크톱 프레임)과 같은 7개이고,
 * 개수 합은 §3 `total_count: 68` · W-02 "전체 68개"에 맞춥니다.
 * '인기'는 아래에서 §3 예시 2건을 앞에 끼우므로 6 + 2 = 8 이 됩니다.
 */
const SECTIONS = [
  { name: '인기', generated: 6 },
  { name: '여름', generated: 12 },
  { name: '직업', generated: 10 },
  { name: '영화', generated: 10 },
  { name: '아트', generated: 10 },
  { name: '시즌', generated: 8 },
  { name: '동화', generated: 10 },
] as const

/**
 * §3 예시의 2개 스타일을 포함하되, W-02 가 "전체 68개"라 그 규모를 재현합니다.
 * 생성 id 는 200 부터 — §3 예시가 쓰는 101·108 과 겹치면 안 됩니다.
 */
export const styleCatalog: StyleCatalog = (() => {
  let nextId = 200
  const sections = SECTIONS.map(({ name, generated }) => {
    const items = Array.from({ length: generated }, (_, i) => {
      const id = nextId++
      return {
        id,
        code: `style-${id}`,
        name: `${name} 스타일 ${i + 1}`,
        thumbnail_url: placeholderImage(`${name} ${i + 1}`),
        credit_cost: i % 4 === 3 ? 2 : 1,
      }
    })
    return { name, count: items.length, styles: items }
  })

  // §3 예시와 동일한 두 건을 인기 섹션 앞에 고정 배치.
  sections[0].styles.unshift(
    {
      id: 101,
      code: 'lego-minifig',
      name: '레고 미니피겨',
      thumbnail_url: placeholderImage('레고 미니피겨'),
      credit_cost: 1,
    },
    {
      id: 108,
      code: 'ghibli-watercolor',
      name: '지브리 수채',
      thumbnail_url: placeholderImage('지브리 수채'),
      credit_cost: 2,
    },
  )
  sections[0].count = sections[0].styles.length

  const total = sections.reduce((sum, s) => sum + s.styles.length, 0)
  return { sections, total_count: total }
})()

export function styleDetailFor(styleId: number): StyleDetail | null {
  const card = styleCatalog.sections.flatMap((s) => s.styles).find((s) => s.id === styleId)
  if (!card) return null
  return {
    id: card.id,
    code: card.code,
    name: card.name,
    credit_cost: card.credit_cost,
    examples: Array.from({ length: 6 }, (_, i) => placeholderImage(`${card.name} 예시 ${i + 1}`)),
    fit_tags: [
      { label: '소형견', score: 'good' },
      { label: '대형견', score: 'good' },
      { label: '검은 털', score: 'caution' },
    ],
    avg_duration_seconds: 24,
    output_count: 1, // Q4 확정 — 1요청 1장(§3 예시도 1).
  }
}

// ---------------------------------------------------------------- 업로드 3케이스 (§3)

export const uploadOk: UploadResult = {
  upload_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  image_url: placeholderImage('업로드 원본'),
  blocking_issue: null,
  warnings: [],
  breed_estimate: { code: 'toy_poodle', label: '토이푸들', confidence: 0.82 },
}

export const uploadWarned: UploadResult = {
  upload_id: '9c858901-8a57-4791-81fe-4c455b099bc9',
  image_url: placeholderImage('업로드 원본'),
  blocking_issue: null,
  warnings: [
    { code: 'QUALITY_WARNING', message: '얼굴이 조금 어두워요', detail: { issues: ['dark'] } },
  ],
  breed_estimate: { code: 'mixed', label: '믹스견', confidence: 0.41 },
}

export const uploadBlocked: UploadResult = {
  upload_id: null,
  image_url: null,
  blocking_issue: {
    code: 'CAT_DETECTED',
    message: '누띠는 강아지 전용이에요. 다른 사진을 골라주세요.',
  },
  warnings: [],
  breed_estimate: null,
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
  },
  {
    id: 'd1a2b3c4-0000-4000-8000-000000000002',
    name: '두부',
    thumbnail_url: placeholderImage('두부'),
    latest_upload_id: null,
  },
]

export const initialCredits: Credits = {
  balance: 11,
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
  { reason: 'generation_refund', ref_label: '지브리', occurred_on: '2026-08-02', amount: 2 },
  { reason: 'link_account', ref_label: null, occurred_on: '2026-07-28', amount: 3 },
  { reason: 'daily_free', ref_label: null, occurred_on: '2026-07-28', amount: 1 },
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
    image_url: placeholderImage('결과 1'),
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
      image_url: placeholderImage(`결과 ${index + 2}`),
      pet_id: row.pet,
      created_at: `${row.day}T10:00:00+09:00`,
    }
  }),
]
