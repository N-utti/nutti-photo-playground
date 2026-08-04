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
  session.set(memberSession.token, 'member')
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
 * 서버 logout 은 204 만 주고 토큰을 무효화하지 않으므로(app/routers/auth.py) 실패해도
 * 멈추지 않습니다 — 로컬 토큰은 endpoints.ts 의 finally 가 이미 지웠고, 남은 일은 다시
 * 서는 것뿐입니다.
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
 * W-05 생성 대기 폴링.
 *
 * - 종료 상태(succeeded/failed)에 도달하면 폴링을 멈춥니다.
 * - 탭이 백그라운드면 폴링하지 않습니다. W-05 는 "창을 닫아도 됩니다"를 약속하므로
 *   보이지 않는 탭에서 계속 때릴 이유가 없고, 포커스가 돌아오면 refetchOnWindowFocus 로
 *   즉시 1회 따라잡습니다.
 */
export function useJobPolling(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.job(jobId ?? ''),
    queryFn: ({ signal }) => jobs.get(jobId as string, signal),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      // 에러로 끝난 쿼리를 계속 때리면 404 인 job 주소에서 폴링이 영원히 돕니다.
      // (TanStack Query 는 에러 상태여도 refetchInterval 을 멈추지 않습니다.)
      if (query.state.status === 'error') return false
      const status = query.state.data?.status
      if (status && TERMINAL_STATUSES.has(status)) return false
      const attempts = query.state.dataUpdateCount
      return Math.min(POLL_BASE_MS * 2 ** Math.max(0, attempts - 1), POLL_MAX_MS)
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // 폴링 중 일시적 5xx 로 화면이 실패로 넘어가면 안 됩니다. 다만 404·401 은
    // 재시도해도 답이 같고, 그 사이 복원 실패 안내(이슈 #5)가 늦어집니다.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false
      return failureCount < 3
    },
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
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status < 500) return false
      return failureCount < 2
    },
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

export function usePets() {
  return useQuery({ queryKey: queryKeys.pets, queryFn: pets.list })
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

// ---------------------------------------------------------------- 계산기 연결

export function useCalculatorLink(params: { pet_id?: string; job_id?: string }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.calculatorLink(params),
    queryFn: () => calculator.link(params),
    enabled: enabled && Boolean(params.pet_id || params.job_id),
  })
}
