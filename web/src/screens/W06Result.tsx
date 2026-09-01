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

import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, isApiError } from '../api/client'
import { calculatorHeadline, estimateSummary } from '../api/calculatorLink'
import { track } from '../app/analytics'
import { beginJobAttempt, clearJobAttempt, resumeJobAttempt } from '../api/idempotency'
import { forgetActiveJob } from '../app/activeJob'
import BackButton from '../app/BackButton'
import { CreditBadge } from '../app/CreditBadge'
import { wasDeletedHere } from '../app/deletedResults'
import { shopLink } from '../app/externalLinks'
import {
  invalidateAfterJobSettled,
  isFatalJobError,
  queryKeys,
  useCalculatorLink,
  useCreateJob,
  useJobPolling,
  useMe,
  usePets,
  useShareJob,
  useStyleDetail,
  useStyles,
} from '../api/queries'
import { useGuestSessionReset } from '../app/guestSession'
import { contextFromJob, withReuse } from '../app/reuseFromJob'
import { saveImage, type SaveImageOutcome } from '../app/saveImage'
import { canShareImage, shareImage, type ShareImageOutcome } from '../app/shareImage'
import { StyleInputForm } from '../app/StyleInputForm'
import {
  effectiveInputValue,
  initialInputValues,
  inputErrors,
  inputsForRequest,
  restoredInputValues,
} from '../app/styleInputs'
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
  url: shopLink('w06_result'),
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

  // 결과가 눈앞에 있으면 따라다니던 상태 바는 할 일이 끝났습니다(app/activeJob.ts).
  // 안 놓아 주면 여기서 나가는 순간 «완성됐어요, 보러 가기»가 다시 떠서, 방금 본
  // 결과를 보러 가라고 권합니다. 아직 만드는 중이면 놓지 않습니다 — 이 화면은 그
  // 경우 대기 화면으로 되돌리는 중이고, 거기서 다시 기억하게 하는 건 낭비입니다.
  useEffect(() => {
    if (settled && jobId) forgetActiveJob(jobId)
  }, [settled, jobId])

  // W-05 와 같은 판정입니다(같은 훅을 쓰므로 여기서 달라지면 두 화면이 같은 에러를
  // 다르게 말합니다). 이미 그려 둔 결과가 있는데 5xx 한 번에 화면을 헐면, 손에 쥔
  // 결과물을 «찾을 수 없다»로 덮는 셈입니다.
  if (error && (job == null || isFatalJobError(error))) {
    const status = error instanceof ApiError ? error.status : 0
    /*
      404 의 이유를 서버는 말해 주지 않습니다. 이 브라우저가 보관함에서 지운 결과라면
      그 이유를 아는 건 우리뿐이라(app/deletedResults.ts), 세션·주소 탓으로 설명하기
      전에 먼저 봅니다. 게스트 리셋보다 앞에 두는 이유: 리셋은 «열 수 없다» 의 흔한
      원인이지만 삭제는 **이 job 에 대해 확인된 사실**이라 더 구체적입니다.
    */
    const deletedHere = status === 404 && wasDeletedHere(jobId)
    return (
      <JobUnavailable
        reason={
          deletedHere
            ? 'deleted'
            : guestReset
              ? 'guest-reset'
              : status === 404 || status === 401
                ? 'not-found'
                : 'error'
        }
        detail={status >= 500 ? error.message : undefined}
      />
    )
  }

  return (
    <div className="min-h-full bg-canvas pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        {/* 대기 화면(W-05)은 끝나는 순간 `replace` 로 여기 자리를 넘겼으므로,
            한 칸 뒤는 만들기를 시작한 화면입니다 — 끝난 진행 막대로 되돌아가지 않습니다. */}
        <BackButton fallback="/styles" />
        {/* 결과가 지워진 job 을 «완성» 이라고 부르면 제목이 본문과 다른 말을 합니다. */}
        <h1 className="text-base font-bold">
          {job?.status === 'failed' ? '실패' : resultRemoved(job) ? '지운 사진' : '완성'}
        </h1>
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

/**
 * 만들기는 성공했는데 **결과가 없는** job — 보관함에서 지운 사진입니다 (이슈 #152).
 *
 * 서버가 `deleted_at` 인 결과를 `results[]` 에서 빼면서 생기는 상태입니다(백엔드
 * PR #157). job 자체는 200 · succeeded 로 그대로 오고 `results` 만 빕니다 —
 * **404 가 아닙니다.** 이슈 #152 에서 프론트는 404 를 요청했지만(이미 «열 수 없는
 * 결과» 화면이 있으니까) 백엔드가 갈라서 정했습니다: 조회는 빈 `results` 로 200,
 * `POST /jobs/{id}/share` 만 404. 그 결정이 이슈 코멘트에 적혀 있습니다.
 *
 * 그래서 이 판정이 필요합니다. 없으면 화면이 «완성» 이라고 말하면서 빈 자리에
 * 저장·공유 버튼을 띄웁니다 — 지운 사진을 공유하라고 권하는 셈이고, 눌러 봐야
 * share 가 404 라 아무 일도 안 일어납니다.
 *
 * `results` 는 `[] | null` 둘 다 올 수 있어(§3 — 진행 중인 job 은 null) 그릴 게
 * 없다는 사실 하나로 판정합니다. 진행 중인 job 은 여기 오기 전에 대기 화면으로
 * 돌려보내지므로(위 `useEffect`) succeeded 조건만으로 충분합니다.
 */
function resultRemoved(job: Job | undefined): boolean {
  return job?.status === 'succeeded' && !job.results?.[0]
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
  //
  // 지워진 결과는 세지 않습니다 — 볼 그림이 없는데 «결과를 봤다» 로 집계하면, 이
  // 지표를 쓰는 쪽(만족도·재생성률의 분모)이 조용히 부풀어 오릅니다.
  const viewLogged = useRef(false)
  useEffect(() => {
    if (viewLogged.current || current === null) return
    viewLogged.current = true
    track({ event_type: 'result_view', properties: { job_id: job.job_id } })
  }, [job.job_id, current])

  if (current === null) return <RemovedResultPanel job={job} />

  return (
    <>
      {/* 노트1 — 원본 대조가 만족도의 근거. 노트4 — 서명은 이미지에 이미 합성돼 있습니다. */}
      <CompareSlider
        jobId={job.job_id}
        beforeUrl={job.source_image_url}
        afterUrl={current.image_url}
      />

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
          track({
            event_type: 'shop_exit_click',
            properties: { job_id: job.job_id },
          })
        }
        className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-brand-2 bg-brand-soft px-3 py-3 hover:border-brand hover:bg-gold-soft"
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
 * 지워진 결과의 자리 (이슈 #152 · 위 `resultRemoved` 주석이 판정 근거).
 *
 * **원본 사진은 남습니다.** 지운 건 결과물이고 업로드는 그대로라, 여기서 사진까지
 * 치우면 «돈만 나가고 사진도 잃었다» 가 됩니다 — 실패 패널·`ResultUnavailable` 이
 * 같은 이유로 원본을 남깁니다. 다만 여기는 사고가 아니라 **사용자가 시킨 일**이라
 * 톤이 다릅니다: 경고(warn)도 오류(danger)도 아니고 사실만 적습니다.
 *
 * `JobUnavailable` 의 `deleted` 로 보내지 않는 이유는 **재료가 손에 있기** 때문입니다.
 * 그 화면은 job 을 아예 못 읽는 404 용이라 줄 수 있는 게 «새로 만들기»(카탈로그)
 * 하나뿐인데, 여기서는 200 으로 `style_id`·`upload_id`·`inputs`·`custom_prompt`·
 * `credit_cost` 가 전부 옵니다. 즉 **같은 설정으로 다시 만들 수 있습니다** —
 * 지운 사진을 다시 보고 싶은 사람에게 그게 정확히 필요한 것이고, 카탈로그로
 * 내보내면 같은 사진을 다시 올리게 됩니다.
 *
 * 출구 셋(공유·계산기·쇼핑몰)은 **전부 뺍니다.** 그 배치는 «감정 최고점에 모은다» 는
 * 근거 위에 서 있는데(FR-W06-08 · 노트6) 지금은 최고점이 아닙니다. 지운 사진을
 * 열었더니 «간식량 계산하기»·«수제간식 보러가기» 가 뜨면, 와이어프레임 콜아웃이
 * 경고한 바로 그 모양 — 출구가 광고로 읽히는 화면이 됩니다.
 */
function RemovedResultPanel({ job }: { job: Job }) {
  return (
    <>
      <img
        src={job.source_image_url}
        alt="업로드한 사진"
        className="aspect-square w-full rounded-xl bg-canvas-2 object-cover"
      />
      <div className="mt-3 rounded-lg border border-rule bg-surface-2 px-3 py-3">
        <p className="text-sm font-semibold">보관함에서 지운 사진이에요</p>
        <p className="mt-0.5 text-sm text-ink-2">
          지운 결과는 되돌릴 수 없어요. 사진은 그대로 있으니 다시 만들 수 있어요.
        </p>
      </div>
      <Regenerate job={job} label="다시 만들기" />
    </>
  )
}

/**
 * 비교 슬라이더. range 입력을 투명하게 덮어 두면 드래그·클릭·키보드(화살표)가
 * 전부 공짜로 따라옵니다 — 포인터 이벤트를 직접 구현하면 키보드 접근성이 사라집니다.
 *
 * ---------------------------------------------------------------------------
 * 프레임 비율은 **결과 이미지가 정합니다** (백엔드 #110 착지분)
 *
 * 여기는 크레딧을 쓰고 받은 그 한 장을 통째로 보여 주는 유일한 자리입니다
 * (보관함 격자는 일부러 정사각 타일이고, 거기서 열면 다시 이 화면으로 옵니다).
 * 그런데 프레임이 `aspect-square` 로 고정돼 있었고, 그건 «결과는 늘 정사각» 이라는
 * 사실 위에 서 있었습니다 — #110 이전의 유일한 실생성 경로가
 * `openai.images.edit(size="1024x1024")` 였으니 맞는 말이었습니다.
 *
 * #110 이 그 앞에 fal 큐 경로를 붙이면서(`FAL_KEY` 가 있으면 이쪽이 우선) 크기가
 * `image_size: "auto"` — 모델이 정하는 값이 됐고, 프롬프트 원문이 캔버스를 직접
 * 요구합니다: 3D_피규어 "vertical 3:4", 이모티콘 "square canvas (1:1)".
 * 그대로 두면 세로 결과의 위아래가 `object-cover` 로 잘리는데, 하필 3D_피규어가
 * 이름을 인쇄하는 자리가 패키지 **아래쪽 줄**("A HAPPY DAY WITH …")입니다.
 * W-02·W-03 이 `uses_pet_name` 으로 «이름이 박혀요» 라고 예고해 놓고(백엔드 #111)
 * 정작 박힌 이름을 잘라서 보여 주게 됩니다.
 *
 * 그래서 결과 이미지를 흐름 안에 두고 **자기 비율대로 높이를 만들게** 합니다.
 * `GenerationResult` 에 width·height 가 없고 §3 job 응답도 크기를 안 주므로,
 * 비율을 미리 알아 프레임에 박아 둘 방법은 없습니다 — 자리를 먼저 정사각으로
 * 잡아 두면 도착한 뒤에 모양이 바뀌는, 화면이 먼저 단정하고 나중에 정정하는
 * 그 패턴이 됩니다. 대신 이미지가 도착하기 전까지 이 자리는 높이가 0 이라
 * 아래 버튼들이 한 번 밀립니다. 잘린 결과보다 나은 쪽을 골랐습니다.
 *
 * 원본은 계속 잘립니다(`object-cover`) — 사용자 카메라 비율은 결과와 다르고,
 * 두 장을 같은 틀에 겹쳐야 «같은 자리 비교» 라는 이 위젯의 존재 이유가 성립합니다.
 * 잘려도 되는 쪽은 이미 손에 있는 원본이지 방금 만든 결과가 아닙니다.
 *
 * ---------------------------------------------------------------------------
 * 결과를 **못 받아 왔을 때**는 이 구조가 화면을 통째로 지웁니다
 *
 * 프레임 높이를 결과 이미지가 만들게 된 대가입니다: 그 한 장이 안 오면 높이가
 * 사실상 0 이 되고, 겹쳐 놓은 원본(`absolute inset-0`)까지 같이 사라집니다.
 * 정사각 프레임 시절에는 결과가 깨져도 최소한 원본은 보였습니다 — 즉 이건
 * 위 결정이 끌고 들어온 **새 회귀**라 여기서 같이 닫습니다.
 *
 * 그래서 결과 이미지가 `error` 를 내면 슬라이더를 접고 원본 + 안내로 바꿉니다.
 * job 은 succeeded 라 «만들기 실패» 가 아니고 크레딧도 정당하게 나간 상태라,
 * 실패 패널의 붉은 톤(danger)이 아니라 경고 톤(warn)을 씁니다.
 */
function CompareSlider({
  jobId,
  beforeUrl,
  afterUrl,
}: {
  jobId: string
  beforeUrl: string
  afterUrl: string
}) {
  const [position, setPosition] = useState(50)
  const client = useQueryClient()

  /*
    실패를 불리언이 아니라 **실패한 주소**로 들고 있습니다. 플래그로 두면 아래
    재시도가 새 주소를 물어 왔을 때도 «실패» 가 남아 새 이미지를 안 그립니다.
    효과로 지우는 방법도 있지만 그건 한 렌더 늦게 지워집니다 — 그 한 렌더 동안
    멀쩡한 결과 위에 «불러오지 못했어요» 가 떠 있습니다.
  */
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  /*
    재시도는 `key` 를 갈아 <img> 를 새로 만드는 것으로 합니다 — 흔히 쓰는 `?t=`
    캐시 버스터는 여기서 못 씁니다. 결과 주소는 서명될 수 있고(쿼리스트링이 서명
    대상), 파라미터를 하나 붙이는 순간 403 이 됩니다. 실패한 응답은 캐시에 남지
    않으므로 요소를 새로 만드는 것만으로 실제 요청이 다시 나갑니다.
  */
  const [attempt, setAttempt] = useState(0)

  function retry() {
    setFailedUrl(null)
    setAttempt((count) => count + 1)
    /*
      주소가 만료된 경우는 같은 주소를 다시 받아 봐야 또 실패합니다 — job 을 다시
      물어 새 `image_url` 을 받아 옵니다. succeeded job 은 폴링이 멈춰 있어서
      (queries.ts `useJobPolling`) 이걸 안 하면 주소가 영영 안 바뀝니다.
    */
    void client.invalidateQueries({ queryKey: queryKeys.job(jobId) })
  }

  if (failedUrl === afterUrl) {
    return <ResultUnavailable sourceUrl={beforeUrl} onRetry={retry} />
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-canvas-2">
      {/* 흐름 안의 유일한 요소 — 이 한 장이 프레임의 높이입니다(위 주석). */}
      <img
        key={attempt}
        src={afterUrl}
        alt="변환 결과"
        onError={() => setFailedUrl(afterUrl)}
        className="block w-full"
      />
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

/**
 * 결과 이미지를 받아 오지 못했을 때 그 자리에 남는 것.
 *
 * 여기서 사실인 것은 둘뿐입니다: **만들기는 끝났고**(job 이 succeeded), **지금 그
 * 이미지를 못 가져온다**. 왜 못 가져오는지는 화면이 모릅니다 — 연결이 끊겼는지,
 * 주소가 만료됐는지, 파일이 사라졌는지 `error` 이벤트는 구분해 주지 않습니다.
 * 그러니 «잠깐 문제예요» 도 «결과는 안전해요» 도 단정하지 않습니다. 둘 다
 * 틀릴 수 있고, 틀리면 사용자는 다시 만들기(크레딧)를 안 눌러 본 채 떠납니다.
 *
 * 원본을 그대로 남기는 건 실패 패널과 같은 이유입니다 — 이 화면에서 사진이 전부
 * 사라지면 «돈만 나가고 사진도 잃었다» 로 읽힙니다. 여기는 정사각으로 잘라도
 * 됩니다. 자르면 안 되는 쪽(이름이 인쇄된 결과)이 지금 없는 상황이라, 위 슬라이더가
 * 프레임을 결과에 맞추던 이유 자체가 성립하지 않습니다.
 */
function ResultUnavailable({ sourceUrl, onRetry }: { sourceUrl: string; onRetry: () => void }) {
  return (
    <div>
      <img
        src={sourceUrl}
        alt="업로드한 사진"
        className="aspect-square w-full rounded-xl bg-canvas-2 object-cover"
      />
      <div role="status" className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-3">
        <p className="text-sm font-semibold text-warn">결과 이미지를 불러오지 못했어요</p>
        <p className="mt-0.5 text-sm text-ink-2">
          만들기는 끝났어요 — 아래 버튼으로 다시 불러와 보세요.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-lg border border-rule-strong bg-surface px-3 py-2 text-xs font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
        >
          다시 불러오기
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 출구 1 · 공유/저장

/**
 * 버튼 두 개가 **각각 끝까지 갑니다** — 눌러서 다른 섹션을 여는 버튼이 아닙니다.
 *
 * 예전에는 「인스타 공유」가 아래에 패널을 펼치고, 진짜 동작(저장·공유 시트)은 그
 * 안에 한 번 더 있었습니다. 즉 같은 이름의 일을 두 번 눌러야 했고, 첫 클릭의 결과는
 * «화면이 길어졌다» 뿐이었습니다. 결과 화면에서 가장 짧아야 할 두 동선인데 중간에
 * 계단이 하나씩 끼어 있던 셈입니다. 지금은 상단 두 버튼이 곧바로 파일을 저장하고
 * 곧바로 공유 시트를 엽니다.
 *
 * 미리보기를 함께 걷어낸 이유: 그 그림은 **위 슬라이더와 같은 파일**이었습니다
 * (PR #73 — 서버는 공유용 사본을 만들지 않고 결과 `public_url` 을 그대로 돌려줍니다,
 * api/types.ts ShareResult). 같은 사진을 한 화면에 두 번 그리면서 출구 셋(계산기·
 * 쇼핑몰·다른 스타일)을 한 화면 아래로 밀어내고 있었습니다(FR-W06-08 · 노트6).
 * 대신 잃는 것이 있습니다 — 슬라이더는 결과를 늘 반쪽만 보여 주므로, 올릴 그림
 * **전체**를 보려면 이제 슬라이더를 끝까지 밀어야 합니다.
 *
 * `POST /jobs/{id}/share` 는 계속 부릅니다. 지금은 응답이 결과 URL 과 같지만, 인스타
 * 전용 리사이즈·합성이 생기면 값이 갈라질 자리가 거기입니다(types.ts ShareResult) —
 * `results[0].image_url` 을 질러 쓰면 그날 조용히 다른 파일을 저장하게 됩니다.
 * 그래서 **누른 뒤에** 부르고(한 번 받아 두면 두 버튼이 같이 씁니다), 그동안 버튼은
 * 자기 자리에서 «저장 중…»·«공유 시트 여는 중…» 으로 기다립니다.
 */
function ShareRow({ job }: { job: Job }) {
  const share = useShareJob(job.job_id)
  const [accountSheet, setAccountSheet] = useState(false)
  const [saving, setSaving] = useState(false)
  // 'opened' 는 저장이 아니라 이미지가 새 탭에서 열렸다는 뜻입니다 — 그때만 안내합니다.
  const [saveOutcome, setSaveOutcome] = useState<SaveImageOutcome | null>(null)
  /*
    «인스타에 올리기» 의 실체 — Web Share API 로 이미지 **파일**을 OS 공유 시트에 넘기면
    인스타그램(게시물/스토리/DM)이 바로 뜹니다. 저장 → 인스타 앱 → 갤러리 왕복을 없애는
    유일한 웹 경로입니다(app/shareImage.ts). 파일 공유가 안 되는 브라우저(데스크톱 대부분)
    에서는 눌러도 `unsupported` 로 끝나므로 그 자리를 인스타그램 링크로 바꿉니다 —
    «올리기» 라고 써 두고 아무 일도 안 일어나는 버튼을 두지 않습니다.
  */
  const [sharing, setSharing] = useState(false)
  const [shareOutcome, setShareOutcome] = useState<ShareImageOutcome | null>(null)
  const shareSheetAvailable = canShareImage()
  // 서버가 보는 상태를 씁니다 — 시트에서 로그인하면 캐시가 무효화되면서 이 줄이
  // 곧바로 회원으로 바뀝니다. localStorage 의 kind 는 값이 바뀌어도 리렌더가 없습니다.
  const { data: me } = useMe()
  const isMember = me?.kind === 'member'
  const filename = `nutti-${job.job_id}.jpg`

  /**
   * 올릴 파일의 주소. 이미 받아 뒀으면 다시 부르지 않습니다 — 저장하고 이어서 올리는
   * 흐름이 흔한데 그때마다 왕복을 더하면 공유 시트가 그만큼 늦게 뜹니다.
   *
   * 실패는 `null` 로만 알립니다. 사유는 아래 `share.error` 가 이미 화면에 적고 있고,
   * 여기서 다시 던지면 처리되지 않은 rejection 이 됩니다.
   */
  async function resolveShareUrl(): Promise<string | null> {
    if (share.data) return share.data.share_image_url
    try {
      return (await share.mutateAsync()).share_image_url
    } catch {
      return null
    }
  }

  /*
    저장은 앵커에 URL 을 그대로 물리지 않고 `saveImage` 를 지납니다. `download` 속성이
    같은 오리진에서만 먹어서, CDN 이 붙는 순간(app/storage.py `public_url`) «이미지 저장»
    이 이미지로 이동이 되기 때문입니다 — 이슈 #77, 그리고 그 조건을 배포 문서에 박은
    PR #78. CORS 가 아직 안 열려 fetch 가 실패하면 예전 동작(새 탭)으로 물러나고,
    그때만 길게 눌러 저장하라고 안내합니다.
  */
  async function handleSaveImage() {
    setSaving(true)
    setSaveOutcome(null)
    try {
      const url = await resolveShareUrl()
      if (url === null) return
      setSaveOutcome(await saveImage(url, filename))
    } finally {
      setSaving(false)
    }
  }

  async function handlePostToInstagram() {
    // FR-W06-12 의 share_click 은 **공유 의도**를 셉니다 — 저장은 여기 안 셉니다.
    track({ event_type: 'share_click', properties: { job_id: job.job_id } })
    setSharing(true)
    setShareOutcome(null)
    try {
      const url = await resolveShareUrl()
      if (url === null) return
      const outcome = await shareImage(
        url,
        filename,
        '누띠 사진 놀이터에서 만든 우리 아이 사진 🐾 @nutti_official',
      )
      setShareOutcome(outcome)
      track({ event_type: 'share_sheet', properties: { job_id: job.job_id, outcome } })
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSaveImage()}
          className="rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
        >
          {saving ? '저장 중…' : '이미지 저장'}
        </button>
        {/* 공유가 주 버튼(노트3) — 위계는 그대로 두고 하는 일만 앞당겼습니다. */}
        {shareSheetAvailable ? (
          <button
            type="button"
            disabled={sharing}
            onClick={() => void handlePostToInstagram()}
            className="rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
          >
            {sharing ? '공유 시트 여는 중…' : '인스타에 올리기'}
          </button>
        ) : (
          <a
            href="https://www.instagram.com/"
            target="_blank"
            rel="noreferrer"
            onClick={() => track({ event_type: 'share_click', properties: { job_id: job.job_id } })}
            className="rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
          >
            인스타그램 열기
          </a>
        )}
      </div>

      {/*
        저장이 끝난 뒤에만 다음 걸음을 답니다. 파일 공유가 안 되는 브라우저에서는
        저장 → 인스타그램이 유일한 경로라 그 말을 여기서 합니다 — 늘 띄워 두면
        아직 아무것도 안 한 사람에게 하는 잔소리가 됩니다.
      */}
      {saveOutcome === 'saved' && (
        <p className="mt-2 text-center text-xs text-ink-3">
          {shareSheetAvailable
            ? '이미지를 저장했어요'
            : '이미지를 저장했어요 — 인스타그램에서 올려 주세요'}
        </p>
      )}
      {saveOutcome === 'opened' && (
        <p className="mt-2 text-center text-xs text-ink-3">
          새 탭에 이미지를 열었어요 — 이미지를 길게 눌러 저장해 주세요.
        </p>
      )}
      {/*
        서버가 «못 준다» 고 답한 경우입니다(만료된 서명 · 지워진 파일). 새 탭을 열어도
        같은 오류 페이지라, 예전처럼 «길게 눌러 저장하세요» 라고 하면 사용자는 오류
        페이지를 누르고 있게 됩니다.
      */}
      {saveOutcome === 'failed' && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
      {shareOutcome === 'failed' && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          공유 시트를 열지 못했어요 — 「이미지 저장」으로 저장한 뒤 올려 주세요.
        </p>
      )}

      {share.error && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {share.error.message}
        </p>
      )}

      {/*
        §2 — 회원은 결과가 자동으로 보관함에 남습니다. 게스트는 남길 곳이 없어 계정
        연동을 권하는 자리가 필요한데(W-06 B · FR-W06-09), 그 자리가 예전에는 「저장」
        버튼이었습니다. 그 버튼이 파일 저장으로 바뀐 이상 거기서 로그인 시트를 띄우면
        «이미지 저장» 을 눌렀는데 로그인을 요구하는 화면이 됩니다 — 그래서 안내 줄로
        옮깁니다. 회원에게 보관함 링크를 주던 그 자리입니다.

        `me` 가 오기 전에는 **아무 줄도 안 답니다.** 기본값을 게스트로 잡아 두면 회원이
        결과를 열 때마다 «로그인하면 남아요» 가 한 번 깜빡이고 «저장돼 있어요» 로
        정정됩니다 — 화면이 먼저 거짓말하고 나중에 고치는 그 패턴입니다.
      */}
      {me == null ? null : isMember ? (
        <p className="mt-2 text-center text-xs text-ink-3">
          보관함에 저장돼 있어요.{' '}
          <Link to="/library" className="underline hover:text-brand">
            보관함 보기
          </Link>
        </p>
      ) : (
        <p className="mt-2 text-center text-xs text-ink-3">
          <button
            type="button"
            onClick={() => setAccountSheet(true)}
            className="underline hover:text-brand"
          >
            로그인
          </button>
          하면 이 결과가 보관함에 남아요
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

  /*
    스타일 입력 스키마 (이슈 #114 → #127 착지).

    이제 이 job 이 **어떤 값으로** 만들어졌는지 서버가 답합니다(`job.inputs`, 백엔드
    PR #139). 그 전까지는 되살리는 대신 다시 고르게 하고 «기본값으로 시작해요» 를
    적어 두는 것이 최선이었습니다 — 값을 못 되살리는 것과 **말없이 바꾸는 것**은 다른
    문제라, 뒤엣것만 계약 없이 닫아 둔 상태였습니다. 이제 앞엣것도 닫힙니다.

    그래도 **스타일 상세는 계속 부릅니다.** `job.inputs` 는 「무엇으로 만들었나」만
    답하고 「지금 무엇을 고를 수 있나」는 못 답하기 때문입니다 — 칸의 종류·선택지·
    검증 규칙은 스타일 쪽에만 있습니다. 그리고 그 둘은 **어긋날 수 있습니다**: 운영이
    job 이후에 칸을 바꾸면 `inputs` 에 없어진 라벨이 남습니다(그래서 아래
    `restoredInputValues` 가 지금 스키마로 한 번 더 거릅니다).

    합치는 순서가 규칙입니다 — 기본값 → 지난번 값 → 이 화면에서 고친 값.
    `job.inputs` 를 그대로 폼 값으로 쓰면 안 되는 이유가 첫 항목입니다: `default` 가
    없는 `prefill` 칸은 서버가 저장하지 않아(`_resolve_input_values` 가 `continue`)
    `inputs` 에 **아예 없고**, 워커가 그때 강아지 이름으로 채웁니다. 그 칸을 비운 채
    두면 이름이 인쇄되는 스타일에서 폼이 «우리 아이» 라고 잘못 말합니다.
  */
  const styleQuery = useStyleDetail(job.style_id)
  const fields = styleQuery.data?.input_fields ?? []
  // 스키마가 오기 전을 «칸이 없다»로 단정하지 않습니다 — 그 창에서 버튼을 누르면
  // 값이 통째로 빠진 요청이 나가고, 크레딧은 이미 나간 뒤입니다.
  const schemaPending = job.style_id !== null && styleQuery.isPending
  /*
    **영영 안 오는 경우**도 같은 단정입니다 (백엔드 PR #182).

    `DELETE /v1/admin/styles/{id}` 는 물리 삭제가 아니라 `status: retired` 전환인데,
    `GET /v1/styles/{id}` 는 public·ab 만 답하므로(app/routers/styles.py `get_style`)
    회수된 스타일은 **404** 로 돌아옵니다. 그러면 위 `fields` 가 `[]` 가 되고 옵션
    섹션이 통째로 사라지는데, `isPending` 만 보던 `schemaPending` 은 false 라 버튼이
    멀쩡히 활성입니다. 눌러도 `POST /v1/jobs` 가 같은 이유로 404 라(`jobs.py` 의
    `status__in=["public","ab"]`) **아무 일도 안 일어납니다.**

    둘을 갈라야 하는 이유는 남은 선택지가 다르기 때문입니다.

    - **404 = 회수됨.** 기다려도 안 옵니다. 이 스타일로는 다시 못 만드는 게 확정이라
      버튼을 잠그는 건 막다른 길만 남기는 셈입니다 — 사진을 살려 카탈로그로 보냅니다
      (아래 `context` 가 없을 때 쓰는 그 링크와 같은 동선).
    - **그 외(5xx·네트워크) = 지금만 모름.** 스타일은 살아 있으므로 새로고침이 답입니다.
      이때 보내면 값이 통째로 빠진 요청이 나가므로 `schemaPending` 과 똑같이 잠급니다.
  */
  const styleRetired = isApiError(styleQuery.error, 'NOT_FOUND')
  const schemaUnavailable = styleQuery.isError && !styleRetired

  // 프리필 칸(31개 중 4개)이 있을 때만 강아지 이름을 부릅니다 — 그 칸의 초기값이
  // 곧 그림에 인쇄될 이름이라, 모르면 폼이 «우리 아이» 라고 잘못 말합니다.
  const needsPetName = job.pet_id !== null && fields.some((field) => field.prefill === 'pet_name')
  const { data: petsData } = usePets(needsPetName)
  const petName = petsData?.items.find((pet) => pet.id === job.pet_id)?.name ?? null

  /** 사용자가 이 화면에서 고친 칸만 들고 있습니다. 나머지는 아래에서 조립합니다. */
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const formId = useId()

  /*
    값을 상태로 «초기화» 하지 않고 그릴 때마다 조립합니다.

    스키마와 강아지 이름은 서로 다른 시점에 도착합니다(W-04 는 그 둘을 맞추려고 효과
    하나와 ref 두 개를 씁니다). 고친 칸만 들고 있으면 늦게 온 이름·기본값이 저절로
    따라오고, 초기화 타이밍을 놓쳐 프리필이 영영 빈 칸으로 남는 경로가 없습니다.
    사용자가 지운 칸은 `edits` 에 `''` 로 남으므로 기본값이 도로 덮지 않습니다.
  */
  // 지난번 값 — 지금 스키마에 있는 칸만(app/styleInputs.ts 주석의 «어긋날 수 있다»).
  const restored = restoredInputValues(fields, job.inputs)
  const values = { ...initialInputValues(fields, petName), ...restored, ...edits }
  const problems = inputErrors(fields, values)
  // 아직 안 만진 칸에 미리 빨간 줄을 긋지 않는 규칙도 W-04 와 같습니다 — 프리필이
  // 규칙을 어기는 경우가 실제로 있어서(«입덕직캠» 3자 제한) 도착하자마자 나무라게 됩니다.
  const visibleErrors: Record<string, string> = {}
  for (const [fieldLabel, message] of Object.entries(problems)) {
    if (submitted || touched.has(fieldLabel)) visibleErrors[fieldLabel] = message
  }

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
        className="mt-2 block rounded-xl border border-rule px-4 py-3 text-center text-sm text-ink-2 hover:border-rule-strong hover:bg-surface-2 hover:text-ink"
      >
        {keepsPhoto ? '이 사진으로 다른 스타일 고르기' : '다른 사진으로 만들기'}
      </Link>
    )
  }

  /*
    회수된 스타일도 «재료를 모르는» 경우입니다 — 다만 모르는 게 아니라 **없어진**
    것이라 기다릴 것이 없습니다(위 `styleRetired` 주석). 사진은 살아 있으므로 바로
    위와 같은 링크로 카탈로그에 보냅니다.

    이유를 한 줄 답니다. «다시 만들기» 가 있던 자리가 말없이 링크로 바뀌면 사용자는
    무엇이 없어졌는지 모른 채 자기가 뭘 잘못 눌렀다고 생각합니다 — 이 화면에서 다른
    결과로 가는 경로는 이 버튼 하나뿐이라(이슈 #26) 사라진 것이 눈에 띕니다.
  */
  if (styleRetired) {
    return (
      <>
        <Link
          to={withReuse('/styles', job.job_id)}
          className="mt-2 block rounded-xl border border-rule px-4 py-3 text-center text-sm text-ink-2 hover:border-rule-strong hover:bg-surface-2 hover:text-ink"
        >
          이 사진으로 다른 스타일 고르기
        </Link>
        <p className="mt-1 text-center text-xs text-ink-3">
          이 스타일은 더 이상 제공되지 않아 같은 설정으로는 다시 만들 수 없어요
        </p>
      </>
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

    /*
      서버도 같은 규칙으로 400 을 냅니다(`_resolve_input_values`, 크레딧은 안 나갑니다).
      먼저 막는 이유는 W-04 와 같습니다 — 그 응답은 어느 칸이 왜 틀렸는지 화면이 옮겨
      적을 만큼 친절하지 않습니다. 접혀 있으면 같이 펼칩니다: 안 보이는 칸을 두고
      «고칠 곳이 있어요» 라고만 하면 어디를 고치라는 말인지 알 수 없습니다.
    */
    if (Object.keys(problems).length > 0) {
      setSubmitted(true)
      setOptionsOpen(true)
      return
    }

    const intent = {
      style_id: context.styleId,
      upload_id: context.uploadId,
      pet_id: null,
      // 커스텀으로 만든 결과는 같은 문구로 다시 돌려야 합니다 — 비우면 스타일도
      // 문구도 없는 요청이 나갑니다.
      custom_prompt: customPrompt,
      // 위 폼에서 보여 준 그 값입니다. 화면에 «스타일: 히메갸루» 라고 적어 놓고
      // 요청에서 빼면 서버가 `default` 로 채워 다른 그림이 나옵니다(이슈 #127).
      // 값이 달라지면 의도가 달라진 것이므로 멱등 키도 자동으로 갈립니다
      // (api/idempotency.ts `sameIntent` 가 `inputs` 를 봅니다).
      inputs: inputsForRequest(fields, values),
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
      {/*
        고를 게 있는 스타일이면 **무엇으로 만들지**를 버튼 앞에 적습니다(24종).

        접어 두는 이유는 이 화면의 배치 때문입니다 — 출구 셋(공유·계산기·쇼핑몰)을
        감정 최고점에 모아 둔 자리라, 폼을 펼쳐 놓으면 계산기와 쇼핑몰이 한 화면 아래로
        밀립니다(노트6 · FR-W06-08). 대신 접힌 줄이 값을 그대로 말하므로, 펼치지 않아도
        «무엇이 나올지 모르는» 상태는 아닙니다.
      */}
      {fields.length > 0 && (
        <section
          aria-label="스타일 옵션"
          className="mt-3 rounded-xl border border-rule bg-surface px-3 py-2.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            {/* 두 칸짜리 스타일에서 `truncate` 는 뒤 칸의 값을 통째로 가립니다 —
                감추면 «변경» 을 눌러야만 알 수 있으니 두 줄까지 풀어 줍니다. */}
            <p className="line-clamp-2 min-w-0 text-sm">
              {fields
                .map((field) => `${field.label}: ${effectiveInputValue(field, values, petName)}`)
                .join(' · ')}
            </p>
            <button
              type="button"
              aria-expanded={optionsOpen}
              aria-controls={formId}
              onClick={() => setOptionsOpen((open) => !open)}
              className="shrink-0 text-xs text-ink-3 underline underline-offset-2 hover:text-brand"
            >
              {optionsOpen ? '접기' : '변경'}
            </button>
          </div>
          {/*
            접힌 줄의 값이 **어디서 온 것인지** 한 줄로 말합니다. 세 경우가 다릅니다.

            1. 서버가 값을 모름(`inputs: null`) — 옛 job 이거나 응답이 이 필드를 갖기
               전에 만든 job 입니다. 이때는 기본값이므로 그렇다고 적습니다. 안 적으면
               접힌 줄이 방금 만든 그림의 설정처럼 읽힙니다.
            2. 지난번 값을 불러옴 — 그 사실을 적습니다. «다시 만들기» 가 같은 설정으로
               도는지가 이 버튼을 누를지 말지의 판단 기준입니다(이슈 #127).
            3. 사용자가 이 화면에서 고침 — 아무 줄도 안 답니다. 지금 값은 방금 본인이
               고른 것이고 접힌 줄이 이미 그걸 말합니다. 여기서 «불러왔어요» 를 계속
               띄우면 고친 값을 두고 지난번 값이라고 말하는 셈입니다.

            2 번에서 `restored` 가 비어 있을 수 있습니다 — 칸이 전부 `default` 없는
            `prefill` 이면 서버가 저장할 값이 없어 `inputs` 가 `{}` 입니다. 그때는
            불러올 것도 잃을 것도 없으므로(이름은 `pet_id` 로 같은 값이 나옵니다)
            역시 아무 줄도 안 답니다.
          */}
          {job.inputs === null ? (
            <p className="mt-0.5 text-xs text-ink-3">지난번 값은 불러올 수 없어 기본값이에요</p>
          ) : Object.keys(edits).length === 0 && Object.keys(restored).length > 0 ? (
            <p className="mt-0.5 text-xs text-ink-3">지난번에 만든 값 그대로예요</p>
          ) : null}
          <div id={formId} hidden={!optionsOpen}>
            {optionsOpen && (
              <StyleInputForm
                fields={fields}
                values={values}
                errors={visibleErrors}
                petName={petName}
                title={null}
                framed={false}
                onChange={(fieldLabel, value) =>
                  setEdits((current) => ({ ...current, [fieldLabel]: value }))
                }
                onTouch={(fieldLabel) =>
                  setTouched((current) =>
                    current.has(fieldLabel) ? current : new Set(current).add(fieldLabel),
                  )
                }
              />
            )}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={regenerate}
        // 스키마를 아직 모르는 동안은 못 누릅니다(위 `schemaPending` 주석). 대개
        // 캐시에 있어 안 보이고, 링크로 처음 연 결과에서만 한 왕복 동안 보입니다.
        // 스키마 조회가 **실패한** 경우도 같습니다 — 회수(404)는 위에서 이미 빠졌으니
        // 여기 남는 건 5xx·네트워크뿐이고, 그건 기다리면 풀립니다.
        disabled={createJob.isPending || schemaPending || schemaUnavailable}
        className="mt-2 w-full rounded-xl border border-rule-strong bg-surface px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {schemaPending
          ? '옵션 불러오는 중…'
          : schemaUnavailable
            ? '옵션을 불러오지 못했어요'
            : createJob.isPending
              ? '보내는 중…'
              : `${label} · ${cost} 크레딧`}
      </button>

      {schemaUnavailable && (
        <p className="mt-1 text-center text-xs text-ink-3">
          잠시 뒤 새로고침하면 다시 만들 수 있어요
        </p>
      )}

      {submitted && Object.keys(problems).length > 0 && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          위 옵션에서 고칠 곳이 있어요.
        </p>
      )}

      {/*
        요청이 실패한 것을 **말은 합니다.** 여기가 비어 있는 동안 W-04 는 같은 실패를
        이미 적고 있었고(`W04Upload.tsx` 의 `createJob.error.message`), 그래서 같은
        오류가 어느 화면에서 눌렀느냐에 따라 «안내» 와 «아무 일도 안 일어남» 으로
        갈렸습니다.

        402 는 뺍니다 — 아래 오버레이가 잔액·필요액까지 들고 따로 뜹니다.

        404 도 뺍니다. 서버 문구가 `"Job, upload, or style not found"` 라 셋 중
        무엇인지 말해 주지 않고, 그대로 옮기면 영문 원문이 사용자에게 나갑니다. 이
        화면에서 job 은 방금 그렸으니 남는 건 스타일·업로드고, 둘 다 «카탈로그에서
        다시» 가 답입니다. 스타일 회수라면 새로고침 뒤에는 위 `styleRetired` 갈래가
        받습니다 — 이 줄은 화면을 열어 둔 사이에 회수된 경우의 첫 클릭용입니다.
      */}
      {createJob.error && !isApiError(createJob.error, 'INSUFFICIENT_CREDIT') && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          {isApiError(createJob.error, 'NOT_FOUND')
            ? '이 스타일이나 사진을 더 이상 쓸 수 없어요. 카탈로그에서 다시 골라 주세요.'
            : createJob.error.message}
        </p>
      )}

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
        track({
          event_type: 'calculator_exit_click',
          properties: { job_id: jobId, breed_code: link.breed_code },
        })
      }
      className="mt-4 block rounded-xl border border-rule-strong bg-surface px-3 py-3 hover:border-rule-strong hover:bg-surface-2"
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
          className="shrink-0 text-xs text-ink-3 underline underline-offset-2 hover:text-brand"
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
              className="block overflow-hidden rounded-lg border border-rule bg-surface hover:border-brand-2"
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
