/**
 * W-05 · 생성 대기 (docs/wireframe-spec-v0.5.html#p05)
 *
 * 반영한 노트:
 *   1. 남은 초를 숫자로 — 무한 스피너는 체감 시간을 배로 늘립니다
 *   2. 진행 문구는 서버가 스타일별로 내려줍니다(`status_message`)
 *   3. 이탈 허용 — 창을 닫아도 서버는 계속 처리
 *
 * 문구에서 **의도적으로 뺀 것**: 와이어프레임의 "알림 받고 나가기 / 완성되면
 * 알려드릴게요". 완료 알림은 MVP 제외(FR-W05-04)라 지킬 수 없는 약속이고, 이슈 #5 가
 * 정확히 이 과약속을 지적했습니다. PO 결정(B+A)에 따라 알림 대신 **같은 브라우저에서
 * 30일 안에 다시 오면 결과가 남아 있다**는, 실제로 지켜지는 범위만 말합니다.
 */

import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { readJobContext } from '../api/jobContext'
import { useJobPolling, useStyles } from '../api/queries'
import { useGuestSessionReset } from '../app/guestSession'
import JobUnavailable from './JobUnavailable'

export default function W05Waiting() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const guestReset = useGuestSessionReset()

  const { data: job, error } = useJobPolling(jobId ?? null)
  const { data: popular } = useStyles({ section: 'popular', limit: 3 })

  // 종료 상태면 결과 화면이 주인입니다. replace 인 이유: 뒤로가기로 이미 끝난
  // 대기 화면에 돌아오면 다시 결과로 튕겨 나가 되돌아갈 수가 없습니다.
  useEffect(() => {
    if (job && (job.status === 'succeeded' || job.status === 'failed')) {
      navigate(`/jobs/${job.job_id}`, { replace: true })
    }
  }, [job, navigate])

  if (error) {
    const status = error instanceof ApiError ? error.status : 0
    return (
      <JobUnavailable
        reason={guestReset ? 'guest-reset' : status === 404 || status === 401 ? 'not-found' : 'error'}
        detail={status >= 500 ? error.message : undefined}
      />
    )
  }

  const context = jobId ? readJobContext(jobId) : null
  const progress = job?.progress ?? 0

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center border-b border-rule bg-surface px-4 py-3">
        <h1 className="text-base font-bold">만드는 중</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {/* 원본은 흐리게 — 결과를 미리 본 것 같은 착각을 주지 않으면서 맥락은 남깁니다. */}
        {(job?.source_image_url ?? context?.sourceImageUrl) && (
          <img
            src={job?.source_image_url ?? context?.sourceImageUrl ?? ''}
            alt=""
            className="aspect-square w-full rounded-xl bg-surface-2 object-cover blur-sm"
          />
        )}

        <div
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="생성 진행률"
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-rule"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2">
          {/* 노트2 — "생성 중"이 아니라 "레고 블록을 쌓는 중". 문구는 운영이 W-11 에서 관리합니다. */}
          <span className="truncate text-sm font-semibold">
            {job?.status_message ?? '준비하는 중…'}
          </span>
          {/* 노트1 — 남은 초를 숫자로. */}
          <span className="shrink-0 font-mono text-sm tabular-nums text-ink-3">
            {job?.eta_seconds != null ? `약 ${job.eta_seconds}초` : ''}
          </span>
        </div>

        {/* 노트3 — 이탈은 막지 않습니다. 다만 알림은 없으므로 약속하지 않습니다. */}
        <Link
          to="/styles"
          className="mt-5 block rounded-xl border border-rule-strong bg-surface px-4 py-3 text-center text-sm font-semibold"
        >
          나가서 둘러보기
        </Link>
        <p className="mt-2 text-center text-xs text-ink-3">
          나가도 작업은 계속됩니다. 이 브라우저에서 이 주소로 다시 오면 결과를 볼 수 있어요.
        </p>

        {/* 노트4 — 결과를 보기 전이라 광고 밀도는 W-06 보다 낮게. 카드 3장까지만. */}
        {popular && popular.sections[0]?.styles.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold">기다리는 동안</h2>
            <ul className="mt-2 grid grid-cols-3 gap-3">
              {popular.sections[0].styles.slice(0, 3).map((style) => (
                <li key={style.id}>
                  <Link
                    to={`/styles/${style.id}`}
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
        )}
      </main>
    </div>
  )
}
