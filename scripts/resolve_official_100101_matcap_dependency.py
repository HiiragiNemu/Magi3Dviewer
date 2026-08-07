#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base

ROOT_NAME = 'android'
TARGET_BUNDLE = 'battle/character/chara_100101_battle_unit'
TARGET_MATERIALS = {
    'mt_chara_100101_body_sj',
    'mt_chara_100101_weapon_a_sj',
}
OUTPUT = Path('research/official-100101-matcap-resolution.json')


def pair_list(value: Any) -> list[tuple[int, Any]]:
    if isinstance(value, dict):
        return sorted((int(key), item) for key, item in value.items())
    result = []
    if not isinstance(value, list):
        return result
    for item in value:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            result.append((int(item[0]), item[1]))
        elif isinstance(item, dict):
            if 'first' in item and 'second' in item:
                result.append((int(item['first']), item['second']))
            elif 'key' in item and 'value' in item:
                result.append((int(item['key']), item['value']))
    return sorted(result)


def child(value: Any, key: str, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def manifest_graph(root_path: Path) -> dict[str, list[str]]:
    env = UnityPy.load(str(root_path))
    candidates = []
    for obj in env.objects:
        if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'AssetBundleManifest':
            continue
        tree = obj.read_typetree()
        if isinstance(tree, dict):
            candidates.append(tree)
    if len(candidates) != 1:
        raise RuntimeError(f'expected one AssetBundleManifest, got {len(candidates)}')
    tree = candidates[0]
    names = {index: str(name).replace('\\', '/').strip('/') for index, name in pair_list(tree.get('AssetBundleNames', []))}
    infos = dict(pair_list(tree.get('AssetBundleInfos', [])))
    graph = {}
    for index, name in names.items():
        info = infos[index]
        dep_indices = [int(value) for value in (child(info, 'AssetBundleDependencies', []) or [])]
        graph[name] = [names[value] for value in dep_indices]
    return graph


def closure(graph: dict[str, list[str]], root: str) -> list[str]:
    folded = {key.lower(): key for key in graph}
    canonical = folded.get(root.lower())
    if not canonical:
        raise KeyError(root)
    visited = set()
    active = set()
    def visit(name: str):
        if name in visited:
            return
        if name in active:
            raise RuntimeError(f'dependency cycle at {name}')
        active.add(name)
        for dep in graph.get(name, []):
            visit(dep)
        active.remove(name)
        visited.add(name)
    visit(canonical)
    visited.remove(canonical)
    return sorted(visited, key=str.lower)


def normalized_name(name: str) -> str:
    return name.strip().replace('\x00\x01', '::').removesuffix('::Material').lower()


def iter_tex_envs(material: Any):
    saved = getattr(material, 'm_SavedProperties', None)
    values = getattr(saved, 'm_TexEnvs', None) if saved is not None else None
    if values is None:
        return
    if isinstance(values, dict):
        yield from values.items()
        return
    for item in values:
        if isinstance(item, (tuple, list)) and len(item) == 2:
            yield item[0], item[1]
        elif hasattr(item, 'first') and hasattr(item, 'second'):
            yield item.first, item.second


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-100101-matcap-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        by_name = {entry.full_path.replace('\\', '/').strip('/').lower(): entry for entry in entries}
        root_entry = by_name.get(ROOT_NAME)
        if root_entry is None:
            raise RuntimeError('current JP catalog did not expose the Android root manifest')
        root_path = base.download(root_entry, request_headers, token, temp)
        graph = manifest_graph(root_path)
        dependencies = closure(graph, TARGET_BUNDLE)
        bundle_names = [TARGET_BUNDLE, *dependencies]
        selected = []
        missing = []
        for name in bundle_names:
            entry = by_name.get(name.lower())
            if entry is None:
                missing.append(name)
            else:
                selected.append(entry)
        if missing:
            raise RuntimeError(f'catalog is missing manifest dependencies: {missing}')
        if len(selected) > 40:
            raise RuntimeError(f'unexpectedly broad character closure: {len(selected)}')

        downloaded = [base.download(entry, request_headers, token, temp) for entry in selected]
        env = UnityPy.load(*(str(path) for path in downloaded))
        results = []
        for obj in env.objects:
            if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Material':
                continue
            try:
                material = obj.read()
            except Exception:
                continue
            name = normalized_name(str(getattr(material, 'm_Name', '')))
            if name not in TARGET_MATERIALS:
                continue
            for key, tex_env in iter_tex_envs(material):
                if str(key) != '_MatCapTex':
                    continue
                pointer = getattr(tex_env, 'm_Texture', None)
                pointer_info = {
                    'fileId': int(getattr(pointer, 'm_FileID', 0) or 0) if pointer is not None else 0,
                    'pathId': int(getattr(pointer, 'm_PathID', 0) or 0) if pointer is not None else 0,
                }
                texture = None
                error = None
                try:
                    texture = pointer.read() if pointer is not None else None
                except Exception as exc:
                    error = repr(exc)
                resolved = None
                if texture is not None:
                    image_info = None
                    try:
                        image = texture.image.convert('RGBA')
                    except Exception as exc:
                        image_info = {'decodeError': repr(exc)}
                    else:
                        pixels = image.tobytes()
                        image_info = {
                            'width': image.width,
                            'height': image.height,
                            'mode': image.mode,
                            'pixelSha256': hashlib.sha256(pixels).hexdigest(),
                        }
                    resolved = {
                        'name': str(getattr(texture, 'm_Name', '')),
                        'type': type(texture).__name__,
                        'width': getattr(texture, 'm_Width', None),
                        'height': getattr(texture, 'm_Height', None),
                        'textureFormat': int(getattr(texture, 'm_TextureFormat', 0) or 0),
                        'sourceSerializedFile': str(getattr(getattr(texture, 'object_reader', None), 'assets_file', '')),
                        'image': image_info,
                    }
                results.append({
                    'material': name,
                    'pointer': pointer_info,
                    'resolveError': error,
                    'resolvedTexture': resolved,
                })

        if not results:
            raise RuntimeError('no target MatCap texture environments were found')
        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-assetbundle-manifest-closure',
            'metadata': metadata,
            'targetBundle': TARGET_BUNDLE,
            'directDependencies': graph.get(TARGET_BUNDLE, graph.get(next(key for key in graph if key.lower() == TARGET_BUNDLE.lower()), [])),
            'dependencyCount': len(dependencies),
            'dependencies': dependencies,
            'downloadedBundleCount': len(selected),
            'matCaps': results,
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
