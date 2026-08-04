/**
 * W-04 · 사진 업로드 · 품질 체크 (docs/wireframe-spec-v0.5.html#p04)
 *
 * 와이어프레임이 A(선택) / B(품질 경고) 두 프레임으로 그려져 있지만 별도 라우트가
 * 아니라 한 화면의 두 상태입니다 — 업로드 결과가 있으면 B, 없으면 A. "다른 사진
 * 고르기"로 A 로 되돌아옵니다.
 *
 * 반영한 노트:
 *   1. 업로드 **전에** 조건을 알려준다(촬영 팁)
 *   2. 펫 프로필 — 다만 "업로드 단계 스킵"(FR-W04-02)은 현재 API 로 불가능합니다.
 *      아래 SavedPets 주석 참고
 *   3. 품질 경고는 차단이 아니라 조언 — 경고가 있어도 진행 버튼은 그대로 활성
 *   4. 차감 금액을 버튼에 박는다
 *   5. 실패 시 자동 반환을 **결제 전에** 고지
 *
 * 스타일 맥락은 `?style_id=` 로 받습니다. 경로가 아니라 쿼리인 이유는 이 화면이
 * 스타일의 하위 리소스가 아니고(W-08 커스텀 프롬프트는 스타일 없이도 들어옵니다),
 * 그래도 새로고침·뒤로가기로 맥락이 살아남아야 하기 때문입니다.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { isApiError } from '../api/client'
import {
  beginJobAttempt,
  clearJobAttempt,
  resumeJobAttempt,
  type JobIntent,
} from '../api/idempotency'
import {
  useCreateJob,
  useCreatePet,
  useCredits,
  usePets,
  useStyleDetail,
  useUploadPhoto,
} from '../api/queries'
import { readJobContext, rememberJobContext } from '../api/jobContext'
import { clearUploadDraft, readUploadDraft, writeUploadDraft } from '../api/uploadDraft'
import type { Pet, UploadIssue, UploadResult } from '../api/types'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'

export default function W04Upload() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const styleIdParam = Number(searchParams.get('style_id'))
  const styleId = Number.isInteger(styleIdParam) && styleIdParam > 0 ? styleIdParam : null

  const { data: style } = useStyleDetail(styleId)
  const { data: credits } = useCredits()
  const { data: petsData } = usePets()

  const [petId, setPetId] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadResult | null>(null)
  const [insufficient, setInsufficient] = useState<{ required: number; balance: number } | null>(
    null,
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadPhoto = useUploadPhoto()
  const createJob = useCreateJob()

  // W-06 "이 사진으로 다른 스타일"(FR-W06-07)로 들어온 경우: 이미 올린 사진을
  // 그대로 재사용하므로 업로드 단계를 건너뜁니다.
  const fromJobId = searchParams.get('from_job')

  useEffect(() => {
    if (fromJobId) {
      const context = readJobContext(fromJobId)
      if (context) {
        setUpload({
          upload_id: context.uploadId,
          image_url: context.sourceImageUrl,
          // 같은 사진을 이미 통과시켰으므로 품질 체크를 다시 보여줄 이유가 없습니다.
          blocking_issue: null,
          warnings: [],
          breed_estimate: null,
        })
        return
      }
    }
    // 402 오버레이에서 크레딧을 받으러 나갔다 돌아온 경우의 복원(api/uploadDraft.ts).
    const draft = readUploadDraft()
    if (draft && draft.styleId === styleId) {
      setUpload(draft.upload)
      setPetId(draft.petId)
    }
  }, [styleId, fromJobId])

  function handleFile(file: File | undefined) {
    if (!file) return
    setInsufficient(null)
    uploadPhoto.mutate(
      { file, petId },
      {
        onSuccess: (result) => {
          setUpload(result)
          // 차단된 업로드는 upload_id 가 없어 복원해 봐야 쓸 데가 없습니다.
          if (result.upload_id) writeUploadDraft({ styleId, petId, upload: result })
        },
      },
    )
  }

  function pickAnother() {
    setUpload(null)
    setInsufficient(null)
    uploadPhoto.reset()
    clearUploadDraft()
    // 같은 파일을 다시 고를 때 change 이벤트가 안 뜨는 문제를 막습니다.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startGeneration() {
    if (!upload?.upload_id || styleId === null) return

    const intent: JobIntent = {
      style_id: styleId,
      upload_id: upload.upload_id,
      pet_id: petId,
      custom_prompt: null,
    }
    // 402 후 재시도라면 원래 키를 그대로 이어씁니다(§4 시나리오3 4단계).
    const attempt = resumeJobAttempt(intent) ?? beginJobAttempt(intent)

    createJob.mutate(
      { body: intent, idempotencyKey: attempt.key },
      {
        onSuccess: ({ job_id }) => {
          clearJobAttempt()
          clearUploadDraft()
          // GET /v1/jobs/{id} 가 style_id·upload_id 를 안 주므로 여기서 남겨 둡니다
          // (api/jobContext.ts — W-06 "다시 만들기"·"다른 스타일"이 이걸 씁니다).
          rememberJobContext(job_id, {
            styleId,
            uploadId: intent.upload_id,
            sourceImageUrl: upload.image_url,
          })
          navigate(`/jobs/${job_id}/waiting`)
        },
        onError: (error) => {
          if (isApiError(error, 'INSUFFICIENT_CREDIT')) {
            const detail = error.detail as { required?: number; balance?: number } | undefined
            setInsufficient({
              required: detail?.required ?? style?.credit_cost ?? 1,
              balance: detail?.balance ?? 0,
            })
          }
        },
      },
    )
  }

  const confirming = upload !== null
  const blocked = upload?.blocking_issue ?? null

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <button
          type="button"
          onClick={() => (confirming ? pickAnother() : navigate(-1))}
          aria-label="뒤로"
          className="text-ink-2"
        >
          ←
        </button>
        <h1 className="text-base font-bold">{confirming ? '확인' : '사진 선택'}</h1>
        <span className="ml-auto rounded-full border border-rule bg-surface-2 px-3 py-1 font-mono text-sm tabular-nums">
          ◆ {Math.max(0, credits?.balance ?? 0)}
        </span>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        <StyleContext styleId={styleId} styleName={style?.name} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => handleFile(event.currentTarget.files?.[0])}
        />

        {confirming ? (
          <ConfirmPanel
            upload={upload}
            petId={petId}
            onPetSaved={setPetId}
            onPickAnother={pickAnother}
            onStart={startGeneration}
            creditCost={style?.credit_cost ?? null}
            starting={createJob.isPending}
            startError={
              createJob.error && !isApiError(createJob.error, 'INSUFFICIENT_CREDIT')
                ? createJob.error.message
                : null
            }
            styleMissing={styleId === null}
          />
        ) : (
          <SelectPanel
            pets={petsData?.items ?? []}
            petId={petId}
            onSelectPet={setPetId}
            onOpenPicker={() => fileInputRef.current?.click()}
            uploading={uploadPhoto.isPending}
            uploadError={uploadPhoto.error?.message ?? null}
          />
        )}
      </main>

      {blocked && <p className="sr-only" role="alert">{blocked.message}</p>}

      {insufficient && (
        <InsufficientCreditOverlay
          required={insufficient.required}
          balance={insufficient.balance}
          onClose={() => setInsufficient(null)}
        />
      )}
    </div>
  )
}

/** 어떤 스타일로 만드는 중인지 계속 보이게 둡니다 — 업로드 중에 잊어버리는 맥락입니다. */
function StyleContext({ styleId, styleName }: { styleId: number | null; styleName?: string }) {
  if (styleId === null) {
    return (
      <div className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
        스타일을 먼저 골라 주세요.{' '}
        <Link to="/styles" className="font-semibold underline">
          스타일 보러 가기
        </Link>
      </div>
    )
  }
  return (
    <div className="mb-4 flex items-center justify-between gap-2 text-sm text-ink-3">
      <span className="truncate">선택한 스타일 · {styleName ?? '불러오는 중…'}</span>
      <Link to="/styles" className="shrink-0 underline">
        변경
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------- A · 선택

interface SelectPanelProps {
  pets: Pet[]
  petId: string | null
  onSelectPet: (petId: string | null) => void
  onOpenPicker: () => void
  uploading: boolean
  uploadError: string | null
}

function SelectPanel({
  pets,
  petId,
  onSelectPet,
  onOpenPicker,
  uploading,
  uploadError,
}: SelectPanelProps) {
  return (
    <>
      <button
        type="button"
        onClick={onOpenPicker}
        disabled={uploading}
        className="grid aspect-[4/3] w-full place-items-center rounded-xl border-2 border-dashed border-rule-strong bg-surface text-sm text-ink-2"
      >
        {uploading ? '사진을 확인하는 중…' : '탭해서 사진 올리기'}
      </button>

      {uploadError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {uploadError}
        </p>
      )}

      <SavedPets pets={pets} petId={petId} onSelectPet={onSelectPet} onAdd={onOpenPicker} />

      {/* 노트1 — 사후 환불보다 사전 안내가 쌉니다. */}
      <p className="mt-5 rounded-lg border border-rule bg-surface px-3 py-2 text-sm text-ink-2">
        ✓ 정면 · 밝은 곳 · 얼굴이 큰 사진일수록 잘 나와요
      </p>
    </>
  )
}

/**
 * 노트2 · FR-W04-02.
 *
 * 요구사항은 "선택 시 업로드 단계 스킵"이지만 지금 API 로는 불가능합니다 —
 * `GET /v1/pets` 는 {id, name, thumbnail_url} 만 주고, `POST /v1/jobs` 는 `upload_id`
 * 를 요구하는데 펫에서 source_image 로 가는 경로가 §3 에 없습니다(04-erd 에는
 * `source_image.pet_profile_id` 가 있으니 데이터는 서버에 있습니다). 백엔드 이슈로
 * 올렸고, 그때까지는 **선택 = 이번 업로드를 이 강아지에 붙이기**로 동작합니다
 * (`POST /v1/uploads` 의 `pet_id` — 이건 §3 에 있습니다).
 */
function SavedPets({
  pets,
  petId,
  onSelectPet,
  onAdd,
}: {
  pets: Pet[]
  petId: string | null
  onSelectPet: (petId: string | null) => void
  onAdd: () => void
}) {
  if (pets.length === 0) return null

  return (
    <section className="mt-5">
      <h2 className="text-sm font-semibold">저장된 강아지</h2>
      <ul className="mt-2 flex flex-wrap gap-3">
        {pets.map((pet) => {
          const selected = pet.id === petId
          return (
            <li key={pet.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectPet(selected ? null : pet.id)}
                className="flex w-14 flex-col items-center gap-1"
              >
                <img
                  src={pet.thumbnail_url}
                  alt=""
                  className={`size-14 rounded-full object-cover ${
                    selected ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''
                  }`}
                />
                <span className="w-full truncate text-center text-xs text-ink-2">{pet.name}</span>
              </button>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={onAdd}
            aria-label="강아지 추가"
            className="grid size-14 place-items-center rounded-full border border-dashed border-rule-strong text-ink-3"
          >
            +
          </button>
        </li>
      </ul>
      {petId && (
        <p className="mt-2 text-xs text-ink-3">
          이 강아지로 저장됩니다 — 사진은 새로 올려 주세요.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- B · 확인

interface ConfirmPanelProps {
  upload: UploadResult
  petId: string | null
  onPetSaved: (petId: string) => void
  onPickAnother: () => void
  onStart: () => void
  creditCost: number | null
  starting: boolean
  startError: string | null
  styleMissing: boolean
}

function ConfirmPanel({
  upload,
  petId,
  onPetSaved,
  onPickAnother,
  onStart,
  creditCost,
  starting,
  startError,
  styleMissing,
}: ConfirmPanelProps) {
  const blocked = upload.blocking_issue

  return (
    <>
      {upload.image_url && (
        <img
          src={upload.image_url}
          alt="업로드한 사진"
          className="aspect-square w-full rounded-xl bg-surface-2 object-cover"
        />
      )}

      {blocked ? (
        // FR-EDGE-07 — 부드러운 문구로 차단. 진행 버튼 자체를 내립니다.
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-3">
          <p className="text-sm font-semibold text-danger">{blocked.message}</p>
        </div>
      ) : (
        upload.warnings.map((warning) => <WarningCard key={warning.code} warning={warning} />)
      )}

      <button
        type="button"
        onClick={onPickAnother}
        className="mt-4 w-full rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold"
      >
        다른 사진 고르기
      </button>

      {!blocked && (
        <>
          {/* 노트3 — 경고가 있어도 이 버튼은 항상 눌립니다. 노트4 — 금액을 버튼에 박습니다. */}
          <button
            type="button"
            onClick={onStart}
            disabled={starting || creditCost === null || styleMissing}
            className="mt-2 w-full rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
          >
            {starting
              ? '만드는 중…'
              : creditCost === null
                ? '스타일 정보를 불러오는 중…'
                : `이대로 만들기 · ${creditCost} 크레딧`}
          </button>

          {startError && (
            <p role="alert" className="mt-2 text-center text-sm text-danger">
              {startError}
            </p>
          )}

          {/* 노트5 — 결제 후가 아니라 결제 전에 말해야 안심 효과가 있습니다. */}
          <p className="mt-2 text-center text-xs text-ink-3">
            실패하면 크레딧은 자동 반환됩니다
          </p>
        </>
      )}

      {!petId && upload.upload_id && (
        <SavePetForm uploadId={upload.upload_id} onSaved={onPetSaved} />
      )}
    </>
  )
}

function WarningCard({ warning }: { warning: UploadIssue }) {
  // FR-EDGE-06/08/09 — 어느 코드든 "이래서 결과가 나쁠 수 있다"는 조언이지 차단이 아닙니다.
  const hint =
    warning.code === 'MULTI_SUBJECT'
      ? '여러 마리가 함께 변환됩니다.'
      : warning.code === 'NOT_A_DOG'
        ? '강아지가 잘 보이는 사진일수록 결과가 좋습니다.'
        : warning.code === 'HUMAN_FACE_DETECTED'
          ? '사람 얼굴은 그대로 변환되지 않을 수 있습니다.'
          : '그대로 진행해도 되지만, 밝은 사진이 결과가 더 좋습니다.'

  return (
    <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-3">
      <p className="text-sm font-semibold text-warn">{warning.message}</p>
      <p className="mt-0.5 text-sm text-ink-2">{hint}</p>
    </div>
  )
}

/** 노트2 — 재방문 시 반복 사용률을 좌우하는 기능이라 업로드 직후 바로 물어봅니다. */
function SavePetForm({ uploadId, onSaved }: { uploadId: string; onSaved: (petId: string) => void }) {
  const [name, setName] = useState('')
  const createPet = useCreatePet()

  return (
    <form
      className="mt-6 rounded-lg border border-rule bg-surface p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        createPet.mutate({ name: trimmed, uploadId }, { onSuccess: (pet) => onSaved(pet.id) })
      }}
    >
      <label htmlFor="pet-name" className="text-sm font-semibold">
        이 강아지 저장하기
      </label>
      <p className="mt-0.5 text-xs text-ink-3">다음에 올 때 이 사진으로 바로 시작할 수 있어요.</p>
      <div className="mt-2 flex gap-2">
        <input
          id="pet-name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="이름 (예: 콩이)"
          maxLength={20}
          className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createPet.isPending || name.trim() === ''}
          className="shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          저장
        </button>
      </div>
      {createPet.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {createPet.error.message}
        </p>
      )}
    </form>
  )
}

