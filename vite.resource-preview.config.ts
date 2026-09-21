import { defineConfig } from 'vite'
import { magiusCompressedAssetProxyPlugin } from './viteCompressedAssetProxy.mjs'

/** Isolated HTTP-only acceptance server; shared Viewer HTTPS config is untouched. */
export default defineConfig({
  base: '',
  plugins: [magiusCompressedAssetProxyPlugin()],
  server: {
    allowedHosts: true,
    https: false,
    watch: {
      ignored: ['**/artifacts/**', '**/work/**', '**/public/**'],
    },
  },
})
