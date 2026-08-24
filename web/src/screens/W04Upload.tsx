/**
 * W-04 · 사진 업로드 · 품질 체크 (docs/wireframe-spec-v0.5.html#p04)
 *
 * 와이어프레임이 A(선택) / B(품질 경고) 두 프레임으로 그려져 있지만 별도 라우트가
 * 아니라 한 화면의 두 상태입니다 — 업로드 결과가 있으면 B, 없으면 A. "다른 사진
 * 고르기"로 A 로 되돌아옵니다.
 *
 * 반영한 노트:
 *   1. 업로드 **전에** 조건을 알려준다(촬영 팁)
 *   2. 펫 프로필 — "업로드 단계 스킵"(FR-W04-02)은 `latest_upload_id`(이슈 #9 A안)로
 *      동작하고, "관리"는 마이페이지(W-12)로 갑니다. 아래 SavedPets 주석 참고
 *   3. 품질 경고는 차단이 아니라 조언 — 경고가 있어도 진행 버튼은 그대로 활성
 *   4. 차감 금액을 버튼에 박는다
 *   5. 실패 시 자동 반환을 **결제 전에** 고지
 *
 * 스타일 맥락은 `?style_id=` 로 받습니다. 경로가 아니라 쿼리인 이유는 이 화면이
 * 스타일의 하위 리소스가 아니고(W-08 커스텀 프롬프트는 스타일 없이도 들어옵니다),
 * 그래도 새로고침·뒤로가기로 맥락이 살아남아야 하기 때문입니다.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { isApiError } from '../api/client'
import BackButton from '../app/BackButton'
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
  useMe,
  usePets,
  useStyleDetail,
  useUploadPhoto,
} from '../api/queries'
import { contextFromJob } from '../app/reuseFromJob'
import { withReuse } from '../app/reuseFromJob'
import { initialOf } from '../app/initials'
import {
  PET_NAME_FALLBACK,
  initialInputValues,
  inputErrors,
  inputsForRequest,
  repriseWithPetName,
} from '../app/styleInputs'
// 폼 자체는 W-06 «다시 만들기» 와 함께 씁니다 — 같은 칸을 같은 규칙으로 그려야 합니다.
import { StyleInputForm } from '../app/StyleInputForm'
import Thumbnail from '../app/Thumbnail'
import { clearUploadDraft, readUploadDraft, writeUploadDraft } from '../api/uploadDraft'
import type { BreedEstimate, Pet, StyleInputField, UploadIssue, UploadResult } from '../api/types'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'

/** `app/routers/uploads.py` 의 `_ALLOWED_CONTENT_TYPES`·`_MAX_FILE_SIZE` 와 같은 값입니다. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_BYTES = 10 * 1024 * 1024

function fileRejection(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'JPG · PNG · WEBP 사진만 올릴 수 있어요.'
  }
  if (file.size > MAX_FILE_BYTES) {
    return '사진은 10MB까지 올릴 수 있어요. 더 작은 사진으로 다시 골라 주세요.'
  }
  return null
}

export default function W04Upload() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const styleIdParam = Number(searchParams.get('style_id'))
  const styleId = Number.isInteger(styleIdParam) && styleIdParam > 0 ? styleIdParam : null

  const { data: style } = useStyleDetail(styleId)
  const { data: petsData } = usePets()

  const [petId, setPetId] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadResult | null>(null)
  /** 올리기 전에 걸러낸 파일(형식·용량). 서버 왕복이 없으므로 mutation 에 안 남습니다. */
  const [fileError, setFileError] = useState<string | null>(null)
  const [insufficient, setInsufficient] = useState<{ required: number; balance: number } | null>(
    null,
  )
  /** 스타일 입력값 `{라벨: 값}` (이슈 #114). 스키마가 없는 스타일에서는 계속 비어 있습니다. */
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  /** 사용자가 손댄 칸. 아직 안 만진 칸에 미리 빨간 줄을 긋지 않기 위한 것입니다. */
  const [touchedInputs, setTouchedInputs] = useState<ReadonlySet<string>>(new Set())
  const [inputsSubmitted, setInputsSubmitted] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadPhoto = useUploadPhoto()
  const createJob = useCreateJob()

  /*
    PR #98 — 이 스타일은 워커가 프롬프트의 `[pet name]` 을 치환해 **그림에 이름을
    인쇄합니다**(app/worker.py). 어떤 이름이 박힐지는 이 화면에서 정해집니다:
    `POST /v1/uploads` 의 `pet_id` 또는 `POST /v1/pets` 가 `source_image.pet_profile_id`
    를 붙여 주면 그 이름, 아니면 «우리 아이» 입니다. 만들기 버튼을 누른 뒤에는 못
    바꾸고 크레딧은 이미 나갑니다 — 그래서 버튼 **앞**에서 말해 줍니다.

    판정은 서버가 계산해 주는 `uses_pet_name` 입니다(이슈 #101 → 백엔드 #111). 예전엔
    프론트가 시드 코드 3종을 하드코딩하고 있었는데, #110 에서 «이모티콘» 프롬프트가
    교체되며 목록이 조용히 틀렸습니다 — 그 파일(app/petNameStyles.ts)과 짝 테스트는
    계약 필드가 착지하면서 함께 지웠습니다.
  */
  const namesTheImage = style?.uses_pet_name ?? false
  /*
    같은 성격의 두 번째 플래그입니다 — 워커가 `[breed]` 도 치환합니다(백엔드 #131 A안
    → PR #137). `uses_pet_name` 과 **독립**이고, 지금 둘 다 참인 건 3D_피규어 한 종뿐
    입니다. 무엇이 인쇄될지는 이 사진의 추정값이 정하므로 판정은 BreedNotice 안에.
  */
  const printsBreed = style?.uses_breed ?? false
  const selectedPetName = petsData?.items.find((pet) => pet.id === petId)?.name ?? null

  /*
    스타일 입력 스키마(이슈 #114)의 초기값.

    두 시점이 따로 옵니다 — `GET /v1/styles/{id}` 로 스키마가 오는 때와, `GET /v1/pets`
    로 강아지 이름이 오는 때. 그래서 «스타일이 바뀌면 새로 채우고, 이름만 바뀌면
    프리필 칸만 다시 채운다» 를 한 효과 안에서 나눠 처리합니다. 뒤엣것이 없으면 초안
    복원(402 왕복)처럼 `petId` 가 먼저 살아나고 목록이 나중에 오는 경로에서 프리필이
    영영 빈 칸으로 남습니다.
  */
  const initializedFor = useRef<number | null>(null)
  const prefilledWith = useRef<string | null>(null)
  useEffect(() => {
    if (!style) return
    if (initializedFor.current !== style.id) {
      initializedFor.current = style.id
      prefilledWith.current = selectedPetName
      // 402 왕복에서 돌아온 경우 사용자가 쓰던 값이 초안에 있습니다 — 사진과 같은 이유로.
      const draft = readUploadDraft()
      setInputValues(
        draft?.styleId === style.id && draft.inputs
          ? draft.inputs
          : initialInputValues(style.input_fields, selectedPetName),
      )
      setTouchedInputs(new Set())
      setInputsSubmitted(false)
      return
    }
    if (prefilledWith.current !== selectedPetName) {
      const previous = prefilledWith.current
      prefilledWith.current = selectedPetName
      setInputValues((values) =>
        repriseWithPetName(style.input_fields, values, previous, selectedPetName),
      )
    }
  }, [style, selectedPetName])

  const inputFields = style?.input_fields ?? []
  const inputProblems = inputErrors(inputFields, inputValues)
  /*
    아직 안 만진 칸에는 빨간 줄을 긋지 않습니다. 프리필이 규칙을 어기는 경우가 실제로
    있어서(«입덕직캠» 은 이름 3자 제한인데 프리필은 저장된 이름 그대로입니다) 도착하자마자
    에러를 띄우면, 사용자가 아무것도 하기 전에 화면이 먼저 사용자를 나무라는 꼴이 됩니다.
    대신 만들기를 누르는 순간 전부 드러나고 진행이 멈춥니다 — 그 시점엔 사실이니까요.
  */
  const visibleInputErrors: Record<string, string> = {}
  for (const [label, message] of Object.entries(inputProblems)) {
    if (inputsSubmitted || touchedInputs.has(label)) visibleInputErrors[label] = message
  }

  function changeInput(label: string, value: string) {
    setInputValues((values) => ({ ...values, [label]: value }))
  }

  function touchInput(label: string) {
    setTouchedInputs((touched) => (touched.has(label) ? touched : new Set(touched).add(label)))
  }

  // W-06 "이 사진으로 다른 스타일"(FR-W06-07)로 들어온 경우: 이미 올린 사진을
  // 그대로 재사용하므로 업로드 단계를 건너뜁니다.
  const fromJobId = searchParams.get('from_job')
  // 재료는 job 응답이 전부 답합니다(이슈 #9 A안 · #81). 그래서 링크를 다시 열거나
  // 다른 기기에서 온 경우에도 같은 사진으로 이어집니다.
  const { data: fromJob, isPending: fromJobPending } = useJob(fromJobId)

  useEffect(() => {
    if (fromJobId) {
      const context = contextFromJob(fromJob)
      if (context) {
        setUpload({
          upload_id: context.uploadId,
          image_url: context.sourceImageUrl,
          // 같은 사진을 이미 통과시켰으므로 품질 체크를 다시 보여줄 이유가 없습니다.
          blocking_issue: null,
          warnings: [],
          /*
            **모르는 것이지 없는 것이 아닙니다.** 서버는 이 사진의 추정값을 여전히
            들고 있고(`source_image.breed_estimate`) 워커도 그 값을 씁니다 — 다만
            `GET /v1/jobs/{id}` 가 안 내려줍니다. 그래서 재사용 경로에서는 견종 예고
            (BreedNotice)가 안 뜹니다: 같은 사진인데 처음 올릴 때는 «토이푸들» 이라고
            했다가 다시 올 때는 아무 말도 안 하는 셈입니다.

            지어내지 않는 쪽을 고릅니다. 계약이 답을 주면 그때 채웁니다(#127 이
            `inputs` 로 같은 모양을 이미 한 번 메웠습니다).
          */
          breed_estimate: null,
        })
        /*
          이 사진에 붙어 있는 강아지도 같이 이어받습니다 (`pet_id`, 백엔드 #111).

          사진만 이어받던 동안 이 경로는 **강아지를 모르는 상태**였습니다. 그 결과가
          두 군데에 나타났습니다: 이름 예고가 «있으면 그 이름이, 없으면 우리 아이가»
          로 흐려지고, `prefill: "pet_name"` 입력 칸(이슈 #114)이 빈 채로 떴습니다 —
          같은 사진으로 방금 만든 결과에는 «콩이» 가 박혀 있는데 말입니다.

          연결 자체는 여기서 만드는 게 아니라 서버에 이미 있는 것을 읽어 오는
          것입니다(`source_image.pet_profile_id`). 그래서 이 값을 넣는다고 새로 붙는
          것은 없고, 화면이 사실을 말할 수 있게 될 뿐입니다.
        */
        setPetId(context.petId)
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
    /*
      서버가 받는 조건을 **올리기 전에** 확인합니다 (PR #59 착지분).

      `POST /v1/uploads` 는 jpeg/png/webp 와 10MB 를 넘으면 400 으로 돌려보냅니다
      (`app/routers/uploads.py`). 조건을 알면서도 그냥 올리면, 모바일 데이터로 10MB 를
      다 태운 뒤에야 "파일 크기는 10MB 이하여야 합니다"를 보게 됩니다. 판정 기준은
      서버와 같은 값이라 여기서 통과한 파일이 서버에서 형식으로 막히는 일은 없습니다.

      최종 판단은 여전히 서버입니다 — 확장자만 바꾼 파일은 여기서 못 걸러냅니다.
    */
    const localError = fileRejection(file)
    if (localError) {
      setFileError(localError)
      return
    }
    setFileError(null)
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
    // 거절당한 파일의 문구는 그 선택에만 붙습니다. 강아지를 고른 순간 다른 사진을
    // 고른 것이므로, 남겨 두면 "10MB 초과" 빨간 줄이 성공한 선택 위에 계속 뜹니다.
    setFileError(null)
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
    // 확인 단계에서 되돌아온 선택 화면은 처음 상태여야 합니다 — 지난 거절 문구가
    // 남으면 방금 잘 쓰던 사진을 두고 실패한 것처럼 보입니다.
    setFileError(null)
    uploadPhoto.reset()
    clearUploadDraft()
    // 같은 파일을 다시 고를 때 change 이벤트가 안 뜨는 문제를 막습니다.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startGeneration() {
    if (!upload?.upload_id || styleId === null) return

    /*
      서버도 같은 규칙으로 400 을 냅니다(`app/routers/jobs.py` `_resolve_input_values`,
      크레딧은 안 나갑니다). 그럼에도 여기서 먼저 막는 이유는 그 응답이 «요청 형식이
      올바르지 않습니다» 한 줄이라, 어느 칸이 왜 틀렸는지 화면이 옮겨 적을 수 없기
      때문입니다 — 사용자는 열두 칸 중 어디를 고쳐야 하는지 모르게 됩니다.
    */
    if (Object.keys(inputProblems).length > 0) {
      setInputsSubmitted(true)
      return
    }

    const intent: JobIntent = {
      style_id: styleId,
      upload_id: upload.upload_id,
      pet_id: petId,
      custom_prompt: null,
      inputs: inputsForRequest(inputFields, inputValues),
    }
    // 402 후 재시도라면 원래 키를 그대로 이어씁니다(§4 시나리오3 4단계).
    const attempt = resumeJobAttempt(intent) ?? beginJobAttempt(intent)

    createJob.mutate(
      { body: intent, idempotencyKey: attempt.key },
      {
        onSuccess: ({ job_id }) => {
          clearJobAttempt()
          clearUploadDraft()
          navigate(`/jobs/${job_id}/waiting`)
        },
        onError: (error) => {
          if (isApiError(error, 'INSUFFICIENT_CREDIT')) {
            const detail = error.detail as { required?: number; balance?: number } | undefined
            setInsufficient({
              required: detail?.required ?? style?.credit_cost ?? 1,
              balance: detail?.balance ?? 0,
            })
            // 여기서부터가 화면 밖으로 나갔다 오는 구간입니다 — 사진과 함께 지금까지
            // 고른 입력값도 붙잡아 둡니다(api/uploadDraft.ts).
            if (upload.upload_id) {
              writeUploadDraft({ styleId, petId, upload, inputs: intent.inputs })
            }
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
        {/* 확인 단계에서도 그냥 뒤로 갑니다 — 사진을 다시 고르는 길은 아래
            «다른 사진 고르기» 입니다(ConfirmPanel). ← 가 화면 안 단계를 되감으면
            같은 화살표가 어떤 때는 나가고 어떤 때는 안 나갑니다. */}
        <BackButton fallback="/styles" />
        <h1 className="text-base font-bold">{confirming ? '확인' : '사진 선택'}</h1>
        <CreditBadge />
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        <StyleContext
          styleId={styleId}
          styleName={style?.name}
          afterUpload={confirming}
          fromJobId={fromJobId}
        />

        <input
          ref={fileInputRef}
          type="file"
          // 서버가 받는 세 형식만(PR #59). `image/*` 는 HEIC·GIF 까지 고르게 해 놓고
          // 서버에서 400 으로 되돌려보내는 길이었습니다 — 못 쓰는 파일은 애초에 회색으로.
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={(event) => handleFile(event.currentTarget.files?.[0])}
        />

        {confirming ? (
          <ConfirmPanel
            upload={upload}
            petId={petId}
            petName={selectedPetName}
            namesTheImage={namesTheImage}
            printsBreed={printsBreed}
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
            fromJobId={fromJobId}
            inputFields={inputFields}
            inputValues={inputValues}
            inputErrors={visibleInputErrors}
            inputsBlocking={Object.keys(inputProblems).length > 0 && inputsSubmitted}
            petNameForPrefill={selectedPetName}
            onInputChange={changeInput}
            onInputTouch={touchInput}
          />
        ) : (
          <SelectPanel
            pets={petsData?.items ?? []}
            petId={petId}
            onSelectPet={selectPet}
            onOpenPicker={() => fileInputRef.current?.click()}
            uploading={uploadPhoto.isPending}
            uploadError={fileError ?? uploadPhoto.error?.message ?? null}
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

/**
 * 어떤 스타일로 만드는 중인지 계속 보이게 둡니다 — 업로드 중에 잊어버리는 맥락입니다.
 *
 * 카탈로그로 되돌아가는 두 링크는 `from_job` 을 그대로 달고 갑니다. 재사용으로
 * 들어온 사용자가 스타일만 바꾸려다 사진을 잃으면, 다시 올린 사진은 새 `upload_id`
 * 라 재사용이 통째로 무산됩니다(app/reuseFromJob.ts).
 */
function StyleContext({
  styleId,
  styleName,
  afterUpload,
  fromJobId,
}: {
  styleId: number | null
  styleName?: string
  afterUpload: boolean
  fromJobId: string | null
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
        <Link to={withReuse('/styles', fromJobId)} className="shrink-0 underline hover:text-brand">
          먼저 고르기
        </Link>
      </div>
    )
  }
  return (
    <div className="mb-4 flex items-center justify-between gap-2 text-sm text-ink-3">
      <span className="truncate">선택한 스타일 · {styleName ?? '불러오는 중…'}</span>
      <Link to={withReuse('/styles', fromJobId)} className="shrink-0 underline hover:text-brand">
        변경
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------- A · 선택

/**
 * 업로드 자리의 사진 아이콘.
 *
 * 아이콘 라이브러리를 들이지 않고 인라인 SVG 로 둡니다 — 앱 전체에서 그림 아이콘이
 * 필요한 곳이 아직 여기뿐이라, 한 개 때문에 의존성과 트리셰이킹 설정을 얹을 이유가
 * 없습니다. `currentColor` 라서 버튼의 hover 색 변화를 그대로 따라갑니다.
 */
function PhotoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-8 transition-transform duration-200 ease-out motion-safe:group-hover:-translate-y-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3.5 17.5 8 13a2 2 0 0 1 2.8 0l3.2 3.2 1.7-1.7a2 2 0 0 1 2.8 0l2 2" />
    </svg>
  )
}

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
        className="group grid aspect-[4/3] w-full place-items-center rounded-xl border-2 border-dashed border-rule-strong bg-surface text-sm text-ink-2 transition duration-200 ease-out enabled:hover:border-brand-2 enabled:hover:bg-surface-2 enabled:hover:text-brand motion-safe:enabled:active:scale-[0.99]"
      >
        {uploading ? (
          // 올라가는 동안은 화면이 멈춘 게 아니라는 신호만 줍니다. 여기서 카메라를
          // 계속 띄워 두면 "아직 안 눌렸나"로 읽힙니다.
          <span className="animate-pulse">사진을 확인하는 중…</span>
        ) : (
          <span className="flex flex-col items-center gap-2">
            <PhotoIcon />
            탭해서 사진 올리기
          </span>
        )}
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
 *
 * "관리"(와이어프레임 W-04 A 프레임)의 목적지는 **마이페이지 C 섹션**입니다 — 이슈 #9
 * 답변에서 `PATCH`·`DELETE /v1/pets/{id}` 소유가 W-12 로 확정됐습니다. 게스트에게는
 * 그리지 않습니다: 앱바가 게스트에게 계정 진입점(아바타)을 주지 않는 것과 같은 규칙이고
 * (app/AccountEntry.tsx), 눌러 봐야 로그인 유도 패널이라 이름 수정·삭제를 할 수 없습니다.
 * 게스트의 다음 걸음은 같은 앱바의 "로그인" 입니다.
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
  const { data: me } = useMe()
  const location = useLocation()

  if (pets.length === 0) return null

  const selectedPet = pets.find((pet) => pet.id === petId) ?? null

  return (
    <section className="mt-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">저장된 강아지</h2>
        {me?.kind === 'member' && (
          <Link
            to="/me"
            // 스타일 맥락(`?style_id=`)까지 담아 보냅니다 — W-12 의 ← 가 이 값으로
            // 돌아오지 않으면 고르던 스타일을 다시 고르게 됩니다.
            state={{ from: `${location.pathname}${location.search}` }}
            className="text-xs text-ink-3 underline underline-offset-2 hover:text-brand"
          >
            관리
          </Link>
        )}
      </div>
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
                className="group flex w-14 flex-col items-center gap-1"
              >
                <Thumbnail
                  src={pet.thumbnail_url}
                  alt=""
                  fallbackLabel={initialOf(pet.name)}
                  // 선택된 칩의 링은 상태 표시라 hover 로 흔들지 않습니다. 선택 안 된
                  // 칩만 같은 자리에 옅은 링을 미리 보여 줘서 "누를 수 있는 것"임을
                  // 알립니다 — 두 링의 굵기·간격이 같아야 hover 때 칩이 안 흔들립니다.
                  className={`size-14 rounded-full bg-surface-2 object-cover ring-offset-2 ring-offset-paper transition duration-200 ease-out ${
                    selected ? 'ring-2 ring-brand' : 'group-hover:ring-2 group-hover:ring-brand-2/60'
                  }`}
                />
                <span className="w-full truncate text-center text-xs text-ink-2 transition-colors duration-200 group-hover:text-ink">
                  {pet.name}
                </span>
              </button>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={onAdd}
            aria-label="강아지 추가"
            className="grid size-14 place-items-center rounded-full border border-dashed border-rule-strong text-ink-3 transition duration-200 ease-out hover:border-brand-2 hover:bg-brand-soft/50 hover:text-brand motion-safe:active:scale-95"
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
  /** 지금 선택된 강아지의 이름. 저장된 강아지를 안 골랐으면 null. */
  petName: string | null
  /** 이 스타일이 그림에 이름을 인쇄하는가 (PR #98). */
  namesTheImage: boolean
  /** 이 스타일이 그림에 견종을 인쇄하는가 (백엔드 #131 A안 → PR #137). */
  printsBreed: boolean
  onPetSaved: (petId: string) => void
  onPickAnother: () => void
  onStart: () => void
  creditCost: number | null
  starting: boolean
  startError: string | null
  styleMissing: boolean
  fromJobId: string | null
  /** 이 스타일이 요구하는 입력 스키마 (이슈 #114). 없는 스타일이면 빈 배열입니다. */
  inputFields: StyleInputField[]
  inputValues: Record<string, string>
  /** **보여 줄** 오류만 옵니다 — 아직 안 만진 칸은 빠져 있습니다(W04Upload 주석). */
  inputErrors: Record<string, string>
  /** 만들기를 눌렀지만 입력 때문에 멈춘 상태. 버튼 아래에 이유를 한 줄 답니다. */
  inputsBlocking: boolean
  /** `prefill` 칸의 placeholder 가 무엇이 들어갈지 말하는 데 씁니다. */
  petNameForPrefill: string | null
  onInputChange: (label: string, value: string) => void
  onInputTouch: (label: string) => void
}

function ConfirmPanel({
  upload,
  petId,
  petName,
  namesTheImage,
  printsBreed,
  onPetSaved,
  onPickAnother,
  onStart,
  creditCost,
  starting,
  startError,
  styleMissing,
  fromJobId,
  inputFields,
  inputValues,
  inputErrors: inputErrorsToShow,
  inputsBlocking,
  petNameForPrefill,
  onInputChange,
  onInputTouch,
}: ConfirmPanelProps) {
  const blocked = upload.blocking_issue

  /*
    이름 안내를 띄우는 자리에서 저장 폼도 같이 받습니다 — 아래쪽 기본 저장 폼과
    **둘 다 뜨면 안 됩니다**. 두 개의 «이름» 입력이 한 화면에 있으면 어느 쪽이
    그림에 들어가는 이름인지 화면이 스스로 헷갈리게 말하는 셈입니다.

    조건에 `fromJobId === null` 이 하나 더 붙어 있었습니다. 재사용 경로에서는 그
    사진에 붙은 강아지를 프론트가 알 방법이 없어서(`GET /v1/jobs/{id}` 에 `pet_id`
    가 없던 시절) 단정도 질문도 못 하고 아래 기본 저장 폼으로 흘려보내던 것입니다.
    백엔드 #111 이 그 필드를 채우면서 전제가 사라졌습니다 — 이제 재사용 경로도
    «강아지가 안 붙은 사진» 이면 다른 경로와 똑같이 여기서 이름을 받습니다.

    즉 판정은 **강아지가 붙어 있는가** 하나로 돌아왔습니다. 어디로 들어왔는지는
    이 질문과 아무 상관이 없었고, 상관있는 척했던 건 계약의 구멍이었습니다.
  */
  const askNameHere = namesTheImage && !blocked && !styleMissing && !petId

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
        className="mt-4 w-full rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
      >
        다른 사진 고르기
      </button>

      {!blocked && styleMissing && (
        // 사진부터 올린 경로(W-01 랜딩 CTA)의 다음 한 걸음. 비활성 버튼을 두면
        // 여기가 막다른 길이 됩니다 — 사진은 초안으로 남으니 돌아오면 이어집니다.
        <>
          <Link
            to={withReuse('/styles', fromJobId)}
            className="mt-2 block w-full rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
          >
            스타일 고르기 →
          </Link>
          <p className="mt-2 text-center text-xs text-ink-3">
            고른 스타일로 돌아오면 이 사진 그대로 이어집니다
          </p>
          {/* W-08 보조 진입점 — 사진이 이미 있으니 여기서 바로 넘어갈 수 있습니다.
              보조로만 두는 이유는 #p08 노트1(기본 그리드와 분리). */}
          <Link
            to={withReuse('/creative', fromJobId)}
            className="mt-3 block text-center text-sm text-ink-2 underline hover:text-brand"
          >
            원하는 걸 직접 써서 만들기 · 2 크레딧
          </Link>
        </>
      )}

      {!blocked && !styleMissing && namesTheImage && (
        <PetNameNotice
          petName={petName}
          /*
            강아지가 붙어 있는데 이름을 아직 모르는 창이 실제로 있습니다.

            초안 복원(402 왕복·재방문)과 재사용 경로(`from_job` → `pet_id`)는 둘 다
            `petId` 를 먼저 손에 넣고 `GET /v1/pets` 는 그 뒤에 도착합니다. 그 사이를
            «우리 아이» 로 그리면 화면이 **먼저 거짓말을 하고 나중에 정정**합니다 —
            그 순간에 버튼을 누른 사용자에게는 정정이 오지 않습니다. 목록에서 사라진
            강아지(다른 탭에서 삭제)라면 그 창이 아예 안 닫힙니다.
          */
          petAttached={petId !== null}
          uploadId={askNameHere ? upload.upload_id : null}
          onPetSaved={onPetSaved}
        />
      )}

      {/*
        견종 예고 (백엔드 #131 A안 → PR #137).

        `namesTheImage` 와 **따로** 겁니다. 두 플래그는 독립이고, 지금 둘 다 참인 건
        3D_피규어 한 종뿐이라 우연히 같이 나타날 뿐입니다.
      */}
      {!blocked && !styleMissing && printsBreed && (
        <BreedNotice estimate={upload.breed_estimate} />
      )}

      {/*
        스타일별 입력 폼 (이슈 #114).

        만들기 버튼 **앞**에 둡니다 — 이름 예고(PR #98)와 같은 이유입니다. 버튼을 누른
        뒤에는 못 바꾸고 크레딧은 이미 나갑니다. 차단된 사진·스타일 미정 상태에서는
        그리지 않습니다: 둘 다 이 자리의 다음 걸음이 «만들기» 가 아닙니다.
      */}
      {!blocked && !styleMissing && inputFields.length > 0 && (
        <StyleInputForm
          fields={inputFields}
          values={inputValues}
          errors={inputErrorsToShow}
          petName={petNameForPrefill}
          onChange={onInputChange}
          onTouch={onInputTouch}
        />
      )}

      {!blocked && !styleMissing && (
        <>
          {/* 노트3 — 경고가 있어도 이 버튼은 항상 눌립니다. 노트4 — 금액을 버튼에 박습니다. */}
          <button
            type="button"
            onClick={onStart}
            disabled={starting || creditCost === null}
            className="mt-2 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
          >
            {starting
              ? '만드는 중…'
              : creditCost === null
                ? '스타일 정보를 불러오는 중…'
                : `이대로 만들기 · ${creditCost} 크레딧`}
          </button>

          {/*
            버튼을 비활성으로 두지 않는 이유는 노트3 과 같습니다 — 회색 버튼은 왜 못
            누르는지 말하지 않습니다. 누르면 문제 있는 칸이 전부 드러나고(inputsSubmitted)
            여기서 어디를 봐야 하는지 알려 줍니다.
          */}
          {inputsBlocking && (
            <p role="alert" className="mt-2 text-center text-sm text-danger">
              위 입력에서 고칠 곳이 있어요.
            </p>
          )}

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

      {!petId && upload.upload_id && !askNameHere && (
        <SavePetForm uploadId={upload.upload_id} onSaved={onPetSaved} />
      )}
    </>
  )
}

function WarningCard({ warning }: { warning: UploadIssue }) {
  /*
    FR-EDGE-06/08/09 — 어느 코드든 "이래서 결과가 나쁠 수 있다"는 조언이지 차단이 아닙니다.

    `HUMAN_FACE_DETECTED` 만 성격이 다릅니다. Q6 확정(PR #124 · 이슈 #114 코멘트)으로
    `human_face_policy=warn` 이 유지되면서, 이 경고는 **책임이 어디로 가는지**를 말하는
    고지가 됐습니다 — 타인 얼굴의 동의 확인을 업로더에게 귀속시키는 결정의 일부입니다.
    품질 조언("그대로 변환되지 않을 수 있습니다")으로 적어 두면 결정이 화면에
    반영되지 않은 채 남습니다. 서버 `message` 는 첫 문장까지만 주므로(계약 그대로)
    나머지는 프론트 카피입니다.

    정책이 `block` 으로 바뀌면 같은 코드가 `blocking_issue` 로 와서 위쪽 분기가 잡습니다 —
    이 카드는 손댈 필요가 없습니다.
  */
  const hint =
    warning.code === 'MULTI_SUBJECT'
      ? '여러 마리가 함께 변환됩니다.'
      : warning.code === 'NOT_A_DOG'
        ? '강아지가 잘 보이는 사진일수록 결과가 좋습니다.'
        : warning.code === 'HUMAN_FACE_DETECTED'
          ? null
          : '그대로 진행해도 되지만, 밝은 사진이 결과가 더 좋습니다.'

  return (
    <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-3">
      <p className="text-sm font-semibold text-warn">{warning.message}</p>
      {warning.code === 'HUMAN_FACE_DETECTED' ? (
        <p className="mt-0.5 text-sm text-ink-2">
          <span className="font-semibold text-ink">
            타인 얼굴이 포함된 사진은 당사자 동의가 필요합니다.
          </span>{' '}
          계속 진행하면 동의를 받은 것으로 간주됩니다.
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-ink-2">{hint}</p>
      )}
    </div>
  )
}

/**
 * 그림에 견종이 들어가는 스타일의 예고 (서버 `uses_breed` · 백엔드 #131 A안 → PR #137).
 *
 * **왜 W-03 이 아니라 여기인가.** `uses_breed` 는 «이 스타일이 견종을 인쇄하는가» 만
 * 답하고, 실제로 인쇄될지는 **그 사진에서 견종이 잡혔는가** 로 갈립니다. 워커의 폴백은
 * `pet_profile.breed_label` → `source_image.breed_estimate["label"]` → «강아지» 인데
 * (app/worker.py), 첫 번째는 쓰는 API 가 없어 늘 NULL 이고(`app/routers/pets.py` 는
 * `name` 만 받습니다) 마지막으로 떨어지면 3D_피규어 프롬프트가 라벨을 통째로 뺍니다
 * («If the breed is the generic word "강아지", omit the breed label entirely»).
 *
 * 그러니 사진을 올리기 전에 «견종도 인쇄됩니다» 라고 쓰면 사진마다 참·거짓이 갈리는
 * 약속이 됩니다. 여기서는 **이 사진의 추정값을 이미 손에 들고 있어서**(§3
 * `POST /v1/uploads` 응답) 그 사진에 대해 참인 말만 할 수 있습니다.
 *
 * 화면이 보는 값과 워커가 쓸 값이 **같은 행**입니다 — 둘 다
 * `source_image.breed_estimate` 이고, `breed_label` 이 늘 NULL 이라 폴백 순서상
 * 앞지르는 값도 없습니다. 즉 여기 적힌 견종이 실제로 그림에 들어갈 견종입니다.
 *
 * `confidence` 로 거르지 않습니다. 워커가 안 거르기 때문입니다 — 0.41 이든 0.9 든
 * 라벨이 있으면 그대로 프롬프트에 들어갑니다. 여기서만 «믿을 만한 것» 을 골라 내면
 * 화면이 안 나온다고 한 견종이 그림에는 나옵니다.
 *
 * 라벨이 없으면 아무 말도 안 합니다. 견종이 안 들어가는 건 결함이 아니라 그냥 없는
 * 것이고, W-03 이 견종을 예고하지 않으므로 정정할 기대도 없습니다. 잡히지도 않은
 * 견종을 두고 «못 찾았어요» 라고 쓰면 사용자가 고칠 수 없는 일을 걱정하게 됩니다.
 */
function BreedNotice({ estimate }: { estimate: BreedEstimate | null }) {
  /*
    세 필드가 **각각** null 일 수 있습니다 — 서버가 비전 응답을 그대로 흘려보냅니다
    (`app/routers/uploads.py` `BreedEstimate`). `code` 나 `confidence` 만 오고 `label`
    이 비는 경우도 계약상 가능하고, 그때 워커가 쓸 값은 «강아지» 입니다.
  */
  const label = estimate?.label?.trim()
  if (!label) return null

  return (
    <p className="mt-3 rounded-lg border border-rule bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
      이 사진에서 <span className="font-semibold text-ink">«{label}»</span> 로 보여요 — 그림에
      견종도 함께 들어갑니다.
    </p>
  )
}

/**
 * 그림에 이름이 들어가는 스타일의 예고 (PR #98 · 서버 `uses_pet_name`).
 *
 * 세 가지 상태를 **말이 되는 만큼만** 구분합니다. 아는 것은 단정하고, 모르는 것은
 * 모른다고 말합니다.
 *
 * 네 번째 상태가 있었습니다 — «이 사진에 저장된 강아지가 있으면 그 이름이, 없으면
 * 우리 아이가». 재사용 경로에서 이 사진의 강아지를 프론트가 몰라서 양쪽을 다 말하던
 * 문구인데, 결제 직전에 «둘 중 하나입니다» 는 예고가 아니라 미룸입니다. 백엔드 #111
 * 이 `GET /v1/jobs/{id}.pet_id` 를 채우면서 모를 이유가 없어져 지웠습니다.
 *
 * 진행을 막지 않는 것은 W-04 의 경고 카드와 같은 원칙입니다(노트3) — 이름 없이 만드는
 * 것도 정상 경로이고, 화면이 할 일은 결제 전에 사실을 알려 주는 것까지입니다.
 */
function PetNameNotice({
  petName,
  petAttached,
  uploadId,
  onPetSaved,
}: {
  petName: string | null
  /** 이 사진에 강아지가 붙어 있는가. 붙어 있으면 이름을 모를 때도 폴백이 아닙니다. */
  petAttached: boolean
  /** 값이 있으면 이 자리에서 이름도 받습니다 — 아래 기본 저장 폼은 내려갑니다. */
  uploadId: string | null
  onPetSaved: (petId: string) => void
}) {
  return (
    <section className="mt-3 rounded-lg border border-rule bg-surface-2 px-3 py-3">
      <p className="text-sm text-ink-2">
        {petName !== null ? (
          <>
            그림에 <span className="font-semibold text-ink">«{petName}»</span> 라는 이름이
            들어갑니다.
          </>
        ) : petAttached ? (
          // 이름은 아직(또는 영영) 모르지만 «우리 아이» 가 아닌 것은 압니다.
          <>저장된 강아지의 이름이 그림에 들어갑니다.</>
        ) : (
          <>
            이대로 만들면 그림에{' '}
            <span className="font-semibold text-ink">«{PET_NAME_FALLBACK}»</span> 라는 이름이
            들어갑니다.
          </>
        )}
      </p>

      {uploadId && (
        <SavePetForm
          uploadId={uploadId}
          onSaved={onPetSaved}
          variant="inline"
          title="이름 넣고 만들기"
          hint="저장하면 그림에 이 이름이 들어가고, 다음에 올 때 이 사진으로 바로 시작할 수 있어요."
        />
      )}
    </section>
  )
}

/** 노트2 — 재방문 시 반복 사용률을 좌우하는 기능이라 업로드 직후 바로 물어봅니다. */
function SavePetForm({
  uploadId,
  onSaved,
  variant = 'standalone',
  title = '이 강아지 저장하기',
  hint = '다음에 올 때 이 사진으로 바로 시작할 수 있어요.',
}: {
  uploadId: string
  onSaved: (petId: string) => void
  /** `inline` 은 이미 카드 안에 들어가 있는 경우 — 테두리를 겹쳐 그리지 않습니다. */
  variant?: 'standalone' | 'inline'
  title?: string
  hint?: string
}) {
  const [name, setName] = useState('')
  const createPet = useCreatePet()

  return (
    <form
      className={
        variant === 'inline' ? 'mt-3' : 'mt-6 rounded-lg border border-rule bg-surface p-3'
      }
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (!trimmed) return
        createPet.mutate({ name: trimmed, uploadId }, { onSuccess: (pet) => onSaved(pet.id) })
      }}
    >
      <label htmlFor={`pet-name-${variant}`} className="text-sm font-semibold">
        {title}
      </label>
      <p className="mt-0.5 text-xs text-ink-3">{hint}</p>
      <div className="mt-2 flex gap-2">
        <input
          id={`pet-name-${variant}`}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="이름 (예: 콩이)"
          maxLength={20}
          className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={createPet.isPending || name.trim() === ''}
          className="shrink-0 rounded-lg border border-rule-strong px-3 py-2 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
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

