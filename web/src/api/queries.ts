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
import { ApiError } from './client'
import { calculator, credits, jobs, library, pets, styles, uploads } from './endpoints'
import type { ClaimableAction, CreateJobBody, Job } from './types'

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

/** 썸네일 선택(§3). 서버 확정값을 캐시에 되꽂아 W-06 의 "4장 중 N번"과 어긋나지 않게 합니다. */
export function useSelectResult(jobId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (resultIndex: number) => jobs.select(jobId, resultIndex),
    onSuccess: ({ selected_index }) => {
      client.setQueryData(queryKeys.job(jobId), (previous: Job | undefined) =>
        previous ? { ...previous, selected_index } : previous,
      )
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
