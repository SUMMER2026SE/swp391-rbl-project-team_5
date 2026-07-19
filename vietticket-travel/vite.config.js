import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const devHost = env.VITE_DEV_HOST || 'localhost'
  const devPort = Number(env.VITE_DEV_PORT || 5173)
  const configuredApiTarget =
    env.VITE_API_PROXY_TARGET ||
    (/^https?:\/\//i.test(env.VITE_API_URL || '') ? env.VITE_API_URL : '') ||
    'http://localhost:5000'
  const apiTarget = configuredApiTarget.replace(/\/api\/?$/, '')

  return {
    plugins: [react()],
    server: {
      host: devHost,
      port: devPort,
      strictPort: true,
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
