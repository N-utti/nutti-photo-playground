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
 *
 * 그 «지켜지는 범위» 가 하나 늘었습니다 — "나가서 둘러보기"로 나가도 **이 탭에 있는
 * 동안은** 화면 아래 상태 바가 따라갑니다(app/JobStatusBar.tsx). 여전히 알림은
 * 아닙니다: 창을 닫으면 같이 사라지고, 그 뒤는 주소의 몫 그대로입니다.
 */

import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { isFatalJobError, useJobPolling, useStyles } from '../api/queries'
import { rememberActiveJob } from '../app/activeJob'
import { useGuestSessionReset } from '../app/guestSession'
import { useJobProgress } from '../app/jobProgress'
import Thumbnail from '../app/Thumbnail'
import JobUnavailable from './JobUnavailable'

export default function W05Waiting() {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const guestReset = useGuestSessionReset()

  const { data: job, error, dataUpdatedAt } = useJobPolling(jobId ?? null)
  const { data: popular } = useStyles({ section: 'popular', limit: 3 })

  // 아래 `if (error)` 보다 위에 있어야 합니다 — 조기 반환 뒤에서 부르면 훅 순서가
  // 렌더마다 달라집니다.
  //
  // 진행률·남은 초·초과 판정(FR-EDGE-02)은 app/jobProgress.ts 가 계산합니다. 나가서
  // 둘러보는 동안 따라다니는 상태 바(app/JobStatusBar.tsx)가 같은 숫자를 말해야 해서
  // 꺼냈습니다 — 같은 job 을 두 곳이 다르게 설명하면 둘 중 하나가 고장 난 셈입니다.
  const { running, progress, remaining, overdue } = useJobProgress(jobId, job, dataUpdatedAt)

  // 이 job 을 이 탭이 «지켜보는 중»이라고 남깁니다. 아래 "나가서 둘러보기"로 나간
  // 뒤에도 화면 아래 한 줄로 따라가기 위한 유일한 단서입니다(app/activeJob.ts).
  // 끝난 job 은 남기지 않습니다 — 종료 상태면 곧바로 결과 화면이 주인이 됩니다.
  useEffect(() => {
    if (jobId && running) rememberActiveJob(jobId)
  }, [jobId, running])

  // 종료 상태면 결과 화면이 주인입니다. replace 인 이유: 뒤로가기로 이미 끝난
  // 대기 화면에 돌아오면 다시 결과로 튕겨 나가 되돌아갈 수가 없습니다.
  useEffect(() => {
    if (job && (job.status === 'succeeded' || job.status === 'failed')) {
      navigate(`/jobs/${job.job_id}`, { replace: true })
    }
  }, [job, navigate])

  // 회복 가능한 에러(5xx·네트워크 단절)인데 이미 받아 둔 진행 상황이 있으면 화면을
  // 헐지 않습니다. 폴링은 그 사이에도 상한 간격으로 계속 두드리는 중이라 곧 스스로
  // 따라잡고, 그 몇 초 때문에 «새로 만들기»밖에 없는 막다른 화면으로 보내면 아직
  // 살아 있는 작업을 사용자가 포기합니다 — 크레딧은 이미 나간 뒤입니다.
  // 대신 아무 말 없이 멈춘 것처럼 보이지 않게 연결 상태를 한 줄로 말합니다.
  const reconnecting = error != null && job != null && !isFatalJobError(error)

  if (error && !reconnecting) {
    const status = error instanceof ApiError ? error.status : 0
    return (
      <JobUnavailable
        reason={guestReset ? 'guest-reset' : status === 404 || status === 401 ? 'not-found' : 'error'}
        detail={status >= 500 ? error.message : undefined}
      />
    )
  }

  return (
    <div className="screen-min-h bg-paper pb-16">
      <header className="sticky top-0 desktop:top-14 z-20 flex items-center border-b border-rule bg-surface px-5 py-3">
        <h1 className="text-base font-bold">만드는 중</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-5 py-4">
        {/* 원본은 흐리게 — 결과를 미리 본 것 같은 착각을 주지 않으면서 맥락은 남깁니다. */}
        {job?.source_image_url && (
          <img
            src={job.source_image_url}
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
          {/* 노트1 — 남은 초를 숫자로. 0 에 닿았는데 아직 안 끝났으면 숫자 대신 말로
              바꿉니다 — "약 0초"가 계속 떠 있으면 그게 곧 멈춘 화면입니다.
              90초를 넘긴 뒤(overdue)에는 그 "거의 다 됐어요"마저 접습니다. 1분 반을
              넘겨 놓고 계속 «거의»라고 말하면 그건 위로가 아니라 거짓말이고, 아래
              안내가 같은 자리에서 사실대로 말합니다. 서버가 여전히 유효한 숫자를
              주는 동안은(remaining > 0) 초과 상태에서도 그대로 보여 줍니다 — 얼마나
              더 걸리는지가 곧 «나갈까 기다릴까»의 판단 재료입니다. */}
          {remaining != null && !(overdue && remaining === 0) && (
            <span
              className={`shrink-0 text-sm text-ink-3 ${
                remaining > 0 ? 'font-mono tabular-nums' : ''
              }`}
            >
              {remaining > 0 ? `약 ${remaining}초` : '거의 다 됐어요'}
            </span>
          )}
        </div>

        {/* 서버가 잠깐 답을 못 주는 중입니다. 폴링이 계속 돌고 있어 사용자가 할 일은
            없지만, 진행률과 숫자가 아무 설명 없이 얼어 있으면 그게 곧 고장 신호로
            읽힙니다 — 노트1 이 스피너를 뺀 이유와 같습니다. */}
        {reconnecting && (
          <p className="mt-1 text-xs text-ink-3">
            연결이 잠시 불안정해요. 작업은 계속되는 중이고, 연결되면 바로 이어서 보여 드릴게요.
          </p>
        )}

        {/* FR-EDGE-02 · 백그라운드 전환.
            «실패»가 아니라 «정상이지만 오래 걸리는 중»입니다 — 크레딧도 정상 차감이라
            되돌릴 것이 없고, 사용자가 할 수 있는 유일한 일이 «기다리거나 나가거나»
            둘뿐입니다. 그래서 경고색을 쓰지 않고, 대신 사라진 남은 초 자리를 이
            안내가 대신 채웁니다. 알림은 여전히 약속하지 않습니다(FR-W05-04). */}
        {overdue && (
          <div className="mt-3 rounded-xl border border-rule-strong bg-surface px-3 py-3">
            <p className="text-sm font-semibold">예상보다 오래 걸리고 있어요</p>
            <p className="mt-0.5 text-sm text-ink-2">
              작업은 계속 진행 중이에요. 나가서 둘러봐도 화면 아래에 진행 상황이 따라가고,
              창을 닫았다면 이 브라우저에서 이 주소로 다시 오면 결과를 볼 수 있어요.
            </p>
          </div>
        )}

        {/* 노트3 — 이탈은 막지 않습니다. 다만 알림은 없으므로 약속하지 않습니다.
            90초를 넘긴 뒤에는 이게 주 버튼입니다 — 그 시점에 우리가 정직하게 권할 수
            있는 건 «기다려 주세요»가 아니라 «나가도 됩니다» 쪽입니다. */}
        <Link
          to="/styles"
          className={`mt-5 block rounded-xl px-4 py-3 text-center text-sm font-semibold motion-safe:active:scale-[0.99] ${
            overdue
              ? 'bg-brand text-paper hover:bg-brand-deep'
              : 'border border-rule-strong bg-surface hover:border-brand-2 hover:bg-surface-2 hover:text-brand'
          }`}
        >
          나가서 둘러보기
        </Link>
        {/* 이제 «나가면 안 보인다»가 아닙니다 — 둘러보는 동안 화면 아래에 진행 상황이
            남고 완성되면 그 자리에서 열립니다. 다만 그건 이 탭 안에서만이라, 창을 닫은
            뒤의 약속(주소)은 그대로 함께 말합니다. */}
        {!overdue && (
          <p className="mt-2 text-center text-xs text-ink-3">
            나가도 작업은 계속돼요. 둘러보는 동안 화면 아래에 진행 상황이 따라가고, 창을
            닫았다면 이 브라우저에서 이 주소로 다시 오면 됩니다.
          </p>
        )}

        {/* 노트4 — 결과를 보기 전이라 광고 밀도는 W-06 보다 낮게. 카드 3장까지만. */}
        {popular && popular.sections[0]?.styles.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-bold">기다리는 동안</h2>
            <ul className="mt-2 grid grid-cols-3 gap-3">
              {popular.sections[0].styles.slice(0, 3).map((style) => (
                <li key={style.id}>
                  <Link
                    to={`/styles/${style.id}`}
                    className="block overflow-hidden rounded-xl border border-rule bg-surface hover:border-brand-2"
                  >
                    <Thumbnail
                      src={style.thumbnail_url}
                      alt={style.name}
                      loading="lazy"
                      className="aspect-square w-full bg-surface-2 object-cover"
                    />
                    <span className="block truncate px-2 py-1 text-sm">{style.name}</span>
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
