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
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useMatch } from 'react-router'
import { useStyles } from '../api/queries'
import { AccountEntry } from '../app/AccountEntry'
import { CreditBadge } from '../app/CreditBadge'
import { useReuseFromJob, withReuse } from '../app/reuseFromJob'
import { TabBar } from '../app/TabBar'
import Thumbnail from '../app/Thumbnail'
import type { JobContext } from '../api/jobContext'
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
  const [activeSection, setActiveSection] = useState<string | null>(null)

  const sectionNames = useMemo(
    () => catalog?.sections.map((section) => section.name) ?? [],
    [catalog],
  )

  // 노트3 — 스크롤 위치로 활성 칩을 정합니다. 앵커바 높이만큼 상단을 잘라내야
  // 헤더가 바 뒤에 가려진 섹션이 활성으로 잡히지 않습니다.
  useEffect(() => {
    if (sectionNames.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiveSection(visible.target.getAttribute('data-section'))
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    )
    for (const element of sectionRefs.current.values()) observer.observe(element)
    return () => observer.disconnect()
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
            className="mt-4 rounded-full border border-rule-strong px-4 py-2 text-sm"
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
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule/80 bg-surface/92 px-4 py-3 backdrop-blur-md">
          {/*
            앱바의 마크는 파비콘과 같은 발바닥입니다 — apple-touch-icon 으로 이미
            받아 둔 파일을 그대로 재사용하므로(index.html) 요청이 늘지 않습니다.
            워드마크가 아니라 마크인 이유: 옆에 "스타일" 제목과 크레딧 배지가
            붙는 자리라 정사각 마크가 폭을 덜 먹습니다. 장식이라 alt 는 빈 값.
          */}
          <img src="/brand/favicon-180.png" alt="" width={24} height={24} className="size-6" />
          <h1 className="text-base font-bold">스타일</h1>
          <CreditBadge showUnit />
          {/* 숫자 = 크레딧 받기(W-10), 아바타 = 계정(W-12). 역할을 겹치지 않게 나눕니다. */}
          <AccountEntry />
        </header>

        {/* 앵커바 — 점프 전용(노트2). 눌러도 다른 섹션을 숨기지 않습니다. */}
        <nav
          aria-label="섹션 바로가기"
          className="sticky top-[57px] z-10 flex gap-2 overflow-x-auto border-b border-rule/80 bg-paper/95 px-4 py-2.5 backdrop-blur-md"
        >
          {sectionNames.map((name) => (
            <a
              key={name}
              href={`#section-${name}`}
              aria-current={activeSection === name ? 'true' : undefined}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm transition-colors ${
                activeSection === name
                  ? 'border-brand bg-brand text-paper shadow-sm'
                  : 'border-rule/80 bg-surface/80 text-ink-2 hover:border-brand-2/45 hover:text-brand'
              }`}
            >
              {name}
            </a>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-(--container-canvas) px-4">
          {!reuse.context && (
            <section className="relative overflow-hidden pt-6 pb-2">
              <div aria-hidden className="absolute -right-12 -top-8 size-32 rounded-full bg-gold-soft/85 blur-2xl" />
              <p className="relative text-xs font-semibold tracking-[0.12em] text-brand-2">STYLE CATALOG</p>
              <div className="relative mt-1 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl leading-tight tracking-[-0.025em]">오늘은 어떤 모습으로<br className="desktop:hidden" /> 만나볼까요?</h2>
                  <p className="mt-1 text-sm text-ink-2">마음에 드는 결과 예시를 먼저 골라 보세요.</p>
                </div>
                <span className="rounded-full border border-brand-2/25 bg-surface/75 px-3 py-1.5 text-xs font-semibold text-brand">{catalog.total_count}가지 스타일</span>
              </div>
            </section>
          )}
          {reuse.context && <ReuseBanner context={reuse.context} />}

          {catalog.sections.map((section) => (
            <section
              key={section.name}
              id={`section-${section.name}`}
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
            className="group mt-6 mb-8 flex items-center justify-between rounded-2xl border border-dashed border-brand-2/45 bg-gold-soft/45 px-4 py-3.5 text-sm text-ink-2 transition hover:border-brand hover:bg-gold-soft"
          >
            <span><span className="block font-semibold text-ink">원하는 장면을 직접 만들고 싶다면</span><span className="mt-0.5 block text-xs">크리에이티브 모드 · 2 크레딧</span></span>
            <span aria-hidden className="grid size-8 place-items-center rounded-full bg-surface text-brand transition group-hover:translate-x-0.5">→</span>
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
      <Link to="/styles" className="shrink-0 text-xs text-ink-3 underline underline-offset-2">
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
      className="group block overflow-hidden rounded-2xl border border-rule/80 bg-surface shadow-[0_8px_18px_rgba(51,46,42,0.04)] transition duration-200 hover:-translate-y-1 hover:border-brand-2/50 hover:shadow-[0_16px_26px_rgba(51,46,42,0.11)] focus-visible:-translate-y-1"
    >
      <div className="relative overflow-hidden">
        <Thumbnail
          src={style.thumbnail_url}
          alt={style.name}
          // 68장이 한 페이지에 있으므로(카탈로그는 페이지네이션 없음) 지연 로드가 필수입니다.
          loading="lazy"
          decoding="async"
          className="aspect-square w-full bg-surface-2 object-cover transition duration-300 group-hover:scale-[1.045]"
        />
        <span className="absolute top-2 right-2 rounded-full bg-surface/90 px-2 py-1 text-[11px] font-semibold text-brand shadow-sm backdrop-blur-sm">
          {style.credit_cost} 크레딧
        </span>
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink/18 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="truncate text-sm font-semibold">{style.name}</span>
        <span aria-hidden className="text-sm text-brand-2 transition-transform duration-200 group-hover:translate-x-0.5">→</span>
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
