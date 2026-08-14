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
      queries: {
        retry: false,
        staleTime: 0,
        /*
          `retry: false` 로 못 막는 쿼리가 있습니다 — `useJobPolling` 은 자기 `retry` 를
          직접 정의해서(5xx 는 3회) 이 기본값을 덮습니다. 그건 의도된 동작이라 테스트에서
          끄면 안 되지만, 재시도 **간격**까지 실제값(1s·2s·4s)으로 둘 이유는 없습니다.
          0 으로 낮춰야 «503 을 맞고도 화면이 안 헐린다» 같은 검사가 타임아웃 안에
          끝납니다. 횟수는 그대로라 검사하려던 경로는 똑같이 밟습니다.
        */
        retryDelay: 0,
      },
      mutations: { retry: false, retryDelay: 0 },
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
