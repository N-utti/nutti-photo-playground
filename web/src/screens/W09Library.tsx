/**
 * W-09 · 보관함 (docs/wireframe-spec-v0.5.html#p09)
 *
 * 반영한 노트:
 *   1. **강아지 단위 필터.** 날짜보다 "누구" 축이 먼저입니다 — 사람은 "지난달 것"이
 *      아니라 "콩이 것"을 찾습니다. 저장된 프로필은 W-07 추천으로도 이어지므로 필터가
 *      걸린 상태에서 계산기 진입을 함께 답니다(§2 W-07 의 `?pet_id=` 경로).
 *   2. **월 단위 섹션.** 무한 그리드는 사방이 똑같아서 자기 결과를 못 찾게 만듭니다.
 *      묶기는 서버가 해서 내려주고(`months[]`) 화면은 그대로 그립니다.
 *   3. **원본도 함께 보관.** 그리드는 결과 썸네일이지만 항목을 열면 W-06 이고, 거기에
 *      비교 슬라이더와 재생성 경로가 이미 있습니다 — 그래서 여기서 상세를 다시 만들지
 *      않고 `/jobs/{job_id}` 로 보냅니다(FR-W09-03).
 *   4. **삭제·일괄 저장은 롱프레스 선택 모드.** 기본 화면에 관리 버튼을 얹지 않습니다.
 *
 * 노트4 를 따르되 앱바에 «선택» 하나는 남깁니다. 롱프레스만으로는 키보드·보조기기
 * 사용자가 삭제에 도달할 방법이 아예 없고, 그리드를 더럽히지 않는 선에서 노트의 의도
 * (기본 화면은 사진만)를 지키는 타협점이 앱바이기 때문입니다.
 *
 * 필터는 `?pet_id=` 로 URL 에 답니다. 결과를 열었다가 뒤로 오면 보던 필터가 남아야 하고,
 * 이 앱은 화면 상태를 URL 로 복원하는 쪽을 이미 택했습니다(routes.tsx). 단 그 URL 이
 * **지워진 강아지**를 가리키면 복원하지 않고 «전체» 로 걷습니다 — 서버가 그 조회를 404 가
 * 아니라 빈 목록으로 답하는 계약이라(05-api-spec §3, 이슈 #33) 그대로 두면 결과가 없는
 * 강아지처럼 보입니다.
 *
 * **게스트 세션 리셋을 여기서도 받습니다**(이슈 #5). 재발급은 새 member_id 라 목록이
 * 200 + 빈 배열로 옵니다 — 에러가 아니라서 화면은 아무 일도 없었던 것처럼 «아직 보관된
 * 사진이 없어요»를 띄웁니다. 만든 적 있는 사람에게 그건 사실이 아니고, 결과가 사라진
 * 이유를 들을 곳이 앱 안에 사라집니다(그전까지 안내는 job URL 로 직접 들어온 W-05·W-06
 * 에만 있었습니다). 탭바로 들어온 사용자가 여기서 처음 만나므로 이 화면이 말해야 합니다.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useDeleteLibraryItems, useLibrary, useMe, usePets } from '../api/queries'
import { CreditBadge } from '../app/CreditBadge'
import { TabBar } from '../app/TabBar'
import { useGuestSessionReset } from '../app/guestSession'
import type { LibraryItem, LibraryMonth } from '../api/types'
import AccountSheet from './AccountSheet'

export default function W09Library() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlPetId = searchParams.get('pet_id') ?? undefined

  const { data: me } = useMe()
  const { data: petsData } = usePets()
  const pets = petsData?.items ?? []

  /*
    URL 에 남은 `?pet_id=` 가 **이미 지워진 강아지**를 가리킬 수 있습니다 — 필터를 건 채
    마이페이지에서 그 강아지를 지우고(FR-W12-03) 뒤로 오면 그 히스토리 항목이 그대로
    살아 있습니다. 서버는 이 조회를 404 가 아니라 빈 목록으로 답하므로(05-api-spec §3,
    이슈 #33) 그대로 두면 «이 강아지로 만든 결과가 아직 없어요»가 뜹니다 — 강아지는 이제
    없고 그 결과들은 `pet_id: null` 이 되어 «전체» 에 그대로 남아 있는데도요(이슈 #12
    결정4). 칩 줄에는 활성 항목이 하나도 없어 «전체» 마저 꺼져 보이고, 계산기 링크는
    존재하지 않는 펫을 가리킵니다. 그래서 없는 강아지 필터는 걷고 전체를 보여 줍니다.

    펫 목록이 도착하기 전에는 판단하지 않습니다 — 로딩 중의 빈 배열을 근거로 삼으면
    멀쩡한 필터가 매 진입마다 지워집니다.
  */
  const petGone =
    Boolean(urlPetId) && petsData !== undefined && !pets.some((pet) => pet.id === urlPetId)
  const petId = petGone ? undefined : urlPetId

  useEffect(() => {
    if (petGone) setSearchParams({}, { replace: true })
  }, [petGone, setSearchParams])

  /*
    회원일 때는 보지 않습니다 — 재발급 뒤 로그인하면 그 게스트 행이 승격·병합돼 결과가
    계정에 남으므로(UC-07), 리셋 사실을 계속 알리면 없어지지도 않은 것을 없어졌다고
    말하게 됩니다. `me` 가 아직 안 왔으면 잠시 뒤 뜨는 편이 낫습니다.
  */
  const guestReset = useGuestSessionReset() && me?.kind === 'guest'

  const library = useLibrary(petId)
  const months = mergeMonths(library.data?.pages ?? [])
  const items = months.flatMap((month) => month.items)

  // null = 선택 모드 아님. 빈 Set 과 구분해야 "다 해제했을 때"도 모드가 유지됩니다.
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [loginSheet, setLoginSheet] = useState(false)
  const remove = useDeleteLibraryItems()

  // 필터가 바뀌면 화면에 없는 항목이 선택에 남습니다 — 그 상태로 삭제를 누르면
  // 사용자가 보고 있지 않은 사진이 지워집니다.
  useEffect(() => {
    setSelected(null)
  }, [petId])

  function selectPet(next: string | undefined) {
    setSearchParams(next ? { pet_id: next } : {}, { replace: true })
  }

  function toggle(resultId: string) {
    setSelected((current) => {
      const next = new Set(current ?? [])
      if (next.has(resultId)) next.delete(resultId)
      else next.add(resultId)
      return next
    })
  }

  const selectedItems = items.filter((item) => selected?.has(item.result_id))

  return (
    <div className="min-h-full bg-canvas pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        {selected ? (
          <>
            <button type="button" onClick={() => setSelected(null)} className="text-sm text-ink-2">
              취소
            </button>
            <h1 className="text-base font-bold" aria-live="polite">
              {selectedItems.length}장 선택
            </h1>
          </>
        ) : (
          <>
            {/* 보관함은 탭 목적지라 뒤로가기가 없습니다(#p09) — 나가는 길은 아래 탭바입니다. */}
            <h1 className="text-base font-bold">보관함</h1>
            <div className="ml-auto flex items-center gap-3">
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-sm text-ink-2"
                >
                  선택
                </button>
              )}
              <CreditBadge />
            </div>
          </>
        )}
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {guestReset ? (
          <GuestResetNotice onLogin={() => setLoginSheet(true)} />
        ) : (
          me?.kind === 'guest' && <GuestNotice onLogin={() => setLoginSheet(true)} />
        )}

        <PetFilter pets={pets} value={petId} onChange={selectPet} />

        {library.isPending ? (
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="aspect-square animate-pulse rounded bg-canvas-rule/70" />
            ))}
          </div>
        ) : library.isError ? (
          <div className="mt-4 rounded-xl border border-rule bg-surface px-4 py-5 text-center">
            <p className="text-sm text-ink-2">보관함을 불러오지 못했어요.</p>
            <p className="mt-1 font-mono text-xs text-ink-3">{library.error.message}</p>
            <button
              type="button"
              onClick={() => library.refetch()}
              className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm"
            >
              다시 시도
            </button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            filtered={Boolean(petId)}
            reset={guestReset}
            onClearFilter={() => selectPet(undefined)}
          />
        ) : (
          <>
            {months.map((month) => (
              <section key={month.label} className="mt-5">
                <h2 className="text-sm text-ink-3">{month.label}</h2>
                <ul className="mt-2 grid grid-cols-3 gap-1.5">
                  {month.items.map((item) => (
                    <li key={item.result_id}>
                      <Tile
                        item={item}
                        selecting={selected !== null}
                        checked={selected?.has(item.result_id) ?? false}
                        onToggle={() => toggle(item.result_id)}
                        onLongPress={() => toggle(item.result_id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {library.hasNextPage && (
              <button
                type="button"
                onClick={() => void library.fetchNextPage()}
                disabled={library.isFetchingNextPage}
                className="mt-5 w-full rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {library.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </>
        )}
      </main>

      {/* 선택 모드에서는 탭바를 내립니다 — 같은 자리를 선택 바가 쓰고, 무엇보다
          "N장 고른 상태"로 다른 탭에 가면 그 선택이 갈 곳이 없습니다. */}
      {!selected && <TabBar />}

      {selected && (
        <SelectionBar
          items={selectedItems}
          pending={remove.isPending}
          failed={remove.isError}
          onDelete={() =>
            remove.mutate(
              selectedItems.map((item) => item.result_id),
              { onSuccess: () => setSelected(null) },
            )
          }
        />
      )}

      {loginSheet && (
        <AccountSheet
          onClose={() => setLoginSheet(false)}
          /* 리셋된 사람에게 "지금까지 만든 결과"는 이미 닿을 수 없는 것을 가리킵니다. */
          description={
            guestReset
              ? '로그인하면 앞으로 만드는 결과가 계정에 남아서, 브라우저를 바꿔도 열 수 있어요.'
              : '로그인하면 지금까지 만든 결과가 계정에 남아서, 다음에 다른 기기에서도 열 수 있어요.'
          }
        />
      )}
    </div>
  )
}

/**
 * 페이지 경계에서 같은 달이 두 번 나옵니다 — 커서가 월이 아니라 개수로 끊기기 때문에
 * 8월이 1페이지 끝과 2페이지 앞에 나뉘어 담깁니다. 그대로 그리면 «2026년 8월» 헤더가
 * 두 번 찍히므로 라벨로 이어 붙입니다(순서는 서버가 준 대로 유지).
 */
function mergeMonths(pages: { months: LibraryMonth[] }[]): LibraryMonth[] {
  const merged: LibraryMonth[] = []
  for (const page of pages) {
    for (const month of page.months) {
      const existing = merged.find((entry) => entry.label === month.label)
      if (existing) existing.items = [...existing.items, ...month.items]
      else merged.push({ label: month.label, items: [...month.items] })
    }
  }
  return merged
}

// ---------------------------------------------------------------- 필터 (FR-W09-01)

function PetFilter({
  pets,
  value,
  onChange,
}: {
  pets: { id: string; name: string }[]
  value: string | undefined
  onChange: (petId: string | undefined) => void
}) {
  // 강아지가 하나도 없으면 칩 줄은 «전체» 하나뿐이라 아무 일도 하지 않습니다.
  if (pets.length === 0) return null

  // 계산기 링크는 **칩으로 고를 수 있는 강아지**에만 답니다. 값만 보고 달면 지워진 펫을
  // 가리키는 `?pet_id=` 를 그대로 넘겨, 앱 밖 계산기로 없는 프로필을 들고 나가게 됩니다.
  const selectedPet = pets.find((pet) => pet.id === value)

  return (
    <>
      <div className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={!value} onClick={() => onChange(undefined)}>
          전체
        </Chip>
        {pets.map((pet) => (
          <Chip key={pet.id} active={value === pet.id} onClick={() => onChange(pet.id)}>
            {pet.name}
          </Chip>
        ))}
      </div>

      {/*
        노트1 — 저장된 프로필이 W-07 추천 정확도로 이어지는 자리입니다. 이 링크가 붙기
        전까지 `/calculator?pet_id=` 는 앱 안에서 도달할 수 없는 라우트였습니다.
      */}
      {selectedPet && (
        <Link
          to={`/calculator?pet_id=${encodeURIComponent(selectedPet.id)}`}
          className="mt-2 flex items-center justify-between rounded-xl border border-rule bg-surface px-4 py-2.5 text-sm"
        >
          이 강아지 간식량 계산하기
          <span aria-hidden className="text-ink-3">
            →
          </span>
        </Link>
      )}
    </>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
        active ? 'border-brand bg-brand text-paper' : 'border-rule bg-surface text-ink-2'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- 그리드 타일

/**
 * 롱프레스 판정.
 *
 * `pointer*` 로 잡으면 터치·마우스·펜이 한 벌로 처리됩니다. 스크롤 중 오발동이 이
 * 화면에서 특히 잦아서(그리드는 세로로 길게 넘깁니다) 움직이면 즉시 취소하고,
 * 길게 눌러 선택이 걸린 뒤 따라오는 click 은 삼켜야 결과 상세로 튀지 않습니다.
 */
const LONG_PRESS_MS = 450
const MOVE_TOLERANCE_PX = 10

function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  function clear() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }

  return {
    /** 롱프레스가 방금 걸렸는지 — 뒤따르는 click 을 취소할 때 봅니다. */
    fired,
    handlers: {
      onPointerDown(event: React.PointerEvent) {
        fired.current = false
        origin.current = { x: event.clientX, y: event.clientY }
        timer.current = window.setTimeout(() => {
          fired.current = true
          onLongPress()
        }, LONG_PRESS_MS)
      },
      onPointerMove(event: React.PointerEvent) {
        const start = origin.current
        if (!start) return
        const moved =
          Math.abs(event.clientX - start.x) > MOVE_TOLERANCE_PX ||
          Math.abs(event.clientY - start.y) > MOVE_TOLERANCE_PX
        if (moved) clear()
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    },
  }
}

function Tile({
  item,
  selecting,
  checked,
  onToggle,
  onLongPress,
}: {
  item: LibraryItem
  selecting: boolean
  checked: boolean
  onToggle: () => void
  onLongPress: () => void
}) {
  const longPress = useLongPress(onLongPress)
  const label = `${dayLabel(item.created_at)} 결과`

  const image = (
    <img
      src={item.image_url}
      alt=""
      loading="lazy"
      className="size-full rounded object-cover"
      draggable={false}
    />
  )

  if (selecting) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={label}
        className="relative block aspect-square w-full bg-canvas-2"
      >
        {image}
        <span
          aria-hidden
          className={`absolute inset-0 rounded ring-inset ${
            checked ? 'bg-brand/25 ring-2 ring-brand' : 'ring-1 ring-rule'
          }`}
        />
        <span
          aria-hidden
          className={`absolute right-1 top-1 grid size-5 place-items-center rounded-full text-[10px] font-bold ${
            checked ? 'bg-brand text-paper' : 'bg-surface/80 text-ink-3'
          }`}
        >
          {checked ? '✓' : ''}
        </span>
      </button>
    )
  }

  return (
    <Link
      to={`/jobs/${item.job_id}`}
      aria-label={label}
      {...longPress.handlers}
      onClick={(event) => {
        // 길게 눌러 선택 모드로 들어간 직후의 click. 막지 않으면 선택하자마자
        // 결과 화면으로 넘어가 버립니다.
        if (longPress.fired.current) event.preventDefault()
      }}
      className="block aspect-square bg-canvas-2"
    >
      {image}
    </Link>
  )
}

/** '2026-08-03T10:00:00+09:00' → '8월 3일'. Date 파싱은 시간대에 따라 하루 밀립니다. */
function dayLabel(createdAt: string): string {
  const [, month, day] = createdAt.slice(0, 10).split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

// ---------------------------------------------------------------- 선택 모드 (FR-W09-04)

function SelectionBar({
  items,
  pending,
  failed,
  onDelete,
}: {
  items: LibraryItem[]
  pending: boolean
  failed: boolean
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const disabled = items.length === 0 || pending

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-md gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void saveAll(items)}
            className="flex-1 rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold disabled:opacity-50"
          >
            저장
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(true)}
            className="flex-1 rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
          >
            삭제
          </button>
        </div>
        {failed && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.
          </p>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setConfirming(false)}
            className="absolute inset-0 cursor-default bg-ink/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-library-title"
            className="relative w-full rounded-t-2xl bg-surface p-5 desktop:max-w-sm desktop:rounded-2xl"
          >
            <h2 id="delete-library-title" className="text-base font-bold">
              {items.length}장을 삭제할까요?
            </h2>
            {/* 되돌릴 수 없다는 사실보다 "지금 받아 둘 수 있다"가 실제로 도움이 됩니다. */}
            <p className="mt-2 text-sm text-ink-2">
              지운 결과는 되돌릴 수 없어요. 필요하면 먼저 «저장»으로 사진을 받아 두세요.
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(false)
                onDelete()
              }}
              className="mt-4 w-full rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
            >
              {pending ? '삭제 중…' : '삭제'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="mt-2 w-full py-2 text-sm text-ink-3"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 일괄 저장.
 *
 * 브라우저에는 "여러 파일을 한 번에 받기"가 없어서 앵커를 순서대로 누르는 게 전부입니다.
 * 사이에 간격을 두는 이유는 연속 클릭을 팝업 차단이 묶어서 막기 때문입니다.
 *
 * **한계**: `download` 속성은 같은 출처(또는 `data:`)에서만 먹습니다. 결과 이미지가
 * 다른 출처의 CDN 에서 오면 브라우저가 저장 대신 그냥 엽니다 — `_blank` 를 붙인 건
 * 그 경우에 최소한 앱이 통째로 날아가지 않게 하려는 것입니다. 제대로 저장하려면
 * CDN 이 CORS 를 허용하거나 서버가 묶어서 내려줘야 합니다(백엔드 확인 필요).
 */
async function saveAll(items: LibraryItem[]): Promise<void> {
  for (const item of items) {
    const anchor = document.createElement('a')
    anchor.href = item.image_url
    anchor.download = `nutti-${item.result_id}.jpg`
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    await new Promise((resolve) => window.setTimeout(resolve, 300))
  }
}

// ---------------------------------------------------------------- 빈 상태 · 게스트

function EmptyState({
  filtered,
  reset,
  onClearFilter,
}: {
  filtered: boolean
  reset: boolean
  onClearFilter: () => void
}) {
  if (filtered) {
    return (
      <div className="mt-6 rounded-xl border border-rule bg-surface px-4 py-8 text-center">
        <p className="text-sm text-ink-2">이 강아지로 만든 결과가 아직 없어요.</p>
        <button
          type="button"
          onClick={onClearFilter}
          className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm"
        >
          전체 보기
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-xl border border-rule bg-surface px-4 py-8 text-center">
      {/*
        리셋 뒤에는 «아직 없어요»가 거짓말이 됩니다 — 만든 적 있는 사람에게 그 문장은
        서비스가 잃어버린 일을 본인 착각으로 돌립니다. 이유·로그인 유도는 위 배너가
        이미 말했으므로 여기서는 반복하지 않고, 앞으로의 길(스타일 고르기)만 남깁니다.
      */}
      <p className="text-sm font-semibold">
        {reset ? '새로 시작한 세션이라 비어 있어요' : '아직 보관된 사진이 없어요'}
      </p>
      <p className="mt-1 text-sm text-ink-2">
        {reset
          ? '지금부터 만든 결과가 여기에 쌓여요.'
          : '스타일을 하나 골라 만들면 결과가 여기에 쌓여요.'}
      </p>
      <Link
        to="/styles"
        className="mt-4 inline-block rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper"
      >
        스타일 고르러 가기
      </Link>
    </div>
  )
}

/**
 * 게스트 안내.
 *
 * 목록을 가리지 않고 위에 얹습니다 — 게스트도 방금 만든 결과는 갖고 있고(같은 브라우저
 * 한정), 여기서 목록을 감추면 "만들었는데 없어졌다"가 됩니다. 말할 수 있는 건 **지속성**
 * 뿐이라 그것만 말합니다(§2 W-06 저장 · Q7).
 */
function GuestNotice({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="mb-3 rounded-xl border border-rule bg-surface px-4 py-3">
      <p className="text-sm font-semibold">이 브라우저에만 남아 있어요</p>
      <p className="mt-1 text-sm text-ink-2">
        로그인하면 지금까지 만든 결과가 계정에 남아서, 브라우저를 바꿔도 열 수 있어요.
      </p>
      <button
        type="button"
        onClick={onLogin}
        className="mt-3 w-full rounded-xl border border-rule-strong px-4 py-2.5 text-sm font-semibold"
      >
        로그인하고 보관하기
      </button>
    </section>
  )
}

/**
 * 게스트 세션이 리셋된 뒤의 안내.
 *
 * 문구를 W-05·W-06 의 `JobUnavailable('guest-reset')` 과 맞춥니다 — 같은 사고를 두
 * 화면이 다르게 설명하면 사용자는 서로 다른 일이 일어난 줄 압니다.
 *
 * `role="status"` 인 이유: 사용자가 누른 적 없는데 화면이 바뀐 경우라, 스크린리더
 * 사용자에게는 빈 그리드만 남고 이 사실이 전달되지 않습니다. 다만 진행을 끊을 만큼
 * 급한 소식은 아니라 `alert` 가 아니라 `status` 입니다.
 */
function GuestResetNotice({ onLogin }: { onLogin: () => void }) {
  return (
    <section
      role="status"
      className="mb-3 rounded-xl border border-rule-strong bg-surface px-4 py-3"
    >
      <p className="text-sm font-semibold">이전에 만든 결과는 열 수 없어요</p>
      <p className="mt-1 text-sm text-ink-2">
        게스트 세션이 만료돼 새 세션으로 시작했어요. 로그인 없이 만든 결과는 만들었던
        브라우저에서 30일 동안만 열립니다.
      </p>
      <button
        type="button"
        onClick={onLogin}
        className="mt-3 w-full rounded-xl border border-rule-strong px-4 py-2.5 text-sm font-semibold"
      >
        로그인하고 보관하기
      </button>
    </section>
  )
}
