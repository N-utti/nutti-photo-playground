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
 * **게스트 세션 리셋을 여기서도 받습니다**(이슈 #5). 재발급된 세션은 새 게스트이므로
 * 목록 응답은 **403 `MEMBER_ONLY`**(아래 `memberOnly`) — 리셋됐다는 사실은 그 응답
 * 어디에도 없습니다. 결과가 사라진 이유를 들을 곳이 그전까지는 job URL 로 직접 들어온
 * W-05·W-06 에만 있었고, 탭바로 들어온 사용자는 여기서 처음 만납니다. 그래서 리셋
 * 안내를 위에, 로그인 안내를 목록 자리에 **함께** 답니다 — 앞은 «왜 없어졌나», 뒤는
 * «앞으로 어떻게 남기나» 라 서로를 대신하지 못합니다.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { isApiError } from '../api/client'
import { useDeleteLibraryItems, useLibrary, useMe, usePets } from '../api/queries'
import BackButton from '../app/BackButton'
import ConfirmDialog from '../app/ConfirmDialog'
import { CreditBadge } from '../app/CreditBadge'
import { rememberDeletedJobs } from '../app/deletedResults'
import { useGuestSessionReset } from '../app/guestSession'
import { downloadAttachment, saveFromNewTabHint, saveImage } from '../app/saveImage'
import { detectInAppBrowser } from '../app/inAppBrowser'
import { fetchShareFile, saveViaShareSheet, shareImage } from '../app/shareImage'
import type { LibraryItem, LibraryMonth } from '../api/types'
import AccountSheet from './AccountSheet'

/**
 * 한 번에 지울 수 있는 장수.
 *
 * 서버가 한 요청을 100개로 끊습니다(`DeleteLibraryRequest.ids: Field(max_length=100)`,
 * 백엔드 PR #157). 넘겨서 보내면 400 이 오고 화면은 «삭제하지 못했어요 · 다시 시도» 로
 * 끝나는데, **다시 눌러도 영영 같은 답입니다** — 101장을 고른 사람에게 그 문구는 서버가
 * 잠깐 아픈 것처럼 들리고, 실제로 해야 할 일(나눠서 지우기)은 화면 어디에도 없습니다.
 * 쪼개서 보내지 않는 이유는 부분 실패입니다: 150장을 두 번에 나눠 보내다 뒤가 실패하면
 * 100장이 지워진 채로 «삭제하지 못했어요» 가 뜹니다.
 *
 * 그래서 **고르는 단계에서** 막고 이유를 말합니다. 저장도 같은 선택을 쓰므로 함께 묶이는데,
 * 100장을 한 장씩 받는 것도 이미 상한에 가까운 일이라 그대로 둡니다(`saveAll`).
 */
const DELETE_LIMIT = 100

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

  /*
    보관함은 **회원 기능**입니다(§2 W-06 저장 — "로그인 회원은 결과가 자동으로 보관함에
    남음, 게스트는 계정 연동 필요"). 그래서 게스트의 `GET /v1/library` 는 실패가 아니라
    **403 `MEMBER_ONLY`** 로 옵니다 — 클레임·연동·탈퇴가 이미 쓰는 그 코드입니다(이슈 #52).

    그걸 일반 오류로 흘리면 «보관함을 불러오지 못했어요 · 다시 시도» 가 뜹니다. 다시
    눌러도 영영 같은 답이 오고, 게스트는 자기 사진이 사라졌다고 읽습니다 — **실패가 아닌
    상황을 실패로 보여 주는 것**이라 눌러야 할 버튼(로그인)이 화면에서 지워집니다.

    보관함 구현(백엔드 PR #156·#157)이 착지해서 목도 그 계약으로 옮겼습니다 — 게스트로
    이 화면을 열면 브라우저에서도 이 갈래가 그대로 밟힙니다. 그전까지 목은 게스트에게도
    목록을 줬고(서버보다 앞서지 않으려는 의도적 지연 — #142·#144 가 그 반대 사고),
    이 화면은 테스트에만 존재했습니다.
  */
  const memberOnly = isApiError(library.error, 'MEMBER_ONLY')

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
      // 상한에 닿으면 더 고르지 않습니다 — 이유는 선택 바가 말합니다.
      else if (next.size < DELETE_LIMIT) next.add(resultId)
      return next
    })
  }

  const selectedItems = items.filter((item) => selected?.has(item.result_id))

  return (
    <div className="screen-min-h bg-canvas pb-10">
      {/*
        데스크톱에서는 **평시에만** 내립니다.

        평시 이 줄이 들고 있는 것은 «보관함» 제목과 크레딧 배지인데, 둘 다 바로 위
        GNB 에 있습니다(켜진 탭이 같은 말을 하고 배지도 그쪽입니다). 남는 «선택» 버튼은
        아래 목록 위로 옮겼습니다 — 버튼 하나 때문에 같은 말을 두 번 하는 줄을 남길
        이유가 없습니다.

        선택 모드는 반대입니다. «취소»·«N장 선택» 은 GNB 어디에도 없고, 이 줄이 없으면
        데스크톱에서 선택을 빠져나갈 길이 사라집니다.
      */}
      <header
        className={`sticky top-0 desktop:top-16 z-20 flex items-center gap-3 border-b border-rule bg-surface px-5 desktop:px-7 py-3 ${
          selected ? '' : 'desktop:hidden'
        }`}
      >
        {selected ? (
          <>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-ink-2 hover:text-ink"
            >
              취소
            </button>
            <h1 className="text-base font-bold" aria-live="polite">
              {selectedItems.length}장 선택
            </h1>
          </>
        ) : (
          <>
            {/* 보관함은 더는 탭 목적지가 아니라 마이페이지(W-12)에서 들어옵니다 — 탭바가
                없어졌으므로 여기서 나가는 길은 이 ← 입니다(없으면 모바일에서 갇힙니다).
                히스토리가 없으면 마이페이지로 되돌립니다. */}
            <BackButton fallback="/me" />
            <h1 className="text-base font-bold">보관함</h1>
            <div className="ml-auto flex items-center gap-3">
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-sm text-ink-2 hover:text-ink"
                >
                  선택
                </button>
              )}
              <CreditBadge />
            </div>
          </>
        )}
      </header>

      <main className="mx-auto w-full max-w-md px-5 desktop:px-7 py-4">
        {/*
          게스트 안내는 리셋된 경우에만 남았습니다.

          여기에는 «이 브라우저에만 남아 있어요» 배너가 하나 더 있었습니다 — 목록 위에
          얹어서 지속성을 알리는 자리였는데, 게스트에게 목록이 **아예 안 오는** 지금은
          띄울 수 없습니다(403). 조건은 `!memberOnly` 라 응답을 기다리는 동안 잠깐 떴다가
          403 이 오면 사라지는, 화면이 먼저 말하고 뒤늦게 정정하는 배너였습니다. 하던 말
          (게스트 결과는 만든 브라우저에서 30일)은 `MemberOnlyNotice` 가 그대로 합니다.
        */}
        {guestReset && <GuestResetNotice onLogin={() => setLoginSheet(true)} />}

        {/*
          데스크톱에서 «선택» 이 서는 자리. 위 앱바가 내려가면서 여기로 옮겼습니다
          (모바일은 앱바 쪽 버튼을 그대로 씁니다 — 그래서 `desktop:` 하나로 갈립니다).

          목록 위 오른쪽인 이유는 이 버튼이 **목록에 하는 일**이기 때문입니다. 고를 것이
          없으면(`items.length === 0`) 위 앱바와 같은 조건으로 아예 안 그립니다.
        */}
        {!selected && items.length > 0 && (
          <div className="hidden justify-end desktop:flex">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-ink-2 hover:text-ink"
            >
              선택
            </button>
          </div>
        )}

        <PetFilter pets={pets} value={petId} onChange={selectPet} />

        {library.isPending ? (
          <div className="mt-4 grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="aspect-square animate-pulse rounded bg-canvas-rule/70" />
            ))}
          </div>
        ) : memberOnly ? (
          <MemberOnlyNotice onLogin={() => setLoginSheet(true)} />
        ) : library.isError ? (
          <div className="mt-4 rounded-xl bg-surface px-4 py-5 text-center">
            <p className="text-sm text-ink-2">보관함을 불러오지 못했어요.</p>
            <p className="mt-1 font-mono text-xs text-ink-3">{library.error.message}</p>
            <button
              type="button"
              onClick={() => library.refetch()}
              className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-brand-soft hover:text-brand"
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
                className="mt-5 w-full rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
              >
                {library.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
              </button>
            )}
          </>
        )}
      </main>

      {selected && (
        <SelectionBar
          items={selectedItems}
          atLimit={selected.size >= DELETE_LIMIT}
          pending={remove.isPending}
          failed={remove.isError}
          onDelete={() =>
            remove.mutate(
              selectedItems.map((item) => item.result_id),
              {
                onSuccess: () => {
                  /*
                    지웠다는 사실을 이 브라우저가 기억합니다(app/deletedResults.ts).
                    같은 결과의 `/jobs/{job_id}` 주소는 히스토리·북마크·공유 링크에
                    그대로 남아 있고, 서버가 논리삭제를 반영하기 시작하면(이슈 #152)
                    그 주소는 404 가 됩니다 — 그때 화면이 «주소가 잘못됐다» 고 하지
                    않게 하려는 근거입니다. 성공 콜백에만 답니다.
                  */
                  rememberDeletedJobs(selectedItems.map((item) => item.job_id))
                  setSelected(null)
                },
              },
            )
          }
        />
      )}

      {loginSheet && (
        <AccountSheet onClose={() => setLoginSheet(false)} />
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
          className="mt-2 flex items-center justify-between rounded-xl border border-rule bg-surface px-4 py-2.5 text-sm hover:border-rule-strong hover:bg-brand-soft"
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
      // 고른 칩은 hover 로 흔들지 않습니다 — 그건 상태 표시입니다. 안 고른 칩만
      // 반응해야 «고를 수 있는 것 / 이미 고른 것» 이 구분됩니다.
      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
        active
          ? 'border-brand bg-brand text-paper'
          : 'border-rule bg-surface text-ink-2 hover:border-brand-2 hover:text-brand'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- 그리드 타일

/**
 * 롱프레스 판정 — **손가락·펜에만** 답니다.
 *
 * `pointer*` 로 잡으면 터치·마우스·펜이 한 벌로 처리됩니다. 스크롤 중 오발동이 이
 * 화면에서 특히 잦아서(그리드는 세로로 길게 넘깁니다) 움직이면 즉시 취소하고,
 * 길게 눌러 선택이 걸린 뒤 따라오는 click 은 삼켜야 결과 상세로 튀지 않습니다.
 *
 * 마우스를 뺀 이유: «길게 눌러 선택» 은 손가락에 메뉴가 없어서 생긴 관용입니다.
 * 마우스에는 그 관용이 없어서, 타일 위에서 버튼을 0.45초 누르고 있던 사람(느린
 * 클릭·드래그를 시작하려던 손)이 예고 없이 선택 모드로 들어갑니다. 대신 데스크톱에는
 * 목록 위 「선택」 버튼이 이미 있고(위 `desktop:flex`), 그게 눌러야 나오는 것이
 * 아니라 보이는 문이라 더 낫습니다.
 *
 * 가르는 기준이 화면 폭이 아니라 **포인터 종류**인 건, 폭으로 자르면 터치스크린
 * 노트북(≥1024px)에서 손가락 롱프레스를 같이 잃고 좁은 창에 마우스를 쓰는 경우는
 * 그대로 남기 때문입니다 — index.css 의 `hover` 변형이 `(hover: hover)` 하나만 보는
 * 것과 같은 이유입니다. 펜은 남깁니다(길게 눌러 메뉴는 펜의 관용입니다).
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
        if (event.pointerType === 'mouse') return
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
        className="relative block aspect-square w-full bg-canvas-2 hover:brightness-95"
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
      // 사진 타일은 색을 얹을 자리가 없습니다(테두리도 배경도 사진에 가립니다).
      // 밝기를 살짝 눌러 «지금 이 칸» 을 가리킵니다.
      className="block aspect-square bg-canvas-2 hover:brightness-95"
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
  atLimit,
  pending,
  failed,
  onDelete,
}: {
  items: LibraryItem[]
  atLimit: boolean
  pending: boolean
  failed: boolean
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  // 한 장이라도 저장이 아니라 «열기» 로 끝났으면 안내합니다 (saveImage 참고).
  const [opened, setOpened] = useState(false)
  // 아예 못 받은 장수. 0 이 아니면 «다 됐다» 고 말하면 안 됩니다.
  const [failedCount, setFailedCount] = useState(0)
  // 갤러리 경로에서 활성화 만료로 시트가 거절된 경우 — 한 번 더 누르면 됩니다.
  const [sheetExpired, setSheetExpired] = useState(false)
  // 카카오톡·인스타 웹뷰 — blob 저장이 조용히 죽는 곳이라 첨부 주소로 한 장씩 내려받습니다.
  const inAppBrowser = detectInAppBrowser()
  const [downloadCount, setDownloadCount] = useState(0)
  /*
    갤러리 경로에서 받아 둔 파일 묶음. 시트가 expired 로 닫혔을 때 이 캐시가 있어야
    두 번째 탭이 N 번의 fetch 없이 바로 뜹니다(W-06 의 shareFile ref 와 같은 이유).
    선택이 바뀌면 key 가 어긋나 다시 받습니다.
  */
  const galleryFiles = useRef<{ key: string; files: File[]; failed: number } | null>(null)
  const disabled = items.length === 0 || pending || saving

  /*
    저장도 W-06 과 같은 갈래입니다(그쪽 ShareRow 주석 참고) — iOS 는 공유 시트로
    넘겨야 사진 앱(갤러리)에 들어가고(blob 다운로드는 파일 앱으로 떨어짐), Android·
    데스크톱은 다운로드. 여러 장은 한 시트에 한꺼번에 넘깁니다.
    ponytail: 상한(100장)까지 파일을 전부 메모리에 들고 시트를 여는 셈 — 시트가
    거절하면(failed) 아래 saveAll 다운로드로 물러나므로, 장수 상한 튜닝은 실측 문의가 오면.
  */
  async function handleSave() {
    setSaving(true)
    setOpened(false)
    setFailedCount(0)
    setSheetExpired(false)
    setDownloadCount(0)
    try {
      if (saveViaShareSheet()) {
        const key = items.map((item) => item.result_id).join(',')
        if (galleryFiles.current?.key !== key) {
          const files: File[] = []
          let failed = 0
          for (const item of items) {
            const file = await fetchShareFile(item.image_url, `nutti-${item.result_id}.jpg`)
            if (file === null) failed += 1
            else files.push(file)
          }
          galleryFiles.current = { key, files, failed }
        }
        const { files, failed } = galleryFiles.current
        if (files.length > 0) {
          const outcome = await shareImage(files)
          if (outcome === 'expired') {
            setSheetExpired(true)
            return
          }
          if (outcome !== 'failed') {
            setFailedCount(failed)
            return
          }
          // 시트가 못 열리면(파일 묶음 거절 등) 예전 경로로 — 최소한 파일로는 남습니다.
        }
      }
      /*
        웹뷰는 blob 을 버립니다 — W-06 과 같이 서버의 첨부 주소로 이동해 한 장씩 내려받습니다
        (app/saveImage.ts downloadAttachment). 결과를 돌려받지 못하니 «시작했다» 까지만.
      */
      if (inAppBrowser !== null) {
        for (const item of items) {
          downloadAttachment(item.download_url, `nutti-${item.result_id}.jpg`)
          await new Promise((resolve) => window.setTimeout(resolve, 300))
        }
        setDownloadCount(items.length)
        return
      }
      const result = await saveAll(items)
      setOpened(result.opened)
      setFailedCount(result.failed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-surface px-5 desktop:px-7 py-3">
        <div className="mx-auto flex w-full max-w-md gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleSave()}
            className="flex-1 rounded-xl border border-rule-strong px-4 py-3 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirming(true)}
            className="flex-1 rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper hover:brightness-95 motion-safe:active:scale-[0.99] disabled:opacity-50"
          >
            삭제
          </button>
        </div>
        {/*
          더 고를 수 없게 된 순간에만 말합니다. 탭했는데 체크가 안 들어오는 게 이 상한이
          모습을 드러내는 방식이라, 이유가 없으면 화면이 고장 난 것으로 읽힙니다.
        */}
        {atLimit && (
          <p role="status" className="mt-2 text-center text-xs text-ink-3">
            한 번에 {DELETE_LIMIT}장까지 고를 수 있어요. 나눠서 지워 주세요.
          </p>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.
          </p>
        )}
        {/* 저장하는 방법은 포인터마다 다릅니다 — W-06 과 같은 문장을 씁니다. */}
        {opened && (
          <p className="mt-2 text-center text-xs text-ink-3">
            일부는 새 탭에 열었어요. {saveFromNewTabHint()}
          </p>
        )}
        {sheetExpired && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            공유 시트가 열리기 전에 닫혔어요 — 한 번 더 눌러 주세요.
          </p>
        )}
        {downloadCount > 0 && (
          <p role="status" className="mt-2 text-center text-xs text-ink-3">
            {downloadCount}장 다운로드를 시작했어요 — 갤러리의 다운로드 앨범이나 파일 앱에서 확인해 주세요.
          </p>
        )}
        {failedCount > 0 && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            {failedCount}장은 저장하지 못했어요.
          </p>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`${items.length}장을 삭제할까요?`}
          titleId="delete-library-title"
          onClose={() => setConfirming(false)}
        >
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
            className="mt-4 w-full rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper hover:brightness-95 motion-safe:active:scale-[0.99] disabled:opacity-50"
          >
            {pending ? '삭제 중…' : '삭제'}
          </button>
        </ConfirmDialog>
      )}
    </>
  )
}

/**
 * 일괄 저장. 어떻게 끝났는지를 장수로 돌려줍니다.
 *
 * 브라우저에는 "여러 파일을 한 번에 받기"가 없어서 한 장씩 순서대로 받는 게 전부입니다.
 * 사이에 간격을 두는 이유는 연속 클릭을 팝업 차단이 묶어서 막기 때문입니다.
 *
 * 앵커에 원본 URL 을 그대로 물리지 않고 `saveImage` 를 지나는 이유는 이슈 #77 —
 * `download` 는 같은 출처에서만 먹어서 CDN 이 붙으면 저장이 «열기» 가 됩니다. 이제
 * fetch → blob 으로 받아 저장하고, CORS 가 아직 안 열려 실패한 것만 예전처럼 엽니다
 * (PR #78 이 CDN 설정 시 CORS 를 필수 조건으로 문서에 박아 뒀습니다).
 *
 * 못 받은 장수를 따로 세는 이유: 일괄 저장은 **일부만 실패하는 게 정상 경로**입니다
 * (지워진 결과·만료된 서명이 섞입니다). 그걸 «열기» 와 한 칸에 담으면 20장을 고르고
 * 3장을 잃은 사람에게 화면이 아무 말도 안 하게 됩니다.
 */
async function saveAll(items: LibraryItem[]): Promise<{ opened: boolean; failed: number }> {
  let opened = false
  let failed = 0
  for (const item of items) {
    const outcome = await saveImage(item.image_url, `nutti-${item.result_id}.jpg`)
    if (outcome === 'opened') opened = true
    if (outcome === 'failed') failed += 1
    await new Promise((resolve) => window.setTimeout(resolve, 300))
  }
  return { opened, failed }
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
      <div className="mt-6 rounded-xl bg-surface px-4 py-8 text-center">
        <p className="text-sm text-ink-2">이 강아지로 만든 결과가 아직 없어요.</p>
        <button
          type="button"
          onClick={onClearFilter}
          className="mt-3 rounded-full border border-rule-strong px-4 py-2 text-sm hover:border-brand-2 hover:bg-brand-soft hover:text-brand"
        >
          전체 보기
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 rounded-xl bg-surface px-4 py-8 text-center">
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
        className="mt-4 inline-block rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
      >
        스타일 고르러 가기
      </Link>
    </div>
  )
}

/**
 * 보관함이 회원 전용이라 목록을 못 받은 경우(403 `MEMBER_ONLY`).
 *
 * **«없어요» 가 아니라 «아직 여기 안 모여요» 라고 말합니다.** 게스트의 결과는 사라진 게
 * 아니라 목록으로 묶이지 않을 뿐이고(만든 브라우저에서 30일 · Q7 · 이슈 #5), 그 차이를
 * 뭉개면 사용자는 사진을 잃었다고 믿습니다. 빈 상태(`EmptyState`)를 재사용하지 않는
 * 이유도 그것입니다 — 거기 적힌 «아직 보관된 사진이 없어요» 는 여기서 **거짓**입니다.
 *
 * 실패 화면(다시 시도)도 아닙니다. 다시 눌러도 같은 403 이 오고, 정말 필요한 동작은
 * 재시도가 아니라 로그인입니다.
 */
function MemberOnlyNotice({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="mt-4 rounded-xl bg-surface px-4 py-5">
      <p className="text-sm font-semibold">로그인하면 여기에 모여요</p>
      <p className="mt-1 text-sm text-ink-2">
        지금까지 만든 사진은 만들었던 브라우저에서 30일 동안 열 수 있어요. 보관함으로
        모아 두려면 로그인이 필요해요.
      </p>
      <button
        type="button"
        onClick={onLogin}
        className="mt-4 w-full rounded-xl border border-rule-strong px-4 py-2.5 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99]"
      >
        로그인하고 보관하기
      </button>
    </div>
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
        className="mt-3 w-full rounded-xl border border-rule-strong px-4 py-2.5 text-sm font-semibold hover:border-brand-2 hover:bg-brand-soft hover:text-brand motion-safe:active:scale-[0.99]"
      >
        로그인하고 보관하기
      </button>
    </section>
  )
}
