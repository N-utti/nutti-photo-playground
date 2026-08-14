/**
 * 화면 조각을 앱과 같은 문맥에서 렌더하는 도우미.
 *
 * 시트·오버레이는 혼자 서지 못합니다 — 안에서 react-query 로 잔액을 읽고(useCredits)
 * 라우터로 현재 주소를 읽습니다(useLocation). 테스트마다 이 껍데기를 손으로 두르면
 * 어느 날 하나가 빠진 채로 «렌더가 안 된다» 를 디버깅하게 됩니다.
 */

import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router'

/**
 * 테스트용 QueryClient.
 *
 * `retry: false` 가 핵심입니다. 앱 기본값(api/main.tsx)은 5xx 를 두 번 더 시도하는데,
 * 실패를 다루는 테스트에서 그대로 두면 한 건에 수 초씩 걸리고 실패 원인이
 * 타임아웃으로 뒤바뀝니다. `staleTime: 0` 은 테스트마다 새 클라이언트를 쓰므로
 * 캐시를 물려받을 일이 없어서 그냥 기본값입니다.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  /** 라우터의 시작 주소. 화면이 `useLocation` 을 읽으면 이 값이 보입니다. */
  route?: string
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient = createTestQueryClient(), ...options }: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient }
}
