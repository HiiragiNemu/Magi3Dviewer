import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { visualizer } from "rollup-plugin-visualizer"

export default defineConfig({
  base: '',
  plugins: [
    legacy({
      // tested working on chrome 61, firefox 68
      targets: ['chrome >= 49'],
      modernTargets: ['chrome >= 60'],
      modernPolyfills: true,
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