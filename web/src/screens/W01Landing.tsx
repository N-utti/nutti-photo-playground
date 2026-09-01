/**
 * W-01 · 랜딩 (docs/wireframe-spec-v0.5.html#p01)
 *
 * 반영한 노트:
 *   1. 비교 슬라이더가 히어로 — 정적 이미지가 아니라 **드래그되는** before/after
 *   2. 가입 없이 1장 — 주 CTA 는 로그인 없이 바로 W-04 로 갑니다
 *   3. 누띠 브랜드를 헤더에 노출
 *   4. "강아지 전용"을 보조 문구에 명시
 *   5. 인기 스타일 프리뷰는 한 줄 — 모바일 3 / 데스크톱 5
 *
 * 로그인 진입점(FR-W01-05)은 PR #21 로 3종 authorize 가 200 `{authorize_url}` 이 되면서
 * 열렸습니다 — 그전에는 누르면 100% 401 이라 아예 빼 뒀습니다. 다만 **보조**입니다:
 * 주 CTA 는 여전히 로그인 없이 W-04 로 가고(노트2), 로그인은 헤더 구석에 둡니다.
 *
 * 빠진 것과 그 이유:
 *
 * - **"요금" 메뉴(FR-W01-07)**. 07-decisions.md errata E-04 가 v0.2 잔재로 판정하고
 *   제거 대상으로 확정했습니다(크레딧 판매 OFF).
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'react-router'
import { track } from '../app/analytics'
import { useMe, useStyles } from '../api/queries'
import { memberLabel } from '../app/memberIdentity'
import { TabBar } from '../app/TabBar'
import Thumbnail from '../app/Thumbnail'
import type { StyleCard } from '../api/types'
import AccountSheet from './AccountSheet'

/**
 * 같은 강아지의 실제 원본/변환 한 쌍입니다 — 자리표시자 도형이던 `*.svg` 를 대체했고,
 * 출처와 가공 내역은 `public/hero/NOTICE.md` 에 있습니다.
 *
 * 둘 다 **3:2 · 1200×800** 으로 맞춰 뒀습니다. 아래 프레임이 4:3 이고 `object-cover`
 * 라 좌우가 깎이는데, 비가 서로 다르면 한 장만 더 깎여 두 사진의 눈높이가 어긋납니다.
 */
const HERO_BEFORE = '/hero/before.webp'
const HERO_AFTER = '/hero/after.webp'

/** 모바일 3 / 데스크톱 5(FR-W01-04). 요청은 5개로 하고 모바일에서 뒤 2개를 숨깁니다. */
const PREVIEW_COUNT = 5
const MOBILE_PREVIEW_COUNT = 3

export default function W01Landing() {
  const { data, isPending, isError } = useStyles({ section: 'popular', limit: PREVIEW_COUNT })
  const { data: me } = useMe()
  const [loginSheet, setLoginSheet] = useState(false)
  const popular = data?.sections[0]?.styles ?? []

  return (
    // pb-24 — 아래 고정된 탭바가 페이지 마지막 줄을 덮지 않게 자리를 비웁니다
    // (W-02·W-09 와 같은 값). 여백을 안 두면 "인기 스타일" 마지막 행이 탭바 뒤에
    // 깔려 스크롤을 끝까지 내려도 안 보입니다.
    <div className="min-h-full bg-paper pb-24">
      {/* 노트3 — 이 사이트가 누띠의 것임을 처음부터 밝힙니다. */}
      <header className="flex items-center gap-2 border-b border-rule bg-surface px-4 py-3">
        {/*
          쇼핑몰 헤더에 걸린 것과 같은 NUTTi 워드마크입니다(출처·라이선스는
          public/brand/NOTICE.md). 서체로 흉내 내지 않고 로고 원본을 씁니다 —
          커스텀 레터링이라 Ohsquare 로 조판하면 다른 글자가 됩니다.

          alt 는 "누띠" 한 단어입니다. 뒤에 오는 "놀이터"와 이어져 스크린리더가
          "누띠 놀이터"로 읽습니다. width/height 는 고유비(35:9) 그대로 — 로고가
          늦게 와도 헤더가 밀리지 않게 자리를 미리 잡습니다.
        */}
        {/*
          워드마크 + "놀이터"를 통째로 홈 링크로 묶습니다. 이 화면이 이미 `/` 라서
          누르면 제자리지만, 로고가 눌리는 게 웹의 관습이고 W-02 앱바 마크와도
          같은 규칙이 됩니다(그쪽은 실제로 여기로 옵니다).

          img 하나가 아니라 둘 다 감싸는 이유는 접근성 이름입니다 — 링크 이름은
          내용에서 계산되므로 이렇게 묶어야 "누띠 놀이터" 한 덩어리로 읽힙니다.
          img 만 감싸면 "누띠" 링크 옆에 "놀이터"가 떨어져 나옵니다.
        */}
        <Link to="/" className="-m-2 flex items-center gap-2 p-2 hover:opacity-70">
          <img src="/brand/nutti-wordmark.svg" alt="누띠" width={70} height={18} className="h-3.5 w-auto" />
          <span className="font-display text-base">놀이터</span>
        </Link>
        <nav className="ml-auto flex items-center gap-4" aria-label="주요">
          <Link to="/styles" className="hidden text-sm text-ink-2 hover:text-ink desktop:block">
            스타일
          </Link>
          {/*
            FR-W01-05 로그인 칩. `/me` 가 오기 전에는 아무것도 그리지 않습니다 —
            게스트로 깜빡였다가 "○○님"으로 바뀌면 회원이 매 방문마다 로그아웃된 것처럼
            보입니다.
          */}
          {me?.kind === 'member' ? (
            // 로그아웃·펫 관리·연동은 이제 마이페이지(W-12)의 것입니다. 랜딩 헤더는
            // 그 문으로만 남습니다 — 이 라벨이 곧바로 로그아웃이던 임시 상태를 끝냅니다.
            <Link to="/me" className="max-w-32 truncate text-sm text-ink-2 underline hover:text-brand">
              {memberLabel(me)}
            </Link>
          ) : me?.kind === 'guest' ? (
            <button
              type="button"
              onClick={() => setLoginSheet(true)}
              className="rounded-full border border-rule-strong px-3 py-1.5 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
            >
              로그인
            </button>
          ) : null}
        </nav>
      </header>

      {loginSheet && (
        <AccountSheet
          onClose={() => setLoginSheet(false)}
          description="로그인하면 만든 결과가 보관함에 쌓이고, 크레딧을 이어서 쓸 수 있어요."
        />
      )}

      <main className="mx-auto w-full max-w-(--container-canvas) px-4">
        {/* 모바일은 헤드라인 → 슬라이더 → CTA 세로 순서, 데스크톱은 좌(문구·CTA)/우(슬라이더). */}
        <section className="grid gap-4 pt-6 desktop:grid-cols-2 desktop:items-center desktop:gap-12 desktop:pt-14">
          {/* 히어로만 display 서체를 씁니다. Ohsquare 는 굵고 둥글어서 큰 글씨에서만
              브랜드로 읽히고, 앱바 h1(text-base)에 쓰면 밀도만 나빠집니다. */}
          <h1 className="font-display text-3xl leading-tight desktop:col-start-1 desktop:row-start-1 desktop:self-end desktop:text-5xl">
            우리 애를 레고로,
            <br />
            초상화로, 우주비행사로
          </h1>

          <div className="desktop:col-start-2 desktop:row-span-2 desktop:row-start-1">
            <BeforeAfterSlider />
          </div>

          {/* 데스크톱에서 왼쪽 두 행의 높이 합은 오른쪽 슬라이더(row-span-2)가 정합니다.
              각 행이 기본값(center)이면 헤드라인과 CTA 가 자기 행 한가운데로 흩어져
              사이가 화면 높이만큼 벌어집니다 — 헤드라인은 아래로, CTA 는 위로 붙여
              가운데에서 만나게 합니다. 모바일(1열)에는 영향이 없습니다. */}
          <div className="desktop:col-start-1 desktop:row-start-2 desktop:self-start">
            {/* 노트2 — 조사한 모든 서비스가 가입을 먼저 요구했습니다. 여기서 웹의 우위를 씁니다. */}
            <Link
              to="/upload"
              onClick={trackCtaClick}
              className="block rounded-xl bg-brand px-5 py-3.5 text-center text-base font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] desktop:inline-block desktop:px-7"
            >
              사진 올리고 무료로 1장 만들기
            </Link>
            {/* 노트4 — 고양이 보호자가 업로드했다가 실망하기 전에 여기서 말합니다. */}
            <p className="mt-2 text-center text-sm text-ink-3 desktop:text-left">
              가입 없이 · 전부 무료 · 강아지 전용
            </p>
          </div>
        </section>

        {/* 노트5 — 카탈로그를 암시하되 스크롤을 잡아먹지 않게 한 줄로 제한. */}
        <section className="pt-10 desktop:pt-16">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-bold">지금 인기 스타일</h2>
            <Link to="/styles" className="text-sm text-ink-2 underline hover:text-brand">
              전체 →
            </Link>
          </div>

          {/* 인기 목록이 실패해도 랜딩의 본 임무(CTA)는 살아 있어야 하므로 이 줄만 접습니다. */}
          {!isError && (
            <ul className="mt-3 grid grid-cols-3 gap-3 desktop:grid-cols-5">
              {isPending
                ? Array.from({ length: PREVIEW_COUNT }, (_, index) => (
                    <li key={index} className={index >= MOBILE_PREVIEW_COUNT ? 'hidden desktop:block' : undefined}>
                      <div className="aspect-square animate-pulse rounded-lg bg-rule/60" />
                    </li>
                  ))
                : popular.map((style, index) => (
                    <li
                      key={style.id}
                      className={index >= MOBILE_PREVIEW_COUNT ? 'hidden desktop:block' : undefined}
                    >
                      <PreviewCard style={style} />
                    </li>
                  ))}
            </ul>
          )}
        </section>
      </main>

      {/* 탭바의 «홈» 이 여기로 옵니다 — 목적지에 탭바가 없으면 탭을 누른 순간 나머지
          탭이 사라집니다(app/TabBar.tsx 주석). 헤더의 «스타일» 링크가 데스크톱에만
          보이는 것도 이걸로 메워집니다 — 모바일에서 카탈로그로 가는 길이 히어로
          CTA 아래 «전체 →» 하나였습니다. */}
      <TabBar />
    </div>
  )
}

/**
 * FR-W01-06 — 이 화면의 지표는 업로드 완료율이고, 그 **분모**가 이 클릭입니다.
 * 분자(업로드·job 생성)와 GA4 크로스도메인은 Phase 6 에서 한꺼번에 붙입니다.
 * 비콘 실패는 endpoints.ts 에서 삼키므로 이동을 막지 않습니다.
 */
function trackCtaClick() {
  track({ event_type: 'landing_cta_click', properties: { screen: 'W-01' } })
}

function PreviewCard({ style }: { style: StyleCard }) {
  return (
    <Link
      to={`/styles/${style.id}`}
      className="block overflow-hidden rounded-lg border border-rule bg-surface hover:border-brand-2"
    >
      {/* 이름이 바로 아래 있으므로 이미지가 없을 때 자리 표시자에 글자를 넣지 않습니다. */}
      <Thumbnail
        src={style.thumbnail_url}
        alt={style.name}
        loading="lazy"
        decoding="async"
        className="aspect-square w-full bg-surface-2 object-cover"
      />
      <div className="px-2 py-1.5">
        <span className="block truncate text-xs font-semibold">{style.name}</span>
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------- 비교 슬라이더

const clamp = (value: number) => Math.min(100, Math.max(0, value))

/**
 * 노트1 · FR-W01-01 — "내 애가 유지된다"를 첫 3초에 증명하는 장치.
 *
 * 구현 메모:
 * - 프레임 **아무 데나** 눌러도 그 지점으로 이동합니다. 노브를 정확히 집게 만들면
 *   모바일에서 첫 시도가 실패하고, 그러면 이 장치가 정적 이미지와 구별되지 않습니다.
 * - `touch-action: pan-y` — 가로 드래그는 우리가 먹고 세로 스크롤은 브라우저에 넘깁니다.
 *   여기서 `none` 을 주면 히어로 위에서 손가락을 올렸을 때 페이지가 안 내려갑니다.
 * - 노브는 `role="slider"` 인 실제 버튼입니다. 포인터가 없는 입력(키보드·스위치)에서도
 *   비교가 가능해야 하고, 그게 이 화면의 유일한 인터랙션이라 대체 수단이 없습니다.
 */
function BeforeAfterSlider() {
  // 50 이 아니라 65 입니다 — **지금 두 사진에 맞춘 값**입니다. 원본에서 강아지 얼굴이
  // 가운데보다 살짝 오른쪽에 있어서, 반으로 가르면 분할선이 하필 얼굴을 관통해
  // «원본» 쪽에 몸통만 남습니다. 첫 화면에서 증명해야 하는 게 «내 애가 유지된다»인데
  // (노트1) 정작 그 애 얼굴이 안 보이는 상태로 시작하는 셈입니다. 65 면 원본은 얼굴까지
  // 온전히, 변환은 피규어와 «NUTTi» 소품이 보입니다.
  //
  // 사진을 갈아 끼우면 이 값도 다시 봐야 합니다(public/hero/NOTICE.md).
  const [position, setPosition] = useState(65)
  const frameRef = useRef<HTMLDivElement>(null)

  function moveToClientX(clientX: number) {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    setPosition(clamp(((clientX - rect.left) / rect.width) * 100))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    // 먼저 위치를 옮기고 캡처를 잡습니다. 순서가 반대면 setPointerCapture 가 던지는
    // 환경(합성 이벤트 등)에서 탭 한 번이 통째로 무시됩니다.
    moveToClientX(event.clientX)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 캡처 없이도 프레임 안에서의 드래그는 동작합니다.
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    // 캡처를 잡고 있을 때만 = 누른 채 끌 때만 따라갑니다(마우스 호버로는 안 움직임).
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    moveToClientX(event.clientX)
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
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
      className="relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-xl border border-rule bg-surface-2 select-none"
    >
      <img
        src={HERO_AFTER}
        alt="변환 결과 예시 — 같은 강아지가 피규어가 되어 «KONG-I» 패키지와 함께 책상에 놓인 사진"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
      />
      {/* 원본을 위에 얹고 왼쪽만 남깁니다 — 노브 왼쪽이 원본, 오른쪽이 변환. */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img
          src={HERO_BEFORE}
          alt="원본 사진 예시 — 나무 데크 위에 엎드린 흰 강아지 사진"
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
        className="absolute top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-rule-strong bg-paper text-sm text-ink-2 shadow-md hover:border-brand-2 hover:text-brand"
      >
        <span aria-hidden>↔</span>
      </button>
    </div>
  )
}
