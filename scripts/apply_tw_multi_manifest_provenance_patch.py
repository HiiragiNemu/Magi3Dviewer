#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_source() -> None:
    path = Path('src/viewer/stageBundleProvenance.ts')
    text = path.read_text(encoding='utf-8')

    if 'manifestSources?: StageBundleManifestSource[]' not in text:
        text = replace_once(
            text,
            '    manifest: StageBundleManifestSource\n'
            '    directDependencies?: string[]\n',
            '    /** Primary manifest kept for backward-compatible JP catalogs. */\n'
            '    manifest: StageBundleManifestSource\n'
            '    /** All manifest sources used to resolve the closure; TW may have several. */\n'
            '    manifestSources?: StageBundleManifestSource[]\n'
            '    directDependencies?: string[]\n',
            'manifestSources interface field',
        )

    if 'function normalizeManifestSource(' not in text:
        anchor = 'function uniqueNormalized(values: readonly string[] | undefined): string[] | undefined {'
        index = text.find(anchor)
        if index < 0:
            raise RuntimeError('uniqueNormalized anchor missing')
        helper = """function normalizeManifestSource(
    value: StageBundleManifestSource,
): StageBundleManifestSource {
    return {
        ...value,
        path: value.path?.replaceAll('\\\\', '/'),
        sha256: value.sha256?.toLowerCase(),
    }
}

function uniqueManifestSources(
    primary: StageBundleManifestSource,
    values: readonly StageBundleManifestSource[] | undefined,
): StageBundleManifestSource[] {
    const result: StageBundleManifestSource[] = []
    const seen = new Set<string>()
    for (const value of [primary, ...(values ?? [])]) {
        const normalized = normalizeManifestSource(value)
        const key = JSON.stringify([
            normalized.region,
            normalized.kind,
            normalized.repository ?? null,
            normalized.revision ?? null,
            normalized.path ?? null,
            normalized.sha256 ?? null,
        ])
        if (seen.has(key)) continue
        seen.add(key)
        result.push(normalized)
    }
    return result
}

"""
        text = text[:index] + helper + text[index:]

    old_manifest = """        manifest: {
            ...value.manifest,
            path: value.manifest.path?.replaceAll('\\\\', '/'),
            sha256: value.manifest.sha256?.toLowerCase(),
        },
"""
    new_manifest = """        manifest: normalizeManifestSource(value.manifest),
        manifestSources: uniqueManifestSources(
            value.manifest,
            value.manifestSources,
        ),
"""
    if old_manifest in text:
        text = replace_once(text, old_manifest, new_manifest, 'normalized manifest sources')
    elif 'manifestSources: uniqueManifestSources(' not in text:
        raise RuntimeError('normalize provenance manifest anchor missing')

    old_validate = """    assertSha256(value.manifest.sha256, 'manifest.sha256')
    assertSha256(value.closureSha256, 'closureSha256')

    const direct = uniqueNormalized(value.directDependencies) ?? []
"""
    new_validate = """    assertSha256(value.manifest.sha256, 'manifest.sha256')
    const manifestSources = [value.manifest, ...(value.manifestSources ?? [])]
    for (const [index, source] of manifestSources.entries()) {
        assertSha256(source.sha256, `manifestSources[${index}].sha256`)
        if (source.region !== value.manifest.region) {
            throw new Error(
                `Stage bundle provenance mixed regions: ${value.manifest.region} / ${source.region}`,
            )
        }
    }
    assertSha256(value.closureSha256, 'closureSha256')

    const direct = uniqueNormalized(value.directDependencies) ?? []
"""
    if old_validate in text:
        text = replace_once(text, old_validate, new_validate, 'multi-manifest validation')
    elif 'Stage bundle provenance mixed regions' not in text:
        raise RuntimeError('provenance validation anchor missing')

    path.write_text(text, encoding='utf-8')


def patch_package() -> None:
    path = Path('package.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    script = data['scripts']['test:release']
    test_name = 'stageBundleMultiManifest.test.mjs'
    if test_name not in script:
        parts = script.split()
        parts.insert(parts.index('--test') + 1, test_name)
        data['scripts']['test:release'] = ' '.join(parts)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    patch_source()
    patch_package()
    print('Applied TW multi-manifest provenance patch')
