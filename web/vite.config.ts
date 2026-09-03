// `vitest/config` 의 defineConfig 는 vite 의 것을 감싸 `test` 키를 더해 줍니다 —
// 삼중 슬래시 참조 없이 이 import 하나로 타입이 붙습니다.
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * MSW 의 서비스워커 스크립트를 목이 꺼진 빌드 산출물에서 지웁니다.
 *
 * `mockServiceWorker.js` 는 `public/` 에 있어야 합니다 — 서비스워커는 자기 URL 의
 * 경로 아래만 가로챌 수 있어서 앱과 같은 스코프(루트)에서 서빙돼야 하고, dev 서버가
 * 그 자리를 주는 건 `public/` 뿐입니다. 그런데 `public/` 는 빌드 때 통째로 `dist/` 로
 * 복사되므로, 그대로 두면 목이 꺼진 프로덕션 산출물에도 실려 나갑니다.
 *
 * 자바스크립트 쪽은 이미 안 실립니다 — `main.tsx` 가 `import.meta.env` 리터럴 비교로
 * 감싸서 MSW 모듈을 통째로 떨궈 냅니다(mocks/browser.ts 주석). 남는 건 이 정적 파일
 * 하나이고, 등록하는 코드가 없으니 동작을 바꾸지는 않습니다. 그래도 지우는 이유는
 * **배포 오리진에 우리 목 워커가 공개로 놓이기 때문**입니다(`play.nutti.co.kr` 은
 * `dist/` 를 Caddy 가 그대로 서빙합니다 — deploy/Caddyfile).
 *
 * `config.env` 를 보고 판단하므로 `--mode development` 로 «목 켜진 빌드» 를 만드는
 * 경우에는 남습니다 — 그 산출물은 워커가 있어야 동작합니다.
 */
function dropMockServiceWorker(): Plugin {
  let target: string | null = null
  return {
    name: 'drop-mock-service-worker',
    apply: 'build',
    configResolved(config) {
      target =
        config.env.VITE_ENABLE_MOCKS === 'true'
          ? null
          : path.resolve(config.root, config.build.outDir, 'mockServiceWorker.js')
    },
    async closeBundle() {
      if (target) await rm(target, { force: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropMockServiceWorker()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    /**
     * vite 기본값(5173)을 일부러 피한 전용 포트입니다. 기본값을 쓰면 같은 PC 의 다른
     * vite 프로젝트와 부딪히고, 그때 vite 는 **조용히 옆 포트로 새서** 5174 로 뜹니다.
     * 그러면 5173 에는 남의 dev 서버가 앉아 있는데 이쪽 주소인 줄 알고 열게 되고,
     * 그 서버의 SPA fallback 이 `/v1/...` 에도 index.html 을 200 으로 돌려주기 때문에
     * 「상태코드는 200 인데 내 API 가 아닌」 검증이 통과해 버립니다.
     *
     * `strictPort` 는 그 상황에서 새지 말고 즉시 죽으라는 뜻입니다 — 포트가 막혀
     * 못 뜨는 건 로그에 보이지만, 옆 포트로 샌 건 안 보입니다.
     */
    port: 5190,
    strictPort: true,
    /**
     * 0.0.0.0 바인딩 — `npm run dev` 가 Local 과 함께 Network URL 도 찍습니다.
     * 같은 공유기에 붙은 휴대폰으로 실기기 확인을 하려면 이게 켜져 있어야 합니다.
     * (프록시가 있으니 로컬 백엔드 붙일 때도 같은 주소 하나로 다 됩니다.)
     */
    host: true,
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
     * (:5190)으로 붙고, 여기에 프록시가 없으면 원본 사진도 생성 결과도 전부 404 입니다
     * — API 는 멀쩡히 200 을 주는데 화면에는 이미지가 하나도 안 뜨는 상태라
     * «백엔드가 아직 안 됐나» 로 오진하기 딱 좋습니다.
     *
     * CDN_BASE_URL 이 채워진 환경에서는 절대 URL 이 와서 이 프록시를 타지 않습니다.
     */
    proxy: {
      '/v1': {
        // ponytail: 8010 임시 — 8000=lead-crawler·8001=sns-api 점유(2026-08-19), 커밋 금지
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://127.0.0.1:8010',
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
