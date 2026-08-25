/**
 * TanStack Query 레이어 — 캐시 키, 폴링 정책, 무효화 지점을 여기 모읍니다.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { ApiError, ensureSession, session } from './client'
import { auth, calculator, credits, jobs, library, pets, styles, uploads } from './endpoints'
import { clearLocalTraces } from './localTraces'
import { clearSessionStatus } from '../app/sessionStatus'
import type {
  ClaimableAction,
  CreateJobBody,
  Job,
  MemberSession,
  SocialProvider,
} from './types'

export const queryKeys = {
  me: ['me'] as const,
  credits: ['credits'] as const,
  ledger: ['credits', 'ledger'] as const,
  styles: (section?: string, limit?: number) => ['styles', { section, limit }] as const,
  style: (id: number) => ['styles', id] as const,
  pets: ['pets'] as const,
  job: (id: string) => ['jobs', id] as const,
  library: (petId?: string) => ['library', { petId }] as const,
  calculatorLink: (params: { pet_id?: string; job_id?: string }) => ['calculator-link', params] as const,
}

// ---------------------------------------------------------------- 인증 (PR #21)

/**
 * 로그인 상태의 **단일 출처**.
 *
 * `session.kind`(localStorage)는 부팅 직후 동기적으로 읽을 수 있어 편하지만, 서버가
 * 토큰을 어떻게 보는지는 모릅니다 — 병합돼 죽은 회원 토큰도 kind 는 'member' 입니다.
 * 연동 여부·로그인 수단처럼 화면 분기를 결정하는 값은 여기서만 읽습니다.
 */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: auth.me })
}

/**
 * 로그인 응답을 현재 세션으로 교체합니다.
 *
 * 병합(merged=true)이면 게스트 자산이 **다른 member_id** 로 옮겨졌고, 승격이면 같은
 * 행이 회원이 된 것입니다. 어느 쪽이든 잔액·보관함·소유 판정이 전부 새 토큰 기준으로
 * 다시 계산되므로 캐시를 통째로 무효화합니다 — 일부만 지우면 앱바 잔액과 보관함이
 * 서로 다른 사람을 말하는 상태가 남습니다.
 */
export async function adoptMemberSession(
  client: QueryClient,
  memberSession: MemberSession,
): Promise<void> {
  // 리프레시 원문은 이 응답에만 있습니다(PR #57) — 여기서 안 담으면 되찾을 곳이 없습니다.
  session.set(memberSession.token, 'member', memberSession.refresh_token)
  await client.invalidateQueries()
}

/** 로컬 가입·로그인. 두 엔드포인트는 성공 처리와 실패 코드만 다르고 폼은 같습니다. */
export function useLocalAuth() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      mode,
      email,
      password,
    }: {
      mode: 'login' | 'register'
      email: string
      password: string
    }) => (mode === 'register' ? auth.register(email, password) : auth.login(email, password)),
    onSuccess: (memberSession) => adoptMemberSession(client, memberSession),
  })
}

/**
 * 로그아웃 = 회원 토큰 폐기 + **새 게스트로 재시작**.
 *
 * 토큰만 지우면 이후 모든 요청이 401 이라 앱이 통째로 멎습니다. 이 앱에는 "로그인
 * 화면으로 보낸다"는 선택지가 없으므로(로그인 없이 전 플로우가 도는 게 전제) 게스트
 * 발급까지가 한 동작이어야 합니다.
 *
 * 서버 logout 은 회원의 리프레시를 폐기하고(PR #57) 발급된 액세스까지 즉시 무효화하지만
 * (백엔드 PR #119 · 이슈 #11 M6) 실패해도 멈추지 않습니다 — 로컬 토큰은 endpoints.ts 의
 * finally 가 이미 지웠고, 남은 일은 다시 서는 것뿐입니다. 서버에 못 닿았으면 리프레시가
 * 30일 동안 살아남지만, 원문은 이 브라우저에서 사라졌고 다시 로그인하면 그 순간
 * 무효화됩니다(회원당 활성 1개).
 *
 * **순서가 계약입니다**: 폐기 → `session.clear()` → `ensureSession()` 이 한 mutation
 * 안에서 이어져야, 무효화된 토큰으로 서 있는 구간이 남지 않습니다. 그 사이 뒤늦게
 * 돌아오는 401 은 새 게스트를 지우면 안 되는 401 이고, 그건 api/client.ts
 * `dropSessionIfCurrent` 가 막습니다 — 여기서 `ensureSession()` 을 빼거나 순서를
 * 뒤집으면 그 보호도 함께 무너집니다.
 */
export function useLogout() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await auth.logout().catch(() => {})
      await ensureSession()
    },
    onSuccess: () => client.invalidateQueries(),
  })
}

/**
 * 회원 탈퇴 (이슈 #123) = 계정 삭제 + 이 브라우저의 흔적 삭제 + **새 게스트로 재시작**.
 *
 * 착지 지점이 로그아웃과 같은 이유도 같습니다 — 토큰 없이 서 있는 상태가 이 앱에는
 * 없습니다(로그인 화면이라는 선택지가 없습니다). 탈퇴한 사용자도 그대로 놀이터를
 * 계속 쓸 수 있어야 하고, 그건 «완전 신규 게스트» 입니다.
 *
 * 로그아웃과 다른 세 가지:
 *
 *   1. **실패를 삼키지 않습니다**(endpoints.ts `withdraw` 주석). 서버가 실패하면
 *      계정은 살아 있으므로 화면도 실패를 말해야 합니다
 *   2. `clearLocalTraces()` — 초안·멱등 키·보고 있던 job 까지 지웁니다. 남겨 두면
 *      «즉시 파기» 고지 직후에 방금 그 사진이 새 게스트 화면에 되살아납니다
 *   3. `client.clear()` — 캐시를 **비웁니다**(로그아웃은 invalidate 만 합니다).
 *      invalidate 는 옛 데이터를 남겨 둔 채 다시 받아오게 하는 것이라, 새 게스트로
 *      선 첫 화면에 탈퇴한 계정의 펫·보관함이 잠깐 그려집니다. 파기를 고지한 화면이
 *      할 수 있는 말이 아닙니다
 *
 * `clearSessionStatus()` 는 만료 배너를 내립니다. 탈퇴 시점에 서버가 토큰을 전부
 * 무효화하므로 그 직후 날아가던 요청이 401 로 떨어지면 «로그인이 만료됐어요» 가
 * 올라오는데, 사용자가 스스로 끝낸 계정을 두고 만료를 통보하는 꼴입니다
 * (LogoutConfirm 이 같은 이유로 같은 일을 합니다).
 */
export function useWithdraw() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await auth.withdraw()
      clearLocalTraces()
      await ensureSession()
    },
    onSuccess: () => {
      client.clear()
      clearSessionStatus()
    },
  })
}

/**
 * 소셜 로그인·카페24 연동 시작.
 *
 * 성공 시 돌아오지 않습니다 — `authorize_url` 로 페이지를 통째로 넘깁니다. 그래서
 * 여기서 캐시를 건드릴 필요가 없고, 돌아오는 지점은 `/auth/callback/{provider}` 입니다.
 */
export function useAuthorizeRedirect() {
  return useMutation({
    mutationFn: async (provider: SocialProvider | 'cafe24') => {
      const { authorize_url } = await auth.authorize(provider)
      window.location.assign(authorize_url)
    },
  })
}

// ---------------------------------------------------------------- 스타일

/**
 * W-02 카탈로그. ETag/If-None-Match 는 브라우저 HTTP 캐시가 처리하므로(§2 W-02)
 * 여기서 직접 다루지 않고, 대신 staleTime 을 길게 잡아 불필요한 재검증을 줄입니다.
 * 스타일 목록은 운영이 W-11 에서 바꿀 때만 변하므로 세션 내 갱신 압박이 없습니다.
 */
export function useStyles(params: { section?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.styles(params.section, params.limit),
    queryFn: () => styles.list(params),
    staleTime: 10 * 60 * 1000,
  })
}

export function useStyleDetail(styleId: number | null) {
  return useQuery({
    queryKey: queryKeys.style(styleId ?? -1),
    queryFn: () => styles.detail(styleId as number),
    enabled: styleId !== null,
    staleTime: 10 * 60 * 1000,
  })
}

// ---------------------------------------------------------------- 업로드

/**
 * W-04 사진 업로드 + 품질 체크.
 *
 * 주의 — 차단(고양이 등)도 **HTTP 200** 으로 옵니다(§1 코드 표). 즉 onError 가 아니라
 * onSuccess 로 들어오고, 화면이 `blocking_issue` 를 직접 분기해야 합니다. 여기서
 * 에러로 승격시키면 안 됩니다.
 */
export function useUploadPhoto() {
  return useMutation({
    mutationFn: ({ file, petId }: { file: File; petId?: string | null }) =>
      uploads.create(file, petId ?? undefined),
  })
}

// ---------------------------------------------------------------- 생성 job 생성

/**
 * idempotencyKey 를 인자로 받는 이유: 키의 수명은 화면이 아니라 "생성 의도"에
 * 붙습니다(api/idempotency.ts). 여기서 매번 새로 만들면 402 후 재시도가 새 키가 돼
 * 크레딧이 두 번 나갈 수 있습니다.
 */
export function useCreateJob() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateJobBody; idempotencyKey: string }) =>
      jobs.create(body, idempotencyKey),
    // 202 시점에 이미 차감돼 있습니다(04-erd 크레딧 트랜잭션).
    // 갱신하지 않으면 W-05 로 넘어간 뒤에도 앱바 배지가 옛 잔액을 말합니다.
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.credits }),
  })
}

// ---------------------------------------------------------------- 생성 job 폴링

const TERMINAL_STATUSES: ReadonlySet<Job['status']> = new Set(['succeeded', 'failed'])

/** §4 시나리오2: 2초 시작, 지수 백오프. 상한을 두지 않으면 늦게 끝난 job 을 늦게 발견합니다. */
const POLL_BASE_MS = 2_000
const POLL_MAX_MS = 8_000

/**
 * 다음 폴링까지의 간격.
 *
 * 백오프만 쓰면 **남은 시간보다 늦게** 물어보는 구간이 생깁니다. 서버가 "6초 남았다"고
 * 말한 직후 8초를 기다리면 화면은 이미 끝난 작업 앞에서 2초를 더 서 있고, 그 사이
 * 진행률과 남은 초가 통째로 멈춥니다 — W-05 노트1 이 스피너 대신 숫자를 넣어 피하려던
 * 바로 그 상태입니다. 그래서 백오프는 상한으로만 쓰고 `eta_seconds` 로 한 번 더 조입니다.
 *
 * 하한이 POLL_BASE_MS 인 이유: 예상보다 오래 걸리는 job 은 eta 가 0 에 붙어 있는데,
 * 그때 간격까지 0 으로 수렴하면 폴링이 아니라 하드 루프가 됩니다.
 */
function nextPollDelay(attempts: number, etaSeconds: number | null | undefined): number {
  const backoff = Math.min(POLL_BASE_MS * 2 ** Math.max(0, attempts - 1), POLL_MAX_MS)
  if (etaSeconds == null) return backoff
  return Math.max(POLL_BASE_MS, Math.min(backoff, etaSeconds * 1_000))
}

/**
 * 이 에러 앞에서 job 읽기를 포기해도 되는가.
 *
 * 404·401 은 다시 물어도 답이 같습니다 — job 이 없거나 남의 것입니다(§3). 계속 때리면
 * 존재하지 않는 주소에서 폴링이 영원히 돌고, 그동안 복원 실패 안내(이슈 #5)는 뜨지
 * 않습니다. 그래서 즉시 포기하고 화면에 넘깁니다.
 *
 * 5xx·네트워크 단절은 성격이 다릅니다. 그건 **job 의 상태가 아니라 우리 쪽 사정**이고,
 * 서버는 그 사이에도 계속 그리고 있습니다. 여기서 포기하면 크레딧이 이미 나간 작업의
 * 결과를 화면이 영영 받지 못합니다 — 창을 닫아도 된다던 노트3 의 약속이 정작 창을
 * 열어 둔 사람에게서 깨집니다. 끊긴 쪽이 우리라면 우리가 다시 두드려야 합니다.
 */
export function isFatalJobError(error: unknown): boolean {
  return error instanceof ApiError && error.status < 500
}

/**
 * W-05 생성 대기 폴링.
 *
 * - 종료 상태(succeeded/failed)에 도달하면 폴링을 멈춥니다.
 * - 탭이 백그라운드면 폴링하지 않습니다. W-05 는 "창을 닫아도 됩니다"를 약속하므로
 *   보이지 않는 탭에서 계속 때릴 이유가 없고, 포커스가 돌아오면 refetchOnWindowFocus 로
 *   즉시 1회 따라잡습니다.
 * - 회복 가능한 에러에서는 멈추지 않습니다(isFatalJobError). 재시도 3회를 소진했다는
 *   건 지금 서버가 답을 못 준다는 뜻일 뿐, job 이 끝났다는 뜻이 아닙니다.
 */
export function useJobPolling(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(jobId ?? ''),
    queryFn: ({ signal }) => jobs.get(jobId as string, signal),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      // TanStack Query 는 에러 상태여도 refetchInterval 을 멈추지 않으므로 여기서
      // 직접 판정합니다. 404 면 접고, 5xx 면 상한 간격으로 계속 두드립니다 — 이게
      // 재시도 소진 뒤 화면이 스스로 되살아나는 유일한 경로입니다.
      if (query.state.status === 'error') {
        return isFatalJobError(query.state.error) ? false : POLL_MAX_MS
      }
      const status = query.state.data?.status
      if (status && TERMINAL_STATUSES.has(status)) return false
      return nextPollDelay(query.state.dataUpdateCount, query.state.data?.eta_seconds)
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => (isFatalJobError(error) ? false : failureCount < 3),
  })
}

/**
 * 폴링 없이 한 번만 읽습니다 — W-04 가 `?from_job=` 으로 들어왔을 때 재생성 재료
 * (`style_id`·`upload_id`, 이슈 #9)를 서버에서 확인하는 용도입니다. 폴링과 같은
 * 캐시 키를 쓰므로 방금 보던 job 이면 요청이 다시 나가지 않습니다.
 */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(jobId ?? ''),
    queryFn: ({ signal }) => jobs.get(jobId as string, signal),
    enabled: jobId !== null,
    // 폴링과 달리 화면이 이 응답을 기다려 세우지 않습니다(재료가 없으면 그냥 빈 폼) —
    // 그래서 재시도도 한 번 적게 잡고 빨리 포기합니다.
    retry: (failureCount, error) => (isFatalJobError(error) ? false : failureCount < 2),
  })
}

export function useShareJob(jobId: string) {
  return useMutation({ mutationFn: () => jobs.share(jobId) })
}

/**
 * job 이 종료 상태에 도달했을 때 호출합니다.
 *
 * 성공이면 크레딧이 차감돼 있고, 실패면 자동 반환돼 있습니다(§4 시나리오2 5단계).
 * 어느 쪽이든 잔액이 움직였으므로 배지를 다시 읽지 않으면 거짓말을 합니다.
 */
export function invalidateAfterJobSettled(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.credits }),
    client.invalidateQueries({ queryKey: queryKeys.ledger }),
    client.invalidateQueries({ queryKey: queryKeys.library() }),
  ])
}

// ---------------------------------------------------------------- 크레딧

/** W-02 헤더 배지와 W-10 A 잔액이 같은 출처를 봅니다. */
export function useCredits() {
  return useQuery({ queryKey: queryKeys.credits, queryFn: credits.get })
}

export function useClaimCredit() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (action: ClaimableAction) => credits.claim(action),
    onSuccess: () => {
      // 잔액과 earn_actions[].status 가 동시에 바뀌므로 둘 다 같은 쿼리입니다.
      client.invalidateQueries({ queryKey: queryKeys.credits })
      client.invalidateQueries({ queryKey: queryKeys.ledger })
    },
  })
}

export function useLedger() {
  return useInfiniteQuery({
    queryKey: queryKeys.ledger,
    queryFn: ({ pageParam }) => credits.ledger(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

// ---------------------------------------------------------------- 펫 · 보관함

/**
 * `enabled` 를 받는 이유: W-06 «다시 만들기» 는 **프리필 칸이 있는 스타일에서만**
 * 강아지 이름이 필요합니다(31개 칸 중 4개). 늘 부르면 결과 화면을 여는 모든 사람이
 * 쓰지도 않을 목록을 한 번씩 더 받습니다 — 캐시가 비어 있는 링크 유입이 특히 그렇습니다.
 */
export function usePets(enabled = true) {
  return useQuery({ queryKey: queryKeys.pets, queryFn: pets.list, enabled })
}

/** 업로드한 사진을 그대로 프로필 썸네일로 씁니다 — 그래서 upload_id 가 필요합니다(§3). */
export function useCreatePet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ name, uploadId }: { name: string; uploadId: string }) =>
      pets.create(name, uploadId),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.pets }),
  })
}

/** W-12 C 섹션 · FR-W12-03. 목록만 바뀌므로 무효화 대상도 pets 하나입니다. */
export function useRenamePet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ petId, name }: { petId: string; name: string }) => pets.rename(petId, name),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.pets }),
  })
}

/**
 * 펫 삭제(FR-W12-03). 결과물은 남고 `source_image.pet_profile_id` 만 NULL 이 됩니다
 * (이슈 #12 결정4) — 그래서 보관함 캐시도 함께 무효화합니다. 강아지 단위 필터에서
 * 이 펫이 사라지고 해당 결과가 "전체"로만 보이게 되기 때문입니다.
 */
export function useDeletePet() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (petId: string) => pets.remove(petId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.pets })
      client.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useLibrary(petId?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.library(petId),
    queryFn: ({ pageParam }) => library.page({ pet_id: petId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

/**
 * 보관함 다중 삭제(FR-W09-04). 인자는 `result_id` 목록입니다 — `job_id` 가 아닙니다.
 * 한 job 에 결과가 여럿일 수 있는 형태로 §3 이 잡혀 있어서(지금은 1장, Q4) 삭제 단위도
 * 결과 쪽입니다.
 *
 * 낙관적 갱신을 하지 않는 이유: 204 라 서버가 무엇이 남았는지 말해 주지 않고, 이 목록은
 * **월 섹션으로 묶인 커서 페이지**라 항목 하나를 빼면 섹션이 비거나 페이지 경계가
 * 어긋납니다. 지우고 다시 읽는 편이 정확합니다.
 *
 * 무효화를 `['library']` **접두사**로 거는 게 핵심입니다. 같은 결과가 «전체» 캐시와
 * «그 강아지» 캐시 양쪽에 들어 있어서, 보고 있던 필터만 지우면 칩을 바꾸는 순간
 * 방금 지운 사진이 되살아납니다.
 */
export function useDeleteLibraryItems() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (resultIds: string[]) => library.removeMany(resultIds),
    onSuccess: () => client.invalidateQueries({ queryKey: ['library'] }),
  })
}

// ---------------------------------------------------------------- 계산기 연결

export function useCalculatorLink(params: { pet_id?: string; job_id?: string }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.calculatorLink(params),
    queryFn: () => calculator.link(params),
    enabled: enabled && Boolean(params.pet_id || params.job_id),
  })
}
