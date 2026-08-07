// FBXLoader may instantiate TextureLoader for embedded/relative texture records.
// The audit only needs geometry, draw groups and UVs, so provide a minimal
// headless image element that completes loads without decoding pixels.
class HeadlessImage {
  constructor() {
    this.listeners = new Map()
  }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) ?? []
    list.push(callback)
    this.listeners.set(type, list)
  }
  removeEventListener(type, callback) {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(type, list.filter(item => item !== callback))
  }
  set src(value) {
    this._src = value
    queueMicrotask(() => {
      for (const callback of this.listeners.get('load') ?? []) {
        callback({ target: this })
      }
    })
  }
  get src() { return this._src }
}

globalThis.document = {
  createElementNS(_namespace, name) {
    if (name === 'img') return new HeadlessImage()
    return { style: {}, addEventListener() {}, removeEventListener() {} }
  },
}

await import('./audit_stage_608_material_uv.mjs')
