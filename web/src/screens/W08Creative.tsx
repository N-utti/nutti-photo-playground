/**
 * W-08 · 크리에이티브 모드 (docs/wireframe-spec-v0.5.html#p08)
 *
 * 반영한 노트:
 *   1. 기본 그리드에서 분리 — 카탈로그·업로드 화면의 **보조** 진입점으로만 옵니다
 *      (FR-W08-01). PixPawAI 가 커스텀 프롬프트를 전면에 놓았다가 "학습곡선"으로
 *      지적받은 게 이 배치의 근거입니다.
 *   2. 빈 입력창을 주지 않습니다 — "우리 애를 __ 로 만들어줘" 문장 틀 + 예시 칩.
 *      백지 프롬프트는 초보자 이탈의 전형입니다(FR-W08-02).
 *   3. 할 수 있는 것과 없는 것을 **입력 단계에서** 못박습니다(FR-W08-03).
 *   4. 비용 2크레딧 — 커스텀은 실패율이 높아 재생성이 잦습니다(FR-W08-04).
 *
 * 사진은 이 화면에서 새로 올리지 않고 W-04 가 남긴 업로드 초안을 이어받습니다
 * (api/uploadDraft.ts). 품질 체크·고양이 차단·펫 저장을 여기 한 번 더 구현하면
 * 두 화면의 규칙이 갈라집니다.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { isApiError } from '../api/client'
import {
  beginJobAttempt,
  clearJobAttempt,
  resumeJobAttempt,
  type JobIntent,
} from '../api/idempotency'
import { useCreateJob } from '../api/queries'
import { rememberJobContext } from '../api/jobContext'
import { clearUploadDraft, readUploadDraft } from '../api/uploadDraft'
import { CreditBadge } from '../app/CreditBadge'
import { promptRejectionReason } from '../app/promptFilter'
import { useReuseFromJob } from '../app/reuseFromJob'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'

/** §2 W-08 — 정적 콘텐츠(고정 예시 목록). 와이어프레임 #p08 칩과 동일합니다. */
const EXAMPLE_CHIPS = ['눈 오는 날 산책', '80년대 앨범 커버', '도자기 인형', '파일럿']

/** 커스텀 프롬프트는 프리셋의 2배입니다(FR-W08-04). 서버도 같은 값으로 계산합니다. */
const CUSTOM_PROMPT_COST = 2

export default function W08Creative() {
  const navigate = useNavigate()
  const createJob = useCreateJob()

  // 초안은 sessionStorage 라 마운트 시 한 번 읽으면 됩니다(탭 수명과 같이 감).
  const [draft] = useState(() => readUploadDraft())
  const [prompt, setPrompt] = useState('')
  const [insufficient, setInsufficient] = useState<{ required: number; balance: number } | null>(
    null,
  )

  // 노트3 — 판정 규칙은 app/promptFilter.ts. 통과 못 하면 버튼도 잠깁니다.
  const rejection = promptRejectionReason(prompt)

  /**
   * 사진의 출처는 둘입니다.
   *
   *  1. `?from_job=` — W-02 재사용 배너를 지나 여기까지 온 경우(FR-W06-07).
   *     이미 만든 job 의 `upload_id` 를 그대로 씁니다(이슈 #9 A안, 서버 우선).
   *  2. 업로드 초안 — W-04 에서 사진만 올리고 넘어온 평소 경로.
   *
   * 1을 무시하면 재사용으로 들어온 사용자가 "사진을 먼저 올려 주세요"를 만납니다.
   * 재사용 시 `pet_id` 는 비웁니다 — job 응답이 어느 강아지였는지 말해 주지 않아서
   * (§3) 아무 값이나 넣으면 보관함 필터가 틀린 강아지를 답합니다.
   */
  const reuse = useReuseFromJob()
  const uploadId = reuse.context?.uploadId ?? draft?.upload.upload_id ?? null
  const sourceImageUrl = reuse.context?.sourceImageUrl ?? draft?.upload.image_url ?? null
  const petId = reuse.context ? null : (draft?.petId ?? null)

  function start() {
    if (!uploadId || !prompt.trim() || rejection) return

    const intent: JobIntent = {
      style_id: null,
      upload_id: uploadId,
      pet_id: petId,
      custom_prompt: prompt.trim(),
    }
    // 402 후 재시도는 같은 키, 새 문구는 새 의도라 새 키입니다(api/idempotency.ts).
    const attempt = resumeJobAttempt(intent) ?? beginJobAttempt(intent)

    createJob.mutate(
      { body: intent, idempotencyKey: attempt.key },
      {
        onSuccess: ({ job_id }) => {
          clearJobAttempt()
          clearUploadDraft()
          // 문구까지 남겨야 W-06 "다시 만들기"가 같은 커스텀 생성을 2 크레딧으로
          // 다시 돌립니다(응답에 style_id·upload_id 가 없어서 생긴 우회, 이슈 #9).
          rememberJobContext(job_id, {
            styleId: null,
            uploadId: intent.upload_id,
            sourceImageUrl,
            customPrompt: intent.custom_prompt,
          })
          navigate(`/jobs/${job_id}/waiting`)
        },
        onError: (error) => {
          if (isApiError(error, 'INSUFFICIENT_CREDIT')) {
            const detail = error.detail as { required?: number; balance?: number } | undefined
            setInsufficient({
              required: detail?.required ?? CUSTOM_PROMPT_COST,
              balance: detail?.balance ?? 0,
            })
          }
        },
      },
    )
  }

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <button type="button" onClick={() => navigate(-1)} aria-label="뒤로" className="text-ink-2">
          ←
        </button>
        <h1 className="text-base font-bold">직접 만들기</h1>
        <CreditBadge />
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {reuse.pending ? (
          // 재사용 재료를 서버에 묻는 중입니다. 여기서 "사진을 먼저 올려 주세요"를
          // 띄우면, 사진이 있는데도 없다고 말했다가 곧 뒤집는 화면이 됩니다.
          <p className="py-16 text-center text-sm text-ink-3">사진을 불러오는 중…</p>
        ) : !uploadId ? (
          <div className="rounded-xl border border-rule bg-surface px-4 py-5">
            <p className="text-sm font-semibold">사진을 먼저 올려 주세요</p>
            <p className="mt-1 text-sm text-ink-2">
              직접 쓴 문장으로 만들려면 우리 애 사진이 먼저 필요해요.
            </p>
            <Link
              to="/upload"
              className="mt-4 block rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-paper"
            >
              사진 올리기
            </Link>
          </div>
        ) : (
          <>
            {sourceImageUrl && (
              <img
                src={sourceImageUrl}
                alt="업로드한 사진"
                className="aspect-square w-full rounded-xl bg-surface-2 object-cover"
              />
            )}

            {/* 노트2 — 문장 틀. 빈칸만 사용자가 채웁니다. */}
            <label
              htmlFor="custom-prompt"
              className="mt-4 block text-sm font-semibold text-ink-2"
            >
              우리 애를 무엇으로 만들까요?
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3 py-2">
              <span aria-hidden className="shrink-0 text-sm text-ink-3">
                우리 애를
              </span>
              <input
                id="custom-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="눈 오는 날 산책"
                maxLength={100}
                className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              />
              <span aria-hidden className="shrink-0 text-sm text-ink-3">
                로 만들어줘
              </span>
            </div>

            <p className="mt-3 text-xs text-ink-3">예시를 눌러 채워보세요</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {EXAMPLE_CHIPS.map((chip) => (
                <li key={chip}>
                  <button
                    type="button"
                    onClick={() => setPrompt(chip)}
                    className="rounded-full border border-rule bg-surface px-3 py-1.5 text-sm text-ink-2"
                  >
                    {chip}
                  </button>
                </li>
              ))}
            </ul>

            {/* 노트3 — 결과 불만의 주된 원인을 입력 단계에서 미리 못박습니다. */}
            <p className="mt-4 rounded-lg border border-rule bg-surface-2 px-3 py-2 text-xs text-ink-2">
              배경 · 의상 · 분위기는 바꿀 수 있어요. 품종이나 털색을 바꾸는 요청은 거절됩니다.
            </p>

            {rejection && (
              <p role="alert" className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                {rejection}
              </p>
            )}

            <button
              type="button"
              onClick={start}
              disabled={!prompt.trim() || rejection !== null || createJob.isPending}
              className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
            >
              {createJob.isPending ? '만드는 중…' : `만들기 · ${CUSTOM_PROMPT_COST} 크레딧`}
            </button>

            {createJob.error && !isApiError(createJob.error, 'INSUFFICIENT_CREDIT') && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {createJob.error.message}
              </p>
            )}

            <p className="mt-2 text-center text-xs text-ink-3">실패하면 크레딧은 자동 반환됩니다</p>
          </>
        )}
      </main>

      {insufficient && (
        <InsufficientCreditOverlay
          required={insufficient.required}
          balance={insufficient.balance}
          onClose={() => setInsufficient(null)}
          onRetry={() => {
            setInsufficient(null)
            start()
          }}
        />
      )}
    </div>
  )
}

