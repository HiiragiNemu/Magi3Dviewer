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
    rollupOptions: {
      output: {
        /**
         * Keep gzip-compressed FBX/animation payloads, but do not expose a
         * `.gz` browser URL. Download-manager extensions such as IDM otherwise
         * intercept Three.js fetch requests as user downloads. `.bin` is also
         * in IDM's default capture list, so use a project-specific suffix. The
         * loader detects gzip by its magic bytes; the rename is lossless.
         */
        assetFileNames(assetInfo) {
          const names = [
            assetInfo.name,
            ...(assetInfo.names ?? []),
            ...(assetInfo.originalFileNames ?? []),
          ].filter((name): name is string => typeof name === 'string')
          return names.some(name => name.toLowerCase().endsWith('.gz'))
            ? 'assets/[name]-[hash].fbxdata'
            : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
  server: {
    allowedHosts: true
  }
})
