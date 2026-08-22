import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import * as THREE from 'three'
import { DDSLoader } from 'three/addons/loaders/DDSLoader.js'

const root = process.cwd()

test('generated stage environments preserve Unity BC6H cubemap faces and mips', () => {
    const fixtures = [
        ['battle-600-00-01-002', '4222104510471304866'],
        ['battle-601-00-01-001', '2115388511594229228'],
        ['battle-608-00-00-001', '4939737858652595000'],
    ]
    for (const [stage, pathID] of fixtures) {
        const directory = path.join(root, 'public', 'stages', 'official', stage)
        const profile = JSON.parse(fs.readFileSync(
            path.join(directory, 'scene-profile.json'),
            'utf8',
        ))
        assert.equal(profile.renderProfile.environmentEncoding, 'unity-bc6h-uf16')
        assert.equal(
            profile.sourceRecords.reDriveReflectionProbe.pointer.pathID,
            pathID,
        )
        const relativeUrl = profile.renderProfile.environmentTextureUrl
            .replace(/^\.\/stages\/official\//, '')
        const bytes = fs.readFileSync(path.join(root, 'public', 'stages', 'official', relativeUrl))
        const arrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        )
        const parsed = new DDSLoader().parse(arrayBuffer, true)
        assert.equal(parsed.isCubemap, true)
        assert.equal(parsed.format, THREE.RGB_BPTC_UNSIGNED_Format)
        assert.equal(parsed.mipmapCount, 7)
        assert.equal(parsed.mipmaps.length, 42)
        assert.equal(
            parsed.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0),
            profile.sourceRecords.reDriveReflectionProbe.export.sourcePayloadByteCount,
        )
    }
})

test('runtime uses linear BC6H and the external-cube X reflection', () => {
    const source = fs.readFileSync(
        path.join(root, 'src', 'viewer', 'stageEnvironment.ts'),
        'utf8',
    )
    assert.match(source, /EXT_texture_compression_bptc/)
    assert.match(source, /THREE\.RGB_BPTC_UNSIGNED_Format/)
    assert.match(source, /THREE\.LinearSRGBColorSpace/)
    assert.match(source, /external-cubemap-x-flip/)
})
