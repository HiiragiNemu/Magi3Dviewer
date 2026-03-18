import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { visualizer } from "rollup-plugin-visualizer"

export default defineConfig({
  base: '',
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    basicSsl(),
    visualizer(),
  ],
  build: {
    // minify: false,
    sourcemap: true,
  },
  server: {
    allowedHosts: true
  }
})