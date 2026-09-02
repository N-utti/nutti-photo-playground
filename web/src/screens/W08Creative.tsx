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
 *   4. 비용을 버튼에 박습니다 — 커스텀은 실패율이 높아 재생성이 잦습니다(FR-W08-04).
 *      FR 이 적은 «2크레딧» 은 서버 폴백값이지 고정값이 아닙니다(app/customPromptCost.ts).
 *
 * 사진은 이 화면에서 새로 올리지 않고 W-04 가 남긴 업로드 초안을 이어받습니다
 * (api/uploadDraft.ts). 품질 체크·고양이 차단·펫 저장을 여기 한 번 더 구현하면
 * 두 화면의 규칙이 갈라집니다.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { isApiError } from '../api/client'
import {
  beginJobAttempt,
  clearJobAttempt,
  resumeJobAttempt,
  type JobIntent,
} from '../api/idempotency'
import { useCreateJob } from '../api/queries'
import { clearUploadDraft, readUploadDraft } from '../api/uploadDraft'
import BreedField from '../app/BreedField'
import BackButton from '../app/BackButton'
import { CreditBadge } from '../app/CreditBadge'
import { useCustomPromptCost } from '../app/customPromptCost'
import { promptRejectionReason } from '../app/promptFilter'
import { useReuseFromJob } from '../app/reuseFromJob'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'

/** §2 W-08 — 정적 콘텐츠(고정 예시 목록). 와이어프레임 #p08 칩과 동일합니다. */
const EXAMPLE_CHIPS = ['눈 오는 날 산책', '80년대 앨범 커버', '도자기 인형', '파일럿']

/*
 * 비용(FR-W08-04)의 출처는 서버입니다 — `GET /v1/credits` 의 `custom_prompt_credit_cost`
 * (이슈 #149 A안, PR #151). 읽는 자리를 `app/customPromptCost.ts` 로 모아 둔 이유는 같은
 * 숫자를 W-02·W-04 링크도 말하기 때문입니다. 「프리셋의 2배」라고 적던 예전 주석은 두
 * 군데가 틀렸습니다: 프리셋 비용은 스타일마다 다르고(운영이 DB 에서 조정), 서버가 «같은
 * 값으로 계산» 한다는 것도 `app_setting` 이 비어 있을 때만 참입니다.
 */

/**
 * 서버 입력 필터에 걸린 400 을 사람 말로 옮깁니다 (PR #60, FR-EDGE-13).
 *
 * 2중 방어의 **두 번째 겹**이 실제로 켜졌습니다(`app/routers/jobs.py`
 * `_CUSTOM_PROMPT_BLOCKLIST`). 두 목록은 일부러 다릅니다 — 화면 필터는 견종 이름 위주고
 * 서버는 "색깔"·"갈색으로" 같은 표현을 더 봅니다. 그래서 화면을 통과한 문장이 서버에서
 * 막히는 조합이 실제로 존재하고, 그때 서버 메시지("요청 형식이 올바르지 않습니다")를
 * 그대로 띄우면 사용자는 **무엇을 고쳐야 하는지 알 수 없습니다**. 화면 필터가 쓰는 것과
 * 같은 문구로 답해서, 어느 겹에서 막혔든 사용자가 보는 안내가 하나가 되게 합니다.
 *
 * 크레딧은 나가지 않았습니다 — 서버가 차감 트랜잭션 **앞에서** 막습니다(UC-08 A1-a).
 */
function serverRejection(error: unknown): string | null {
  if (!isApiError(error, 'VALIDATION_ERROR')) return null
  const detail = error.detail as { reason?: string } | undefined
  if (detail?.reason !== 'input_filter_blocked') return null
  return '품종 · 털색을 바꾸는 요청은 만들 수 없어요. 배경 · 의상 · 분위기로 바꿔 보세요. (크레딧은 차감되지 않았어요)'
}

export default function W08Creative() {
  const navigate = useNavigate()
  const createJob = useCreateJob()

  // 초안은 sessionStorage 라 마운트 시 한 번 읽으면 됩니다(탭 수명과 같이 감).
  const [draft] = useState(() => readUploadDraft())
  const [prompt, setPrompt] = useState('')
  /** 고르거나 직접 쓴 견종 — 계산기 링크가 씁니다(커스텀 프롬프트엔 `[breed]` 없음). 비우면 지난 값 유지. */
  const [breed, setBreed] = useState(draft?.breed ?? '')
  const [insufficient, setInsufficient] = useState<{ required: number; balance: number } | null>(
    null,
  )

  /**
   * 비용은 이제 **요청 전에** 압니다 — `GET /v1/credits` 의 `custom_prompt_credit_cost`
   * (이슈 #149 A안). 예전에는 이 화면이 2 를 적어 두고 402 를 맞아야만 배웠습니다.
   *
   * 402 의 `required` 는 그래도 남깁니다. 둘이 어긋나는 순간이 실제로 있습니다 —
   * 화면을 열어 둔 사이 운영이 `app_setting` 을 바꾸면 캐시된 정책값은 낡고, 방금
   * 거절한 서버가 말한 `required` 가 참입니다. 그래서 배운 값이 정책값을 덮습니다.
   * 세션에는 남기지 않습니다(화면 수명 안에서만) — 서버 상태를 클라이언트가 대신
   * 기억하는 구조는 이 repo 가 이미 한 번 지운 후퇴입니다(이슈 #9 의 `jobContext.ts`).
   *
   * 모르는 동안(`null`) 숫자를 지어내지 않습니다 — 라벨에서 비용만 빠집니다.
   */
  const policyCost = useCustomPromptCost()
  const [chargedCost, setChargedCost] = useState<number | null>(null)
  const cost = chargedCost ?? policyCost

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
  // 재사용 경로는 그 사진에 이미 적어 둔 견종을 이어받습니다(`GET /v1/jobs/{id}.breed`).
  const reusedBreed = reuse.context?.breed ?? null
  useEffect(() => {
    if (reusedBreed) setBreed(reusedBreed)
  }, [reusedBreed])

  function start() {
    if (!uploadId || !prompt.trim() || rejection) return

    const intent: JobIntent = {
      style_id: null,
      upload_id: uploadId,
      pet_id: petId,
      custom_prompt: prompt.trim(),
      ...(breed.trim() ? { breed: breed.trim() } : {}),
    }
    // 402 후 재시도는 같은 키, 새 문구는 새 의도라 새 키입니다(api/idempotency.ts).
    const attempt = resumeJobAttempt(intent) ?? beginJobAttempt(intent)

    createJob.mutate(
      { body: intent, idempotencyKey: attempt.key },
      {
        onSuccess: ({ job_id }) => {
          clearJobAttempt()
          clearUploadDraft()
          // 문구를 따로 남기지 않습니다 — job 응답의 `custom_prompt` 가 답합니다
          // (PR #83, 이슈 #81). 예전에는 여기서 localStorage 색인에 적어 뒀고, 그래서
          // W-06 "다시 만들기"가 **이 브라우저에서만** 살아 있었습니다.
          navigate(`/jobs/${job_id}/waiting`)
        },
        onError: (error) => {
          if (isApiError(error, 'INSUFFICIENT_CREDIT')) {
            const detail = error.detail as { required?: number; balance?: number } | undefined
            if (detail?.required !== undefined) setChargedCost(detail.required)
            // 필요한 크레딧을 모르면 오버레이가 «몇 크레딧이 필요한지» 를 못 씁니다.
            // 그 경우엔 열지 않고 버튼 아래 오류 문구로 넘깁니다 — 0 을 적어 두면
            // 화면이 «0 크레딧이 필요한데» 라는 말을 하게 됩니다.
            const required = detail?.required ?? cost
            if (required !== null) {
              setInsufficient({ required, balance: detail?.balance ?? 0 })
            }
          }
        },
      },
    )
  }

  return (
    <div className="screen-min-h bg-paper pb-16">
      <header className="sticky top-0 desktop:top-14 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <BackButton fallback="/upload" />
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
              className="mt-4 block rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
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

            <BreedField value={breed} onChange={setBreed} />

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
                    className="rounded-full border border-rule bg-surface px-3 py-1.5 text-sm text-ink-2 hover:border-brand-2 hover:bg-brand-soft/50 hover:text-brand"
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
              className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
            >
              {createJob.isPending
                ? '만드는 중…'
                : cost === null
                  ? // 비용을 아직 모릅니다. 버튼은 살려 둡니다 — `GET /v1/credits` 가
                    // 실패한 상태에서 잠그면 만들기 자체가 막다른 길이 됩니다.
                    '만들기'
                  : `만들기 · ${cost} 크레딧`}
            </button>

            {/*
              오버레이를 못 연 402(= `required` 도 정책값도 모르는 경우)에서 화면이 아무
              말도 안 하지 않게, 조건을 «부족 오류가 아님» 이 아니라 «오버레이가 안 떴음»
              으로 둡니다. 오버레이를 닫은 뒤에도 방금 실패한 이유가 남습니다.
            */}
            {createJob.error && !insufficient && (
              <p role="alert" className="mt-2 text-center text-sm text-danger">
                {serverRejection(createJob.error) ?? createJob.error.message}
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

