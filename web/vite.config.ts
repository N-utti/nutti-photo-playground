// `vitest/config` 의 defineConfig 는 vite 의 것을 감싸 `test` 키를 더해 줍니다 —
// 삼중 슬래시 참조 없이 이 import 하나로 타입이 붙습니다.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /**
     * 목을 끄고(VITE_ENABLE_MOCKS=false) 로컬 백엔드에 붙일 때 쓰는 프록시.
     *
     * 이건 개발 중 CORS 회피 수단일 뿐이고 배포 환경에서는 성립하지 않습니다 —
     * 실제 배포는 백엔드에 CORSMiddleware 가 배선돼야 합니다(이슈 #3).
     *
     * `/media` 가 `/v1` 만큼 중요합니다. 로컬 백엔드는 R2 자격증명이 없으면
     * 파일을 `var/media/` 에 쓰고 이미지 URL 을 **`/media/...` 로 내려줍니다**
     * (app/storage.py `public_url`, app/main.py 의 StaticFiles 마운트). 그 경로는
     * 응답 본문에 그대로 실려 오므로 `<img src>` 가 되는 순간 **프론트 오리진**
     * (:5173)으로 붙고, 여기에 프록시가 없으면 원본 사진도 생성 결과도 전부 404 입니다
     * — API 는 멀쩡히 200 을 주는데 화면에는 이미지가 하나도 안 뜨는 상태라
     * «백엔드가 아직 안 됐나» 로 오진하기 딱 좋습니다.
     *
     * CDN_BASE_URL 이 채워진 환경에서는 절대 URL 이 와서 이 프록시를 타지 않습니다.
     */
    proxy: {
      '/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  /**
   * 컴포넌트 테스트 (이슈 #94).
   *
   * 별도 번들러 설정을 두지 않습니다 — 위의 `plugins` · `resolve.alias` 를 그대로
   * 물려받아야 테스트가 앱과 **같은 방식으로** 모듈을 풉니다. 설정이 갈라지면
   * "테스트는 통과하는데 빌드는 깨지는" 종류가 생깁니다.
   *
   * `env.VITE_API_BASE_URL` 이 절대 URL 인 이유: 개발 기본값은 `/v1` 상대 경로인데,
   * node 의 fetch(undici)는 상대 URL 을 파싱하지 못해 요청이 나가기도 전에 던집니다.
   * MSW 핸들러는 오리진 와일드카드로 선언돼 있어(mocks/handlers.ts 의 `BASE`)
   * 호스트가 무엇이든 그대로 받습니다.
   */
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Tailwind 를 테스트마다 돌릴 이유가 없습니다 — jsdom 은 어차피 CSS 를 적용하지 않습니다.
    css: false,
    env: {
      VITE_API_BASE_URL: 'http://localhost/v1',
    },
  },
})
