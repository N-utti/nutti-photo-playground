import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { ApiError, ensureSession } from './api/client'
import { startAnalytics } from './app/analytics'
import { captureInstagramCode } from './app/instagramCode'
import { router } from './app/routes'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // 4xx 는 재시도해도 같은 답이 옵니다 — 크레딧 부족·404·중복 클레임 등.
        if (error instanceof ApiError && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

async function bootstrap() {
  /*
    GA4 를 **세션 발급보다 먼저** 켭니다. 첫 화면의 `page_view` 와 유입 파라미터(`utm_*`,
    크로스도메인 `_gl`)는 지금 이 주소에만 있고, 게스트 발급이 느리거나 실패하면
    (429·네트워크) 그 사이에 사용자가 나가 버릴 수 있습니다 — 그러면 «어디서 왔는지»가
    통째로 사라집니다. 측정 ID 가 비어 있으면 아무 일도 하지 않습니다(app/analytics.ts).
  */
  startAnalytics()

  // 목이 켜져 있으면 워커가 먼저 준비돼야 첫 요청(게스트 발급)을 가로챌 수 있습니다.
  // 리터럴 비교로 감싸야 프로덕션 빌드에서 MSW 가 번들에서 완전히 빠집니다.
  if (import.meta.env.VITE_ENABLE_MOCKS === 'true') {
    const { startMocks } = await import('./mocks/browser')
    await startMocks()
  }

  // §4 시나리오1 1단계 — 토큰이 없으면 게스트로 시작합니다.
  // 실패해도 앱은 띄웁니다. 여기서 멈추면 사용자에게 흰 화면만 남습니다.
  // 발급 제한(429)이면 client.ts 가 이벤트를 쏘고 RootLayout 배너가 사유를 설명합니다.
  // 인스타 DM 링크(`?ig=`)로 들어온 코드는 세션보다 먼저 집어 둡니다 — 게스트 발급이 주소를 건드리지 않아도
  // 순서를 고정해 두면 나중에 부팅 순서가 바뀌어도 코드를 잃지 않습니다.
  captureInstagramCode()
  await ensureSession().catch((error: unknown) => {
    console.error('게스트 세션 발급 실패', error)
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
