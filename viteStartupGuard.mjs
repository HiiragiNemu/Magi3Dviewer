import { readFileSync } from 'node:fs'

/** Inline before the module graph: a failed module cannot hide its own error UI. */
export function magiusStartupGuardPlugin() {
  const source = readFileSync(new URL('./src/startupGuard.js', import.meta.url), 'utf8')
  if (/<\/script/i.test(source)) throw new Error('Startup guard contains a closing script tag')
  return {
    name: 'magius-startup-guard',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, context) {
        if (!context.filename.replaceAll('\\', '/').endsWith('/index.html')) return []
        return [{ tag: 'script', attrs: { id: 'magius-startup-guard' }, children: source, injectTo: 'head-prepend' }]
      },
    },
  }
}
