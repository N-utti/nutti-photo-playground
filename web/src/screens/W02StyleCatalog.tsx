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
import type { StyleCard } from '../api/types'

export default function W02StyleCatalog() {
  const { data: catalog, isPending, isError, error, refetch } = useStyles()

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
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
          <span className="size-6 rounded-full bg-rule-strong" aria-hidden />
          <h1 className="text-base font-bold">스타일</h1>
          <CreditBadge showUnit />
          {/* 숫자 = 크레딧 받기(W-10), 아바타 = 계정(W-12). 역할을 겹치지 않게 나눕니다. */}
          <AccountEntry />
        </header>

        {/* 앵커바 — 점프 전용(노트2). 눌러도 다른 섹션을 숨기지 않습니다. */}
        <nav
          aria-label="섹션 바로가기"
          className="sticky top-[57px] z-10 flex gap-2 overflow-x-auto border-b border-rule bg-paper/95 px-4 py-2 backdrop-blur"
        >
          {sectionNames.map((name) => (
            <a
              key={name}
              href={`#section-${name}`}
              aria-current={activeSection === name ? 'true' : undefined}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm transition-colors ${
                activeSection === name
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-surface text-ink-2'
              }`}
            >
              {name}
            </a>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-(--container-canvas) px-4">
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
                    <StyleCardItem style={style} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="pt-8 text-center text-sm text-ink-3">전체 {catalog.total_count}개</p>

          {/* W-08 보조 진입점(FR-W08-01 노트1) — 커스텀 프롬프트는 기본 그리드에서
              분리합니다. 전면에 놓으면 초보자에게 학습곡선이 됩니다. */}
          <Link
            to="/creative"
            className="mt-4 mb-8 block rounded-xl border border-rule px-4 py-3 text-center text-sm text-ink-2"
          >
            원하는 걸 직접 써서 만들기 · 2 크레딧
          </Link>
        </main>
      </div>
    </Shell>
  )
}

/** 카탈로그 본문 + 그 위에 뜨는 W-03 시트(Outlet). 로딩·에러 상태도 시트를 받습니다. */
function Shell({ sheetOpen, children }: { sheetOpen: boolean; children: ReactNode }) {
  return (
    <>
      <div inert={sheetOpen}>{children}</div>
      <Outlet />
    </>
  )
}

/** 리서치 인사이트2 — 카드 면적의 80% 이상이 적용 예시 이미지. */
function StyleCardItem({ style }: { style: StyleCard }) {
  return (
    <Link
      to={`/styles/${style.id}`}
      className="block overflow-hidden rounded-lg border border-rule bg-surface"
    >
      <img
        src={style.thumbnail_url}
        alt={style.name}
        // 68장이 한 페이지에 있으므로(카탈로그는 페이지네이션 없음) 지연 로드가 필수입니다.
        loading="lazy"
        decoding="async"
        className="aspect-square w-full bg-surface-2 object-cover"
      />
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-sm font-semibold">{style.name}</span>
        <span className="shrink-0 font-mono text-xs text-ink-3">{style.credit_cost}</span>
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
