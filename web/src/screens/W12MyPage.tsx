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
 *   2. B 에 **획득 경로는 없습니다** — 그건 W-10 입니다. 내역은 "링크만"이었던 결정2 를
 *      완화해 **최근 3줄까지** 보여 줍니다(LedgerPreview 주석) — 잔액 옆에 이유가
 *      없으면 왜 12 인지 보러 한 화면을 더 들어가야 합니다. 전체·페이지네이션은 W-10 B
 *   3. 펫 삭제는 FK NULL 이라 결과물이 보관함에 남습니다(결정4) — 확인 문구가 그 사실을
 *      말해야 "삭제하면 사진도 지워지나?"에 답이 됩니다
 *   4. 카페24 **연동 해제는 없습니다**(결정3) — 해제→재연동 반복 수급 경로를 열지 않기
 *      위해 단방향이고, 해제는 CS 처리입니다
 *   5. 회원 탈퇴(FR-W12-06)는 파기 정책이 정해질 때까지 자리만 잡고 있었습니다. 이슈
 *      #22 가 PO 확정을 거쳐 PR #120 으로 착지해(`DELETE /v1/auth/me`) 지금은 실제로
 *      동작하고, 무엇이 사라지는지는 확인 창이 고지합니다(WithdrawConfirm)
 */

import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import {
  useCredits,
  useDeletePet,
  useLedger,
  useMe,
  usePets,
  useRenamePet,
} from '../api/queries'
import BackButton from '../app/BackButton'
import ConfirmDialog from '../app/ConfirmDialog'
import FloatingField from '../app/FloatingField'
import { creditAmountPhrase, linkAccountCtaLabel, useEarnAmount } from '../app/earnAmount'
import { amountTone, reasonLabel, shortDate, signedAmount } from '../app/ledgerFormat'
import { memberInitial, memberLabel, PROVIDER_LABEL } from '../app/memberIdentity'
import { initialOf } from '../app/initials'
import Thumbnail from '../app/Thumbnail'
import AccountSheet from './AccountSheet'
import LogoutConfirm from './LogoutConfirm'
import ShopLinkSheet from './ShopLinkSheet'
import WithdrawConfirm from './WithdrawConfirm'
import type { Me, Pet } from '../api/types'

export default function W12MyPage() {
  const { data: me, isPending } = useMe()
  const back = useBackTarget()

  return (
    <div className="screen-min-h bg-paper pb-16">
      <header className="sticky top-0 desktop:top-14 z-20 flex items-center gap-3 border-b border-rule bg-surface px-4 py-3">
        <BackButton fallback={back} />
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
 * ← 가 **뒤가 없을 때** 갈 곳(app/BackButton.tsx).
 *
 * 평소에는 히스토리 한 칸 뒤로 갑니다. 이 값이 쓰이는 건 주소 직접 입력이나 OAuth
 * 왕복 복귀처럼 뒤에 우리 화면이 없는 진입뿐입니다.
 *
 * 그때 기댈 단서가 `state.from` 입니다. 진입점이 두 곳이라 — 앱바 아바타(어느
 * 화면에서든)와 W-04 "저장된 강아지 · 관리" — 후자에서 왔으면 고르던 스타일
 * (`?style_id=`)이 붙은 그 주소로 돌려보내야 하고, 그래서 링크가 자기 주소를 담아
 * 보냅니다. 값은 `authReturn` 과 같은 기준으로 **앱 내부 경로만** 통과시킵니다
 * (`state` 는 히스토리에 실려 오는 값이라 그대로 믿고 이동하면 안 됩니다).
 */
function useBackTarget(): string {
  const from = useLocation().state?.from
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from
  return '/styles'
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
          className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99]"
        >
          로그인하고 이어서 쓰기
        </button>
      </section>

      <Link
        to="/credits"
        className="mt-3 flex items-center justify-between rounded-xl border border-rule bg-surface px-4 py-3 text-sm hover:border-rule-strong hover:bg-surface-2"
      >
        크레딧 받기
        <span aria-hidden className="text-ink-3">
          →
        </span>
      </Link>

      {loginSheet && (
        <AccountSheet onClose={() => setLoginSheet(false)} />
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

      <LedgerPreview />

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          to="/credits"
          className="rounded-lg border border-rule-strong px-3 py-2 text-center text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
        >
          크레딧 받기
        </Link>
        <Link
          to="/credits/ledger"
          className="rounded-lg border border-rule px-3 py-2 text-center text-sm text-ink-2 hover:border-rule-strong hover:bg-surface-2 hover:text-ink"
        >
          전체 보기
        </Link>
      </div>
    </section>
  )
}

/**
 * 받은 내역 미리보기 — 최근 3줄.
 *
 * 이슈 #12 결정2 는 "B 는 링크만, 내역 UI 를 여기 복제하지 않는다"였습니다. 링크만
 * 두면 «잔액 12》 옆에 왜 12 인지가 없어서, 잔액을 확인하러 온 사용자가 이유를 보려면
 * 한 화면을 더 들어가야 합니다. 그래서 **최근 몇 줄만** 여기서 답하고 나머지는 여전히
 * W-10 B 로 보냅니다(결정2 완화, PO 확인).
 *
 * 복제가 아닌 이유: 줄의 표기는 `app/ledgerFormat` 한 곳이고, 페이지네이션·주문번호
 * (`ref_label`)·에러 복구는 그대로 W-10 B 에만 있습니다. 여기 있는 건 3열 요약뿐입니다.
 *
 * 대가는 마이페이지 진입 시 `GET /credits/ledger` 한 번입니다 — 쿼리 키가 W-10 B 와
 * 같아서(`queryKeys.ledger`) 이어서 «전체 보기»로 들어가면 그 응답을 그대로 씁니다.
 */
const PREVIEW_ROWS = 3

function LedgerPreview() {
  const { data, isPending, isError } = useLedger()
  // 첫 페이지만 봅니다 — 「더 보기」로 뒤 페이지가 캐시에 쌓여 있어도 최근 줄은 여기 있습니다.
  const entries = (data?.pages[0]?.items ?? []).slice(0, PREVIEW_ROWS)

  if (isPending) {
    return (
      <ul className="mt-3 space-y-2">
        {Array.from({ length: PREVIEW_ROWS }, (_, index) => (
          <li key={index} className="h-6 animate-pulse rounded bg-rule/60" />
        ))}
      </ul>
    )
  }

  // 실패는 조용히 접습니다. 아래 «전체 보기»가 살아 있어 막다른 길이 아니고, 잔액과
  // 강아지 목록이 함께 있는 화면에서 부가 정보 하나 때문에 빨간 경고를 띄우면 계정에
  // 문제가 생긴 것처럼 읽힙니다. 재시도 버튼이 필요한 자리는 W-10 B 입니다.
  if (isError) return null

  if (entries.length === 0) {
    return <p className="mt-3 text-sm text-ink-3">아직 받은 내역이 없어요.</p>
  }

  return (
    <ul className="mt-3 border-t border-rule">
      {entries.map((entry, index) => (
        <li
          key={`${entry.reason}-${entry.occurred_on}-${index}`}
          className="flex items-center gap-2 border-b border-rule py-2 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">{reasonLabel(entry.reason)}</span>
          <span className="font-mono text-xs text-ink-3 tabular-nums">
            {shortDate(entry.occurred_on)}
          </span>
          {/* 폭을 고정해 증감이 한 열로 떨어지게 합니다 — +20 과 −1 이 들쭉날쭉하면
              "얼마나 늘고 줄었나"를 세로로 훑을 수 없습니다. */}
          <span className={`w-10 text-right font-mono tabular-nums ${amountTone(entry.amount)}`}>
            {signedAmount(entry.amount)}
          </span>
        </li>
      ))}
    </ul>
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
        <Link to="/upload" className="text-sm text-ink-2 underline hover:text-brand">
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
            className="mt-2 rounded-full border border-rule-strong px-4 py-1.5 text-sm hover:border-brand-2 hover:bg-surface-2 hover:text-brand"
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
              {/* 이름이 바로 옆 줄이라 장식용(alt="")이고, 사진이 없으면 첫 글자를 남깁니다. */}
              <Thumbnail
                src={pet.thumbnail_url}
                alt=""
                fallbackLabel={initialOf(pet.name)}
                className="size-10 shrink-0 rounded-full bg-surface-2 object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{pet.name}</span>
              <button
                type="button"
                onClick={() => setRenaming(pet)}
                className="rounded-lg border border-rule px-2.5 py-1 text-xs hover:border-rule-strong hover:bg-surface-2"
              >
                수정
              </button>
              <button
                type="button"
                onClick={() => setDeleting(pet)}
                className="rounded-lg border border-rule px-2.5 py-1 text-xs text-danger hover:border-danger/40 hover:bg-danger-soft"
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
    <ConfirmDialog title="이름 바꾸기" titleId="rename-pet-title" onClose={onClose}>
      <FloatingField
        id="pet-name"
        label="강아지 이름"
        className="mt-4"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="예: 콩이"
        maxLength={20}
      />
      <button
        type="button"
        disabled={rename.isPending || trimmed.length === 0 || trimmed === pet.name}
        onClick={() =>
          rename.mutate({ petId: pet.id, name: trimmed }, { onSuccess: onClose })
        }
        className="mt-4 w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-paper hover:bg-brand-deep motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {rename.isPending ? '저장 중…' : '저장'}
      </button>
      {rename.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          이름을 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
    </ConfirmDialog>
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
    <ConfirmDialog title={`${pet.name} 프로필을 삭제할까요?`} titleId="delete-pet-title" onClose={onClose}>
      <p className="mt-2 text-sm text-ink-2">
        지금까지 만든 결과는 보관함에 그대로 남아요. 다만 보관함의 강아지 필터에서 이 이름이
        사라져서, 그 결과들은 «전체»에서만 보이게 됩니다.
      </p>
      <button
        type="button"
        disabled={remove.isPending}
        onClick={() => remove.mutate(pet.id, { onSuccess: onClose })}
        className="mt-4 w-full rounded-xl bg-danger px-4 py-3 text-sm font-semibold text-paper hover:brightness-95 motion-safe:active:scale-[0.99] disabled:opacity-50"
      >
        {remove.isPending ? '삭제 중…' : '삭제'}
      </button>
      {remove.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-danger">
          삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.
        </p>
      )}
    </ConfirmDialog>
  )
}

// ---------------------------------------------------------------- D · 쇼핑몰 연동 (FR-W12-04)

/**
 * 연동 상태의 단일 출처는 `GET /v1/auth/me.cafe24_linked` 입니다 — W-10 의 "쇼핑몰 계정
 * 연동 +3" 줄과 **같은 값**을 읽고 **같은 시트**(ShopLinkSheet, SMS 인증번호 2단계)를
 * 엽니다. 진입점만 둘이고 구현은 하나여서, 한쪽만 고쳐 상태가 어긋나는 일이 생기지 않습니다.
 */
function ShopLinkSection({ me }: { me: Me }) {
  const [linkSheet, setLinkSheet] = useState(false)
  /*
    두 금액 다 `app_setting` 이고 운영이 바꿉니다(백엔드 PR #186) — W-10 목록 줄과 같은
    출처(`earn_actions[].amount`)를 읽습니다. 한 쿼리에서 나오므로 둘은 늘 같이 알거나
    같이 모릅니다. 모르는 동안 숫자를 지어내지 않는 이유는 app/earnAmount.ts 에 있습니다.
  */
  const linkAmount = useEarnAmount('link_account')
  const orderAmount = useEarnAmount('order')

  return (
    <section className="rounded-xl border border-rule bg-surface px-4 py-4">
      <h2 className="text-sm font-semibold">쇼핑몰 계정 연동</h2>
      {me.cafe24_linked ? (
        <p className="mt-1 text-sm text-ink-2">
          <span className="font-semibold text-good">✓ 연동됨</span> · 누띠에서 주문하면{' '}
          {creditAmountPhrase(orderAmount)}이 자동으로 들어와요.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {linkAmount === null || orderAmount === null
              ? '연동하면 크레딧을 받고, 이후 주문에도 자동으로 쌓여요.'
              : `연동하면 +${linkAmount} 크레딧을 받고, 이후 주문은 +${orderAmount}씩 자동으로 쌓여요.`}
          </p>
          <button
            type="button"
            onClick={() => setLinkSheet(true)}
            className="mt-3 w-full rounded-xl border border-rule-strong px-4 py-2.5 text-sm font-semibold hover:border-brand-2 hover:bg-surface-2 hover:text-brand motion-safe:active:scale-[0.99]"
          >
            {linkAccountCtaLabel(linkAmount)}
          </button>
          {linkSheet && <ShopLinkSheet onClose={() => setLinkSheet(false)} />}
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- E · 로그아웃 · 탈퇴

function DangerSection() {
  const [logoutConfirm, setLogoutConfirm] = useState(false)
  const [withdrawConfirm, setWithdrawConfirm] = useState(false)

  return (
    <section className="rounded-xl border border-rule bg-surface px-4 py-2">
      <button
        type="button"
        onClick={() => setLogoutConfirm(true)}
        className="w-full py-3 text-left text-sm hover:text-brand"
      >
        로그아웃
      </button>
      {/*
        FR-W12-06 — 백엔드 #22 가 PR #120 으로 착지해(`DELETE /v1/auth/me`) 자리만
        잡아 두던 안내를 실제 동작으로 바꿉니다. 파기 범위·크레딧 소멸·쇼핑몰 회원과의
        관계는 확인 창이 고지합니다(WithdrawConfirm).

        게스트에게는 이 섹션 자체가 안 그려집니다 — DangerSection 은 MemberSections
        안에 있습니다. 서버도 게스트 호출을 403 `MEMBER_ONLY` 로 막지만, 눌러도 거절될
        버튼을 보여 주는 건 로그인 유도로도 안 읽힙니다(이슈 #123 권장사항).
      */}
      <button
        type="button"
        onClick={() => setWithdrawConfirm(true)}
        className="w-full border-t border-rule py-3 text-left text-sm text-ink-3 hover:text-danger"
      >
        회원 탈퇴
      </button>

      {logoutConfirm && <LogoutConfirm onClose={() => setLogoutConfirm(false)} />}
      {withdrawConfirm && <WithdrawConfirm onClose={() => setWithdrawConfirm(false)} />}
    </section>
  )
}

