import fs from 'node:fs';
const p='stageReflectionProbes.test.mjs'; const t=fs.readFileSync(p,'utf8'); const idx=t.indexOf("test('GLSL box projection masks"); const head=t.slice(0,idx); const tail=`test('GLSL box projection masks exact-zero divisors before division and omits inactive slabs', () => {
    const shader = probes.UNITY_REFLECTION_PROBE_SHADER
    const start = shader.indexOf('vec3 stageBoxProjectedCubemapDirection(')
    const end = shader.indexOf('\\nfloat stagePerceptualRoughnessToMipmapLevel', start)
    const body = shader.slice(start, end)
    assert.ok(body.includes('bvec3 activeAxes = notEqual(reflectionWS, vec3(0.0))'))
    assert.ok(body.includes('if (enabled > 0.5 && any(activeAxes))'))
    for (const axis of ['x', 'y', 'z']) {
        assert.ok(body.includes(`activeAxes.${axis} ? reflectionWS.${axis} : 1.0`))
    }
    assert.ok(body.includes('(boxMinMax - positionWS) / divisor'))
    assert.ok(!body.includes('/ reflectionWS'))
    assert.ok(body.includes('float fa = activeAxes.x ? rbMinMax.x : (activeAxes.y ? rbMinMax.y : rbMinMax.z)'))
    assert.ok(body.includes('if (activeAxes.y) fa = min(fa, rbMinMax.y)'))
    assert.ok(body.includes('if (activeAxes.z) fa = min(fa, rbMinMax.z)'))
    assert.ok(body.includes('return reflectionWS'))
    assert.ok(!/epsilon|1e-|0\\.000|clamp\\(/i.test(body))
})
`;
fs.writeFileSync(p,head+tail);
