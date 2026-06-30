import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiTarget = (
    env.VITE_API_PROXY_TARGET ||
    env.VITE_API_URL ||
    'http://localhost:5000'
  ).replace(/\/api\/?$/, '')

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      include: ['src/**/*.test.{js,jsx}'],
    },
  }
})
