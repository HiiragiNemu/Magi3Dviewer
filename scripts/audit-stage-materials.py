#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import json
import struct
from pathlib import Path
from typing import Any


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0
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
        return raw.decode('utf-8', 'replace') if kind == 'S' else {'rawBytes': length}
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
        end, prop_count, _prop_len = reader.u64(), reader.u64(), reader.u64()
    else:
        end, prop_count, _prop_len = reader.u32(), reader.u32(), reader.u32()
    name_len = reader.u8()
    if end == 0 and prop_count == 0 and name_len == 0:
        return None
    name = reader.read(name_len).decode('utf-8', 'replace')
    props = [read_property(reader) for _ in range(prop_count)]
    children: list[Node] = []
    null_len = 25 if reader.is64 else 13
    while reader.pos < end - null_len:
        child = read_node(reader)
        if child is None:
            break
        children.append(child)
    reader.pos = end
    return Node(name, props, children, end)


def parse(data: bytes) -> list[Node]:
    if not data.startswith(b'Kaydara FBX Binary  \x00\x1a\x00'):
        raise ValueError('Not binary FBX')
    reader = Reader(data)
    reader.pos = 23
    version = reader.u32()
    reader.is64 = version >= 7500
    roots = []
    while reader.pos < len(data):
        try:
            node = read_node(reader)
        except (IndexError, struct.error):
            break
        if node is None:
            break
        roots.append(node)
    return roots


def child(node: Node | None, name: str) -> Node | None:
    if node is None: return None
    return next((value for value in node.children if value.name == name), None)


def scalar_children(node: Node) -> dict[str, Any]:
    result = {}
    for item in node.children:
        if item.props:
            result[item.name] = item.props[0] if len(item.props) == 1 else item.props
    return result


def clean_name(value: Any) -> str:
    return str(value).split('::', 1)[-1].replace('\x00\x01', '::')


def analyze(path: Path) -> dict[str, Any]:
    with gzip.open(path, 'rb') as stream:
        roots = parse(stream.read())
    objects_root = next((value for value in roots if value.name == 'Objects'), None)
    connections_root = next((value for value in roots if value.name == 'Connections'), None)
    objects: dict[int, dict[str, Any]] = {}
    if objects_root:
        for node in objects_root.children:
            if not node.props or not isinstance(node.props[0], int):
                continue
            object_id = node.props[0]
            values = scalar_children(node)
            objects[object_id] = {
                'type': node.name,
                'name': clean_name(node.props[1]) if len(node.props) > 1 else '',
                'subtype': clean_name(node.props[2]) if len(node.props) > 2 else '',
                'fileName': values.get('FileName'),
                'relativeFilename': values.get('RelativeFilename'),
            }

    connections = []
    if connections_root:
        for node in connections_root.children:
            if node.name != 'C' or len(node.props) < 3:
                continue
            connections.append({
                'kind': node.props[0],
                'source': node.props[1],
                'destination': node.props[2],
                'property': node.props[3] if len(node.props) > 3 else None,
            })

    actual_files = {value.name.lower(): value.name for value in path.parent.iterdir() if value.is_file()}
    textures = []
    for object_id, value in objects.items():
        if value['type'] not in {'Texture', 'Video'}:
            continue
        raw_names = [value.get('relativeFilename'), value.get('fileName'), value.get('name')]
        candidates = []
        for raw in raw_names:
            if not raw or not isinstance(raw, str):
                continue
            base = Path(raw.replace('\\', '/')).name
            candidates.extend([base, Path(base).stem + '.png'])
        resolved = next((actual_files[name.lower()] for name in candidates if name.lower() in actual_files), None)
        textures.append({
            'id': object_id,
            **value,
            'candidates': list(dict.fromkeys(candidates)),
            'resolvedFile': resolved,
        })

    material_links = []
    for connection in connections:
        source = objects.get(connection['source'])
        destination = objects.get(connection['destination'])
        if not source or not destination:
            continue
        if source['type'] in {'Texture', 'Video'} or destination['type'] in {'Texture', 'Video'}:
            material_links.append({
                **connection,
                'sourceObject': source,
                'destinationObject': destination,
            })

    return {
        'stage': path.parent.name,
        'fbx': path.name,
        'availableFiles': sorted(value.name for value in path.parent.iterdir() if value.is_file()),
        'objectCounts': {
            kind: sum(value['type'] == kind for value in objects.values())
            for kind in sorted({value['type'] for value in objects.values()})
        },
        'materials': [
            {'id': object_id, **value}
            for object_id, value in objects.items() if value['type'] == 'Material'
        ],
        'textures': textures,
        'textureConnections': material_links,
        'resolvedTextureCount': sum(bool(value['resolvedFile']) for value in textures),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('public/stages/official'))
    parser.add_argument('--out', type=Path, default=Path('/tmp/stage-material-audit.json'))
    args = parser.parse_args()
    reports = []
    failures = []
    for path in sorted(args.root.glob('*/*.fbx.gz')):
        try:
            reports.append(analyze(path))
        except Exception as error:
            failures.append({'path': path.as_posix(), 'error': repr(error)})
    result = {
        'schemaVersion': 1,
        'stageCount': len(reports),
        'resolvedTextureCount': sum(item['resolvedTextureCount'] for item in reports),
        'failures': failures,
        'stages': reports,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('stageCount', 'resolvedTextureCount', 'failures')}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(f'{len(failures)} stage FBX files failed')


if __name__ == '__main__':
    main()
