/**
 * W-06 · 결과 (docs/wireframe-spec-v0.5.html#p06)
 *
 * 배치 순서가 이 화면의 전부입니다 — 와이어프레임 콜아웃: 출구(공유·계산기·쇼핑몰)를
 * 결과 이미지보다 **위**에 두면 광고로 읽혀 공유가 끊깁니다. 결과 → 공유 → 계산기 →
 * 쇼핑몰 → 다른 스타일 순서를 바꾸지 마세요(FR-W06-08).
 *
 * 반영한 노트:
 *   1. 비교 슬라이더 — 변환본만으로는 "우리 애가 맞나" 판단이 안 됩니다
 *   2. ~~4장 중 선택~~ — Q4 확정(1요청 1장, 이슈 #26)으로 사문화. 정오표 E-05
 *   3. 공유가 주 버튼, 저장이 보조 (v0.2에서 뒤집힘)
 *   4. 누띠 서명은 **서버가 이미지에 합성**해 내려줍니다(§2) — 프론트가 그리지 않습니다
 *   6. 출구 셋을 감정 최고점에 모읍니다
 *   7. 업로드를 재사용하는 2회차 유도
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError } from '../api/client'
import { calculatorHeadline, estimateSummary } from '../api/calculatorLink'
import { events } from '../api/endpoints'
import { beginJobAttempt, clearJobAttempt, resumeJobAttempt } from '../api/idempotency'
import { CreditBadge } from '../app/CreditBadge'
import { NUTTI_SHOP_URL } from '../app/externalLinks'
import {
  invalidateAfterJobSettled,
  isFatalJobError,
  useCalculatorLink,
  useCreateJob,
  useJobPolling,
  useMe,
  useShareJob,
  useStyles,
} from '../api/queries'
import { useGuestSessionReset } from '../app/guestSession'
import { contextFromJob, withReuse } from '../app/reuseFromJob'
import { saveImage, type SaveImageOutcome } from '../app/saveImage'
import Thumbnail from '../app/Thumbnail'
import type { Job, JobErrorCode } from '../api/types'
import AccountSheet from './AccountSheet'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'
import JobUnavailable from './JobUnavailable'

/**
 * 쇼핑몰 행은 API 대상이 아니라 운영이 갱신하는 설정값입니다(§2 W-06).
 * 문구에 효능(관절·면역 등) 단정 표현을 넣지 마세요 — FR-W06-11 · NFR-LEGAL-01.
 */
const SHOP_BANNER = {
  url: NUTTI_SHOP_URL,
  title: '누띠 수제간식 보러가기',
  note: '5만원 이상 무료배송',
}

/**
 * 실패 문구는 **문서화된 코드에만** 있습니다(§1). 그 밖의 값이 오면 여기서 막습니다.
 *
 * 표를 그대로 인덱싱하면 처음 보는 코드에서 `undefined.title` 이 터지고, 그러면
 * 사라지는 건 문구 한 줄이 아니라 화면 전체입니다 — 크레딧이 돌아왔다는 안내도,
 * 사진을 살려 주는 "다시 시도"도 같이 날아가고 라우터 기본 에러 화면만 남습니다.
 * 크레딧이 나갔다 돌아온 사람에게 그 화면은 «돈만 나가고 사진도 잃었다»로 읽힙니다.
 *
 * 폴백이 `GENERATION_FAILED` 인 이유: 모르는 코드에 대해 우리가 확실히 아는 건
 * «만들기가 실패했고 크레딧은 돌아왔다» 뿐이고, 그게 정확히 이 문구입니다. 반대로
 * SAFETY_BLOCKED 로 폴백하면 사진 탓이 아닌 실패에 사진 탓을 하게 됩니다.
 */
function failureCopy(code: Job['error_code']): { title: string; body: string } {
  return FAILURE_COPY[code as JobErrorCode] ?? FAILURE_COPY.GENERATION_FAILED
}

const FAILURE_COPY: Record<JobErrorCode, { title: string; body: string }> = {
  GENERATION_FAILED: {
    title: '만들기에 실패했어요',
    body: '모델 쪽 오류였어요. 사진은 그대로 있으니 다시 시도해 주세요.',
  },
  SAFETY_BLOCKED: {
    title: '이 사진은 만들 수 없었어요',
    body: '안전 필터에 걸렸어요. 다른 사진이나 다른 스타일로 시도해 주세요.',
  },
  MAX_RETRIES_EXCEEDED: {
    title: '여러 번 시도했지만 실패했어요',
    body: '잠시 뒤에 다시 시도해 주세요.',
  },
}

export default function W06Result() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const guestReset = useGuestSessionReset()

  const { data: job, error } = useJobPolling(jobId ?? null)

  // 아직 만드는 중인 job 주소로 직접 들어온 경우(Q7 복원 포함)는 대기 화면이 주인입니다.
  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'processing')) {
      navigate(`/jobs/${job.job_id}/waiting`, { replace: true })
    }
  }, [job, navigate])

  // 성공이면 차감, 실패면 자동 반환이 이미 끝나 있습니다(§4 시나리오2 5단계).
  // 어느 쪽이든 잔액이 움직였으므로 배지를 다시 읽지 않으면 거짓말을 합니다.
  const settled = job?.status === 'succeeded' || job?.status === 'failed'
  useEffect(() => {
    if (settled) void invalidateAfterJobSettled(client)
  }, [settled, client])

  // W-05 와 같은 판정입니다(같은 훅을 쓰므로 여기서 달라지면 두 화면이 같은 에러를
  // 다르게 말합니다). 이미 그려 둔 결과가 있는데 5xx 한 번에 화면을 헐면, 손에 쥔
  // 결과물을 «찾을 수 없다»로 덮는 셈입니다.
  if (error && (job == null || isFatalJobError(error))) {
    const status = error instanceof ApiError ? error.status : 0
    return (
      <JobUnavailable
        reason={
          guestReset ? 'guest-reset' : status === 404 || status === 401 ? 'not-found' : 'error'
        }
        detail={status >= 500 ? error.message : undefined}
      />
    )
  }

  return (
    <div className="min-h-full bg-canvas pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <Link to="/styles" aria-label="스타일 목록" className="text-ink-2">
          ←
        </Link>
        <h1 className="text-base font-bold">{job?.status === 'failed' ? '실패' : '완성'}</h1>
        <CreditBadge />
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {job?.status === 'failed' ? (
          <FailurePanel job={job} />
        ) : job?.status === 'succeeded' ? (
          <ResultPanel job={job} />
        ) : (
          <div className="py-16 text-center text-sm text-ink-3">불러오는 중…</div>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------- 실패 (FR-EDGE-01)

function FailurePanel({ job }: { job: Job }) {
  const copy = failureCopy(job.error_code)

  return (
    <>
      {/* "원본은 유지" — 다시 시도할 때 사진을 다시 올리게 하지 않습니다. */}
      <img
        src={job.source_image_url}
        alt="업로드한 사진"
        className="aspect-square w-full rounded-xl bg-canvas-2 object-cover"
      />
      <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-3">
        <p className="text-sm font-semibold text-danger">{copy.title}</p>
        <p className="mt-0.5 text-sm text-ink-2">{copy.body}</p>
      </div>
      <p className="mt-2 text-center text-xs text-ink-3">크레딧은 자동으로 돌려드렸어요</p>
      <Regenerate job={job} label="다시 시도" />
    </>
  )
}

// ---------------------------------------------------------------- 성공

function ResultPanel({ job }: { job: Job }) {
  // Q4 확정(2026-08-04)으로 **1요청 = 1장**입니다. `results[]` 배열 형태는 산출 수
  // 상향 대비로 남아 있지만(§3) 길이는 항상 1이고, `selected_index`·
  // `POST /jobs/{id}/select` 는 스펙에서 삭제됐습니다 — 고를 게 없으니 선택도 없습니다.
  // 다른 결과가 필요하면 "다시 만들기"(새 job·새 크레딧)가 그 경로입니다.
  const current = job.results?.[0] ?? null

  // 노트: 결과를 실제로 본 시점을 W-11 집계의 기준선으로 씁니다(04-erd metric_event).
  const viewLogged = useRef(false)
  useEffect(() => {
    if (viewLogged.current) return
    viewLogged.current = true
    void events.track({ event_type: 'result_view', properties: { job_id: job.job_id } })
  }, [job.job_id])

  return (
    <>
      {/* 노트1 — 원본 대조가 만족도의 근거. 노트4 — 서명은 이미지에 이미 합성돼 있습니다. */}
      {current && <CompareSlider beforeUrl={job.source_image_url} afterUrl={current.image_url} />}

      {/* 출구 1 — 공유가 주 버튼(노트3). */}
      <ShareRow job={job} />

      <Regenerate
        job={job}
        label="다시 만들기"
        hint="결과는 매번 달라져요 — 마음에 안 들면 다시 만들어 보세요"
      />

      {/* 출구 2 — 계산기(W-07 배선). */}
      <CalculatorBanner jobId={job.job_id} />

      {/* 출구 3 — 쇼핑몰. */}
      <a
        href={SHOP_BANNER.url}
        target="_blank"
        rel="noreferrer"
        onClick={() =>
          void events.track({
            event_type: 'shop_exit_click',
            properties: { job_id: job.job_id },
          })
        }
        className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-brand-2 bg-brand-soft px-3 py-3"
      >
        <span>
          <span className="block text-sm font-semibold">{SHOP_BANNER.title}</span>
          <span className="block text-xs text-ink-3">{SHOP_BANNER.note}</span>
        </span>
        <span aria-hidden className="text-ink-3">
          →
        </span>
      </a>

      {/* 노트7 — 같은 업로드로 2회차. */}
      <OtherStyles jobId={job.job_id} />
    </>
  )
}

/**
 * 비교 슬라이더. range 입력을 투명하게 덮어 두면 드래그·클릭·키보드(화살표)가
 * 전부 공짜로 따라옵니다 — 포인터 이벤트를 직접 구현하면 키보드 접근성이 사라집니다.
 */
function CompareSlider({ beforeUrl, afterUrl }: { beforeUrl: string; afterUrl: string }) {
  const [position, setPosition] = useState(50)

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-canvas-2">
      <img src={afterUrl} alt="변환 결과" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img src={beforeUrl} alt="원본" className="size-full object-cover" />
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.currentTarget.value))}
        aria-label="원본과 결과 비교"
        className="peer absolute inset-0 size-full cursor-ew-resize opacity-0"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-surface peer-focus-visible:w-1 peer-focus-visible:bg-brand"
        style={{ left: `calc(${position}% - 1px)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-rule bg-surface"
        style={{ left: `${position}%` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------- 출구 1 · 공유/저장

function ShareRow({ job }: { job: Job }) {
  const share = useShareJob(job.job_id)
  const [accountSheet, setAccountSheet] = useState(false)
  const [saving, setSaving] = useState(false)
  // 'opened' 는 저장이 아니라 이미지가 새 탭에서 열렸다는 뜻입니다 — 그때만 안내합니다.
  const [saveOutcome, setSaveOutcome] = useState<SaveImageOutcome | null>(null)
  // 서버가 보는 상태를 씁니다 — 시트에서 로그인하면 캐시가 무효화되면서 이 줄이
  // 곧바로 회원으로 바뀝니다. localStorage 의 kind 는 값이 바뀌어도 리렌더가 없습니다.
  const { data: me } = useMe()
  const isMember = me?.kind === 'member'

  function handleSave() {
    // §2 — 회원은 결과가 자동으로 보관함에 남습니다. 게스트는 남길 곳이 없어
    // 계정 연동 시트가 뜹니다(W-06 B, FR-W06-09).
    if (!isMember) setAccountSheet(true)
  }

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold"
        >
          저장
        </button>
        <button
          type="button"
          disabled={share.isPending}
          onClick={() => {
            void events.track({
              event_type: 'share_click',
              properties: { job_id: job.job_id },
            })
            share.mutate()
          }}
          className="rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
        >
          {share.isPending ? '준비 중…' : '인스타 공유'}
        </button>
      </div>

      {isMember && (
        <p className="mt-2 text-center text-xs text-ink-3">
          보관함에 저장돼 있어요.{' '}
          <Link to="/library" className="underline">
            보관함 보기
          </Link>
        </p>
      )}

      {share.data && (
        /*
          인스타그램은 웹에서 대신 게시할 수 없습니다 — 이미지를 내려받아 사용자가 직접
          올리는 게 현재로선 유일한 경로입니다.

          이 이미지는 **위 슬라이더의 결과와 같은 파일**입니다(PR #73 — 서버는 공유용
          사본을 만들지 않고 결과 `public_url` 을 그대로 돌려줍니다, api/types.ts
          ShareResult). 그래서 «공유용 이미지» 라고 부르지 않습니다 — 새 그림이 생겼다고
          읽히면 사용자는 서명·구도가 달라진 별도 결과물을 기대하게 되고, 실제로는 방금
          본 그 사진이라 기대가 어긋납니다. 여기서 다시 그리는 이유는 슬라이더가 결과를
          늘 반쪽만 보여 주기 때문입니다 — 올릴 그림 전체를 보는 자리는 여기뿐입니다.

          저장은 앵커에 URL 을 그대로 물리지 않고 `saveImage` 를 지납니다. `download`
          속성이 같은 오리진에서만 먹어서, CDN 이 붙는 순간(app/storage.py `public_url`)
          «이미지 저장» 이 이미지로 이동이 되기 때문입니다 — 이슈 #77, 그리고 그 조건을
          배포 문서에 박은 PR #78. CORS 가 아직 안 열려 fetch 가 실패하면 예전 동작으로
          물러나고, 그때만 길게 눌러 저장하라고 안내합니다.
        */
        <div className="mt-3 rounded-lg border border-rule bg-surface p-3">
          <img
            src={share.data.share_image_url}
            alt="저장할 결과 이미지"
            className="w-full rounded-lg bg-canvas-2"
          />
          <p className="mt-2 text-center text-xs text-ink-3">
            누띠 서명이 이미 들어 있어요 — 저장해서 인스타그램에 올려 주세요
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const url = share.data?.share_image_url
                if (!url) return
                setSaving(true)
                setSaveOutcome(null)
                void saveImage(url, `nutti-${job.job_id}.jpg`)
                  .then(setSaveOutcome)
                  .finally(() => setSaving(false))
              }}
              className="rounded-lg border border-rule-strong px-3 py-2 text-center text-sm font-semibold disabled:opacity-50"
            >
              {saving ? '저장 중…' : '이미지 저장'}
            </button>
            <a
              href="https://www.instagram.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-brand px-3 py-2 text-center text-sm font-semibold text-paper"
            >
              인스타그램 열기
            </a>
          </div>
          {saveOutcome === 'opened' && (
            <p className="mt-2 text-center text-xs text-ink-3">
              새 탭에 이미지를 열었어요 — 이미지를 길게 눌러 저장해 주세요.
            </p>
          )}
        </div>
      )}

      {share.error && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {share.error.message}
        </p>
      )}

      {accountSheet && (
        <AccountSheet
          onClose={() => setAccountSheet(false)}
          description="로그인하면 지금 결과가 보관함에 남고, 다음에 다른 기기에서도 열 수 있어요."
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------- 다시 만들기 (FR-W06-04)

function Regenerate({ job, label, hint }: { job: Job; label: string; hint?: string }) {
  const navigate = useNavigate()
  // 재생성 재료는 job 응답이 전부 답합니다(이슈 #9 · #81).
  const context = contextFromJob(job)
  const createJob = useCreateJob()
  const [insufficient, setInsufficient] = useState<{ required: number; balance: number } | null>(
    null,
  )

  // 재료를 모르면 재생성 자체가 불가능합니다. 서버가 답해도 **커스텀 job 인데 문구를
  // 모르는 경우**(style_id: null + 문구도 null)가 남습니다 — 프롬프트 로그가 job 보다
  // 먼저 지워진 경우고(`on_delete=SET_NULL`), 그대로 보내면 스타일도 문구도 없는
  // 요청이 나갑니다. PR #83 전에는 여기가 «이 브라우저에서 만든 job 이 아님»까지
  // 포함해 훨씬 넓었습니다.
  //
  // 다만 그 둘은 남은 재료가 다릅니다. 문구만 모르는 쪽은 `upload_id` 를 이미 알고
  // 있으므로 **사진까지 버릴 이유가 없습니다** — `from_job` 을 떼고 카탈로그로 보내면
  // 방금 쓴 사진을 다시 올리게 되고 새 upload_id 가 발급돼, PR #37 이 막아 둔 함정에
  // 그대로 빠집니다. 아래 «이 사진으로 다른 스타일» 섹션이 이미 맥락을 나르고 있어
  // 같은 화면에서 두 동선이 엇갈리기도 합니다. 실패 화면에는 그 섹션이 없으므로
  // (FailurePanel) 여기가 사진을 살리는 유일한 경로입니다.
  if (!context || (context.styleId === null && !context.customPrompt)) {
    const keepsPhoto = context !== null
    return (
      <Link
        to={keepsPhoto ? withReuse('/styles', job.job_id) : '/styles'}
        className="mt-2 block rounded-xl border border-rule px-4 py-3 text-center text-sm text-ink-2"
      >
        {keepsPhoto ? '이 사진으로 다른 스타일 고르기' : '다른 사진으로 만들기'}
      </Link>
    )
  }

  // 값을 지어내지 않고 **이 job 이 실제로 낸 값**을 그대로 씁니다(PR #83 `credit_cost`).
  // 실패한 job 도 0 이 되지 않으므로(자동 반환은 트랜잭션만 쌓습니다 — app/worker.py
  // `_refund`) 실패 화면의 버튼도 같은 값을 말합니다. 스타일 상세를 따로 불러
  // `credit_cost` 를 되짚던 조회는 이 값이 생기면서 없어졌습니다.
  const customPrompt = context.customPrompt
  const cost = job.credit_cost

  function regenerate() {
    if (!context) return
    const intent = {
      style_id: context.styleId,
      upload_id: context.uploadId,
      pet_id: null,
      // 커스텀으로 만든 결과는 같은 문구로 다시 돌려야 합니다 — 비우면 스타일도
      // 문구도 없는 요청이 나갑니다.
      custom_prompt: customPrompt,
    }
    // **새 의도 = 새 키**. 같은 키를 재사용하면 서버가 원래 job 을 그대로 돌려줘
    // 새 결과가 나오지 않습니다(§1 · api/idempotency.ts).
    //
    // 단 402 직후의 재시도는 예외입니다 — 그때는 job 이 만들어지지 않았으므로 원래
    // 키를 이어야 합니다(§4 시나리오3 4단계). resumeJobAttempt 는 **같은 의도이면서
    // 아직 job 이 안 생긴 시도**만 돌려주고(성공 시 clearJobAttempt 로 지워짐), 그
    // 외에는 null 이라 평소의 "다시 만들기"는 그대로 새 키를 받습니다.
    const attempt = resumeJobAttempt(intent) ?? beginJobAttempt(intent)

    createJob.mutate(
      { body: intent, idempotencyKey: attempt.key },
      {
        onSuccess: ({ job_id }) => {
          clearJobAttempt()
          navigate(`/jobs/${job_id}/waiting`)
        },
        onError: (error) => {
          if (isApiError(error, 'INSUFFICIENT_CREDIT')) {
            const detail = error.detail as { required?: number; balance?: number } | undefined
            setInsufficient({ required: detail?.required ?? cost, balance: detail?.balance ?? 0 })
          }
        },
      },
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={regenerate}
        disabled={createJob.isPending}
        className="mt-2 w-full rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold disabled:opacity-50"
      >
        {createJob.isPending ? '보내는 중…' : `${label} · ${cost} 크레딧`}
      </button>

      {/*
        1요청 1장(Q4 확정)이 되면서 이 버튼이 **"다른 결과"로 가는 유일한 경로**가
        됐습니다(이슈 #26). 마음에 안 들 때 고를 썸네일이 없어졌으니, 재생성이
        가능하다는 사실 자체를 말해 주지 않으면 그냥 이탈합니다.

        다만 버튼 위계는 그대로 둡니다 — 공유가 주 버튼인 건 이 화면의 목적이고
        (FR-W06-03·노트3), 재생성을 검정 버튼으로 올리면 유입 동선이 뒤집힙니다.
        저장과 같은 무게까지만 올리고 나머지는 문구로 해결합니다.
      */}
      {hint && <p className="mt-1 text-center text-xs text-ink-3">{hint}</p>}

      {insufficient && (
        <InsufficientCreditOverlay
          required={insufficient.required}
          balance={insufficient.balance}
          onClose={() => setInsufficient(null)}
          onRetry={() => {
            setInsufficient(null)
            regenerate()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------- 출구 2 · 계산기

function CalculatorBanner({ jobId }: { jobId: string }) {
  const { data: link } = useCalculatorLink({ job_id: jobId })
  if (!link) return null

  // 문구 규칙(이름·추정 3케이스)은 W-07 화면과 공유합니다 — api/calculatorLink.ts.
  // 여기서 따로 쓰면 같은 추정을 두고 두 화면이 다른 말을 하게 됩니다.
  return (
    <a
      href={link.calculator_url}
      onClick={() =>
        void events.track({
          event_type: 'calculator_exit_click',
          properties: { job_id: jobId, breed_code: link.breed_code },
        })
      }
      className="mt-4 block rounded-xl border border-rule-strong bg-surface px-3 py-3"
    >
      <span className="block text-sm font-semibold">{calculatorHeadline(link)}</span>
      <span className="mt-0.5 block text-xs text-ink-2">{estimateSummary(link).text}</span>
      <span className="mt-2 block text-sm font-semibold underline">간식량 계산하기 →</span>
    </a>
  )
}

// ---------------------------------------------------------------- 노트7 · 다른 스타일

function OtherStyles({ jobId }: { jobId: string }) {
  const { data: popular } = useStyles({ section: 'popular', limit: 3 })
  const styleList = popular?.sections[0]?.styles.slice(0, 3) ?? []
  if (styleList.length === 0) return null

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">이 사진으로 다른 스타일</h2>
        {/*
          여기 3장은 인기 섹션의 앞부분일 뿐입니다. 그 밖을 고르려면 카탈로그로
          나가야 하는데 `from_job` 없이 보내면 맥락이 끊겨 **같은 사진을 다시
          올리게 됩니다** — W-02·W-03 이 이 파라미터를 그대로 나릅니다
          (app/reuseFromJob.ts).
        */}
        <Link
          to={`/styles?from_job=${jobId}`}
          className="shrink-0 text-xs text-ink-3 underline underline-offset-2"
        >
          전체 스타일 보기
        </Link>
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-3">
        {styleList.map((style) => (
          <li key={style.id}>
            {/* from_job 이 있으면 W-04 가 업로드 단계를 건너뜁니다. */}
            <Link
              to={`/upload?style_id=${style.id}&from_job=${jobId}`}
              className="block overflow-hidden rounded-lg border border-rule bg-surface"
            >
              <Thumbnail
                src={style.thumbnail_url}
                alt={style.name}
                loading="lazy"
                className="aspect-square w-full bg-canvas-2 object-cover"
              />
              <span className="block truncate px-2 py-1 text-xs">{style.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
