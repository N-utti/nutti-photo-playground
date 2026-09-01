/**
 * 견종을 **받는 자리** (비전 추정 대체). 계산기 40종 목록(`api/breeds.ts`)에서 고르고,
 * 없으면 «직접 입력» 으로 씁니다. 목록 밖 이름은 그림에는 그대로 들어가고 계산기에는
 * 믹스견으로 넘어갑니다(FR-EDGE-11). 선택 사항입니다 — 비우면 `[breed]` 는 «강아지».
 *
 * W-04(확인 단계)와 W-08(직접 만들기)이 같이 씁니다 — 값은 `POST /v1/jobs` 의 `breed`.
 */

import { useId, useState } from 'react'
import { BREED_SIZES } from '../api/breeds'

const BREED_NAMES = Object.keys(BREED_SIZES)
const CUSTOM_BREED = '__custom__'

export default function BreedField({
  value,
  onChange,
  printsBreed = false,
}: {
  value: string
  onChange: (value: string) => void
  /** 이 스타일이 그림에 견종을 인쇄하는가(`uses_breed`). 안내 문구만 바뀝니다. */
  printsBreed?: boolean
}) {
  const id = useId()
  // «직접 입력» 을 눌러 열었거나, 초안 복원·재사용·저장된 강아지로 목록 밖 값이 들어온 경우.
  // 값에서 파생시키는 이유는 값이 마운트 뒤에 도착하는 경로(job 응답)가 있어서입니다.
  const [customOpen, setCustomOpen] = useState(false)
  const custom = customOpen || (value !== '' && !BREED_NAMES.includes(value))
  const selectValue = custom ? CUSTOM_BREED : value

  return (
    <section className="mt-3 rounded-lg border border-rule bg-surface-2 px-3 py-3">
      <label htmlFor={id} className="text-sm font-semibold">
        견종
      </label>
      <p className="mt-0.5 text-xs text-ink-3">
        {printsBreed ? '그림에 견종이 인쇄돼요. ' : ''}목록에 없으면 직접 입력을 골라 주세요.
      </p>
      <select
        id={id}
        value={selectValue}
        onChange={(event) => {
          const next = event.currentTarget.value
          if (next === CUSTOM_BREED) {
            setCustomOpen(true)
            onChange('')
          } else {
            setCustomOpen(false)
            onChange(next)
          }
        }}
        className="mt-2 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm"
      >
        <option value="">선택 안 함</option>
        {BREED_NAMES.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={CUSTOM_BREED}>직접 입력</option>
      </select>
      {custom && (
        <input
          aria-label="견종 직접 입력"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          maxLength={50}
          placeholder="예: 골든두들"
          className="mt-2 w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm"
        />
      )}
    </section>
  )
}
