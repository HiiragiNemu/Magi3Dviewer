import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (path) => fs.readFileSync(path, 'utf8');

const stageId = 'battle-600-00-01-002';
const revision = '61ad830ca038a9efd58e67170a61c85e';
const companionPath = 'public/stages/official/battle-600-00-01-002/uv1-companion.json';
const companionReference = './stages/official/battle-600-00-01-002/uv1-companion.json';

const runtimeDeliverySource = read('src/viewer/runtimeProductDelivery.ts');
const stageUv1Source = read('src/viewer/stageUv1Companion.ts');

function transpileModule(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function exportedFunctionSource(source, name) {
  const sourceFile = ts.createSourceFile(
    `${name}.ts`,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find(statement => (
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === name
  ));
  assert.ok(declaration, `missing ${name}`);
  return declaration.getText(sourceFile);
}

async function importModule(source) {
  return import(
    `data:text/javascript;base64,${Buffer.from(transpileModule(source)).toString('base64')}`
    + `#${Date.now()}-${Math.random()}`
  );
}

async function loadRuntimeDeliveryModule() {
  // The real telemetry dependency must also have an absolute module identity
  // when the delivery module is loaded from a data URL in this test harness.
  const telemetry = transpileModule(read('magia-exedra-character-three/loadingProgress.ts'));
  const telemetryUrl = `data:text/javascript;base64,${Buffer.from(telemetry).toString('base64')}`;
  return importModule(runtimeDeliverySource.replace(
    "'../../magia-exedra-character-three/loadingProgress.ts'",
    JSON.stringify(telemetryUrl),
  ));
}

async function loadUv1LoaderModule() {
  return importModule(exportedFunctionSource(stageUv1Source, 'loadStageUv1Companion'));
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centralEntries = [];
  let offset = 0;
  const append = bytes => {
    chunks.push(bytes);
    offset += bytes.byteLength;
  };
  const header = (length, write) => {
    const bytes = new Uint8Array(length);
    write(new DataView(bytes.buffer));
    return bytes;
  };

  for (const [name, body] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof body === 'string' ? encoder.encode(body) : body;
    const localOffset = offset;
    append(header(30, view => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);
      view.setUint32(14, crc32(data), true);
      view.setUint32(18, data.byteLength, true);
      view.setUint32(22, data.byteLength, true);
      view.setUint16(26, nameBytes.byteLength, true);
    }));
    append(nameBytes);
    append(data);
    centralEntries.push({ nameBytes, data, localOffset });
  }

  const centralOffset = offset;
  for (const entry of centralEntries) {
    append(header(46, view => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint32(16, crc32(entry.data), true);
      view.setUint32(20, entry.data.byteLength, true);
      view.setUint32(24, entry.data.byteLength, true);
      view.setUint16(28, entry.nameBytes.byteLength, true);
      view.setUint32(42, entry.localOffset, true);
    }));
    append(entry.nameBytes);
  }
  const centralBytes = offset - centralOffset;
  append(header(22, view => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, centralEntries.length, true);
    view.setUint16(10, centralEntries.length, true);
    view.setUint32(12, centralBytes, true);
    view.setUint32(16, centralOffset, true);
  }));

  const output = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return output;
}

function deliveryManifest(packUrl, zipBytes, companionBytes) {
  const gateway = new URL('/', packUrl).href.replace(/\/$/, '');
  return {
    schema: 'magius.runtime-product-delivery.v1',
    repository: 'fixture/repository',
    deliveryGateway: gateway,
    activation: {
      hosts: ['magius3dviewer.pages.dev'],
      queryOverride: 'runtimeDelivery=release',
      localMode: 'prefer-workspace-files',
    },
    counts: {
      products: 1,
      stageProducts: 1,
      enemyModels: 0,
      enemyVfxProducts: 0,
      characterVfxProducts: 0,
      releaseAssets: 1,
      unpackedBytes: companionBytes,
      packedBytes: zipBytes,
    },
    entries: [{
      stableKey: `stage|${stageId}`,
      kind: 'stage',
      rootPath: `/stages/official/${stageId}/`,
      releaseTag: 'runtime-products-v1-a',
      assetName: 'fixture-stage.zip',
      packUrl,
      originUrl: 'https://github.com/fixture/repository/releases/download/runtime-products-v1-a/fixture-stage.zip',
      fileCount: 1,
      unpackedBytes: companionBytes,
      packedBytes: zipBytes,
    }],
  };
}

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

async function withDeliveryFixture(options, callback) {
  const runtime = await loadRuntimeDeliveryModule();
  const uv1 = await loadUv1LoaderModule();
  const nativeFetch = globalThis.fetch;
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const base = 'http://127.0.0.1:6585/';
  const catalogUrl = `${base}catalogs/runtime-product-delivery.v1.json`;
  const localCompanionUrl = `${base}stages/official/${stageId}/uv1-companion.json`;
  const packUrl = 'https://runtime-gateway.invalid/runtime-products-v1-a/fixture-stage.zip';
  const companion = {
    schemaVersion: 3,
    stageId,
    sourceRevision: revision,
    sourceBundle: 'fixture',
    fbxPath: 'fixture.fbx',
    uvConvention: 'fixture',
    geometries: {},
    nodes: [],
  };
  const companionText = JSON.stringify(companion);
  const zip = storedZip({ 'uv1-companion.json': companionText });
  const manifest = deliveryManifest(packUrl, zip.byteLength, Buffer.byteLength(companionText));
  const requests = [];

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { baseURI: base },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(options.release ? `${base}?runtimeDelivery=release` : base),
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, cache: init?.cache, signal: init?.signal });
    if (url === catalogUrl) return new Response(JSON.stringify(manifest));
    if (url === packUrl) {
      return options.packStatus && options.packStatus !== 200
        ? new Response('pack failure', { status: options.packStatus })
        : new Response(zip);
    }
    if (url === localCompanionUrl) {
      return options.companionStatus && options.companionStatus !== 200
        ? new Response('companion failure', { status: options.companionStatus })
        : new Response(companionText);
    }
    if (url.startsWith('blob:')) return nativeFetch(input, init);
    throw new Error(`Unexpected fixture fetch: ${url}`);
  };

  const invoke = async (signal = new AbortController().signal) => {
    const resolvedUrl = await runtime.resolveRuntimeAssetUrl(
      companionReference,
      signal,
    );
    const loaded = await uv1.loadStageUv1Companion(resolvedUrl, signal);
    return { resolvedUrl, loaded };
  };

  try {
    await callback({ invoke, requests, catalogUrl, localCompanionUrl, packUrl });
  } finally {
    runtime.resetRuntimeProductDeliveryForTests();
    globalThis.fetch = nativeFetch;
    restoreGlobal('document', documentDescriptor);
    restoreGlobal('location', locationDescriptor);
  }
}

test('stage 600 profile opts into the exact current-JP UV1 companion', () => {
  const catalog = JSON.parse(read('public/stages/catalog.json'));
  const stages = catalog.stages.filter((stage) => stage.id === stageId);
  assert.equal(stages.length, 1);
  assert.equal(
    stages[0].renderProfile?.lightmap?.uv1CompanionUrl,
    './stages/official/battle-600-00-01-002/uv1-companion.json',
  );
});

test('stage 600 companion closes all 158 Three r182 mesh nodes', () => {
  const companion = JSON.parse(read(companionPath));
  assert.equal(companion.schemaVersion, 3);
  assert.equal(companion.stageId, stageId);
  assert.equal(companion.sourceRevision, revision);
  assert.equal(companion.nodes.length, 158);
  assert.equal(Object.keys(companion.geometries).length, 132);
  assert.match(companion.uvConvention, /CBA/);

  for (const node of companion.nodes) {
    assert.equal(typeof node.hierarchyPath, 'string');
    const geometry = companion.geometries[node.geometryKey];
    assert.ok(geometry, `missing geometry ${node.geometryKey}`);
  }
  for (const [key, geometry] of Object.entries(companion.geometries)) {
    const bytes = Buffer.from(geometry.uv1Base64, 'base64');
    assert.equal(
      bytes.length,
      geometry.vertexCount * 2 * 4,
      `wrong Float32 byte length for ${key}`,
    );
    assert.match(geometry.uv1Sha256, /^[0-9a-f]{64}$/);
  }
});

test('runtime restores uv1 before applyStageLightmaps and fails closed', () => {
  const stages = read('src/viewer/stages.ts');
  const helper = read('src/viewer/stageUv1Companion.ts');
  const uv1Apply = stages.indexOf('if (profileTextures.uv1Companion)');
  const lightmapApply = stages.indexOf(
    'if (profileTextures.lightmaps?.length && profileTextures.lightmapBindings)',
    uv1Apply,
  );
  assert.ok(uv1Apply >= 0);
  assert.ok(lightmapApply > uv1Apply);
  assert.match(stages, /applyStageUv1Companion\([\s\S]*?strict:\s*true/);
  assert.match(stages, /loadStageUv1Companion/);
  assert.match(helper, /(?:originalGeometry|clone)\.setAttribute\(\s*'uv1'/);
  assert.match(helper, /schemaVersion !== 3/);
  assert.match(helper, /schemaVersion !== 4/);
  assert.match(helper, /matchedNodeCount !== companion\.nodes\.length/);
  assert.match(helper, /describeUv1CarrierGeometryDifference/);
  assert.match(helper, /originalGeometry\.clone\(\)/);
});

test('UV1 caller resolves exactly once and preserves the abort signal', () => {
  const stages = read('src/viewer/stages.ts');
  const sourceFile = ts.createSourceFile(
    'stages.ts',
    stages,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  let uv1Branch;
  const visit = node => {
    if (
      ts.isIfStatement(node)
      && node.expression.getText(sourceFile) === 'profile.lightmap.uv1CompanionUrl'
    ) uv1Branch = node.getText(sourceFile);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(uv1Branch);
  assert.match(
    uv1Branch,
    /loadStageUv1Companion\(\s*await resolveRuntimeAssetUrl\(\s*profile\.lightmap\.uv1CompanionUrl,\s*signal,?\s*\),\s*signal,?\s*\)/,
  );
  assert.equal([...uv1Branch.matchAll(/\bresolveRuntimeAssetUrl\s*\(/g)].length, 1);
  assert.equal([...uv1Branch.matchAll(/\bloadStageUv1Companion\s*\(/g)].length, 1);
  assert.doesNotMatch(
    exportedFunctionSource(stageUv1Source, 'loadStageUv1Companion'),
    /resolveRuntimeAssetUrl/,
  );
});

test('forced release resolves UV1 through the packed stage before fetch', async () => {
  await withDeliveryFixture({ release: true }, async fixture => {
    const { resolvedUrl, loaded } = await fixture.invoke();
    assert.match(resolvedUrl, /^blob:/);
    assert.equal(loaded.stageId, stageId);
    assert.deepEqual(
      fixture.requests.map(request => request.url),
      [fixture.catalogUrl, fixture.packUrl, resolvedUrl],
    );
    assert.equal(
      fixture.requests.filter(request => request.url === fixture.localCompanionUrl).length,
      0,
    );
  });
});

test('local mode keeps the page-relative UV1 request and skips the pack', async () => {
  await withDeliveryFixture({ release: false }, async fixture => {
    const { resolvedUrl, loaded } = await fixture.invoke();
    assert.equal(resolvedUrl, fixture.localCompanionUrl);
    assert.equal(loaded.stageId, stageId);
    assert.deepEqual(
      fixture.requests.map(request => request.url),
      [fixture.catalogUrl, fixture.localCompanionUrl],
    );
    assert.equal(
      fixture.requests.filter(request => request.url === fixture.packUrl).length,
      0,
    );
  });
});

test('UV1 resolution and fetch failures both remain fail-closed', async () => {
  await withDeliveryFixture(
    { release: true, packStatus: 503 },
    async fixture => {
      await assert.rejects(
        fixture.invoke(),
        /Runtime product pack request failed: HTTP 503/,
      );
      // Delivery retries a transient 503 twice before surfacing the error;
      // none of these attempts may fall back to a page-relative companion.
      assert.deepEqual(
        fixture.requests.map(request => request.url),
        [fixture.catalogUrl, fixture.packUrl, fixture.packUrl, fixture.packUrl],
      );
    },
  );
  await withDeliveryFixture(
    { release: false, companionStatus: 404 },
    async fixture => {
      await assert.rejects(
        fixture.invoke(),
        /Could not load stage UV1 companion: 404/,
      );
      assert.deepEqual(
        fixture.requests.map(request => request.url),
        [fixture.catalogUrl, fixture.localCompanionUrl],
      );
    },
  );
});
