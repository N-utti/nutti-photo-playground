/**
 * W-07 · 계산기로 넘기기 (docs/wireframe-spec-v0.5.html#p07)
 *
 * **이 화면이 얇은 이유를 먼저 적습니다.** 노트1 — 계산기는 이미 라이브고
 * (`nutti.co.kr/calculator.html`, 5단계) 놀이터가 할 일은 *거기로 사람을 보내는
 * 것뿐*입니다. 노트6 — 계산기는 세 출구 중 하나이지 **필수 경유지가 아닙니다**.
 * 그래서 와이어프레임 A 프레임은 별도 화면이 아니라 **결과 화면(W-06)에 붙은
 * 배너**이고, 실제 넘기기는 거기서 바로 일어납니다(UC-06 (c)). 결과에서 나가는
 * 길 중간에 확인 화면을 끼우면 출구에 마찰만 늘어납니다.
 *
 * 그럼 이 라우트는 무엇인가: 결과가 눈앞에 없을 때의 진입입니다. §2 W-07 이
 * `?pet_id=` 를 `?job_id=` 와 나란히 규정하는 경로 — 보관함(W-09)에서 강아지를 고르면
 * 뜨는 «이 강아지 간식량 계산하기» 가 그 링크입니다(`W09Library` `PetFilter`).
 *
 * **`?pet_id=` 는 세 갈래를 다 냅니다.** 서버는 그 펫의 **최신 사진**에 적힌 견종을 따라가므로
 * (`app/routers/results.py` `_resolve_pet_and_estimate`), 사진이 한 장도 없는 강아지는
 * `breed_code: null` 로 와서 계산기 1단계부터 시작합니다(FR-EDGE-10). 그리고 **없는
 * 강아지는 404** 입니다 — 폴백이 아닙니다. 아래 `notFound` 갈래가 그 자리입니다.
 */

import { Link, useSearchParams } from 'react-router'
import { isApiError } from '../api/client'
import { calculatorHeadline, estimateSummary } from '../api/calculatorLink'
import { track } from '../app/analytics'
import { useCalculatorLink } from '../api/queries'
import BackButton from '../app/BackButton'
import type { CalculatorLink } from '../api/types'

export default function W07Calculator() {
  const [searchParams] = useSearchParams()

  const petId = searchParams.get('pet_id') ?? undefined
  const jobId = searchParams.get('job_id') ?? undefined
  const params = { pet_id: petId, job_id: jobId }

  const { data: link, isPending, isError, error, refetch } = useCalculatorLink(params)

  /*
    404 는 **재시도로 풀리지 않습니다.** 가리키는 강아지나 결과가 없는 주소라(서버는
    폴백 없이 `_not_found`), «다시 시도» 를 누르면 영영 같은 답이 옵니다. 이 자리에
    실제로 오는 사람은 마이페이지에서 강아지를 지운 뒤 히스토리·북마크로 돌아온
    경우입니다 — 고장이 아니라 **없어진 것**이라 그렇게 말하고, 계산기는 1단계부터
    쓰면 되므로 나가는 길을 답니다.
  */
  const notFound = isApiError(error, 'NOT_FOUND')

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <BackButton fallback="/styles" />
        <h1 className="text-base font-bold">간식량 계산기</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {!petId && !jobId ? (
          // 쿼리가 없으면 서버에 물어볼 게 없습니다(useCalculatorLink 도 비활성).
          // 그래도 계산기로 가는 길 자체는 막지 않습니다 — 1단계부터 하면 됩니다.
          <div className="rounded-xl border border-rule bg-surface px-4 py-5">
            <p className="text-sm font-semibold">어떤 강아지인지 알 수 없어요</p>
            <p className="mt-1 text-sm text-ink-2">
              결과 화면에서 넘어오면 만들 때 입력한 견종으로 2단계부터 시작할 수 있어요.
            </p>
            <Link
              to="/styles"
              className="mt-4 block rounded-xl border border-rule-strong px-4 py-3 text-center text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
            >
              사진부터 만들기
            </Link>
          </div>
        ) : isPending ? (
          <div className="h-40 animate-pulse rounded-xl bg-rule/60" />
        ) : notFound ? (
          <div className="rounded-xl border border-rule bg-surface px-4 py-5">
            <p className="text-sm font-semibold">그 강아지를 찾을 수 없어요</p>
            <p className="mt-1 text-sm text-ink-2">
              지웠거나 다른 계정에서 만든 강아지예요. 계산기는 1단계부터도 쓸 수 있어요.
            </p>
            <div className="mt-4 grid gap-2">
              {/* 서버에 물어볼 게 없으므로 쿼리 없는 진입으로 보냅니다 — 거기서 계산기
                  1단계로 나가는 길을 이미 답니다(위 «어떤 강아지인지 알 수 없어요»). */}
              <Link
                to="/calculator"
                className="block rounded-xl border border-rule-strong px-4 py-3 text-center text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
              >
                계산기 1단계부터 하기
              </Link>
              <Link
                to="/library"
                className="block rounded-xl px-4 py-2 text-center text-sm text-ink-2 hover:text-brand"
              >
                보관함으로
              </Link>
            </div>
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rule bg-surface px-4 py-5 text-center">
            <p className="text-sm text-ink-2">계산기 링크를 불러오지 못했어요.</p>
            <p className="mt-1 font-mono text-xs text-ink-3">{error.message}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <HandoffCard link={link} jobId={jobId} petId={petId} />
        )}
      </main>
    </div>
  )
}

function HandoffCard({
  link,
  jobId,
  petId,
}: {
  link: CalculatorLink
  jobId?: string
  petId?: string
}) {
  const summary = estimateSummary(link)

  return (
    <>
      <div className="rounded-xl border border-rule-strong bg-surface-2 px-4 py-4">
        <h2 className="text-base font-bold">{calculatorHeadline(link)}</h2>
        <p className="mt-1 text-sm text-ink-2">{summary.text}</p>

        {/* 노트4 — 믹스견은 판별이 부정확합니다. 단정하면 신뢰를 잃으므로 출처를
            밝히고 되돌아갈 길이 있다는 걸 넘어가기 **전에** 말합니다.

            믹스견일 때 "입력한 값" 이라고 하지 않는 이유: 그 값은 사용자가 쓴 게
            아니라 **쓴 견종이 계산기 목록에 없어서 서버가 대신 넣은 값**일 수
            있습니다(FR-EDGE-11 — 응답만으로는 구분이 안 됩니다. `calculatorLink.ts`). */}
        {summary.kind !== 'unknown' && (
          <p className="mt-2 rounded-lg bg-good-soft px-3 py-2 text-xs text-good">
            {summary.kind === 'mixed'
              ? '계산기 1단계에서 견종을 직접 고를 수 있어요.'
              : '만들 때 입력한 값이에요. 다르면 계산기 1단계에서 바꿀 수 있어요.'}
          </p>
        )}

        <a
          href={link.calculator_url}
          onClick={() =>
            track({
              event_type: 'calculator_exit_click',
              properties: { job_id: jobId ?? null, pet_id: petId ?? null, breed_code: link.breed_code },
            })
          }
          className="mt-4 block rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
        >
          간식량 계산하기 →
        </a>
      </div>

      <p className="mt-2 text-center text-xs text-ink-3">누띠 간식 계산기로 이동합니다</p>
    </>
  )
}
