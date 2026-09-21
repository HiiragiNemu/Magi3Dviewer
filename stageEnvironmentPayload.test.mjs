import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const officialRoot = path.join(root, 'public', 'stages', 'official')
const manifestPath = path.join(
    officialRoot,
    'stage-environment-payloads.generated.json',
)

const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1
            ? (value >>> 1) ^ 0xedb88320
            : value >>> 1
    }
    crcTable[index] = value >>> 0
}

function crc32Hex(bytes) {
    let value = 0xffffffff
    for (const byte of bytes) {
        value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]
    }
    return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function keyOf(record) {
    return [
        record.stageId,
        record.role,
        String(record.sourcePathID),
        record.targetUrl,
        record.encoding,
    ].join('|')
}

function profileBindings() {
    const result = []
    const profilePaths = fs.readdirSync(officialRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(officialRoot, entry.name, 'scene-profile.json'))
        .filter((profilePath) => fs.existsSync(profilePath))
        .sort()
    for (const profilePath of profilePaths) {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
        const source = profile.sourceRecords ?? {}
        const redrive = source.reDriveReflectionProbe ?? {}
        if (
            redrive.pointer?.pathID
            && redrive.environmentTextureUrl
            && redrive.environmentEncoding
        ) {
            result.push({
                stageId: profile.stageId,
                role: 'redrive-custom-reflection',
                sourcePathID: String(redrive.pointer.pathID),
                targetUrl: redrive.environmentTextureUrl,
                encoding: redrive.environmentEncoding,
            })
        }
        for (const probe of source.reflectionProbes ?? []) {
            if (
                probe.effectiveTexture?.pathID
                && probe.textureUrl
                && probe.textureEncoding
            ) {
                result.push({
                    stageId: profile.stageId,
                    role: 'reflection-probe-component',
                    sourcePathID: String(probe.effectiveTexture.pathID),
                    targetUrl: probe.textureUrl,
                    encoding: probe.textureEncoding,
                })
            }
        }
    }
    return result
}

test('generated environment manifest covers every serialized profile binding', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.schema, 'magius-stage-environment-payloads-v1')
    assert.equal(manifest.profileCount, 399)
    assert.equal(manifest.recordCount, 578)
    assert.equal(manifest.exactRecordCount, 572)
    assert.equal(manifest.transcodedRecordCount, 6)
    assert.equal(manifest.payloadByteExactRecordCount, 568)
    assert.equal(manifest.exactMismatchRecordCount, 4)
    assert.equal(manifest.recordCount, manifest.records.length)
    assert.equal(
        manifest.exactRecordCount + manifest.transcodedRecordCount,
        manifest.recordCount,
    )
    assert.deepEqual(
        manifest.records.map(keyOf).sort(),
        profileBindings().map(keyOf).sort(),
    )
})

test('every environment payload records target bytes and an explicit source comparison', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    for (const record of manifest.records) {
        assert.match(record.targetPath, /^public\/stages\/official\//)
        const targetPath = path.resolve(root, record.targetPath)
        assert.equal(
            targetPath.startsWith(`${path.resolve(officialRoot)}${path.sep}`),
            true,
        )
        const bytes = fs.readFileSync(targetPath)
        assert.equal(bytes.byteLength, record.targetByteCount, record.targetPath)
        assert.equal(crc32Hex(bytes), record.targetCrc32, record.targetPath)
        if (record.encoding === 'linear-image') {
            assert.equal(
                record.verificationMode,
                'serialized-source-and-export-container',
            )
            assert.equal(record.dataOffset, undefined)
            assert.equal(record.payloadByteExact, undefined)
            continue
        }

        assert.equal([
            'unity-bc6h-uf16',
            'unity-rgba16f',
        ].includes(record.encoding), true)
        assert.equal(bytes.subarray(0, 4).toString('ascii'), 'DDS ')
        assert.equal(record.dataOffset, 148)
        const payload = bytes.subarray(record.dataOffset)
        assert.equal(payload.byteLength, record.targetPayloadByteCount)
        assert.equal(crc32Hex(payload), record.targetPayloadCrc32)
        assert.equal(
            payload.subarray(0, 16).toString('hex'),
            record.targetPayloadFirst16,
        )
        assert.equal(
            payload.subarray(-16).toString('hex'),
            record.targetPayloadLast16,
        )
        if (record.payloadByteExact) {
            assert.equal(
                record.verificationMode,
                'serialized-payload-byte-exact',
            )
            assert.equal(payload.byteLength, record.sourcePayloadByteCount)
            assert.equal(record.targetPayloadCrc32, record.sourcePayloadCrc32)
            assert.equal(record.targetPayloadFirst16, record.sourcePayloadFirst16)
            assert.equal(record.targetPayloadLast16, record.sourcePayloadLast16)
        } else {
            assert.equal(
                record.verificationMode,
                'serialized-source-target-mismatch',
            )
            assert.notEqual(record.targetPayloadCrc32, record.sourcePayloadCrc32)
        }
    }

    assert.deepEqual(
        manifest.records
            .filter((record) => record.payloadByteExact === false)
            .map((record) => [
                record.stageId,
                record.componentPathID,
                record.sourcePathID,
            ].join('|'))
            .sort(),
        [
            'dungeon-60800-bg-3d-608-00-13-001-001|3551080673865009989|-7303154347486012131',
            'dungeon-61100-bg-3d-611-00-11-001-001|-7404328998500997614|3548923910310010466',
            'dungeon-65000-bg-3d-652-01-12-001-001|7736479510424432649|868535443454998802',
            'dungeon-65000-bg-3d-652-01-12-001-002|-6270853130413215135|-6109552195659165303',
        ].sort(),
    )
})

test('environment repair preserves Rose, Intro, Memory room and battle 616 exact routes', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const rose = manifest.records.find((record) => (
        record.stageId === 'battle-600-00-01-002'
        && record.role === 'redrive-custom-reflection'
    ))
    assert.deepEqual(
        {
            sourcePathID: rose?.sourcePathID,
            encoding: rose?.encoding,
            sourcePayloadByteCount: rose?.sourcePayloadByteCount,
            sourcePayloadCrc32: rose?.sourcePayloadCrc32,
            sourcePayloadFirst16: rose?.sourcePayloadFirst16,
            payloadByteExact: rose?.payloadByteExact,
        },
        {
            sourcePathID: '4222104510471304866',
            encoding: 'unity-bc6h-uf16',
            sourcePayloadByteCount: 32928,
            sourcePayloadCrc32: 'bfc76fdd',
            sourcePayloadFirst16: 'ee95575e010000000000942449922449',
            payloadByteExact: true,
        },
    )

    const introRecords = manifest.records.filter(
        (record) => record.stageId === 'dungeon-intro-0001-001',
    )
    assert.equal(introRecords.length, 2)
    assert.deepEqual(
        [...new Set(introRecords.map((record) => record.encoding))],
        ['linear-image'],
    )
    assert.deepEqual(
        [...new Set(introRecords.map((record) => record.targetUrl))],
        ['./stages/official/dungeon-intro-0001-001/ReflectionProbe-0-equirectangular.png'],
    )

    const memoryRecords = manifest.records.filter(
        (record) => record.stageId === 'gallery-memory-room-story',
    )
    assert.equal(memoryRecords.length, 2)
    assert.equal(memoryRecords.every((record) => (
        record.encoding === 'unity-rgba16f'
        && record.payloadByteExact === true
    )), true)
    assert.deepEqual(
        memoryRecords.map((record) => record.sourcePathID).sort(),
        ['-2922853838246413135', '305213154601286568'].sort(),
    )

    const protected616 = JSON.parse(fs.readFileSync(
        path.join(root, 'public', 'stages', 'catalog', 'battle-616-00-01-001.json'),
        'utf8',
    ))
    assert.equal(
        protected616.renderProfile.environmentTextureUrl,
        './stages/official/battle-616-00-01-001/ReflectionProbe-1-equirectangular.png',
    )
    assert.equal(protected616.renderProfile.environmentIntensity, 1)
    assert.equal(protected616.renderProfile.renderer.exposure, 1)
    const battle616Records = manifest.records.filter(
        (record) => record.stageId === 'battle-616-00-01-001',
    )
    assert.deepEqual(
        battle616Records.map((record) => ({
            role: record.role,
            sourcePathID: record.sourcePathID,
            encoding: record.encoding,
            targetUrl: record.targetUrl,
            targetByteCount: record.targetByteCount,
            targetCrc32: record.targetCrc32,
        })),
        [
            {
                role: 'redrive-custom-reflection',
                sourcePathID: '8367683656720248506',
                encoding: 'linear-image',
                targetUrl: './stages/official/battle-616-00-01-001/ReflectionProbe-1-equirectangular.png',
                targetByteCount: 951,
                targetCrc32: 'ed08c70a',
            },
            {
                role: 'reflection-probe-component',
                sourcePathID: '6784762475835347631',
                encoding: 'linear-image',
                targetUrl: './stages/official/battle-616-00-01-001/ReflectionProbe-0-equirectangular.png',
                targetByteCount: 153427,
                targetCrc32: '006fd8ef',
            },
        ],
    )
})
