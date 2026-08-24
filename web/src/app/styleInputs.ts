/**
 * 스타일별 입력값의 초기화·검증 (이슈 #114 · 백엔드 #116·#118).
 *
 * 화면이 아니라 여기에 두는 이유는 **서버와 같은 규칙을 말해야 하기 때문**입니다.
 * `app/routers/jobs.py` `_resolve_input_values` 가 최종 판정이고, 이 파일은 그 판정을
 * 왕복 전에 미리 하는 사본입니다. 규칙이 화면 JSX 안에 흩어지면 서버가 바뀔 때
 * 어디를 맞춰야 하는지 알 수 없어집니다.
 *
 * 서버 규칙(그대로 옮긴 것):
 *   - 빈 값은 **보내지 않습니다** → 서버가 `default` 로 채우고, default 가 없는
 *     `prefill` 필드는 워커가 강아지 이름(없으면 «우리 아이»)으로 채웁니다
 *   - `max_length` 초과 · `pattern` 불일치 → 400
 *   - `type: 'choice'` 이고 `allow_custom` 이 아니면 목록 밖 값 → 400
 *   - 스키마에 없는 라벨은 **서버가 조용히 버리고 생성을 계속합니다**(백엔드 PR #139).
 *     예전에는 400 `unknown_inputs` 였습니다 — 그때는 크레딧이 안 나갔지만 지금은 나갑니다.
 */

import type { StyleInputField } from '../api/types'

/** 워커가 `prefill` 필드를 채울 때 쓰는 고정 호칭 (app/worker.py 와 같은 값). */
export const PET_NAME_FALLBACK = '우리 아이'

/**
 * 폼의 초기값.
 *
 * `default` 가 있으면 그 값으로 시작합니다 — 서버가 어차피 그 값으로 채우므로,
 * 비워 두면 화면만 «아무것도 안 고른» 것처럼 보이고 결과는 default 로 나옵니다.
 *
 * `prefill: "pet_name"` 은 선택된 강아지 이름으로 채웁니다. **이름을 모르면 비워
 * 둡니다** — 여기서 «우리 아이» 를 미리 적어 넣으면 사용자가 그걸 자기가 고른 값으로
 * 읽고 지우지 않게 되는데, 정작 그 자리는 나중에 강아지를 저장하면 진짜 이름이
 * 들어갈 자리입니다. 비워 두면 서버·워커가 같은 폴백을 넣고, 화면은 placeholder 로
 * 무엇이 들어갈지만 알려 줍니다(W04Upload StyleInputForm).
 */
export function initialInputValues(
  fields: StyleInputField[],
  petName: string | null,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (field.prefill === 'pet_name' && petName) {
      values[field.label] = petName
      continue
    }
    if (field.default) values[field.label] = field.default
  }
  return values
}

/**
 * 강아지가 바뀌었을 때 프리필 칸만 다시 채웁니다.
 *
 * 사용자가 이미 손댄 칸은 건드리지 않습니다 — 이름을 «단지» 로 고쳐 놓고 강아지를
 * 바꿨다고 그 편집을 되돌리면, 화면이 방금 받은 입력을 말없이 버리는 셈입니다.
 * 판정 기준은 «비어 있거나, 직전 강아지 이름 그대로인가» 입니다.
 */
export function repriseWithPetName(
  fields: StyleInputField[],
  values: Record<string, string>,
  previousPetName: string | null,
  petName: string | null,
): Record<string, string> {
  const next = { ...values }
  for (const field of fields) {
    if (field.prefill !== 'pet_name') continue
    const current = next[field.label] ?? ''
    const untouched = current === '' || (previousPetName !== null && current === previousPetName)
    if (!untouched) continue
    if (petName) next[field.label] = petName
    else delete next[field.label]
  }
  return next
}

/**
 * 칸 하나의 오류 문구. 통과하면 null.
 *
 * 비어 있으면 오류가 아닙니다 — 서버가 default 로 채우거나(있는 경우) 워커가
 * 이름을 넣는 자리라, 빈 칸을 막으면 정상 경로를 실수로 만듭니다.
 */
export function fieldError(field: StyleInputField, rawValue: string | undefined): string | null {
  const value = (rawValue ?? '').trim()
  if (value === '') return null

  if (field.max_length && [...value].length > field.max_length) {
    return `${field.max_length}자 이내로 써 주세요.`
  }
  /*
    서버는 `re.fullmatch` 라 **전체 일치**입니다. JS 정규식은 부분 일치라 앵커를
    붙여 같은 판정으로 맞춥니다 — 안 붙이면 여기서는 통과하고 서버에서만 400 이
    되는, 화면이 «괜찮다» 고 말해 놓고 왕복 뒤에 뒤집히는 종류가 됩니다.
  */
  if (field.pattern && !new RegExp(`^(?:${field.pattern})$`, 'u').test(value)) {
    return patternHint(field)
  }
  if (
    field.type === 'choice' &&
    !field.allow_custom &&
    !(field.options ?? []).some((option) => option.value === value)
  ) {
    return '목록에서 골라 주세요.'
  }
  return null
}

/**
 * `pattern` 은 사용자에게 보여 줄 말이 아닙니다(`^\d{4}$`). 스키마가 `help` 를 주면
 * 그걸 쓰고, 없으면 «형식이 맞지 않는다» 는 사실만 말합니다 — 정규식을 한국어로
 * 번역하는 표를 만들면 스키마가 늘 때마다 그 표가 조용히 낡습니다.
 */
function patternHint(field: StyleInputField): string {
  return field.help ? `형식이 맞지 않아요 — ${field.help}` : '형식이 맞지 않아요.'
}

/** 라벨별 오류. 통과한 칸은 들어 있지 않습니다. */
export function inputErrors(
  fields: StyleInputField[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const error = fieldError(field, values[field.label])
    if (error) errors[field.label] = error
  }
  return errors
}

/**
 * `POST /v1/jobs` 로 보낼 `inputs`.
 *
 * 빈 칸과 **스키마에 없는 라벨을 떨어뜨립니다**. 후자는 스타일을 바꾸면 실제로
 * 생깁니다 — 상태에 옛 스타일의 라벨이 남은 채로 보내는 경로가 있습니다.
 *
 * 이 필터가 **유일한 방어선**입니다. 예전에는 뚫려도 서버가 400 `unknown_inputs` 로
 * 돌려보내 크레딧이 안 나갔지만, 지금 서버는 모르는 라벨을 조용히 버리고 생성을
 * 계속합니다(백엔드 PR #139) — 뚫리면 크레딧이 나가고 사용자가 고른 값은 결과에
 * 없습니다. 그래서 `values` 가 아니라 **`fields` 를 순회**합니다: 스키마에 있는 라벨만
 * 결과에 들어갈 수 있어서, 상태에 뭐가 남아 있든 구조적으로 새어 나갈 수 없습니다.
 *
 * 보낼 값이 하나도 없으면 `undefined` — 스키마가 없는 스타일에서 `{}` 를 실어
 * 보내지 않기 위해서입니다(서버는 받아 주지만, 빈 객체는 «입력을 골랐다» 는 거짓
 * 신호라 idempotency 의도 비교에도 그대로 남습니다).
 */
export function inputsForRequest(
  fields: StyleInputField[],
  values: Record<string, string>,
): Record<string, string> | undefined {
  const payload: Record<string, string> = {}
  for (const field of fields) {
    const value = (values[field.label] ?? '').trim()
    if (value !== '') payload[field.label] = value
  }
  return Object.keys(payload).length > 0 ? payload : undefined
}

/**
 * 지난번 job 이 실제로 쓴 값 (W-06 «다시 만들기», 이슈 #127 → 백엔드 PR #139).
 *
 * `job.inputs` 는 서버가 판정한 최종 값이라 이미 스키마로 걸러져 있습니다. 그런데도
 * **지금 스키마 기준으로 한 번 더 거르는** 이유는, 그 판정이 job 을 만들던 시점의
 * 스키마였기 때문입니다. 운영이 그 뒤 칸을 바꾸면 없어진 라벨이 남아 있을 수 있고,
 * 그대로 두면 두 군데가 어긋납니다 — 접힌 줄에는 «의상: 버섯» 이라고 적히는데
 * `inputsForRequest` 는 그 라벨을 안 싣고, 서버는 실려도 조용히 버립니다(PR #139).
 * 여기서 걸러야 **화면에 적힌 값 = 실제로 나갈 값** 이 유지됩니다.
 *
 * 빈 문자열도 없는 것으로 봅니다. 서버는 빈 값을 저장하지 않지만(`_resolve_input_values`
 * 가 `continue`), 들어와도 폼의 기본값을 덮어쓰지 않는 쪽이 맞습니다 — 빈 값으로
 * 덮으면 `default` 가 있는 칸이 화면에서만 비어 보이고 결과에는 default 가 나옵니다.
 */
export function restoredInputValues(
  fields: StyleInputField[],
  jobInputs: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!jobInputs) return {}
  const values: Record<string, string> = {}
  for (const field of fields) {
    const value = jobInputs[field.label]
    if (value !== undefined && value.trim() !== '') values[field.label] = value
  }
  return values
}

/**
 * 접힌 줄에 적을 «지금 값» (W-06 «다시 만들기»).
 *
 * 빈 칸을 «없음» 이라고 적으면 거짓입니다 — 서버가 `default` 로, 워커가 강아지
 * 이름으로 채워서 결과에는 값이 들어갑니다. 그래서 placeholder 와 같은 순서
 * (값 → default → 강아지 이름)로 **실제로 쓰일 값**을 적습니다. 시드의 31개 칸은
 * 전부 default 나 prefill 을 가지므로 마지막 «—» 까지 내려오는 칸은 지금 없습니다
 * (스키마가 늘어날 때를 위한 자리입니다).
 */
export function effectiveInputValue(
  field: StyleInputField,
  values: Record<string, string>,
  petName: string | null,
): string {
  const value = (values[field.label] ?? '').trim()
  if (value !== '') return value
  if (field.default) return field.default
  if (field.prefill === 'pet_name') return petName ?? PET_NAME_FALLBACK
  return '—'
}
