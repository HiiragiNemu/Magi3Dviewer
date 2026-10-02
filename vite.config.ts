import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { visualizer } from "rollup-plugin-visualizer"
import { magiusCompressedAssetProxyPlugin } from './viteCompressedAssetProxy.mjs'
import { magiusStartupGuardPlugin } from './viteStartupGuard.mjs'

const lightweightDeployment = process.env.MAGIUS_DEPLOY_LIGHTWEIGHT === '1'

export default defineConfig({
  publicDir: lightweightDeployment ? false : 'public',
  base: '',
  plugins: [
    magiusStartupGuardPlugin(),
    magiusCompressedAssetProxyPlugin(),
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
    outDir: lightweightDeployment
      ? process.env.MAGIUS_DEPLOY_OUT_DIR || 'dist-deploy'
      : 'dist',
    // minify: false,
    sourcemap: true,
    // Explicit application and vendor budgets are enforced after the build.
    // This threshold catches accidental recombination while permitting the
    // isolated Three.js core chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: 'index.html',
        resourcePreview: 'resource-preview.html',
      },
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')

          // Keep the browser entry small and cache the major application
          // subsystems independently. These checks run before node_modules so
          // imported assets remain owned by their application subsystem.
          if (normalized.includes('/magia-exedra-character-three/')) {
            // The character scene imports Viewer screen/shadow passes, and
            // the Viewer manager extends the character library class. Splitting
            // this connected runtime makes the preview entry evaluate the
            // derived class before its base; keep both entry orders equivalent.
            return 'viewer-runtime'
          }
          if (normalized.includes('/src/viewer/localization/')) {
            return 'viewer-localization'
          }

          // Scene, GUI, camera and stage modules intentionally share live
          // bindings. Splitting those modules into separate manual chunks
          // creates a production-only ESM temporal-dead-zone cycle before the
          // Viewer scene is initialized. Keep that connected runtime together.
          if (normalized.includes('/src/viewer/')) {
            return 'viewer-runtime'
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
          return names.some(name => /\.(?:gz|bin)$/i.test(name))
            ? 'assets/[name]-[hash].fbxdata'
            : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
  server: {
    allowedHosts: true,
    watch: {
      // Runtime products are fetched by URL and do not need HMR. Excluding
      // their large corpora prevents the default source preview from opening
      // a file watcher for every official asset.
      ignored: [
        '**/artifacts/**',
        '**/dist*/**',
        '**/public/stages/**',
        '**/public/character-actions/**',
        '**/public/vfx/**',
        '**/magia-exedra-character-three/models/**',
      ],
    },
  }
})
