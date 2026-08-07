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

TARGET_BUNDLE = 'battle/character/chara_100101_battle_unit'
TARGET_MATERIAL = 'mt_chara_100101_body_sj'
OUTPUT = Path('research/official-redrive-modern-shader-blob.json')


def summarize(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytearray):
        value = bytes(value)
    if isinstance(value, bytes):
        return {
            'type': 'bytes',
            'length': len(value),
            'sha256': hashlib.sha256(value).hexdigest(),
            'headHex': value[:64].hex(),
            'tailHex': value[-64:].hex() if value else '',
        }
    if depth >= 7:
        if isinstance(value, (list, tuple, dict)):
            return {'type': type(value).__name__, 'length': len(value)}
        return {'type': type(value).__name__, 'repr': repr(value)[:500]}
    if isinstance(value, dict):
        return {str(key): summarize(child, depth + 1) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        if len(value) <= 512 and all(
            item is None or isinstance(item, (str, int, float, bool))
            for item in value
        ):
            return list(value)
        return {
            'type': type(value).__name__,
            'length': len(value),
            'items': [summarize(item, depth + 1) for item in list(value)[:64]],
            'truncated': len(value) > 64,
        }
    return {'type': type(value).__name__, 'repr': repr(value)[:1000]}


def find_material_and_shader(env: Any):
    for obj in env.objects:
        if str(getattr(getattr(obj, 'type', None), 'name', '')) != 'Material':
            continue
        try:
            material = obj.read()
        except Exception:
            continue
        name = str(getattr(material, 'm_Name', '')).strip().lower()
        if name != TARGET_MATERIAL:
            continue
        pointer = getattr(material, 'm_Shader', None)
        if pointer is None:
            raise RuntimeError('target Material has no Shader PPtr')
        shader = pointer.read()
        shader_path_id = int(getattr(pointer, 'm_PathID', 0) or 0)
        candidates = [
            reader for reader in env.objects
            if int(getattr(reader, 'path_id', 0) or 0) == shader_path_id
            and str(getattr(getattr(reader, 'type', None), 'name', '')) == 'Shader'
        ]
        if not candidates:
            raise RuntimeError(
                f'Shader PPtr read succeeded but no Shader ObjectReader exists for PathID {shader_path_id}'
            )
        # A PathID may be repeated across different SerializedFiles. Prefer the
        # candidate whose parsed object has the same generated-object identity
        # fields, then fall back to the first exact type/path match.
        shader_reader = candidates[0]
        for candidate in candidates:
            try:
                candidate_shader = candidate.read()
            except Exception:
                continue
            if type(candidate_shader) is type(shader):
                shader_reader = candidate
                break
        return obj, material, pointer, shader_reader, shader
    raise RuntimeError(f'{TARGET_MATERIAL} not found')


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-modern-shader-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        character_entries = [
            entry for entry in entries
            if entry.full_path.lower() == TARGET_BUNDLE
        ]
        shader_entries = [
            entry for entry in entries
            if entry.full_path.lower().startswith(('shader/', 'shaders/'))
        ]
        selected = sorted(
            {entry.full_path: entry for entry in [*character_entries, *shader_entries]}.values(),
            key=lambda item: item.full_path,
        )
        if len(character_entries) != 1 or not shader_entries:
            raise RuntimeError('bounded character/shader workspace could not be selected')
        downloaded = [base.download(entry, request_headers, token, temp) for entry in selected]
        env = UnityPy.load(*(str(path) for path in downloaded))
        material_obj, material, pointer, shader_reader, shader = find_material_and_shader(env)

        try:
            tree = shader_reader.read_typetree()
        except Exception as exc:
            tree = {'typetreeError': repr(exc)}
        raw = shader_reader.get_raw_data()
        raw_bytes = raw.tobytes() if hasattr(raw, 'tobytes') else bytes(raw)

        attr_names = [
            name for name in dir(shader)
            if any(token in name.lower() for token in (
                'blob', 'compress', 'decompress', 'platform', 'offset',
                'parsed', 'dependency', 'name', 'subprogram', 'program',
            ))
            and not name.startswith('__')
        ]
        attrs = {}
        for name in sorted(set(attr_names)):
            try:
                value = getattr(shader, name)
            except Exception as exc:
                attrs[name] = {'error': repr(exc)}
                continue
            if callable(value):
                attrs[name] = {'callable': True}
            else:
                attrs[name] = summarize(value)

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-character-plus-shader-workspace',
            'metadata': metadata,
            'targetBundle': TARGET_BUNDLE,
            'shaderBundleCount': len(shader_entries),
            'material': {
                'name': str(getattr(material, 'm_Name', '')),
                'pathId': int(getattr(material_obj, 'path_id', 0) or 0),
                'shaderPointer': {
                    'fileId': int(getattr(pointer, 'm_FileID', 0) or 0),
                    'pathId': int(getattr(pointer, 'm_PathID', 0) or 0),
                },
            },
            'shader': {
                'pythonType': type(shader).__name__,
                'name': str(getattr(shader, 'm_Name', '')),
                'pathId': int(getattr(shader_reader, 'path_id', 0) or 0),
                'serializedFile': str(getattr(getattr(shader_reader, 'assets_file', None), 'name', '')),
                'rawObject': {
                    'length': len(raw_bytes),
                    'sha256': hashlib.sha256(raw_bytes).hexdigest(),
                    'headHex': raw_bytes[:128].hex(),
                    'tailHex': raw_bytes[-128:].hex() if raw_bytes else '',
                },
                'typetree': summarize(tree),
                'selectedAttributes': attrs,
            },
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'shaderName': report['shader']['name'],
            'shaderPathId': report['shader']['pathId'],
            'serializedFile': report['shader']['serializedFile'],
            'rawLength': report['shader']['rawObject']['length'],
            'typetreeTopKeys': sorted(tree.keys()) if isinstance(tree, dict) else [],
            'selectedAttributeKeys': sorted(attrs),
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
