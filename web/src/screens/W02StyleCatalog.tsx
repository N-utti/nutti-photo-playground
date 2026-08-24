/**
 * W-02 · 홈 · 스타일 카탈로그 (docs/wireframe-spec-v0.5.html#p02)
 *
 * 목 위에서 스택 전체(client → MSW → TanStack Query → 렌더)가 도는지 확인하는
 * 첫 실제 화면입니다. 와이어프레임 노트에서 구조적으로 규정된 것만 구현했고,
 * 비주얼(색·서체)은 확정 전이라 중립 토큰만 씁니다.
 *
 * 반영한 노트:
 *   1. 검색 없음 — 전체 펼침
 *   2. 앵커 칩은 필터가 아니라 **점프**. 나머지를 숨기지 않습니다
 *   3. 앵커바 sticky, 스크롤 위치에 따라 현재 섹션 칩 활성화
 *   4. 섹션 헤더에 개수 표기
 *   5. 모바일 2열 / 데스크톱 4열
 *   7. 크레딧 비용은 카드에 유지
 *
 * 노트 밖에서 카드가 하나 더 말하는 것: **이름이 그림에 인쇄되는 스타일**
 * (`uses_pet_name`, 백엔드 #111). 짝 필드인 `uses_breed` 는 받아만 두고 아직 안
 * 그립니다 — 이유는 screens/W03StyleDetail.tsx 헤더에 한 곳으로 적어 뒀습니다.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useMatch } from 'react-router'
import { useStyles } from '../api/queries'
import { AccountEntry } from '../app/AccountEntry'
import { CreditBadge } from '../app/CreditBadge'
import { CUSTOM_PROMPT_COST_ESTIMATE } from '../app/customPromptCost'
import { useReuseFromJob, withReuse, type JobContext } from '../app/reuseFromJob'
import { TabBar } from '../app/TabBar'
import Thumbnail from '../app/Thumbnail'
import { sectionAnchorIds } from './sectionAnchor'
import type { StyleCard } from '../api/types'

export default function W02StyleCatalog() {
  const { data: catalog, isPending, isError, error, refetch } = useStyles()

  // W-06 "이 사진으로 다른 스타일"(FR-W06-07)이 인기 3개 밖으로 나온 경로입니다.
  // 맥락이 여기서 끊기면 같은 사진을 다시 올리게 되므로(app/reuseFromJob.ts) 카드
  // 링크와 W-03 시트로 그대로 넘깁니다.
  const reuse = useReuseFromJob()

  // W-03 시트가 이 화면 위에 렌더됩니다(routes.tsx). 시트가 떠 있는 동안
  // 뒤 그리드는 탭 이동·스크린리더 대상에서 빠져야 모달로서 성립합니다.
  const sheetOpen = useMatch('/styles/:styleId') !== null

  const sectionRefs = useRef(new Map<string, HTMLElement>())
  const anchorBarRef = useRef<HTMLElement>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const sectionNames = useMemo(
    () => catalog?.sections.map((section) => section.name) ?? [],
    [catalog],
  )

  // 칩과 섹션이 같은 자리를 읽습니다 — 왜 한 곳에서 만드는지는 screens/sectionAnchor.ts.
  const anchorIds = useMemo(() => sectionAnchorIds(sectionNames), [sectionNames])

  /*
    노트3 — 스크롤 위치로 활성 칩을 정합니다.

    «활성» 의 정의는 **고정 바 바로 아래 첫 줄을 차지한 섹션** 입니다. 사용자가 화면
    맨 위에서 읽고 있는 것이 그것이고, 칩이 가리켜야 하는 것도 그것입니다.

    원래는 IntersectionObserver 에 `rootMargin: '-96px 0px -70% 0px'` 를 걸어 «위에서
    30% 안에 걸친 섹션» 을 활성으로 삼았습니다. 그 30% 는 뷰포트 높이에 비례하므로
    창이 클수록 경계가 아래로 내려갑니다 — 1440×900 PC 에서 재 보면 다음 섹션이 아직
    130px 아래에 있는데 칩은 이미 넘어가 있습니다. 화면 위쪽은 이전 섹션 카드인데 칩만
    다음 것을 가리키니 «탭이 한 칸씩 밀린다» 로 읽힙니다.

    그래서 비율 대신 **앵커바의 실제 아래 끝**을 기준선으로 씁니다. 앱바 높이가 글꼴
    설정이나 배너 때문에 달라져도 같이 따라가므로, 여기에 57px 같은 상수를 다시 적어
    넣지 않아도 됩니다.
  */
  useEffect(() => {
    if (sectionNames.length === 0) return

    let frame = 0
    const pick = () => {
      frame = 0
      const barBottom = anchorBarRef.current?.getBoundingClientRect().bottom ?? 0
      // 기준선을 지난 **마지막** 섹션이 화면 맨 위를 차지한 섹션입니다. 아직 아무것도
      // 지나지 않았으면(맨 위) 첫 섹션을 가리킵니다.
      let current = sectionNames[0]
      for (const name of sectionNames) {
        const element = sectionRefs.current.get(name)
        if (!element) continue
        /*
          기준선은 앵커바 아래 끝이 아니라 «섹션이 점프 후 **멈추는 자리**» 입니다.

          바 아래 끝만 쓰면 칩을 눌러도 그 칩이 안 켜집니다 — `scroll-mt-28`(112px)이
          바 아래 끝(측정값 104px)보다 8px 아래라, 점프가 끝난 순간 섹션 top 은 아직
          기준선을 안 지난 상태입니다. 화면은 분명히 «컨셉 사진관» 을 보여 주는데 칩은
          이전 섹션에 켜져 있고, 8px 을 더 굴려야 따라옵니다. 눌러도 아무 반응이 없는
          것처럼 보이는 자리라 이 화면이 원래 고치려던 증상과 같은 얼굴입니다.

          그래서 두 값 중 **아래쪽**을 씁니다. 여백 클래스를 바꿔도(scroll-mt-*) 여기를
          같이 고칠 필요가 없도록 상수 대신 요소에서 읽습니다.
        */
        const resting = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
        if (element.getBoundingClientRect().top <= Math.max(barBottom, resting) + 1) current = name
      }
      setActiveSection(current)
    }
    // 스크롤마다 레이아웃을 읽으므로 프레임당 한 번으로 접습니다.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(pick)
    }

    pick()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [sectionNames])

  if (isPending) {
    return (
      <Shell sheetOpen={sheetOpen}>
        <CatalogSkeleton />
      </Shell>
    )
  }

  if (isError) {
    return (
      <Shell sheetOpen={sheetOpen}>
        <div className="mx-auto max-w-md px-5 py-16 text-center">
          <p className="text-ink-2">스타일을 불러오지 못했습니다.</p>
          <p className="mt-1 font-mono text-xs text-ink-3">{error.message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
          >
            다시 시도
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell sheetOpen={sheetOpen}>
      <div className="min-h-full bg-paper pb-24">
        {/* 앱바 — 크레딧 배지의 표시 규칙(ADR-02 음수·미상 처리)은 app/CreditBadge.tsx 에 있습니다. */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
          {/*
            앱바의 마크는 파비콘과 같은 발바닥입니다 — apple-touch-icon 으로 이미
            받아 둔 파일을 그대로 재사용하므로(index.html) 요청이 늘지 않습니다.
            워드마크가 아니라 마크인 이유: 옆에 "스타일" 제목과 크레딧 배지가
            붙는 자리라 정사각 마크가 폭을 덜 먹습니다.

            누르면 랜딩(W-01)으로 갑니다 — 헤더 로고가 홈으로 가는 건 웹의 관습이고,
            탭바 4칸에는 랜딩이 없어서(«스타일»·«만들기»·«보관함»·누띠샵) 여기 말고는
            앱 안에서 랜딩으로 돌아갈 길이 없습니다.

            이름은 img 의 alt 가 아니라 링크의 aria-label 로 답니다. 마크 자체는 여전히
            장식이고(옆에 «스타일» 제목이 있습니다) 스크린리더가 읽어야 하는 건 그림이
            아니라 **이 링크가 어디로 가는지**입니다. -m-2 p-2 는 24px 마크의 탭 영역만
            40px 로 넓히고 여백은 되돌려 앱바 배치를 그대로 둡니다.
          */}
          <Link to="/" aria-label="누띠 놀이터 홈" className="-m-2 shrink-0 p-2 hover:opacity-70">
            <img src="/brand/favicon-180.png" alt="" width={24} height={24} className="size-6" />
          </Link>
          <h1 className="text-base font-bold">스타일</h1>
          <CreditBadge showUnit />
          {/* 숫자 = 크레딧 받기(W-10), 아바타 = 계정(W-12). 역할을 겹치지 않게 나눕니다. */}
          <AccountEntry />
        </header>

        {/* 앵커바 — 점프 전용(노트2). 눌러도 다른 섹션을 숨기지 않습니다. */}
        <nav
          ref={anchorBarRef}
          aria-label="섹션 바로가기"
          className="sticky top-[57px] z-10 flex gap-2 overflow-x-auto border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur"
        >
          {sectionNames.map((name, index) => (
            <a
              key={name}
              href={`#${anchorIds[index]}`}
              aria-current={activeSection === name ? 'true' : undefined}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm transition-colors ${
                activeSection === name
                  ? 'border-brand bg-brand text-paper'
                  : 'border-rule bg-surface text-ink-2 hover:border-brand-2 hover:text-brand'
              }`}
            >
              {name}
            </a>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-(--container-canvas) px-4">
          {reuse.context && <ReuseBanner context={reuse.context} />}

          {catalog.sections.map((section, index) => (
            <section
              key={section.name}
              id={anchorIds[index]}
              data-section={section.name}
              ref={(element) => {
                if (element) sectionRefs.current.set(section.name, element)
                else sectionRefs.current.delete(section.name)
              }}
              className="scroll-mt-28 pt-6"
            >
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-bold">{section.name}</h2>
                <span className="font-mono text-xs text-ink-3">{section.count}</span>
              </div>

              {/* 노트5 — 모바일 2열, 데스크톱 4열. */}
              <ul className="mt-3 grid grid-cols-2 gap-3 desktop:grid-cols-4">
                {section.styles.map((style) => (
                  <li key={style.id}>
                    <StyleCardItem style={style} reuseJobId={reuse.jobId} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="pt-8 text-center text-sm text-ink-3">전체 {catalog.total_count}개</p>

          {/* W-08 보조 진입점(FR-W08-01 노트1) — 커스텀 프롬프트는 기본 그리드에서
              분리합니다. 전면에 놓으면 초보자에게 학습곡선이 됩니다. */}
          {/* 재사용 중이면 여기도 같은 사진을 이어받습니다 — 이 링크만 맥락을 잃으면
              배너가 "사진 그대로"라고 말해 놓고 W-08 에서 사진을 다시 요구합니다. */}
          <Link
            to={withReuse('/creative', reuse.jobId)}
            className="mt-4 mb-8 block rounded-xl border border-rule px-4 py-3 text-center text-sm text-ink-2 hover:border-rule-strong hover:bg-surface-2 hover:text-ink"
          >
            원하는 걸 직접 써서 만들기 · {CUSTOM_PROMPT_COST_ESTIMATE} 크레딧
          </Link>
        </main>
      </div>
    </Shell>
  )
}

/**
 * 카탈로그 본문 + 그 위에 뜨는 W-03 시트(Outlet). 로딩·에러 상태도 시트를 받습니다.
 *
 * 탭바를 여기 두는 이유: 카탈로그를 못 불러왔다고 보관함까지 갇히면 안 됩니다.
 * 세 상태(로딩·에러·정상)가 전부 이 껍데기를 지나므로 한 번만 답니다.
 * `inert` 안쪽인 것도 의도입니다 — 시트가 떠 있는 동안 탭바는 모달 밖이라
 * 탭 이동·스크린리더 대상에서 같이 빠져야 합니다.
 */
function Shell({ sheetOpen, children }: { sheetOpen: boolean; children: ReactNode }) {
  return (
    <>
      <div inert={sheetOpen}>
        {children}
        <TabBar />
      </div>
      <Outlet />
    </>
  )
}

/**
 * 재사용 중임을 카탈로그 상단에 못박습니다 — 배너가 없으면 "왜 이 화면이
 * 평소와 다르게 동작하지"(업로드를 안 물어봄)를 설명할 자리가 없습니다.
 *
 * 해제는 `from_job` 을 뗀 같은 주소입니다. 다른 화면으로 보내면 스타일을 고르던
 * 중이었다는 사실이 사라집니다.
 */
function ReuseBanner({ context }: { context: JobContext }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand-2 bg-brand-soft px-3 py-2.5">
      {context.sourceImageUrl && (
        <img
          src={context.sourceImageUrl}
          alt="다시 쓸 사진"
          className="size-11 shrink-0 rounded-lg bg-surface-2 object-cover"
        />
      )}
      <p className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold">올린 사진 그대로 만들어요</span>
        <span className="block text-xs text-ink-2">스타일만 고르면 바로 확인 단계예요</span>
      </p>
      <Link to="/styles" className="shrink-0 text-xs text-ink-3 underline underline-offset-2 hover:text-brand">
        다른 사진 쓰기
      </Link>
    </div>
  )
}

/** 리서치 인사이트2 — 카드 면적의 80% 이상이 적용 예시 이미지. */
function StyleCardItem({ style, reuseJobId }: { style: StyleCard; reuseJobId: string | null }) {
  return (
    <Link
      to={withReuse(`/styles/${style.id}`, reuseJobId)}
      className="block overflow-hidden rounded-lg border border-rule bg-surface hover:border-brand-2"
    >
      <div className="relative">
        <Thumbnail
          src={style.thumbnail_url}
          alt={style.name}
          // 39장이 한 페이지에 있으므로(카탈로그는 페이지네이션 없음) 지연 로드가 필수입니다.
          loading="lazy"
          decoding="async"
          className="aspect-square w-full bg-surface-2 object-cover"
        />
        {/*
          이름이 그림 안에 인쇄되는 스타일 (서버 `uses_pet_name` · 백엔드 #111).

          W-03 시트가 이미 같은 사실을 말하지만(PR #98) 그건 **고른 뒤**입니다. 이름이
          박히는 스타일을 찾아 온 사람은 39칸을 한 장씩 열어 봐야 알 수 있었습니다 —
          지금 시드에서 해당하는 건 39종 중 2종이라, 배지는 소음이 아니라 그 2종을
          한눈에 찾게 해 주는 표시입니다.

          이미지 위에 얹는 이유는 아래 메타 줄이 이미 «이름 + 비용» 으로 꽉 차 있기
          때문입니다(모바일 2열에서 카드 폭이 좁습니다). 여기에 칩을 하나 더 끼우면
          스타일 이름이 두세 글자로 잘립니다.
        */}
        {style.uses_pet_name && (
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-paper">
            이름 인쇄
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-sm font-semibold">{style.name}</span>
        {/*
          비용이 «1» 이라는 벌거벗은 숫자였습니다 — 무엇의 1 인지 카드 어디에도 없고,
          지금 시드는 39 종이 전부 1 이라 39 칸에 같은 숫자만 떠 있었습니다. 스크린리더
          사용자에게는 «3D 피규어, 1» 이라 더 나빴습니다.

          단위를 풀어 쓰는 대신 앱바 배지와 **같은 기호**(◆, app/CreditBadge.tsx)를 씁니다.
          모바일 2 열에서 카드 폭이 좁아 «1 크레딧» 을 넣으면 스타일 이름이 잘리는데,
          기호는 한 글자로 같은 뜻을 나르고 배지에서 이미 학습된 표시입니다. 읽어 주는
          말은 `sr-only` 로 온전히 남깁니다(배지와 같은 이유 — generic `<span>` 에는
          `aria-label` 이 붙지 않습니다).
        */}
        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-3">
          <span aria-hidden>◆ {style.credit_cost}</span>
          <span className="sr-only">{style.credit_cost} 크레딧</span>
        </span>
      </div>
    </Link>
  )
}

function CatalogSkeleton() {
  return (
    <div className="mx-auto w-full max-w-(--container-canvas) px-4 pt-6">
      <div className="h-6 w-24 rounded bg-rule" />
      <ul className="mt-3 grid grid-cols-2 gap-3 desktop:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="aspect-square animate-pulse rounded-lg bg-rule/60" />
        ))}
      </ul>
    </div>
  )
}
