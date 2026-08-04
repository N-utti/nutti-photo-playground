import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export const worker = setupWorker(...handlers)

/**
 * 켜고 끄는 판단은 main.tsx 가 합니다 — 거기서 `import.meta.env` 리터럴 비교로
 * 감싸야 Vite 가 프로덕션 빌드에서 이 모듈 전체를 통째로 떨어냅니다.
 * 이 파일 안에서 조건을 검사하면 MSW(200KB+)가 사용자 번들에 그대로 실립니다.
 *
 * `onUnhandledRequest: 'bypass'` 로 둔 이유: 백엔드가 엔드포인트를 하나씩
 * 구현해 가는 동안, 핸들러를 지운 것만 실서버로 넘어가고 나머지는 계속 목이
 * 받습니다 — 전부 되기를 기다리지 않고 점진적으로 붙일 수 있습니다.
 */
export async function startMocks(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: false,
  })
}
