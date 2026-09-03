import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { ApiError, ensureSession, openWhenSessionReady } from './api/client'
import { startAnalytics } from './app/analytics'
import { redeemHandoff, takeHandoffCode } from './app/handoff'
import { captureInstagramCode } from './app/instagramCode'
import { router, warmScreens } from './app/routes'
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
  /*
    웹뷰에서 크롬으로 넘어온 주소(`?handoff=`)의 코드는 **GA4 보다 먼저** 주소에서 걷어 냅니다 —
    `page_location` 에 살아 있는 자격증명이 실려 나가면 안 됩니다(app/handoff.ts). 소진은 아래
    관문에서, 게스트 발급보다 먼저 합니다.
  */
  const handoffCode = takeHandoffCode()

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

  /*
    **기다리지 않고** 렌더합니다.

    예전에는 여기서 `await ensureSession()` 했습니다. 토큰 없이 나간 요청이 401 로
    돌아오는 걸 막으려는 것이었는데, 그 대가로 게스트 발급이 왕복하는 내내 화면이
    비어 있었습니다 — 목 위에서 잰 FCP 248ms 가 발급 응답 217ms 바로 뒤에 붙어
    있었고, 실서버 모바일 회선에서는 그 왕복이 더 깁니다. 첫 화면이 이탈률인 앱에서
    가장 비싼 자리입니다.

    이제 그 보호는 `openWhenSessionReady()` 가 요청 계층에서 합니다(api/client.ts).
    401 을 막는 효과는 그대로고, 막히는 대상만 «화면 전체»에서 «토큰이 필요한
    요청»으로 좁아집니다. 껍데기와 스켈레톤은 토큰 없이도 참이라 즉시 나갑니다.

    실패(429)를 여기서 삼키는 이유는 전과 같습니다 — 발급이 막혀도 앱은 띄웁니다.
    사유는 RootLayout 배너가 설명합니다.
  */
  /*
    웹뷰에서 크롬으로 넘어온 주소(`?handoff=`)면 그 코드를 **게스트 발급보다 먼저** 소진해
    같은 세션을 이어받습니다(app/handoff.ts). 순서가 뒤집히면 새 게스트가 먼저 앉아 결과가
    안 열립니다. 코드가 없으면 즉시 지나갑니다.
  */
  openWhenSessionReady(
    redeemHandoff(handoffCode)
      .then(() => ensureSession())
      .catch((error: unknown) => {
        console.error('게스트 세션 발급 실패', error)
      }),
  )

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )

  // 렌더 **뒤**에 부릅니다. 첫 페인트를 앞당기려고 화면을 갈라 놓고 그 앞에 다시
  // 세우면 되돌리는 셈입니다 — 실제 내려받기도 유휴 시점까지 더 미룹니다.
  warmScreens()
}

void bootstrap()
