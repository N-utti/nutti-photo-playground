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
import { calculator, credits, jobs, library, pets, styles } from './endpoints'
import type { ClaimableAction, Job } from './types'

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
      const status = query.state.data?.status
      if (status && TERMINAL_STATUSES.has(status)) return false
      const attempts = query.state.dataUpdateCount
      return Math.min(POLL_BASE_MS * 2 ** Math.max(0, attempts - 1), POLL_MAX_MS)
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // 폴링 중 일시적 5xx 로 화면이 실패로 넘어가면 안 됩니다.
    retry: 3,
  })
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
