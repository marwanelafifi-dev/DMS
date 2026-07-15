import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// host: true so it works inside the container; the API base URL is proxied by nginx
// in the built image (see web/nginx.conf) and via /api during local dev.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
})
