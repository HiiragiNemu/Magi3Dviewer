import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

const root = process.cwd()
const stageDir = path.join(root, 'public/stages/official/battle-608-00-00-001')
const stageDefPath = path.join(root, 'public/stages/catalog/battle-608-00-00-001.json')
const outPath = path.join(root, 'research/stage-608-material-uv-audit.json')

function pngInfo(file) {
  const data = fs.readFileSync(file)
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bytes: data.length,
  }
}

function finiteRange(attribute, geometry, group) {
  if (!attribute) return null
  const index = geometry.index
  const start = Math.max(0, group?.start ?? 0)
  const count = group?.count ?? (index ? index.count : attribute.count)
  const stop = Math.min(start + count, index ? index.count : attribute.count)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let visited = 0
  for (let cursor = start; cursor < stop; cursor++) {
    const vertex = index ? index.getX(cursor) : cursor
    if (vertex < 0 || vertex >= attribute.count) continue
    const x = attribute.getX(vertex)
    const y = attribute.getY(vertex)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    visited++
  }
  if (!visited) return null
  return {
    visited,
    min: [minX, minY],
    max: [maxX, maxY],
    span: [maxX - minX, maxY - minY],
    outside01: minX < -1e-5 || minY < -1e-5 || maxX > 1.00001 || maxY > 1.00001,
  }
}

function materialNames(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.map((material, index) => material?.name || `${mesh.name}:material-${index}`)
}

const definition = JSON.parse(fs.readFileSync(stageDefPath, 'utf8'))
const fbxFile = fs.readdirSync(stageDir).find(name => /animated\.fbxdata$/i.test(name))
if (!fbxFile) throw new Error('animated 608 FBX payload not found')
let bytes = fs.readFileSync(path.join(stageDir, fbxFile))
const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b
if (gzip) bytes = zlib.gunzipSync(bytes)
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const manager = new THREE.LoadingManager()
manager.setURLModifier(url => {
  if (/\.(png|jpg|jpeg|tga)$/i.test(url)) return 'data:,'
  return url
})
const loader = new FBXLoader(manager)
const object = loader.parse(arrayBuffer, `file://${stageDir}/`)
object.updateMatrixWorld(true)

const meshes = []
object.traverse(child => {
  if (!child.isMesh) return
  const geometry = child.geometry
  const names = materialNames(child)
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: geometry.index?.count ?? geometry.attributes.position?.count ?? 0, materialIndex: 0 }]
  const groupAudit = groups.map((group, index) => ({
    groupIndex: index,
    materialIndex: group.materialIndex ?? 0,
    materialName: names[group.materialIndex ?? 0] ?? null,
    start: group.start,
    count: group.count,
    uv: finiteRange(geometry.attributes.uv, geometry, group),
    uv1: finiteRange(geometry.attributes.uv1, geometry, group),
    uv2: finiteRange(geometry.attributes.uv2, geometry, group),
  }))
  const box = new THREE.Box3().setFromObject(child)
  meshes.push({
    name: child.name,
    type: child.type,
    materials: names,
    attributes: Object.keys(geometry.attributes),
    indexed: Boolean(geometry.index),
    indexCount: geometry.index?.count ?? null,
    vertexCount: geometry.attributes.position?.count ?? null,
    groups: groupAudit,
    worldBounds: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
  })
})

const pngs = fs.readdirSync(stageDir)
  .filter(name => name.toLowerCase().endsWith('.png'))
  .map(name => ({ name, ...pngInfo(path.join(stageDir, name)) }))
  .sort((a, b) => a.name.localeCompare(b.name))

const materialBindingMap = new Map((definition.materialBindings ?? []).map(binding => [binding.materialName, binding]))
const namedGroups = meshes.flatMap(mesh => mesh.groups.map(group => ({ mesh: mesh.name, ...group })))
const materialCoverage = [...new Set(namedGroups.map(group => group.materialName).filter(Boolean))]
  .sort()
  .map(name => ({
    materialName: name,
    binding: materialBindingMap.get(name) ?? null,
    groups: namedGroups.filter(group => group.materialName === name),
  }))

const report = {
  schemaVersion: 1,
  source: 'deployed-magius3dviewer-public-stage-package',
  stageId: definition.id,
  assetBundleName: definition.assetBundleName,
  fbx: { file: fbxFile, gzip, decodedBytes: bytes.length },
  meshCount: meshes.length,
  textureCount: pngs.length,
  pngs,
  materialCoverage,
  meshes,
}
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({
  stageId: report.stageId,
  meshCount: report.meshCount,
  textureCount: report.textureCount,
  materialCount: report.materialCoverage.length,
  outside01Groups: namedGroups.filter(group => group.uv?.outside01).length,
}, null, 2))
