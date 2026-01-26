import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import { visualizer } from "rollup-plugin-visualizer"

export default defineConfig({
  base: '',
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    visualizer(),
  ],
  build: {
    // minify: false
  },
  server: {
    allowedHosts: true
  }
})