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
    // Explicit application and vendor budgets are enforced after the build.
    // This threshold catches accidental recombination while permitting the
    // isolated Three.js core chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')

          // Keep the browser entry small and cache the major application
          // subsystems independently. These checks run before node_modules so
          // imported assets remain owned by their application subsystem.
          if (normalized.includes('/magia-exedra-character-three/')) {
            return 'character-runtime'
          }
          if (normalized.includes('/src/viewer/controllers/')) {
            return 'viewer-controls'
          }
          if (normalized.includes('/src/viewer/camera/')) {
            return 'viewer-camera'
          }
          if (normalized.includes('/src/viewer/localization/')) {
            return 'viewer-localization'
          }
          if (normalized.includes('/src/viewer/stage') ||
              normalized.endsWith('/src/viewer/stages.ts') ||
              normalized.endsWith('/src/viewer/reDriveVolumeRuntime.ts')) {
            return 'viewer-stage'
          }

          if (!normalized.includes('/node_modules/')) return undefined
          if (normalized.includes('/three/examples/jsm/postprocessing/') ||
              normalized.includes('/three/examples/jsm/shaders/')) {
            return 'three-postprocessing'
          }
          if (normalized.includes('/three/examples/jsm/loaders/')) return 'three-loaders'
          if (normalized.includes('/three/examples/jsm/controls/')) return 'three-controls'
          if (normalized.includes('/three/examples/jsm/libs/')) return 'three-libs'
          if (normalized.includes('/node_modules/three/')) return 'three-core'
          if (normalized.includes('/node_modules/@tweenjs/')) return 'tween'
          if (normalized.includes('/node_modules/fflate/')) return 'fflate'
          if (normalized.includes('/node_modules/lz-string/')) return 'lz-string'
          return 'vendor'
        },
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
