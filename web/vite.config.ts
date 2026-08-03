import { defineConfig } from 'vite'
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
     */
    proxy: {
      '/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
