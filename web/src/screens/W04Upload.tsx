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
import { CreditBadge } from '../app/CreditBadge'
import {
  beginJobAttempt,
  clearJobAttempt,
  resumeJobAttempt,
  type JobIntent,
} from '../api/idempotency'
import {
  useCreateJob,
  useCreatePet,
  useJob,
  usePets,
  useStyleDetail,
  useUploadPhoto,
} from '../api/queries'
import { rememberJobContext, resolveJobContext } from '../api/jobContext'
import { clearUploadDraft, readUploadDraft, writeUploadDraft } from '../api/uploadDraft'
import type { Pet, UploadIssue, UploadResult } from '../api/types'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'

export default function W04Upload() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const styleIdParam = Number(searchParams.get('style_id'))
  const styleId = Number.isInteger(styleIdParam) && styleIdParam > 0 ? styleIdParam : null

  const { data: style } = useStyleDetail(styleId)
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
  // 재료는 서버가 우선입니다(이슈 #9 A안) — 로컬 색인은 이 브라우저에서 만든 job
  // 에만 있어서, 링크를 다시 열거나 다른 탭에서 온 경우 답을 못 합니다.
  const { data: fromJob, isPending: fromJobPending } = useJob(fromJobId)

  useEffect(() => {
    if (fromJobId) {
      const context = resolveJobContext(fromJobId, fromJob)
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
      // 서버 답을 기다리는 동안 초안 복원으로 내려가면, 재료가 도착하기 전에 엉뚱한
      // 사진이 확인 단계에 먼저 그려집니다. 도착하면 이 효과가 다시 돕니다.
      if (fromJobPending) return
    }
    // 402 오버레이에서 크레딧을 받으러 나갔다 돌아온 경우의 복원(api/uploadDraft.ts).
    //
    // `styleId === null` 인 초안도 받습니다. W-01 랜딩의 주 CTA 는 스타일 없이
    // `/upload` 로 들어오므로(FR-W01-02) 사진이 먼저 올라가고 스타일이 나중에
    // 붙습니다 — 이때 초안을 버리면 스타일을 고르고 돌아온 사용자가 같은 사진을
    // 두 번 올리게 되고, upload_id 가 새로 발급돼 idempotency 전제도 깨집니다.
    const draft = readUploadDraft()
    if (draft && (draft.styleId === styleId || draft.styleId === null)) {
      setUpload(draft.upload)
      setPetId(draft.petId)
      // 이제 이 사진은 이 스타일의 것입니다. 다시 적어 두지 않으면 402 왕복에서
      // 또 "스타일 없는 초안"으로 남습니다.
      if (draft.styleId !== styleId) writeUploadDraft({ ...draft, styleId })
    }
  }, [styleId, fromJobId, fromJob, fromJobPending])

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

  /**
   * FR-W04-02 · "저장된 강아지 선택 시 업로드 단계 스킵".
   *
   * 스킵의 조건은 `latest_upload_id` 하나입니다(이슈 #9 A안) — 그 값이 곧
   * `POST /v1/jobs` 의 `upload_id` 라서 사진을 다시 올릴 이유가 없습니다. 값이
   * 없으면(업로드 만료·삭제, 또는 백엔드 미구현) 예전처럼 **선택 = 이번 업로드를
   * 이 강아지에 붙이기**로만 동작합니다.
   */
  function selectPet(pet: Pet) {
    const next = pet.id === petId ? null : pet.id
    setPetId(next)
    setInsufficient(null)
    if (next === null || !pet.latest_upload_id) return

    const reused: UploadResult = {
      upload_id: pet.latest_upload_id,
      // 원본 URL 은 `GET /v1/pets` 가 주지 않습니다. 썸네일은 같은 사진에서 나온
      // 이미지라 확인 단계 미리보기로는 맞고, 생성에 쓰이는 건 upload_id 입니다.
      image_url: pet.thumbnail_url,
      blocking_issue: null,
      warnings: [],
      breed_estimate: null,
    }
    setUpload(reused)
    writeUploadDraft({ styleId, petId: pet.id, upload: reused })
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
        <CreditBadge />
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        <StyleContext styleId={styleId} styleName={style?.name} afterUpload={confirming} />

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
            onSelectPet={selectPet}
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
          // §4 시나리오3 4단계 — 크레딧을 받았으면 시트를 닫고 **같은 키로** 재시도합니다.
          // startGeneration 이 resumeJobAttempt 를 먼저 보므로 키는 자동으로 이어집니다.
          onRetry={() => {
            setInsufficient(null)
            startGeneration()
          }}
        />
      )}
    </div>
  )
}

/** 어떤 스타일로 만드는 중인지 계속 보이게 둡니다 — 업로드 중에 잊어버리는 맥락입니다. */
function StyleContext({
  styleId,
  styleName,
  afterUpload,
}: {
  styleId: number | null
  styleName?: string
  afterUpload: boolean
}) {
  if (styleId === null) {
    // 업로드 후에는 ConfirmPanel 의 주 버튼이 그대로 "스타일 고르기"라 여기서 또
    // 말하지 않습니다. 업로드 전에는 경고가 아니라 순서 안내입니다 — 랜딩의 주
    // CTA(FR-W01-02)가 스타일 없이 이 화면으로 보내므로, 도착하자마자 경고를
    // 띄우면 정상 경로를 실수처럼 보이게 만듭니다.
    if (afterUpload) return null
    return (
      <div className="mb-4 flex items-center justify-between gap-2 text-sm text-ink-3">
        <span className="truncate">스타일은 사진을 올린 뒤에 골라도 됩니다</span>
        <Link to="/styles" className="shrink-0 underline">
          먼저 고르기
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
  onSelectPet: (pet: Pet) => void
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
 * 노트2 · FR-W04-02 — "선택 시 업로드 단계 스킵".
 *
 * `GET /v1/pets` 의 `latest_upload_id`(이슈 #9 A안)가 그 스킵을 가능하게 합니다.
 * 값이 있는 펫은 탭하는 순간 확인 단계로 넘어가고, 없는 펫(업로드 만료·삭제, 또는
 * 백엔드 미구현 구간)은 예전처럼 **이번 업로드를 이 강아지에 붙이기**로 남습니다
 * (`POST /v1/uploads` 의 `pet_id`). 두 상태를 칩 아래 한 줄로 구분해 줍니다 —
 * 구분이 없으면 "어떤 애는 되고 어떤 애는 안 되는" 이유를 알 수 없습니다.
 */
function SavedPets({
  pets,
  petId,
  onSelectPet,
  onAdd,
}: {
  pets: Pet[]
  petId: string | null
  onSelectPet: (pet: Pet) => void
  onAdd: () => void
}) {
  if (pets.length === 0) return null

  const selectedPet = pets.find((pet) => pet.id === petId) ?? null

  return (
    <section className="mt-5">
      <h2 className="text-sm font-semibold">저장된 강아지</h2>
      {pets.some((pet) => pet.latest_upload_id) && (
        <p className="mt-1 text-xs text-ink-3">최근 사진이 있는 강아지는 바로 만들 수 있어요.</p>
      )}
      <ul className="mt-2 flex flex-wrap gap-3">
        {pets.map((pet) => {
          const selected = pet.id === petId
          return (
            <li key={pet.id}>
              <button
                type="button"
                aria-pressed={selected}
                aria-label={
                  pet.latest_upload_id ? `${pet.name} — 최근 사진으로 바로 만들기` : pet.name
                }
                onClick={() => onSelectPet(pet)}
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
      {selectedPet && !selectedPet.latest_upload_id && (
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

      {!blocked && styleMissing && (
        // 사진부터 올린 경로(W-01 랜딩 CTA)의 다음 한 걸음. 비활성 버튼을 두면
        // 여기가 막다른 길이 됩니다 — 사진은 초안으로 남으니 돌아오면 이어집니다.
        <>
          <Link
            to="/styles"
            className="mt-2 block w-full rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-paper"
          >
            스타일 고르기 →
          </Link>
          <p className="mt-2 text-center text-xs text-ink-3">
            고른 스타일로 돌아오면 이 사진 그대로 이어집니다
          </p>
          {/* W-08 보조 진입점 — 사진이 이미 있으니 여기서 바로 넘어갈 수 있습니다.
              보조로만 두는 이유는 #p08 노트1(기본 그리드와 분리). */}
          <Link
            to="/creative"
            className="mt-3 block text-center text-sm text-ink-2 underline"
          >
            원하는 걸 직접 써서 만들기 · 2 크레딧
          </Link>
        </>
      )}

      {!blocked && !styleMissing && (
        <>
          {/* 노트3 — 경고가 있어도 이 버튼은 항상 눌립니다. 노트4 — 금액을 버튼에 박습니다. */}
          <button
            type="button"
            onClick={onStart}
            disabled={starting || creditCost === null}
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

