import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  base: '',
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
  ],
  build: {
    // minify: false
  },
  server: {
    allowedHosts: true
  }
})