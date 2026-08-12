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
})
