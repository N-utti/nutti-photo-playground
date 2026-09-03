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
 *
 * ---------------------------------------------------------------------------
 * `uses_breed` 는 왜 **이 화면에** 없는가 (W-02 도 같은 판단)
 *
 * 견종은 W-04 확인 단계에서 사용자가 고르거나 직접 씁니다(`screens/W04Upload.tsx`
 * BreedField). 업로드 전인 여기서는 무엇이 박힐지 아직 정해지지 않았고, 받는 자리도
 * 아니라서 예고할 것이 없습니다 — 이름(`uses_pet_name`)과 같은 이유로 W-04 가 말합니다.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { isApiError } from '../api/client'
import { useStyleDetail } from '../api/queries'
import { useModalDialog } from '../app/useModalDialog'
import { useReuseFromJob, withReuse } from '../app/reuseFromJob'
import { PET_NAME_FALLBACK } from '../app/styleInputs'
import type { FitTag, StyleDetail } from '../api/types'

/**
 * 와이어프레임 표기(소형견 ◎ / 검은 털 △).
 * §3 에 `score` 의 전체 값 도메인이 명세돼 있지 않으므로(api/types.ts FitTag 주석)
 * 모르는 등급은 기호 없이 라벨만 보여 줍니다 — 임의 기호를 붙이면 뜻을 지어내는 셈입니다.
 */
const FIT_MARK: Record<string, string> = { good: '◎', caution: '△' }

/**
 * 손잡이를 잡아 내려서 닫기.
 *
 * 시트 위에 손잡이 막대를 그려 두고 잡히지 않게 두면 그 자체가 거짓 예고입니다 —
 * «잡아 내릴 수 있다» 고 생긴 것이 안 움직이면 사용자는 앱이 멈춘 줄 압니다.
 * 닫는 길을 하나 더 만드는 게 아니라 이미 그려 둔 약속을 지키는 쪽이고, 스크림 탭과
 * Escape 는 그대로 남습니다(키보드·스크린리더는 계속 그쪽 길로 닫습니다 — 드래그는
 * 포인터에만 있는 동작이라 그 둘을 대신할 수 없습니다).
 *
 * **손잡이에서만** 시작합니다. 본문은 세로 스크롤 영역(`overflow-y-auto`)이라 거기서
 * 드래그를 받으면 스크롤하려던 손가락이 시트를 닫습니다.
 */

/** 이만큼 내렸으면 «내려놓는 중» 으로 봅니다. 시트 최대 높이(85vh)의 1/6 남짓. */
const DISMISS_DISTANCE = 96
/** 짧게 튕겨 내리는 손짓도 닫힘입니다. px/ms — 96px 을 160ms 안에 긋는 속도. */
const DISMISS_VELOCITY = 0.6
/** 다만 제자리 탭의 미세한 떨림까지 «튕김» 으로 세지 않도록 최소 거리를 둡니다. */
const DISMISS_FLICK_DISTANCE = 24

/** 화면 코드의 `motion-safe:` 와 같은 질문 — 여기서는 JS 로 물어야 합니다. */
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

type DragState = {
  pointerId: number
  /** 잡은 지점. 이동량은 여기서부터 잽니다. */
  startY: number
  /** 직전 이동 지점·시각 — 놓는 순간의 속도는 마지막 두 점에서 나옵니다. */
  y: number
  at: number
  dy: number
  v: number
}

function useDragToDismiss(sheet: { current: HTMLElement | null }, close: () => void) {
  const drag = useRef<DragState | null>(null)
  /** 잡고 있는 동안 걸어 둔 리스너를 걷는 함수. 안 잡고 있으면 null. */
  const release = useRef<(() => void) | null>(null)

  // close 는 렌더마다 새 함수일 수 있습니다(useModalDialog 와 같은 이유).
  const closeRef = useRef(close)
  closeRef.current = close

  // 잡은 채로 시트가 사라지는 경우(드래그 도중 라우트 변경)를 위한 뒷정리.
  useEffect(() => () => release.current?.(), [])

  return useCallback(
    (event: ReactPointerEvent) => {
      const element = sheet.current
      if (!element || release.current) return
      /*
        데스크톱(≥1024px)에서는 이게 바닥에 붙은 시트가 아니라 화면 한가운데 뜨는
        대화상자입니다 — 아래로 «내려놓을» 가장자리가 없어서, 끌면 그냥 중앙에서
        어긋납니다. 손잡이는 그대로 두되(모양은 시트 정체성) 드래그만 받지 않습니다.
      */
      if (window.matchMedia('(min-width: 1024px)').matches) return
      // 마우스는 왼쪽 버튼만. 오른쪽 클릭으로 시트가 끌려 내려가면 메뉴와 겹칩니다.
      if (event.pointerType === 'mouse' && event.button !== 0) return

      const state: DragState = {
        pointerId: event.pointerId,
        startY: event.clientY,
        y: event.clientY,
        at: event.timeStamp,
        dy: 0,
        v: 0,
      }
      drag.current = state
      // 끄는 동안은 손가락을 그대로 따라와야 합니다 — 되돌아갈 때만 애니메이션.
      element.style.transition = 'none'

      const move = (moved: PointerEvent) => {
        if (moved.pointerId !== state.pointerId) return

        const dt = moved.timeStamp - state.at
        if (dt > 0) state.v = (moved.clientY - state.y) / dt
        state.y = moved.clientY
        state.at = moved.timeStamp
        // 위로는 따라가지 않습니다 — 시트는 이미 화면 아래 끝에 붙어 있어 올릴 자리가 없습니다.
        state.dy = Math.max(0, moved.clientY - state.startY)
        element.style.transform = `translateY(${state.dy}px)`
      }

      const end = (ended: PointerEvent) => {
        if (ended.pointerId !== state.pointerId) return
        drag.current = null
        release.current?.()

        // pointercancel(시스템이 제스처를 가져간 경우)은 «놓았다» 가 아닙니다 — 되돌립니다.
        const dismiss =
          ended.type === 'pointerup' &&
          (state.dy >= DISMISS_DISTANCE ||
            (state.v >= DISMISS_VELOCITY && state.dy >= DISMISS_FLICK_DISTANCE))

        if (dismiss) {
          // 내린 자리에 둔 채로 닫습니다. 라우트가 바뀌며 시트가 통째로 사라집니다.
          closeRef.current()
          return
        }

        element.style.transition = prefersReducedMotion()
          ? ''
          : 'transform 200ms cubic-bezier(0.2, 0, 0, 1)'
        element.style.transform = ''
      }

      /*
        move·up 을 손잡이가 아니라 window 에서 받습니다. 손가락이 손잡이 밖으로 나가도
        (거의 항상 나갑니다 — 아래로 끄니까) 계속 따라와야 하고, 화면 밖에서 손을 떼도
        끝을 알아야 하기 때문입니다.

        effect 가 아니라 **여기서 바로** 겁니다. state 로 올렸다가 effect 에서 걸면
        리스너가 붙는 시점이 다음 커밋 이후로 밀려서, 잡자마자 튕겨 내리는 손짓의 첫
        몇 프레임을 놓칩니다(실제 브라우저에서 확인 — 테스트는 act 가 effect 를 즉시
        비워 주는 바람에 이 구멍을 못 봤습니다).
      */
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
      release.current = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        release.current = null
      }
    },
    [sheet],
  )
}

export default function W03StyleDetail() {
  const { styleId } = useParams()
  const navigate = useNavigate()

  const parsed = Number(styleId)
  const id = Number.isInteger(parsed) && parsed > 0 ? parsed : null

  const { data: style, isPending, error } = useStyleDetail(id)

  /*
    id 가 null 이면 `useStyleDetail` 은 `enabled: false` 라 **요청을 아예 보내지
    않습니다**. 그런데 react-query 는 그 상태를 `isPending` 으로 내려 주므로, 아래에서
    isPending 을 그대로 믿으면 시트가 스켈레톤에 영원히 멈춥니다 — 못 고르는 스타일을
    두고 «곧 뜬다» 고 말하는 셈입니다(실측: /styles/lego · /styles/0 · /styles/-1).

    서버가 없는 번호로 404 를 내려 줄 때와 사용자가 겪는 일은 같으므로(고를 수 없는
    스타일), 요청을 못 보내는 이 경우도 같은 자리로 보냅니다. 아래 error 갈래가 이미
    그 말을 하고 있어서 새 문구를 만들지 않습니다.
  */
  const unknownId = id === null

  // 재사용 맥락(FR-W06-07)은 시트를 닫아도 살아 있어야 합니다 — 여기서 떨어뜨리면
  // 뒤의 카탈로그가 갑자기 평소 모드로 바뀌어 사진을 다시 올리게 됩니다.
  const reuse = useReuseFromJob()
  const close = useCallback(
    () => navigate(withReuse('/styles', reuse.jobId)),
    [navigate, reuse.jobId],
  )

  /*
    포커스 이동 · Escape · 배경 스크롤 잠금을 여기서 손으로 하고 있었습니다. 셋은 맞게
    돌았지만 **Tab 가둠이 없었습니다** — 뒤 화면을 못 만지게 막는 건 부모
    W02StyleCatalog 의 `<div inert={sheetOpen}>` 이 대신 해 주고 있었고, 그건 이 시트가
    그 라우트의 자식일 때만 성립하는 전제입니다(app/useModalDialog.ts 헤더).

    앱 안에 모달 처리가 두 갈래로 갈려 있으면 다음 사람이 어느 쪽을 베낄지 알 수
    없어서, 부모에 기대지 않고 혼자 서는 쪽으로 맞춥니다. 부모의 `inert` 는 그대로
    둡니다 — 그쪽은 탭바까지 모달 밖으로 빼는 일도 겸하고 있습니다(W02 주석).
  */
  const sheetRef = useModalDialog<HTMLDivElement>(close)
  const startDrag = useDragToDismiss(sheetRef, close)

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
        {/*
          손잡이. 막대 자체는 4px 이라 손가락으로 못 잡으므로 잡는 판을 따로 둡니다 —
          시트의 안쪽 여백을 도로 먹어(`-mx-4 -mt-2`) 위 가장자리까지 넓히고, `py-2` 로
          다시 밀어 **막대의 위치와 아래 12px 여백은 예전 그대로** 둡니다.
          `touch-none` 이 없으면 아래로 긋는 순간 브라우저가 스크롤로 가져갑니다.
        */}
        <div
          aria-hidden
          onPointerDown={startDrag}
          className="-mx-4 -mt-2 mb-1 flex cursor-grab touch-none justify-center px-4 py-2 active:cursor-grabbing desktop:cursor-default"
        >
          <div className="h-1 w-10 rounded-full bg-rule" />
        </div>

        {unknownId || error ? (
          <SheetError
            message={
              unknownId || isApiError(error, 'NOT_FOUND')
                ? '지금은 고를 수 없는 스타일이에요.'
                : '스타일 정보를 불러오지 못했습니다.'
            }
            onClose={close}
          />
        ) : isPending ? (
          <SheetSkeleton />
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
      {style.uses_pet_name && (
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">
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
      <h2 id="style-sheet-title" className="text-lg font-bold">
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
