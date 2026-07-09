import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared')
    }
  }
})
