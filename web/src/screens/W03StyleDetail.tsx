/**
 * W-03 · 스타일 상세 (docs/wireframe-spec-v0.5.html#p03)
 *
 * 노트1 때문에 이 화면은 라우트상 **W-02 의 자식**입니다. 전체 화면으로 갈아끼우면
 * 그리드의 스크롤 위치와 앵커 상태가 사라져 "여러 스타일을 비교한다"는 이 화면의
 * 존재 이유가 없어집니다. `/styles/:styleId` 로 직접 들어와도 뒤에 카탈로그가 함께
 * 렌더되므로, 시트를 닫으면 탐색이 그대로 이어집니다.
 *
 * 반영한 노트:
 *   1. 전체 화면이 아니라 시트 — 그리드 탐색 맥락 유지
 *   2. 적용 예시 6장 캐러셀 (장수는 서버 `examples[]` 를 따릅니다)
 *   3. 적합도 태그(견종·털색) — 기대치를 미리 낮추는 장치
 *   4. 소요 시간·산출 장수는 버튼 **아래**
 *   숨기는 것: 프롬프트 원문 — API(§3 GET /v1/styles/{id})가 애초에 내려주지 않습니다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { isApiError } from '../api/client'
import { useStyleDetail } from '../api/queries'
import { useReuseFromJob, withReuse } from '../app/reuseFromJob'
import { PET_NAME_FALLBACK, usesPetName } from '../app/petNameStyles'
import type { FitTag, StyleDetail } from '../api/types'

/**
 * 와이어프레임 표기(소형견 ◎ / 검은 털 △).
 * §3 에 `score` 의 전체 값 도메인이 명세돼 있지 않으므로(api/types.ts FitTag 주석)
 * 모르는 등급은 기호 없이 라벨만 보여 줍니다 — 임의 기호를 붙이면 뜻을 지어내는 셈입니다.
 */
const FIT_MARK: Record<string, string> = { good: '◎', caution: '△' }

export default function W03StyleDetail() {
  const { styleId } = useParams()
  const navigate = useNavigate()

  const parsed = Number(styleId)
  const id = Number.isInteger(parsed) && parsed > 0 ? parsed : null

  const { data: style, isPending, error } = useStyleDetail(id)
  const sheetRef = useRef<HTMLDivElement>(null)

  // 재사용 맥락(FR-W06-07)은 시트를 닫아도 살아 있어야 합니다 — 여기서 떨어뜨리면
  // 뒤의 카탈로그가 갑자기 평소 모드로 바뀌어 사진을 다시 올리게 됩니다.
  const reuse = useReuseFromJob()
  const close = useCallback(
    () => navigate(withReuse('/styles', reuse.jobId)),
    [navigate, reuse.jobId],
  )

  useEffect(() => {
    sheetRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)

    // 시트가 떠 있는 동안 뒤 그리드가 같이 스크롤되면 안 됩니다.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [close])

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end desktop:items-center desktop:justify-center">
      {/* 스크림 — 시트 밖을 누르면 닫힙니다. */}
      <button
        type="button"
        aria-label="닫기"
        onClick={close}
        className="absolute inset-0 cursor-default bg-ink/40"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-sheet-title"
        tabIndex={-1}
        className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-surface px-4 pt-2 pb-6 outline-none desktop:max-w-lg desktop:rounded-2xl desktop:pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-rule" aria-hidden />

        {isPending ? (
          <SheetSkeleton />
        ) : error ? (
          <SheetError
            message={
              isApiError(error, 'NOT_FOUND')
                ? '지금은 고를 수 없는 스타일이에요.'
                : '스타일 정보를 불러오지 못했습니다.'
            }
            onClose={close}
          />
        ) : (
          <SheetBody style={style} reuseJobId={reuse.jobId} reusing={reuse.context !== null} />
        )}
      </div>
    </div>
  )
}

function SheetBody({
  style,
  reuseJobId,
  reusing,
}: {
  style: StyleDetail
  reuseJobId: string | null
  /** 재료가 실제로 확인된 경우에만 "사진 그대로"를 약속합니다. */
  reusing: boolean
}) {
  return (
    <>
      {/* 노트2 — 예시는 서로 다른 견종으로 채워집니다(어떤 사진을 넣을지는 운영이 W-11 에서 정함). */}
      <ExampleCarousel images={style.examples} styleName={style.name} />

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <h2 id="style-sheet-title" className="text-lg font-bold">
          {style.name}
        </h2>
        <span className="shrink-0 rounded-full border border-rule bg-surface-2 px-2 py-0.5 font-mono text-xs tabular-nums">
          {style.credit_cost} 크레딧
        </span>
      </div>

      {/*
        PR #98 — 이 스타일은 그림 안에 아이 이름이 인쇄됩니다.

        적합도 태그(노트3)와 같은 «기대치를 미리 낮추는 장치» 이지만 성격이 다릅니다:
        태그는 결과가 나쁠 수 있다는 예고이고, 이건 **사용자가 지금 바꿀 수 있는
        조건**의 예고입니다 — 저장된 강아지를 고르고 들어오면 그 이름이 박힙니다.
        그래서 태그 위, 만들기 버튼 앞에 둡니다.
      */}
      {usesPetName(style.code) && (
        <p className="mt-3 rounded-lg border border-rule bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <span className="font-semibold text-ink">아이 이름이 그림에 들어갑니다</span> — 저장된
          강아지로 만들면 그 이름이, 아니면 «{PET_NAME_FALLBACK}» 가 인쇄됩니다.
        </p>
      )}

      {/* 노트3 — 적합도 태그. */}
      {style.fit_tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {style.fit_tags.map((tag) => (
            <li key={tag.label}>
              <FitChip tag={tag} />
            </li>
          ))}
        </ul>
      )}

      {/* 재사용 중이면 `from_job` 을 그대로 넘겨 W-04 가 업로드 단계를 건너뜁니다. */}
      <Link
        to={withReuse(`/upload?style_id=${style.id}`, reuseJobId)}
        className="mt-5 block rounded-xl bg-brand px-4 py-3 text-center text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
      >
        이 스타일로 만들기
      </Link>

      {/*
        재사용 경로에서는 이 버튼 다음이 곧 결제(확인 → 생성)입니다. 업로드 단계를
        건너뛰는 만큼 "얼마가 나가는지"를 여기서 한 번 말해 둡니다 — 비용 배지는
        위에 있지만 시트를 스크롤한 상태면 눈에 없습니다(FR-W04-05 와 같은 이유).
      */}
      {reusing && (
        <p className="mt-2 text-center text-sm font-semibold">
          올린 사진 그대로 · {style.credit_cost} 크레딧
        </p>
      )}

      {/* 노트4 — 대기 이탈의 절반은 "얼마나 걸리는지 몰라서". 버튼 바로 아래에 둡니다. */}
      <p className="mt-2 text-center text-sm text-ink-3">
        평균 {style.avg_duration_seconds}초 · {style.output_count}장 생성
      </p>
    </>
  )
}

function FitChip({ tag }: { tag: FitTag }) {
  const mark = FIT_MARK[tag.score]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
        tag.score === 'caution'
          ? 'border-warn/30 bg-warn-soft text-warn'
          : 'border-rule bg-surface-2 text-ink-2'
      }`}
    >
      {tag.label}
      {mark && <span aria-hidden>{mark}</span>}
      {mark && <span className="sr-only">{tag.score === 'caution' ? '주의' : '적합'}</span>}
    </span>
  )
}

/**
 * 스크롤 스냅 캐러셀. 라이브러리를 붙이지 않은 이유는 이 화면이 요구하는 게
 * "가로로 넘기고 현재 위치를 점으로 표시" 하나뿐이고, 그건 브라우저 네이티브
 * 스크롤이 이미 더 잘 하기 때문입니다(관성·터치·키보드 전부 공짜).
 */
function ExampleCarousel({ images, styleName }: { images: string[]; styleName: string }) {
  const trackRef = useRef<HTMLUListElement>(null)
  const [active, setActive] = useState(0)

  /*
    예시가 없으면 캐러셀 자체를 내립니다.

    `examples[]` 는 서버가 `example_keys` 로 만드는 값이라 예시 사진을 아직 안 올린
    스타일에서는 빈 배열입니다(app/routers/styles.py). 그래도 그리던 시절에는 트랙이
    높이 0 으로 접혀 **화면에는 아무 변화가 없는데** 아래 라이브 영역만
    "적용 예시 1 / 0" 을 읽었습니다 — 0 장인데 1 번째라는, 있지도 않은 사진을 세는
    말입니다. 보이지 않는 곳이라 눈으로는 영영 안 걸립니다.
  */
  if (images.length === 0) return null

  return (
    <div>
      <ul
        ref={trackRef}
        onScroll={(event) => {
          const track = event.currentTarget
          setActive(Math.round(track.scrollLeft / track.clientWidth))
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-xl"
      >
        {images.map((src, index) => (
          <li key={index} className="w-full shrink-0 snap-center">
            <img
              src={src}
              alt={`${styleName} 적용 예시 ${index + 1}`}
              loading={index === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="aspect-square w-full bg-surface-2 object-cover"
            />
          </li>
        ))}
      </ul>

      {/* 한 장뿐이면 점 하나짜리 페이저와 "1 / 1" 안내는 넘길 곳이 있다는 거짓말입니다. */}
      {images.length > 1 && (
        <>
          <div className="mt-2 flex justify-center gap-1.5">
            {images.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`예시 ${index + 1}`}
                aria-current={active === index ? 'true' : undefined}
                onClick={() => {
                  const track = trackRef.current
                  track?.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' })
                }}
                className={`size-1.5 rounded-full transition-colors ${
                  active === index ? 'bg-brand' : 'bg-rule-strong hover:bg-brand-2'
                }`}
              />
            ))}
          </div>

          <p className="sr-only" aria-live="polite">
            적용 예시 {active + 1} / {images.length}
          </p>
        </>
      )}
    </div>
  )
}

function SheetError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="py-8 text-center">
      <h2 id="style-sheet-title" className="text-base font-semibold">
        {message}
      </h2>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
      >
        다른 스타일 보기
      </button>
    </div>
  )
}

function SheetSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-square w-full rounded-xl bg-rule/60" />
      <div className="mt-4 h-5 w-32 rounded bg-rule/60" />
      <div className="mt-3 h-7 w-48 rounded-full bg-rule/60" />
      <div className="mt-5 h-11 w-full rounded-xl bg-rule/60" />
      {/* 스켈레톤에도 라벨 대상이 필요합니다 — aria-labelledby 가 가리키는 노드. */}
      <span id="style-sheet-title" className="sr-only">
        스타일 정보를 불러오는 중
      </span>
    </div>
  )
}
