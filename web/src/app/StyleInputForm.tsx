/**
 * 스타일별 입력 폼 (이슈 #114 · 백엔드 #116·#118).
 *
 * 39종 중 25종이 1~2개의 칸을 갖습니다. 이 값들은 워커가 프롬프트 맨 앞에 «라벨: 값»
 * 으로 붙여 실제 결과물을 바꿉니다(app/worker.py) — 폼이 없던 동안에는 서버가 전부
 * `default` 로 채웠고, 그래서 «의상» 이 늘 버섯이고 «신분» 이 늘 양반이었습니다.
 *
 * 화면이 **둘**이라 W-04 에서 여기로 나왔습니다: 만들기(W-04 확인 단계)와 다시
 * 만들기(W-06)가 같은 칸을 같은 규칙으로 그려야 합니다. 한쪽에만 있으면 «고를 수
 * 있는 값» 이 입구에 따라 달라지고, 그게 정확히 이슈 #127 의 증상이었습니다.
 *
 * 검증 규칙은 app/styleInputs.ts 한 곳에 있습니다(서버 판정의 사본). 여기서는 그리기만
 * 합니다 — 어떤 오류를 **보여 줄지**의 판단도 호출부 몫입니다(아직 안 만진 칸 등).
 */

import { useId, useState } from 'react'
import { PET_NAME_FALLBACK } from './styleInputs'
import type { StyleInputField } from '../api/types'

export function StyleInputForm({
  fields,
  values,
  errors,
  petName,
  title = '이 스타일에서 고를 수 있어요',
  /** 카드 안에 이미 들어가 있으면 false — 테두리를 겹쳐 그리지 않습니다(W-06). */
  framed = true,
  onChange,
  onTouch,
}: {
  fields: StyleInputField[]
  values: Record<string, string>
  /** **보여 줄** 오류만 옵니다 — 아직 안 만진 칸은 빠져 있습니다(호출부 주석). */
  errors: Record<string, string>
  petName: string | null
  title?: string | null
  framed?: boolean
  onChange: (label: string, value: string) => void
  onTouch: (label: string) => void
}) {
  return (
    <section className={framed ? 'mt-4 rounded-lg border border-rule bg-surface px-3 py-3' : 'mt-3'}>
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      <div className={`space-y-4 ${title ? 'mt-1' : ''}`}>
        {fields.map((field) => (
          <InputField
            key={field.label}
            field={field}
            value={values[field.label] ?? ''}
            error={errors[field.label] ?? null}
            petName={petName}
            onChange={(value) => onChange(field.label, value)}
            onTouch={() => onTouch(field.label)}
          />
        ))}
      </div>
    </section>
  )
}

function InputField({
  field,
  value,
  error,
  petName,
  onChange,
  onTouch,
}: {
  field: StyleInputField
  value: string
  error: string | null
  petName: string | null
  onChange: (value: string) => void
  onTouch: () => void
}) {
  const id = useId()
  const errorId = `${id}-error`
  const helpId = `${id}-help`

  const options = field.options ?? []
  /*
    `allow_custom` 인 choice 에서 «직접 입력» 을 열어 둘지의 판정.

    지금 값이 목록에 없으면(초안 복원·직접 입력 중) 열린 채로 시작해야 합니다 — 닫아
    두면 사용자가 쓴 값이 화면 어디에도 없는데 요청에는 실려 나갑니다.
  */
  const [custom, setCustom] = useState(
    field.type === 'choice' && value !== '' && !options.some((option) => option.value === value),
  )
  const chosen = options.find((option) => option.value === value)

  return (
    <div>
      <label
        htmlFor={field.type === 'text' || custom ? id : undefined}
        className="text-sm font-semibold"
      >
        {field.label}
      </label>
      {field.help && (
        <p id={helpId} className="mt-0.5 text-xs text-ink-3">
          {field.help}
        </p>
      )}

      {field.type === 'choice' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((option) => {
            const selected = !custom && option.value === value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setCustom(false)
                  onChange(option.value)
                  onTouch()
                }}
                className={`rounded-full border px-3 py-1.5 text-sm transition duration-200 ease-out ${
                  selected
                    ? 'border-brand bg-brand-soft font-semibold text-brand'
                    : 'border-rule bg-surface-2 text-ink-2 hover:border-brand-2 hover:text-brand'
                }`}
              >
                {option.value}
              </button>
            )
          })}
          {field.allow_custom && (
            <button
              type="button"
              aria-pressed={custom}
              onClick={() => {
                setCustom(true)
                // 목록에서 고른 값이 남아 있으면 그걸 고쳐 쓰는 게 자연스럽습니다 —
                // 지우면 «파스텔 핑크» 를 조금 바꾸려던 사용자가 처음부터 쓰게 됩니다.
                onTouch()
              }}
              className={`rounded-full border px-3 py-1.5 text-sm transition duration-200 ease-out ${
                custom
                  ? 'border-brand bg-brand-soft font-semibold text-brand'
                  : 'border-dashed border-rule-strong text-ink-3 hover:border-brand-2 hover:text-brand'
              }`}
            >
              직접 입력
            </button>
          )}
        </div>
      )}

      {(field.type === 'text' || custom) && (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onTouch}
          /*
            서버 제약을 입력 단계에서 그대로 겁니다 — 넘겨 쓰고 나서 지우게 하는 것보다
            애초에 안 들어가는 편이 짧습니다. 그래도 검증을 지우지 않는 이유는 프리필된
            값은 이 속성을 거치지 않고 들어오기 때문입니다(app/styleInputs.ts).
          */
          maxLength={field.max_length}
          placeholder={placeholderFor(field, petName)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[field.help ? helpId : null, error ? errorId : null]
            .filter(Boolean)
            .join(' ') || undefined}
          className={`mt-2 w-full rounded-lg border bg-paper px-3 py-2 text-sm ${
            error ? 'border-danger' : 'border-rule'
          }`}
        />
      )}

      {/* 설명이 있는 선택지는 고른 뒤에 그 설명을 보여 줍니다(«에칭 아트 — 제일 잘 나와요!»). */}
      {chosen?.description && !custom && (
        <p className="mt-1.5 text-xs text-ink-3">{chosen.description}</p>
      )}

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * 빈 칸이 무엇으로 채워질지 말해 줍니다.
 *
 * `prefill` 칸을 비워 두면 워커가 강아지 이름(없으면 «우리 아이»)을 넣고, `default`
 * 가 있는 칸은 서버가 그 값을 넣습니다. 둘 다 아니면 할 말이 없으니 비워 둡니다 —
 * "입력하세요" 같은 placeholder 는 라벨을 한 번 더 읽는 것 이상을 하지 않습니다.
 */
function placeholderFor(field: StyleInputField, petName: string | null): string | undefined {
  if (field.prefill === 'pet_name') return `비워 두면 «${petName ?? PET_NAME_FALLBACK}»`
  if (field.default) return `비워 두면 «${field.default}»`
  return undefined
}
