#!/usr/bin/env python3
"""Audit animation-family structure across every bundled character FBX.

This parser reads the binary FBX object/connection graph but deliberately skips
large geometry, skin-weight and key arrays. The purpose is to verify the export
convention that one logical animation can consist of a full-body clip and one or
more partial/weapon companions whose numeric suffix is not semantically stable.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import struct
from pathlib import Path
from typing import Any


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0
        self.version = 0
        self.is64 = False

    def read(self, count: int) -> bytes:
        value = self.data[self.pos:self.pos + count]
        self.pos += count
        return value

    def u8(self): return self.read(1)[0]
    def u32(self): return struct.unpack('<I', self.read(4))[0]
    def u64(self): return struct.unpack('<Q', self.read(8))[0]
    def i16(self): return struct.unpack('<h', self.read(2))[0]
    def i32(self): return struct.unpack('<i', self.read(4))[0]
    def i64(self): return struct.unpack('<q', self.read(8))[0]
    def f32(self): return struct.unpack('<f', self.read(4))[0]
    def f64(self): return struct.unpack('<d', self.read(8))[0]


def read_property(reader: Reader) -> Any:
    kind = chr(reader.u8())
    if kind == 'Y': return reader.i16()
    if kind == 'C': return bool(reader.u8())
    if kind == 'I': return reader.i32()
    if kind == 'F': return reader.f32()
    if kind == 'D': return reader.f64()
    if kind == 'L': return reader.i64()
    if kind in 'SR':
        length = reader.u32()
        raw = reader.read(length)
        return raw.decode('utf-8', 'replace') if kind == 'S' else raw
    if kind in 'fdilbc':
        length = reader.u32()
        encoding = reader.u32()
        compressed_length = reader.u32()
        reader.read(compressed_length)
        return {'arrayType': kind, 'length': length, 'encoding': encoding}
    raise ValueError(f'Unknown FBX property {kind!r} at {reader.pos - 1}')


class Node:
    __slots__ = ('name', 'props', 'children', 'end')

    def __init__(self, name: str, props: list[Any], children: list['Node'], end: int):
        self.name = name
        self.props = props
        self.children = children
        self.end = end


def read_node(reader: Reader) -> Node | None:
    if reader.is64:
        end = reader.u64()
        property_count = reader.u64()
        property_length = reader.u64()
    else:
        end = reader.u32()
        property_count = reader.u32()
        property_length = reader.u32()
    name_length = reader.u8()
    if end == 0 and property_count == 0 and property_length == 0 and name_length == 0:
        return None
    name = reader.read(name_length).decode('utf-8', 'replace')
    props = [read_property(reader) for _ in range(property_count)]
    children: list[Node] = []
    null_length = 25 if reader.is64 else 13
    while reader.pos < end - null_length:
        child = read_node(reader)
        if child is None:
            break
        children.append(child)
    if end > len(reader.data) or end < reader.pos:
        raise ValueError(f'Invalid FBX node end {end}, current {reader.pos}, node {name}')
    reader.pos = end
    return Node(name, props, children, end)


def parse_fbx(data: bytes) -> tuple[int, list[Node]]:
    if not data.startswith(b'Kaydara FBX Binary  \x00\x1a\x00'):
        raise ValueError('Not a binary FBX')
    reader = Reader(data)
    reader.pos = 23
    reader.version = reader.u32()
    reader.is64 = reader.version >= 7500
    roots: list[Node] = []
    while reader.pos < len(data):
        try:
            node = read_node(reader)
        except (IndexError, struct.error):
            break
        if node is None:
            break
        roots.append(node)
    return reader.version, roots


def find_child(nodes: list[Node], name: str) -> Node | None:
    return next((node for node in nodes if node.name == name), None)


def clean_name(value: Any) -> str:
    return str(value).split('::', 1)[-1].replace('\x00\x01', '::')


def family_name(name: str) -> str:
    name = re.sub(r'_weapon_[a-z0-9]+(?=_|$)', '', name, flags=re.I)
    return re.sub(r'_\d+$', '', name)


def analyze(path: Path) -> dict[str, Any]:
    with gzip.open(path, 'rb') as stream:
        data = stream.read()
    version, roots = parse_fbx(data)
    objects_node = find_child(roots, 'Objects')
    connections_node = find_child(roots, 'Connections')
    objects: dict[int, dict[str, str]] = {}
    by_type: dict[str, list[int]] = {}
    if objects_node:
        for node in objects_node.children:
            if not node.props or not isinstance(node.props[0], int):
                continue
            object_id = node.props[0]
            objects[object_id] = {
                'type': node.name,
                'name': clean_name(node.props[1]) if len(node.props) > 1 else '',
            }
            by_type.setdefault(node.name, []).append(object_id)

    children: dict[int, list[int]] = {}
    parents: dict[int, list[int]] = {}
    if connections_node:
        for node in connections_node.children:
            if node.name != 'C' or len(node.props) < 3:
                continue
            connection_type, source, destination = node.props[:3]
            if connection_type == 'OO' and isinstance(source, int) and isinstance(destination, int):
                children.setdefault(destination, []).append(source)
                parents.setdefault(source, []).append(destination)

    stacks: list[dict[str, Any]] = []
    for stack_id in by_type.get('AnimationStack', []):
        layers = [
            item for item in children.get(stack_id, [])
            if objects.get(item, {}).get('type') == 'AnimationLayer'
        ]
        if not layers:
            layers = [
                item for item in parents.get(stack_id, [])
                if objects.get(item, {}).get('type') == 'AnimationLayer'
            ]
        curve_nodes: list[int] = []
        for layer_id in layers:
            curve_nodes.extend(
                item for item in children.get(layer_id, [])
                if objects.get(item, {}).get('type') == 'AnimationCurveNode'
            )
            curve_nodes.extend(
                item for item in parents.get(layer_id, [])
                if objects.get(item, {}).get('type') == 'AnimationCurveNode'
            )
        stacks.append({
            'name': objects[stack_id]['name'],
            'family': family_name(objects[stack_id]['name']),
            'curveNodes': len(set(curve_nodes)),
        })

    families: dict[str, list[dict[str, Any]]] = {}
    for stack in stacks:
        families.setdefault(stack['family'], []).append(stack)
    multi = {key: value for key, value in families.items() if len(value) > 1}
    numbered_base = 0
    unnumbered_base = 0
    for clips in multi.values():
        largest = max(clips, key=lambda item: item['curveNodes'])
        if re.search(r'_\d+$', largest['name']):
            numbered_base += 1
        else:
            unnumbered_base += 1

    character_match = re.search(r'chara_(\d+)_battle_unit', path.as_posix())
    return {
        'characterId': int(character_match.group(1)) if character_match else None,
        'path': path.as_posix(),
        'fbxVersion': version,
        'animationStackCount': len(stacks),
        'multiClipFamilyCount': len(multi),
        'numberedBaseFamilyCount': numbered_base,
        'unnumberedBaseFamilyCount': unnumbered_base,
        'mixedBaseNaming': numbered_base > 0 and unnumbered_base > 0,
        'families': multi,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('magia-exedra-character-three/models'))
    parser.add_argument('--out', type=Path, default=Path('/tmp/all-character-animation-family-audit.json'))
    parser.add_argument('--minimum-models', type=int, default=90)
    args = parser.parse_args()

    paths = sorted(args.root.glob('chara_*_battle_unit/VisualRoot.fbx.gz'))
    results = []
    failures = []
    for path in paths:
        try:
            results.append(analyze(path))
        except Exception as error:
            failures.append({'path': path.as_posix(), 'error': repr(error)})

    summary = {
        'modelCount': len(paths),
        'parsedCount': len(results),
        'parseFailureCount': len(failures),
        'charactersWithMultiClipFamilies': sum(item['multiClipFamilyCount'] > 0 for item in results),
        'charactersWithMixedBaseNaming': sum(item['mixedBaseNaming'] for item in results),
        'numberedBaseFamilies': sum(item['numberedBaseFamilyCount'] for item in results),
        'unnumberedBaseFamilies': sum(item['unnumberedBaseFamilyCount'] for item in results),
    }
    report = {'schemaVersion': 1, 'summary': summary, 'failures': failures, 'characters': results}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))

    if len(paths) < args.minimum_models:
        raise SystemExit(f'Expected at least {args.minimum_models} models, found {len(paths)}')
    if failures:
        raise SystemExit(f'{len(failures)} FBX files failed to parse')
    if summary['charactersWithMixedBaseNaming'] < 1:
        raise SystemExit('Corpus no longer demonstrates mixed animation suffix roles')


if __name__ == '__main__':
    main()
