/**
 * W-12 · 마이페이지 (docs/wireframe-spec-v0.5.html#p12, 이슈 #12 승인안)
 *
 * 와이어프레임 W-01~W-11 에는 없던 신설 화면입니다. #9(펫 관리)와 #10→ADR-11(카페24
 * 연동)이 갈 곳을 잃어 만든 착지점이고, 구성·결정 5건은 이슈 #12 에서 PO 확정을
 * 받았습니다.
 *
 * 섹션 5개 — A 계정 · B 크레딧 · C 내 강아지 · D 쇼핑몰 연동 · E 로그아웃/탈퇴.
 *
 * 반영한 결정:
 *   1. 표시명은 `nickname` → 이메일 앞부분 → "내 계정" 폴백, 아바타는 **이니셜 원형**
 *      (프로바이더 프로필 이미지는 만료·CORS 때문에 기각 — 결정1·5)
 *   2. B 는 **링크만** — 획득 경로·내역 UI 를 여기 복제하지 않습니다. 그건 W-10 입니다
 *   3. 펫 삭제는 FK NULL 이라 결과물이 보관함에 남습니다(결정4) — 확인 문구가 그 사실을
 *      말해야 "삭제하면 사진도 지워지나?"에 답이 됩니다
 *   4. 카페24 **연동 해제는 없습니다**(결정3) — 해제→재연동 반복 수급 경로를 열지 않기
 *      위해 단방향이고, 해제는 CS 처리입니다
 *   5. 회원 탈퇴는 자리만(FR-W12-06, 이슈 #22 후속) — 파기 정책이 정해지기 전에 버튼을
 *      살려 두면 되돌릴 수 없는 동작을 정의 없이 실행하게 됩니다
 */

import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import {
  useAuthorizeRedirect,
  useCredits,
  useDeletePet,
  useMe,
  usePets,
  useRenamePet,
} from '../api/queries'
import { rememberAuthReturn } from '../app/authReturn'
import { memberInitial, memberLabel, PROVIDER_LABEL } from '../app/memberIdentity'
import AccountSheet from './AccountSheet'
import LogoutConfirm from './LogoutConfirm'
import type { Me, Pet } from '../api/types'

export default function W12MyPage() {
  const { data: me, isPending } = useMe()

  return (
    <div className="min-h-full bg-paper pb-16">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <Link to="/styles" aria-label="뒤로" className="text-ink-2">
          ←
        </Link>
        <h1 className="text-base font-bold">마이페이지</h1>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {isPending ? (
          <div className="space-y-3">
            <div className="h-20 animate-pulse rounded-xl bg-rule/60" />
            <div className="h-24 animate-pulse rounded-xl bg-rule/60" />
            <div className="h-32 animate-pulse rounded-xl bg-rule/60" />
          </div>
        ) : me?.kind === 'member' ? (
          <MemberSections me={me} />
        ) : (
          <GuestPanel />
        )}
      </main>
    </div>
  )
}

/**
 * 게스트가 주소로 직접 들어온 경우.
 *
 * 앱바 진입점은 게스트에게 아예 아바타를 보여주지 않지만(app/AccountEntry.tsx) URL 은
 * 막을 수 없습니다. 보여줄 게 잔액뿐인 빈 화면 대신 로그인 한 걸음을 제안합니다 —
 * 게스트도 크레딧과 결과는 이미 갖고 있으므로 "잃는 것"이 아니라 "이어 쓰는 것"으로
 * 말합니다(UC-07 병합).
 */
function GuestPanel() {
  const [loginSheet, setLoginSheet] = useState(false)
  const { data: credits } = useCredits()

  return (
    <>
      <section className="rounded-xl border border-rule bg-surface px-4 py-5 text-center">
        <p className="text-sm font-semibold">아직 로그인 전이에요</p>
        <p className="mt-1 text-sm text-ink-2">
          로그인하면 지금까지 만든 결과와 크레딧
          {typeof credits?.balance === 'number' && ` ${Math.max(0, credits.balance)}개`}가 계정으로
          옮겨지고, 강아지 프로필도 여기서 관리할 수 있어요.
        </p>
        <button
          type="button"
          onClick={() => setLoginSheet(true)}
          className="mt-4 w-full rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper"
        >
          로그인하고 이어서 쓰기
        </button>
      </section>

      <Link
        to="/credits"
        className="mt-3 flex items-center justify-between rounded-xl border border-rule bg-surface px-4 py-3 text-sm"
      >
        크레딧 받기
        <span aria-hidden className="text-ink-3">
          →
        </span>
      </Link>

      {loginSheet && (
        <AccountSheet
          onClose={() => setLoginSheet(false)}
          description="로그인하면 만든 결과가 보관함에 쌓이고, 크레딧을 이어서 쓸 수 있어요."
        />
      )}
    </>
  )
}

function MemberSections({ me }: { me: Me }) {
  return (
    <div className="space-y-3">
      <AccountSection me={me} />
      <CreditSection />
      <PetSection />
      <ShopLinkSection me={me} />
      <DangerSection />
    </div>
  )
}

// ---------------------------------------------------------------- A · 계정 (FR-W12-01)

function AccountSection({ me }: { me: Me }) {
  return (
    <section className="flex items-center gap-3 rounded-xl border border-rule bg-surface px-4 py-4">
      <span
        aria-hidden
        className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-2 text-lg font-semibold ring-1 ring-rule-strong"
      >
        {memberInitial(me)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold">{memberLabel(me)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
          {/* providers 는 복수입니다(§3) — 한 계정에 카카오·네이버·로컬이 함께 붙을 수
              있어 칩도 여러 개입니다. 어느 수단으로 가입했는지 못 찾아 다른 수단으로
              다시 가입하는 게 소셜 다중화의 전형적인 계정 중복 원인입니다. */}
          {me.providers.map((provider) => (
            <span key={provider} className="rounded-full bg-surface-2 px-2 py-0.5">
              {PROVIDER_LABEL[provider] ?? provider}
            </span>
          ))}
          {me.email && <span className="truncate text-ink-3">{me.email}</span>}
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- B · 크레딧 (FR-W12-02)

function CreditSection() {
  const { data: credits, isError } = useCredits()
  // 미상(`—`)과 0 을 구분합니다 — app/CreditBadge.tsx 와 같은 규칙(ADR-02).
  const balance = credits && !isError ? Math.max(0, credits.balance) : null

  return (
    <section className="rounded-xl border border-rule bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">보유 크레딧</h2>
        <span className="font-mono text-lg font-bold tabular-nums">{balance ?? '—'}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          to="/credits"
          className="rounded-lg border border-rule-strong px-3 py-2 text-center text-sm font-semibold"
        >
          크레딧 받기
        </Link>
        <Link
          to="/credits/ledger"
          className="rounded-lg border border-rule px-3 py-2 text-center text-sm text-ink-2"
        >
          받은 내역
        </Link>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- C · 내 강아지 (FR-W12-03)

function PetSection() {
  const { data, isPending, isError, refetch } = usePets()
  const [renaming, setRenaming] = useState<Pet | null>(null)
  const [deleting, setDeleting] = useState<Pet | null>(null)
  const pets = data?.items ?? []

  return (
    <section className="rounded-xl border border-rule bg-surface px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">내 강아지</h2>
        {/* 프로필은 사진에서 만들어집니다(POST /v1/pets 가 upload_id 를 요구) — 그래서
            "추가"는 업로드 화면으로 보냅니다. */}
        <Link to="/upload" className="text-sm text-ink-2 underline">
          + 추가
        </Link>
      </div>

      {isPending ? (
        <div className="mt-3 h-12 animate-pulse rounded-lg bg-rule/60" />
      ) : isError ? (
        <div className="mt-3 text-center">
          <p className="text-sm text-ink-2">강아지 목록을 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 rounded-full border border-rule-strong px-4 py-1.5 text-sm"
          >
            다시 시도
          </button>
        </div>
      ) : pets.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">
          아직 저장된 강아지가 없어요. 사진을 올리면 프로필로 저장할 수 있어요.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pets.map((pet) => (
            <li key={pet.id} className="flex items-center gap-3">
              <img
                src={pet.thumbnail_url}
                alt=""
                className="size-10 shrink-0 rounded-full bg-surface-2 object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{pet.name}</span>
              <button
                type="button"
                onClick={() => setRenaming(pet)}
                className="rounded-lg border border-rule px-2.5 py-1 text-xs"
              >
                수정
              </button>
              <button
                type="button"
                onClick={() => setDeleting(pet)}
                className="rounded-lg border border-rule px-2.5 py-1 text-xs text-danger"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {renaming && <RenamePetDialog pet={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeletePetDialog pet={deleting} onClose={() => setDeleting(null)} />}
    </section>
  )
}

function RenamePetDialog({ pet, onClose }: { pet: Pet; onClose: () => void }) {
  const rename = useRenamePet()
  const [name, setName] = useState(pet.name)
  const trimmed = name.trim()

  return (
    <Dialog title="이름 바꾸기" titleId="rename-pet-title" onClose={onClose}>
      <label htmlFor="pet-name" className="mt-3 block text-sm text-ink-2">
        강아지 이름
      </label>
      <input
        id="pet-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={20}
        className="mt-1 w-full rounded-lg border border-rule-strong bg-surface px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={rename.isPending || trimmed.length === 0 || trimmed === pet.name}
        onClick={() =>
          rename.mutate({ petId: pet.id, name: trimmed }, { onSuccess: onClose })
        }
        className="mt-4 w-full rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
      >
        {rename.isPending ? '저장 중…' : '저장'}
      </button>
      {rename.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          이름을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
    </Dialog>
  )
}

/**
 * 삭제 확인 (이슈 #12 결정4).
 *
 * `DELETE /v1/pets/{id}` 는 `source_image.pet_profile_id` 만 NULL 로 만들고 사진·결과물은
 * 남깁니다. 사용자가 가장 무서워하는 건 "결과물이 같이 지워지나?"이므로 그 답을 먼저
 * 적고, 실제로 달라지는 것(보관함 강아지 필터에서 사라짐)을 뒤에 붙입니다.
 */
function DeletePetDialog({ pet, onClose }: { pet: Pet; onClose: () => void }) {
  const remove = useDeletePet()

  return (
    <Dialog title={`${pet.name} 프로필을 삭제할까요?`} titleId="delete-pet-title" onClose={onClose}>
      <p className="mt-2 text-sm text-ink-2">
        지금까지 만든 결과는 보관함에 그대로 남아요. 다만 보관함의 강아지 필터에서 이 이름이
        사라져서, 그 결과들은 «전체»에서만 보이게 됩니다.
      </p>
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() => remove.mutate(pet.id, { onSuccess: onClose })}
        className="mt-4 w-full rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper disabled:opacity-50"
      >
        {remove.isPending ? '삭제 중…' : '삭제'}
      </button>
      {remove.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
    </Dialog>
  )
}

// ---------------------------------------------------------------- D · 쇼핑몰 연동 (FR-W12-04)

/**
 * 연동 상태의 단일 출처는 `GET /v1/auth/me.cafe24_linked` 입니다 — W-10 의 "쇼핑몰 계정
 * 연동 +3" 줄과 **같은 값**을 읽고 **같은 authorize** 로 갑니다. 진입점만 둘이고 구현은
 * 하나여서, 한쪽만 고쳐 상태가 어긋나는 일이 생기지 않습니다.
 */
function ShopLinkSection({ me }: { me: Me }) {
  const location = useLocation()
  const authorize = useAuthorizeRedirect()

  function startLink() {
    rememberAuthReturn(`${location.pathname}${location.search}`)
    authorize.mutate('cafe24')
  }

  return (
    <section className="rounded-xl border border-rule bg-surface px-4 py-4">
      <h2 className="text-sm font-semibold">쇼핑몰 계정 연동</h2>
      {me.cafe24_linked ? (
        <p className="mt-1 text-sm text-ink-2">
          <span className="font-semibold text-good">✓ 연동됨</span> · 누띠에서 주문하면 +20 크레딧이
          자동으로 들어와요.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">
            연동하면 +3 크레딧을 받고, 이후 주문은 +20씩 자동으로 쌓여요.
          </p>
          <button
            type="button"
            disabled={authorize.isPending}
            onClick={startLink}
            className="mt-3 w-full rounded-xl border border-rule-strong px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {authorize.isPending ? '여는 중…' : '연동하고 +3 받기'}
          </button>
          {authorize.isError && (
            <p role="alert" className="mt-2 text-center text-sm text-danger">
              연동 화면을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.
            </p>
          )}
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- E · 로그아웃 · 탈퇴

function DangerSection() {
  const [logoutConfirm, setLogoutConfirm] = useState(false)

  return (
    <section className="rounded-xl border border-rule bg-surface px-4 py-2">
      <button
        type="button"
        onClick={() => setLogoutConfirm(true)}
        className="w-full py-3 text-left text-sm"
      >
        로그아웃
      </button>
      <div className="border-t border-rule py-3">
        {/*
          FR-W12-06 자리. 파기 범위(원본·결과물 유예, 크레딧 소멸, 카페24 회원과의 관계)가
          이슈 #22 에서 설계 중이라 동작을 붙이지 않았습니다 — 되돌릴 수 없는 동작을
          정의 없이 실행시키느니, 지금 할 수 있는 안내(CS 경로)를 줍니다.
        */}
        <p className="text-sm text-ink-3">회원 탈퇴</p>
        <p className="mt-0.5 text-xs text-ink-3">
          준비 중이에요. 지금 탈퇴가 필요하면 고객센터로 알려주세요.
        </p>
      </div>

      {logoutConfirm && <LogoutConfirm onClose={() => setLogoutConfirm(false)} />}
    </section>
  )
}

// ---------------------------------------------------------------- 공용 다이얼로그

function Dialog({
  title,
  titleId,
  onClose,
  children,
}: {
  title: string
  titleId: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center desktop:items-center">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full rounded-t-2xl bg-surface p-5 desktop:max-w-sm desktop:rounded-2xl"
      >
        <h2 id={titleId} className="text-base font-bold">
          {title}
        </h2>
        {children}
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm text-ink-3">
          취소
        </button>
      </div>
    </div>
  )
}
