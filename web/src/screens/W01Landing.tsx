/**
 * W-01 · 홈 (원페이지 갤러리) — 옛 랜딩(W-01)과 스타일 카탈로그(W-02)를 한 장으로 합쳤습니다.
 *
 * 왜 합쳤나: 스타일을 고르려고 «스타일 탭» 으로 한 번 더 들어가는 단계가 있었습니다.
 * 이제 첫 화면이 곧 갤러리입니다 — 히어로(비교 슬라이더) 아래에 **중앙 정렬 카테고리
 * 배지**로 필터를 걸고, 그 아래 그리드에서 바로 스타일을 고릅니다. 카드를 누르면
 * `/styles/:styleId` 상세 시트가 이 화면 위에 뜹니다(이 화면이 그 라우트의 부모라,
 * 시트가 떠도 뒤 그리드가 살아 있고 스크롤·필터가 보존됩니다).
 *
 * 옛 W-02 에서 그대로 가져온 계약(지우지 마세요):
 *   - 카드 면적의 대부분이 예시 이미지 (리서치 인사이트2)
 *   - 이름이 그림에 인쇄되는 스타일 배지 (`uses_pet_name`, 백엔드 #111)
 *   - 크레딧 비용은 카드에 유지 · 앱바 배지와 같은 ◆ 기호
 *   - 재사용 맥락(FR-W06-07)을 `from_job` 으로 나름 — 이때 히어로 대신 재사용 배너
 *   - 커스텀 프롬프트(W-08)는 그리드에서 분리된 보조 진입점
 *
 * 옛 W-01 에서 가져온 것:
 *   - before/after 비교 슬라이더가 히어로 (FR-W01-01 — «내 애가 유지된다» 를 첫 3초에)
 *   - 가입 없이 1장 — 주 CTA 는 로그인 없이 W-04 로 (노트2)
 *
 * 바뀐 것: 옛 W-02 의 sticky 앵커칩(섹션 점프)을 **필터 배지**로 교체했습니다. 배지는
 * 이제 나머지를 숨깁니다 — 「전체」가 기본이고, 카테고리를 누르면 그 섹션만 남습니다.
 *
 * 배지 아래에는 「인기 스타일로 시작하기」 진열대가 섭니다(아래 `PickedShelf`).
 * 39종을 한 번에 들이밀지 않고 «여기서 시작하세요» 를 세 장으로 말하는 자리입니다.
 */

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link, Outlet, useMatch } from 'react-router'
import { track } from '../app/analytics'
import { AccountEntry } from '../app/AccountEntry'
import { BrandLockup } from '../app/BrandLockup'
import { CreditBadge } from '../app/CreditBadge'
import { customPromptLinkLabel, useCustomPromptCost } from '../app/customPromptCost'
import { shopLink } from '../app/externalLinks'
import { useReuseFromJob, withReuse, type JobContext } from '../app/reuseFromJob'
import { useStyles } from '../api/queries'
import Thumbnail from '../app/Thumbnail'
import type { StyleCard } from '../api/types'

/**
 * 같은 강아지의 실제 원본/변환 한 쌍입니다 — 출처·가공은 `public/hero/NOTICE.md`.
 * 둘 다 4:3 · 1072×804 로 아래 프레임과 같은 비라 여기서 더 깎이지 않습니다.
 */
const HERO_BEFORE = '/hero/before.webp'
const HERO_AFTER = '/hero/after.webp'

/** null = 전체. 배지가 이 상태를 바꿉니다. */
type Filter = string | null

export default function W01Landing() {
  const { data: catalog, isPending, isError, error, refetch } = useStyles()

  // 재사용 맥락(FR-W06-07). 이때는 히어로 대신 재사용 배너를 세우고, 카드 링크가
  // `from_job` 을 이어받습니다 — 안 그러면 방금 쓴 사진을 다시 올리게 됩니다.
  const reuse = useReuseFromJob()
  const customPromptCost = useCustomPromptCost()

  // 상세 시트(W-03)가 이 화면 위에 렌더됩니다. 떠 있는 동안 뒤 그리드는 탭 이동·
  // 스크린리더 대상에서 빠져야 모달로서 성립합니다(아래 inert).
  const sheetOpen = useMatch('/styles/:styleId') !== null

  const [filter, setFilter] = useState<Filter>(null)

  // catalog 를 dep 으로 둡니다 — `catalog?.sections ?? []` 를 매 렌더 새로 만들면
  // 아래 두 useMemo 가 그 새 배열 때문에 매번 다시 도므로(참조가 바뀜) 메모가 무의미해집니다.
  const sections = useMemo(() => catalog?.sections ?? [], [catalog])
  const sectionNames = useMemo(() => sections.map((s) => s.name), [sections])

  // 전체 = 모든 섹션의 스타일을 한 그리드로. 카테고리 = 그 섹션만.
  const visible = useMemo<StyleCard[]>(() => {
    if (filter === null) return sections.flatMap((s) => s.styles)
    return sections.find((s) => s.name === filter)?.styles ?? []
  }, [sections, filter])

  return (
    <>
      <div inert={sheetOpen}>
        {/* 하단 탭바가 없어져(마이페이지로 통합) pb 는 순수 여백입니다. */}
        <div className="screen-min-h bg-paper pb-10">
          {/* 모바일 앱바 — 데스크톱은 상단 GNB(app/DesktopNav.tsx)가 같은 셋을 들어 내립니다.
              숫자 = 크레딧 받기(W-10), 아바타 = 계정(W-12), 로고 = 홈.

              배경은 페이지와 **같은 `bg-paper`** 이고 테두리도 없습니다(핀터레스트·carat 처럼
              헤더가 뜨지 않고 배경에 녹습니다). 흰 `bg-surface` + 아래 테두리이던 때는 크림
              페이지 위로 흰 띠가 떠서 갤러리보다 헤더가 먼저 눈에 들어왔습니다.

              높이 60px = `py-3.5`(14px) 두 번 + 내용 32px. 56px 이었는데 로고가 갑갑했습니다.
              데스크톱 GNB(64px)보다 낮은 건 의도입니다 — 모바일은 세로가 귀하고, 레퍼런스도
              모바일이 더 낮습니다(carat 52px). */}
          <header className="flex items-center gap-3 bg-paper px-5 desktop:px-7 py-3.5 desktop:hidden">
            <Link to="/" className="-m-2 mr-auto flex p-2">
              <BrandLockup className="text-base" />
            </Link>
            <CreditBadge showUnit />
            <AccountEntry />
          </header>

          <main className="mx-auto w-full max-w-(--container-canvas) px-5 desktop:px-7">
            {/* 재사용 중이면 히어로를 숨깁니다 — 이미 사진이 있는 사람에게 «사진 올리고
                무료로 1장» CTA 는 앞뒤가 안 맞습니다. 대신 재사용 배너를 세웁니다. */}
            {reuse.context ? (
              <ReuseBanner context={reuse.context} />
            ) : (
              <Hero />
            )}

            {/* 카테고리 배지 — 중앙 정렬(carat prompt-gallery 참고). 앵커 점프가 아니라
                필터입니다: 「전체」가 기본, 카테고리를 누르면 그 섹션만 남습니다. */}
            {!isError && (
              <nav
                aria-label="스타일 카테고리"
                className="flex flex-wrap justify-center gap-2 pt-8 desktop:pt-10"
              >
                <FilterBadge label="전체" active={filter === null} onClick={() => setFilter(null)} />
                {sectionNames.map((name) => (
                  <FilterBadge
                    key={name}
                    label={name}
                    active={filter === name}
                    onClick={() => setFilter(name)}
                  />
                ))}
              </nav>
            )}

            {/* 「전체」일 때만 섭니다 — 카테고리를 골랐는데 그 위에 다른 카테고리 카드가
                남아 있으면 방금 건 필터가 거짓말이 됩니다. */}
            {!isError && filter === null && <PickedShelf reuseJobId={reuse.jobId} />}

            {/* 그리드 */}
            <section className="pt-6">
              {isPending ? (
                <GridSkeleton />
              ) : isError ? (
                <div className="mx-auto max-w-md py-16 text-center">
                  <p className="text-ink-2">스타일을 불러오지 못했습니다.</p>
                  <p className="mt-1 font-mono text-xs text-ink-3">{error.message}</p>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="mt-4 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-brand-soft hover:text-brand"
                  >
                    다시 시도
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-lg font-bold">{filter ?? '전체 스타일'}</h2>
                    <span className="font-mono text-xs text-ink-3">{visible.length}</span>
                  </div>
                  {/* 모바일 2열 / 데스크톱 4열.
                      이름을 붙인 이유는 위 진열대(`PickedShelf`)와 **같은 카드가 겹치기**
                      때문입니다 — 겹침 자체는 의도지만(아래 PickedShelf), 그러면 화면에
                      같은 이름의 링크가 둘이 됩니다. 목록에 이름이 있어야 «전체에서 찾은
                      레고» 와 «진열대의 레고» 를 갈라 셀 수 있습니다(테스트·보조기기 둘 다). */}
                  <ul
                    aria-label="스타일 목록"
                    className="mt-4 grid grid-cols-2 gap-3 desktop:grid-cols-4 desktop:gap-4"
                  >
                    {visible.map((style) => (
                      <li key={style.id}>
                        <StyleCardItem style={style} reuseJobId={reuse.jobId} />
                      </li>
                    ))}
                  </ul>

                  {/* W-08 보조 진입점 — 커스텀 프롬프트는 기본 그리드에서 분리합니다. */}
                  <Link
                    to={withReuse('/creative', reuse.jobId)}
                    className="mt-6 mb-8 block rounded-2xl bg-rule px-4 py-3 text-center text-sm text-ink-2 hover:bg-rule-strong hover:text-ink"
                  >
                    {customPromptLinkLabel(customPromptCost)}
                  </Link>
                </>
              )}
            </section>

            {/*
              누띠샵(쇼핑몰) 유입구 — 마이페이지 링크는 회원만 보므로, 게스트가 대다수인
              이 놀이터에서 게스트도 보이는 자리가 여기입니다. 주 CTA(«무료로 1장»)와
              경쟁하지 않게 갤러리 맨 아래 가벼운 링크로 둡니다. 위젯이 붙기 전까지의
              게스트 유입 경로입니다.

              **«더 둘러보기» 라고 쓰지 마세요.** 바로 위가 스타일 그리드라 그 «더» 가
              «누띠샵에 스타일이 더 있다» 로 읽힙니다 — 누띠샵은 강아지 수제간식 쇼핑몰이라
              누르는 순간 기대와 다른 것이 나오고, 그건 유입이 아니라 즉시 이탈입니다.
              그래서 W-06 결과 배너와 **같은 말**로 파는 물건을 이름에 넣습니다
              (screens/W06Result.tsx `SHOP_BANNER`). 효능(관절·면역 등) 단정 표현은 여기서도
              금지입니다 — FR-W06-11 · NFR-LEGAL-01.

              재사용 흐름(`from_job`) 중에는 숨깁니다 — 히어로를 숨기는 것과 같은 이유로,
              사진을 이어 만드는 한복판에 앱 밖으로 나가는 문을 열지 않습니다. GA4 는
              `utm_content=home` 으로 마이페이지 유입과 갈라 셉니다.
            */}
            {!reuse.jobId && (
              <footer className="pt-4 pb-10 text-center desktop:pb-4">
                <a
                  href={shopLink('home')}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() =>
                    track({ event_type: 'shop_exit_click', properties: { from: 'home' } })
                  }
                  className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-brand"
                >
                  누띠 수제간식 보러가기 <span aria-hidden>↗</span>
                </a>
              </footer>
            )}
          </main>
        </div>
      </div>

      {/* 상세 시트(W-03). 뒤 그리드는 위 inert 로 잠급니다. */}
      <Outlet />
    </>
  )
}

// ---------------------------------------------------------------- 히어로

function Hero() {
  return (
    <section className="grid gap-4 pt-6 desktop:grid-cols-2 desktop:items-center desktop:gap-x-12 desktop:gap-y-8 desktop:pt-10">
      {/* 히어로만 display 서체. 큰 글씨에서만 브랜드로 읽힙니다. */}
      <h1 className="font-display text-3xl leading-tight desktop:col-start-1 desktop:row-start-1 desktop:self-end desktop:text-5xl">
        우리 강아지를 레고로,
        <br />
        초상화로, 프라모델로
      </h1>

      {/* 데스크톱에서는 4:3 프레임 폭을 남은 높이에서 역산해 첫 화면이 스크롤 없이 들어오게 합니다. */}
      <div className="desktop:col-start-2 desktop:row-span-2 desktop:row-start-1 desktop:mx-auto desktop:w-[min(100%,max(308px,(100dvh_-_520px)*4/3))]">
        <BeforeAfterSlider />
      </div>

      <div className="desktop:col-start-1 desktop:row-start-2 desktop:w-fit desktop:self-start">
        {/* 노트2 — 조사한 모든 서비스가 가입을 먼저 요구했습니다. 여기서 웹의 우위를 씁니다. */}
        <Link
          to="/upload"
          onClick={trackCtaClick}
          className="block rounded-2xl bg-brand px-5 py-3.5 text-center text-base font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] desktop:inline-block desktop:px-7"
        >
          사진 올리고 무료로 1장 만들기
        </Link>
        {/* 노트4 — 고양이 보호자가 업로드했다가 실망하기 전에 여기서 말합니다. */}
        <p className="mt-2 text-center text-sm text-ink-3">가입 없이 · 전부 무료 · 강아지 전용</p>
      </div>
    </section>
  )
}

/**
 * FR-W01-06 — 이 화면의 지표는 업로드 완료율이고, 그 **분모**가 이 클릭입니다.
 * 비콘 실패는 endpoints.ts 에서 삼키므로 이동을 막지 않습니다.
 */
function trackCtaClick() {
  track({ event_type: 'landing_cta_click', properties: { screen: 'W-01' } })
}

// ---------------------------------------------------------------- 진열대

/** 진열대에 세우는 장수. 서버도 목도 `limit` 을 그대로 받습니다. */
const SHELF_COUNT = 3

/**
 * 「인기 스타일로 시작하기」 — 39종 그리드 앞에 세 장만 먼저 세우는 진열대입니다.
 *
 * **「인기」는 아직 아무도 세지 않은 말입니다. 알고 쓰는 것입니다.** 데이터는
 * `GET /v1/styles?section=popular` 에서 오는데, 그 `popular` 은 집계가 아닙니다 — 백엔드가
 * «별도 컬럼/플래그 없이 `sort_order` 재사용» 이라고 적어 둔 대로(app/routers/styles.py)
 * 운영이 W-11 에서 정한 **진열 순서**의 상위 N 개입니다. 그래서 지금 이 제목은 «많이 쓰인
 * 것» 이 아니라 «우리가 앞에 둔 것» 을 가리킵니다. 사용량 집계가 붙기 전까지는 이 차이를
 * 아는 채로 두세요 — 순위·«N명이 만들었어요» 같은 **수치를 여기 덧붙이면** 그 순간 세지도
 * 않은 숫자를 말하게 됩니다. 백엔드에 집계가 생기면 그때 제목이 참말이 됩니다.
 *
 * **「둘러보기」·「구경하기」·「탐색하기」를 쓰지 마세요.** 셋 다 «많은 것 사이를 돌아다니기»
 * 라서 세 장(`SHELF_COUNT`) 앞에 붙으면 말과 물건이 어긋납니다. 진열대를 열 장쯤으로
 * 늘리는 날에는 그때 돌아다니는 말로 바꿔도 됩니다.
 *
 * 「시작하기」인 이유는 규모를 말하지 않기 때문입니다 — 세 장이든 열 장이든 «여기서
 * 출발하세요» 는 참이고, 히어로 CTA(「사진 올리고 무료로 1장 만들기」)를 그냥 지나친
 * 사람에게 주는 두 번째 진입로라 역할과도 맞습니다.
 *
 * 다만 이건 **제목이지 버튼이 아닙니다.** 문구가 행동을 부르는 꼴이라 더 조심해야 합니다 —
 * 누를 것처럼 보이게 만들지 마세요(밑줄·화살표·테두리 금지). 누를 것은 아래 카드입니다.
 *
 * **`section: 'popular'` 을 꼭 서버에 물어야 합니다.** 이미 받아 둔 카탈로그의 앞 세 개를
 * 잘라 쓰고 싶어지지만, 그건 «첫 번째 섹션의 상위» 라서 «전체의 상위» 와 다릅니다. 목이
 * 그 함정을 주석으로 못박아 뒀습니다(mocks/handlers.ts `popular`) — 실서버에서 다른
 * 스타일이 오는데 목에서는 아무 문제가 안 보이는 종류의 차이입니다.
 *
 * **아래 전체 그리드와 카드가 겹칩니다. 의도입니다.** 빼면 「전체 스타일 39」가 36 이
 * 되어 이름과 숫자가 둘 다 거짓이 되고, 그 세 개를 찾던 사람이 전체에서 못 찾습니다.
 * 대신 **크기로** 갈랐습니다 — 진열대는 모바일에서 가로로 흐르는 큰 카드(폭 60%, 다음
 * 장이 잘려 보여 «옆에 더 있다» 가 읽힙니다), 데스크톱에서는 3열이라 전체 그리드(4열)보다
 * 큽니다. 같은 격자에 같은 카드를 두 번 그리면 그건 구분이 아니라 버그로 보입니다.
 */
function PickedShelf({ reuseJobId }: { reuseJobId: string | null }) {
  const { data, isPending } = useStyles({ section: 'popular', limit: SHELF_COUNT })
  const picked = data?.sections[0]?.styles ?? []

  // 실패하거나 비어 있으면 진열대 자체를 접습니다 — 홈의 주인공은 아래 그리드라,
  // 빈 선반이나 오류 문구를 세워 두는 것보다 없는 편이 낫습니다. 다만 **도착 전에는**
  // 접지 않습니다. 뒤늦게 끼어들면 이미 그리드를 보던 사람의 화면이 아래로 밀립니다.
  if (!isPending && picked.length === 0) return null

  return (
    <section className="pt-8 desktop:pt-10">
      <h2 className="text-lg font-bold">인기 스타일로 시작하기</h2>
      {isPending ? (
        <ul
          aria-hidden
          className="mt-4 flex gap-3 desktop:grid desktop:grid-cols-3 desktop:gap-4"
        >
          {Array.from({ length: SHELF_COUNT }, (_, i) => (
            <li
              key={i}
              className="aspect-square w-[60%] shrink-0 animate-pulse rounded-2xl bg-rule/60 desktop:w-auto"
            />
          ))}
        </ul>
      ) : (
        /* 가장자리까지 흘리려고 `main` 의 좌우 여백(px-5)을 되돌렸다가 안쪽으로 다시 줍니다 —
           카드가 화면 끝에서 잘려야 «가로로 더 있다» 가 보입니다. 데스크톱은 격자라 원복. */
        <ul
          aria-label="인기 스타일"
          className="mt-4 -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 desktop:mx-0 desktop:grid desktop:grid-cols-3 desktop:gap-4 desktop:overflow-visible desktop:px-0"
        >
          {picked.map((style) => (
            <li key={style.id} className="w-[60%] shrink-0 snap-start desktop:w-auto">
              <StyleCardItem style={style} reuseJobId={reuseJobId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- 배지 · 카드

function FilterBadge({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // 안 고른 배지는 hover 에서 **면까지** 바뀝니다 — 테두리와 글자만 바뀌던 때는
      // 흰 알약이 크림 페이지 위에서 그대로라 어느 배지 위에 있는지 잘 안 보였습니다.
      // 같은 화면의 「다시 시도」 버튼과 같은 짝입니다(brand-soft 면 · brand 글자 7.55:1).
      // 고른 배지는 hover 로 흔들지 않습니다 — 그건 상태 표시입니다(W-09 칩과 같은 규칙).
      className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? 'border-brand bg-brand text-paper'
          : 'border-rule bg-surface text-ink-2 hover:border-brand-2 hover:bg-brand-soft hover:text-brand'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * 재사용 중임을 그리드 위에 못박습니다 — 배너가 없으면 «왜 업로드를 안 물어보지» 를
 * 설명할 자리가 없습니다. 해제(다른 사진 쓰기)는 `from_job` 을 뗀 홈입니다.
 */
function ReuseBanner({ context }: { context: JobContext }) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-brand-2 bg-brand-soft px-3 py-2.5">
      {context.sourceImageUrl && (
        <img
          src={context.sourceImageUrl}
          alt="다시 쓸 사진"
          className="size-11 shrink-0 rounded-xl bg-surface-2 object-cover"
        />
      )}
      <p className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold">올린 사진 그대로 만들어요</span>
        <span className="block text-xs text-ink-2">스타일만 고르면 바로 확인 단계예요</span>
      </p>
      <Link to="/" className="shrink-0 text-xs text-ink-2 underline underline-offset-2 hover:text-brand">
        다른 사진 쓰기
      </Link>
    </div>
  )
}

/** 리서치 인사이트2 — 카드 면적의 대부분이 적용 예시 이미지. */
function StyleCardItem({ style, reuseJobId }: { style: StyleCard; reuseJobId: string | null }) {
  return (
    <Link
      to={withReuse(`/styles/${style.id}`, reuseJobId)}
      className="group block overflow-hidden rounded-2xl border border-rule bg-surface transition-shadow hover:border-brand-2 hover:shadow-md"
    >
      <div className="relative overflow-hidden">
        <Thumbnail
          src={style.thumbnail_url}
          alt={style.name}
          loading="lazy"
          decoding="async"
          className="aspect-square w-full bg-surface-2 object-cover motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-[1.04]"
        />
        {/* 이름이 그림 안에 인쇄되는 스타일 (서버 `uses_pet_name` · 백엔드 #111). */}
        {style.uses_pet_name && (
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-semibold text-paper">
            이름 인쇄
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-base font-bold">{style.name}</span>
        {/* 앱바 배지와 같은 ◆ 기호. 읽어 주는 말은 sr-only 로 온전히 남깁니다. */}
        <span className="shrink-0 font-mono text-xs tabular-nums text-accent">
          <span aria-hidden>◆ {style.credit_cost}</span>
          <span className="sr-only">{style.credit_cost} 크레딧</span>
        </span>
      </div>
    </Link>
  )
}

function GridSkeleton() {
  return (
    <>
      <div className="h-6 w-24 rounded bg-rule" />
      <ul className="mt-3 grid grid-cols-2 gap-3 desktop:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="aspect-square animate-pulse rounded-xl bg-rule/60" />
        ))}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------- 비교 슬라이더

const clamp = (value: number) => Math.min(100, Math.max(0, value))

/**
 * 노트1 · FR-W01-01 — "내 애가 유지된다"를 첫 3초에 증명하는 장치.
 *
 * - 프레임 아무 데나 눌러도 그 지점으로 이동합니다(노브를 정확히 집게 하면 모바일 첫 시도가 실패).
 * - `touch-action: pan-y` — 가로 드래그는 우리가 먹고 세로 스크롤은 브라우저에 넘깁니다.
 * - 노브는 `role="slider"` 인 실제 버튼입니다(키보드·스위치 입력에서도 비교 가능).
 */
function BeforeAfterSlider() {
  // 65 는 지금 두 사진에 맞춘 값입니다(사진을 갈면 다시 봐야 함 — public/hero/NOTICE.md).
  const [position, setPosition] = useState(65)
  /*
    «지금 잡고 있다» 를 CSS `:active` 가 아니라 상태로 듭니다.

    드래그를 받는 것은 노브가 아니라 **프레임**이고(프레임 아무 데나 눌러도 노브가 그리로
    옵니다), 누른 뒤에는 프레임이 포인터를 캡처합니다. 그래서 손가락이 노브 밖으로 나가는
    순간 — 끌면 거의 항상 나갑니다 — `:active` 도 `:hover` 도 노브에서 떨어집니다.
    잡은 표시가 끄는 도중에 꺼지면 그건 잡았다는 느낌의 반대입니다.
  */
  const [dragging, setDragging] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)

  function moveToClientX(clientX: number) {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    setPosition(clamp(((clientX - rect.left) / rect.width) * 100))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    moveToClientX(event.clientX)
    setDragging(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 캡처 없이도 프레임 안에서의 드래그는 동작합니다.
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveToClientX(event.clientX)
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    // 캡처 여부와 무관하게 끕니다 — 캡처가 실패한 환경(위 catch)에서도 손을 뗀 것은
    // 사실이고, 여기서 안 끄면 잡은 표시가 화면에 남아 굳습니다.
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 10 : 5
    let next: number
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = position - step
        break
      case 'ArrowRight':
      case 'ArrowUp':
        next = position + step
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = 100
        break
      default:
        return
    }
    event.preventDefault()
    setPosition(clamp(next))
  }

  const rounded = Math.round(position)

  return (
    <div
      ref={frameRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      // 끄는 동안은 프레임 전체가 쥔 손입니다 — 손가락·커서가 노브를 벗어나도(끌면 거의
      // 항상 벗어납니다) 잡고 있다는 표시가 끊기지 않습니다.
      className={`relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-2xl bg-surface-2 select-none ${
        dragging ? 'cursor-grabbing' : ''
      }`}
    >
      <img
        src={HERO_AFTER}
        alt="변환 결과 예시 — 같은 흰 포메라니안이 파란 하늘을 나는 모습으로 바뀐 사진"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
      />
      {/* 원본을 위에 얹고 왼쪽만 남깁니다 — 노브 왼쪽이 원본, 오른쪽이 변환. */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img
          src={HERO_BEFORE}
          alt="원본 사진 예시 — 침대 위에 엎드린 흰 포메라니안 사진"
          draggable={false}
          className="size-full object-cover"
        />
      </div>

      <span className="absolute bottom-2 left-2 rounded-full bg-ink/70 px-2 py-0.5 text-xs text-paper">
        원본
      </span>
      <span className="absolute right-2 bottom-2 rounded-full bg-ink/70 px-2 py-0.5 text-xs text-paper">
        변환
      </span>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-paper"
        style={{ left: `${position}%` }}
      />

      <button
        type="button"
        role="slider"
        aria-label="원본과 변환 결과 비교"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`원본 ${rounded}%`}
        onKeyDown={handleKeyDown}
        style={{ left: `${position}%` }}
        /*
          잡은 동안의 표시 넷을 한꺼번에 겁니다 — 면이 브랜드 톤으로 물들고, 살짝 줄고,
          그림자가 얕아져 «눌려 들어간» 것처럼 보이고, 커서가 쥔 손이 됩니다.

          `left` 는 전환 대상이 아니라(index.css 의 목록에 없습니다) 손가락을 즉시
          따라오고, `transform`(축소)만 150ms 로 부드럽게 붙습니다. 위치가 늦게 따라오면
          그건 잡은 느낌이 아니라 느린 느낌입니다.

          축소는 `motion-safe:` 안에 둡니다 — 움직임을 줄여 달라고 한 사람에게는 색과
          그림자만으로 같은 말을 합니다(집안 규칙).

          커서는 전역 규칙이 버튼에 깔아 둔 `pointer` 를 덮습니다(index.css 「커서」).
          잡아 끄는 것에는 손가락표보다 쥔 손이 맞고, W-06 의 `type="range"` 가
          `ew-resize` 를 자기 자리에서 지정한 것과 같은 예외입니다.
        */
        className={`absolute top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-sm ${
          dragging
            ? 'cursor-grabbing border-brand-2 bg-brand-soft text-brand shadow-sm motion-safe:scale-95'
            : 'cursor-grab border-rule-strong bg-paper text-ink-2 shadow-md hover:border-brand-2 hover:text-brand'
        }`}
      >
        <span aria-hidden>↔</span>
      </button>
    </div>
  )
}
