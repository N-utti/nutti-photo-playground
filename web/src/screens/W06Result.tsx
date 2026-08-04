/**
 * W-06 · 결과 (docs/wireframe-spec-v0.5.html#p06)
 *
 * 배치 순서가 이 화면의 전부입니다 — 와이어프레임 콜아웃: 출구(공유·계산기·쇼핑몰)를
 * 결과 이미지보다 **위**에 두면 광고로 읽혀 공유가 끊깁니다. 결과 → 공유 → 계산기 →
 * 쇼핑몰 → 다른 스타일 순서를 바꾸지 마세요(FR-W06-08).
 *
 * 반영한 노트:
 *   1. 비교 슬라이더 — 변환본만으로는 "우리 애가 맞나" 판단이 안 됩니다
 *   2. 4장 중 선택
 *   3. 공유가 주 버튼, 저장이 보조 (v0.2에서 뒤집힘)
 *   4. 누띠 서명은 **서버가 이미지에 합성**해 내려줍니다(§2) — 프론트가 그리지 않습니다
 *   6. 출구 셋을 감정 최고점에 모읍니다
 *   7. 업로드를 재사용하는 2회차 유도
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError, session } from '../api/client'
import { auth, events } from '../api/endpoints'
import { beginJobAttempt, clearJobAttempt } from '../api/idempotency'
import { readJobContext, rememberJobContext } from '../api/jobContext'
import {
  invalidateAfterJobSettled,
  useCalculatorLink,
  useCreateJob,
  useCredits,
  useJobPolling,
  useSelectResult,
  useShareJob,
  useStyleDetail,
  useStyles,
} from '../api/queries'
import { useGuestSessionReset } from '../app/guestSession'
import type { Job, JobErrorCode } from '../api/types'
import InsufficientCreditOverlay from './InsufficientCreditOverlay'
import JobUnavailable from './JobUnavailable'

/**
 * 쇼핑몰 행은 API 대상이 아니라 운영이 갱신하는 설정값입니다(§2 W-06).
 * 문구에 효능(관절·면역 등) 단정 표현을 넣지 마세요 — FR-W06-11 · NFR-LEGAL-01.
 */
const SHOP_BANNER = {
  url: 'https://nutti.co.kr',
  title: '누띠 수제간식 보러가기',
  note: '5만원 이상 무료배송',
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
  const { data: credits } = useCredits()

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

  if (error) {
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
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <Link to="/styles" aria-label="스타일 목록" className="text-ink-2">
          ←
        </Link>
        <h1 className="text-base font-bold">{job?.status === 'failed' ? '실패' : '완성'}</h1>
        <span className="ml-auto rounded-full border border-rule bg-surface-2 px-3 py-1 font-mono text-sm tabular-nums">
          ◆ {Math.max(0, credits?.balance ?? 0)}
        </span>
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
  const copy = FAILURE_COPY[job.error_code ?? 'GENERATION_FAILED']

  return (
    <>
      {/* "원본은 유지" — 다시 시도할 때 사진을 다시 올리게 하지 않습니다. */}
      <img
        src={job.source_image_url}
        alt="업로드한 사진"
        className="aspect-square w-full rounded-xl bg-surface-2 object-cover"
      />
      <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-3">
        <p className="text-sm font-semibold text-danger">{copy.title}</p>
        <p className="mt-0.5 text-sm text-ink-2">{copy.body}</p>
      </div>
      <p className="mt-2 text-center text-xs text-ink-3">크레딧은 자동으로 돌려드렸어요</p>
      <Regenerate jobId={job.job_id} label="다시 시도" />
    </>
  )
}

// ---------------------------------------------------------------- 성공

function ResultPanel({ job }: { job: Job }) {
  const results = job.results ?? []
  const selectResult = useSelectResult(job.job_id)
  const [selected, setSelected] = useState(job.selected_index ?? 0)

  const current = results[selected] ?? results[0]

  // 노트: 결과를 실제로 본 시점을 W-11 집계의 기준선으로 씁니다(04-erd metric_event).
  const viewLogged = useRef(false)
  useEffect(() => {
    if (viewLogged.current) return
    viewLogged.current = true
    void events.track({ event_type: 'result_view', properties: { job_id: job.job_id } })
  }, [job.job_id])

  function choose(index: number) {
    setSelected(index)
    selectResult.mutate(index)
  }

  return (
    <>
      {/* 노트1 — 원본 대조가 만족도의 근거. 노트4 — 서명은 이미지에 이미 합성돼 있습니다. */}
      {current && <CompareSlider beforeUrl={job.source_image_url} afterUrl={current.image_url} />}

      {/* 노트2 — 4장 중 고르게 하면 체감 성공률이 급등합니다. */}
      {results.length > 1 && (
        <>
          <ul className="mt-3 grid grid-cols-4 gap-2">
            {results.map((result) => (
              <li key={result.index}>
                <button
                  type="button"
                  onClick={() => choose(result.index)}
                  aria-pressed={selected === result.index}
                  aria-label={`${result.index + 1}번 결과`}
                  className={`block w-full overflow-hidden rounded-lg border-2 ${
                    selected === result.index ? 'border-ink' : 'border-transparent'
                  }`}
                >
                  <img
                    src={result.image_url}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full bg-surface-2 object-cover"
                  />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-center text-xs text-ink-3">
            {results.length}장 중 {selected + 1}번
          </p>
        </>
      )}

      {/* 출구 1 — 공유가 주 버튼(노트3). */}
      <ShareRow job={job} selectedIndex={selected} />

      <Regenerate jobId={job.job_id} label="다시 만들기" />

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
        className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface px-3 py-3"
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
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-surface-2">
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
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-surface peer-focus-visible:w-1 peer-focus-visible:bg-ink"
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

function ShareRow({ job, selectedIndex }: { job: Job; selectedIndex: number }) {
  const share = useShareJob(job.job_id)
  const [accountSheet, setAccountSheet] = useState(false)
  const isMember = session.kind === 'member'

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
              properties: { job_id: job.job_id, result_index: selectedIndex },
            })
            share.mutate()
          }}
          className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
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
        // 인스타그램은 웹에서 대신 게시할 수 없습니다 — 공유용 이미지를 내려받아
        // 사용자가 직접 올리는 게 현재로선 유일한 경로입니다.
        <div className="mt-3 rounded-lg border border-rule bg-surface p-3">
          <img
            src={share.data.share_image_url}
            alt="공유용 이미지"
            className="w-full rounded-lg bg-surface-2"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a
              href={share.data.share_image_url}
              download
              className="rounded-lg border border-rule-strong px-3 py-2 text-center text-sm font-semibold"
            >
              이미지 저장
            </a>
            <a
              href="https://www.instagram.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-ink px-3 py-2 text-center text-sm font-semibold text-paper"
            >
              인스타그램 열기
            </a>
          </div>
        </div>
      )}

      {share.error && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {share.error.message}
        </p>
      )}

      {accountSheet && <AccountLinkSheet onClose={() => setAccountSheet(false)} />}
    </>
  )
}

/** W-06 B · 계정 연동 바텀시트 (FR-W06-09/10). */
function AccountLinkSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-sheet-title"
        className="relative w-full rounded-t-2xl bg-surface p-5 desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id="account-sheet-title" className="text-base font-bold">
          누띠 계정으로 이어서
        </h2>
        <p className="mt-1 text-sm text-ink-2">보관함에 저장하고 크레딧을 받으세요.</p>

        {/* 노트5 — 카페24 쇼핑몰 계정이 곧 회원 DB. fetch 가 아니라 브라우저 이동입니다. */}
        <a
          href={auth.cafe24AuthorizeUrl()}
          className="mt-4 block rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-paper"
        >
          누띠 쇼핑몰 계정으로 로그인
        </a>

        {/*
          카카오는 아직 배선할 수 없습니다 — POST /v1/auth/kakao 는 `kakao_token` 을
          요구하는데, 그 토큰을 얻을 경로(JS SDK 키 또는 서버 authorize 리다이렉트)가
          스펙·환경변수 어디에도 없습니다. 백엔드 이슈로 올렸습니다.
        */}
        <button
          type="button"
          disabled
          className="mt-2 w-full rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold disabled:opacity-50"
        >
          카카오로 계속하기 (준비 중)
        </button>

        <p className="mt-3 text-center text-xs text-ink-3">
          연동하면 크레딧 3개 · 쇼핑몰 회원 자동 가입
        </p>
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3">
          닫기
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 다시 만들기 (FR-W06-04)

function Regenerate({ jobId, label }: { jobId: string; label: string }) {
  const navigate = useNavigate()
  const context = readJobContext(jobId)
  const { data: style } = useStyleDetail(context?.styleId ?? null)
  const createJob = useCreateJob()
  const [insufficient, setInsufficient] = useState<{ required: number; balance: number } | null>(
    null,
  )

  // 재료를 모르면 재생성 자체가 불가능합니다(api/jobContext.ts 주석 — 백엔드 이슈).
  if (!context) {
    return (
      <Link
        to="/styles"
        className="mt-2 block rounded-xl border border-rule px-4 py-3 text-center text-sm text-ink-2"
      >
        다른 사진으로 만들기
      </Link>
    )
  }

  const cost = style?.credit_cost ?? 1

  function regenerate() {
    if (!context) return
    const intent = {
      style_id: context.styleId,
      upload_id: context.uploadId,
      pet_id: null,
      custom_prompt: null,
    }
    // **새 의도 = 새 키**. 같은 키를 재사용하면 서버가 원래 job 을 그대로 돌려줘
    // 새 결과가 나오지 않습니다(§1 · api/idempotency.ts).
    const attempt = beginJobAttempt(intent)

    createJob.mutate(
      { body: intent, idempotencyKey: attempt.key },
      {
        onSuccess: ({ job_id }) => {
          clearJobAttempt()
          rememberJobContext(job_id, context)
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
        className="mt-2 w-full rounded-xl border border-rule px-4 py-3 text-sm font-semibold text-ink-2 disabled:opacity-50"
      >
        {createJob.isPending ? '보내는 중…' : `${label} · ${cost} 크레딧`}
      </button>

      {insufficient && (
        <InsufficientCreditOverlay
          required={insufficient.required}
          balance={insufficient.balance}
          onClose={() => setInsufficient(null)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------- 출구 2 · 계산기

function CalculatorBanner({ jobId }: { jobId: string }) {
  const { data: link } = useCalculatorLink({ job_id: jobId })
  if (!link) return null

  return (
    <a
      href={link.calculator_url}
      onClick={() =>
        void events.track({
          event_type: 'calculator_exit_click',
          properties: { job_id: jobId, breed_code: link.breed_code },
        })
      }
      className="mt-4 block rounded-xl border border-rule-strong bg-surface-2 px-3 py-3"
    >
      <span className="block text-sm font-semibold">우리 아이는 하루 몇 g까지 괜찮을까?</span>
      <span className="mt-0.5 block text-xs text-ink-2">
        {/* FR-EDGE-10 — 추정 실패면 틀린 견종을 프리필하느니 1단계부터 보냅니다. */}
        {link.breed_label
          ? `사진에서 ${link.breed_label}로 봤어요 · 2단계부터 시작`
          : '견종을 확인하지 못했어요 · 1단계부터 시작'}
      </span>
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
      <h2 className="text-sm font-semibold">이 사진으로 다른 스타일</h2>
      <ul className="mt-2 grid grid-cols-3 gap-3">
        {styleList.map((style) => (
          <li key={style.id}>
            {/* from_job 이 있으면 W-04 가 업로드 단계를 건너뜁니다. */}
            <Link
              to={`/upload?style_id=${style.id}&from_job=${jobId}`}
              className="block overflow-hidden rounded-lg border border-rule bg-surface"
            >
              <img
                src={style.thumbnail_url}
                alt={style.name}
                loading="lazy"
                className="aspect-square w-full bg-surface-2 object-cover"
              />
              <span className="block truncate px-2 py-1 text-xs">{style.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
