import { defineConfig } from 'vite'

export default defineConfig({
  // Relative paths so the packed app works from any folder inside the Even app.
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  test: { environment: 'node' },
} as never)
