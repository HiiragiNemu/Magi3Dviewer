#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base
import resolve_official_608_particle_texture as closure

TARGET_STAGE_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
MATERIAL_REPORT = Path('research/official-608-sprite-material-modes.json')
OUTPUT = Path('research/official-608-sprite-renderer-mesh-uv.json')
TARGETS = {
    'bg3d608_00_blue_ChairCD',
    'mt_bg3d608_00_red_MusicNoteA',
    'mt_bg3d608_00_red_MusicNoteB',
    'mt_bg3d608_00_red_MusicNoteC',
    'mt_bg3d608_00_red_violinCol',
    'mt_bg3d608_00_red_violinShdLine',
}


def normalize_cab(value: Any) -> str:
    return str(value).replace('\\', '/').rsplit('/', 1)[-1].lower()


def source_cab(obj: Any) -> str:
    return normalize_cab(getattr(getattr(obj, 'assets_file', None), 'name', ''))


def external_cab(obj: Any, file_id: int) -> str:
    if file_id == 0:
        return source_cab(obj)
    assets_file = getattr(obj, 'assets_file', None)
    externals = list(getattr(assets_file, 'externals', []) or [])
    if file_id < 1 or file_id > len(externals):
        raise RuntimeError(
            f'{source_cab(obj)}: external fileID {file_id} outside 1..{len(externals)}'
        )
    external = externals[file_id - 1]
    return normalize_cab(
        getattr(external, 'name', '') or getattr(external, 'path', '')
    )


def pointer_pair(value: Any) -> tuple[int, int]:
    if not isinstance(value, dict):
        return 0, 0
    return int(value.get('m_FileID', 0) or 0), int(value.get('m_PathID', 0) or 0)


def object_key(obj: Any) -> tuple[str, int]:
    return source_cab(obj), int(getattr(obj, 'path_id', 0) or 0)


def resolve_pointer(
    object_index: dict[tuple[str, int], Any],
    source_obj: Any,
    file_id: int,
    path_id: int,
) -> Any | None:
    if path_id == 0:
        return None
    return object_index.get((external_cab(source_obj, file_id), path_id))


def safe_name(obj: Any) -> str:
    if obj is None:
        return ''
    try:
        return str(obj.peek_name())
    except Exception:
        try:
            tree = obj.read_typetree()
            return str(tree.get('m_Name', '')) if isinstance(tree, dict) else ''
        except Exception:
            return ''


def parse_obj_uv(mesh_obj: Any) -> dict[str, Any]:
    try:
        mesh = mesh_obj.read()
        exported = mesh.export()
    except Exception as exc:
        return {
            'status': 'unavailable',
            'error': f'{type(exc).__name__}: {exc}',
        }
    if isinstance(exported, bytes):
        exported = exported.decode('utf-8', errors='replace')
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    for line in str(exported).splitlines():
        if line.startswith('v '):
            fields = line.split()
            if len(fields) >= 4:
                vertices.append(tuple(float(value) for value in fields[1:4]))
        elif line.startswith('vt '):
            fields = line.split()
            if len(fields) >= 3:
                uvs.append((float(fields[1]), float(fields[2])))

    def finite_range(values: list[float]) -> list[float] | None:
        finite = [value for value in values if math.isfinite(value)]
        return [min(finite), max(finite)] if finite else None

    outside = [
        uv for uv in uvs
        if uv[0] < 0 or uv[0] > 1 or uv[1] < 0 or uv[1] > 1
    ]
    return {
        'status': 'derived-from-UnityPy-Mesh.export-OBJ',
        'vertexCount': len(vertices),
        'uv0Count': len(uvs),
        'uRange': finite_range([uv[0] for uv in uvs]),
        'vRange': finite_range([uv[1] for uv in uvs]),
        'outsideUnitSquareCount': len(outside),
        'outsideUnitSquareFraction': (len(outside) / len(uvs)) if uvs else 0,
        'note': (
            'UV min/max is a deterministic derived diagnostic from UnityPy Mesh.export OBJ, '
            'not a claim about ReDrive shader UV selection. Raw vertex channel metadata is '
            'reported separately from the serialized Mesh typetree.'
        ),
    }


def compact_mesh(mesh_obj: Any) -> dict[str, Any]:
    tree = mesh_obj.read_typetree()
    if not isinstance(tree, dict):
        raise TypeError('Mesh typetree is not a dictionary')
    vertex_data = tree.get('m_VertexData') or {}
    channels = vertex_data.get('m_Channels') if isinstance(vertex_data, dict) else None
    return {
        'name': str(tree.get('m_Name', '')),
        'serializedFile': source_cab(mesh_obj),
        'pathId': str(int(getattr(mesh_obj, 'path_id', 0) or 0)),
        'subMeshCount': len(tree.get('m_SubMeshes') or []),
        'vertexCountSerialized': (
            int(vertex_data.get('m_VertexCount', 0) or 0)
            if isinstance(vertex_data, dict) else None
        ),
        'vertexChannels': base.jsonable(channels),
        'localAABB': base.jsonable(tree.get('m_LocalAABB')),
        'objDerivedUv0': parse_obj_uv(mesh_obj),
    }


def compact_texture(texture_obj: Any) -> dict[str, Any]:
    tree = texture_obj.read_typetree()
    if not isinstance(tree, dict):
        raise TypeError('Texture2D typetree is not a dictionary')
    return {
        'name': str(tree.get('m_Name', '')),
        'serializedFile': source_cab(texture_obj),
        'pathId': str(int(getattr(texture_obj, 'path_id', 0) or 0)),
        'width': tree.get('m_Width'),
        'height': tree.get('m_Height'),
        'textureFormat': tree.get('m_TextureFormat'),
        'mipCount': tree.get('m_MipCount'),
        'colorSpace': tree.get('m_ColorSpace'),
        'isReadable': tree.get('m_IsReadable'),
        'textureSettings': base.jsonable(tree.get('m_TextureSettings')),
    }


def main() -> int:
    compact_report = json.loads(MATERIAL_REPORT.read_text(encoding='utf-8'))
    materials_from_report = {
        item['name']: item
        for item in compact_report.get('materials', [])
        if isinstance(item, dict) and item.get('name') in TARGETS
    }
    missing_report = sorted(TARGETS - set(materials_from_report))
    if missing_report:
        raise RuntimeError(f'compact material report missing targets: {missing_report}')

    with tempfile.TemporaryDirectory(prefix='magius-608-sprite-uv-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        by_name = {closure.normalize_name(entry.full_path).lower(): entry for entry in entries}
        dependencies, bounded_record = closure.current_dependencies(metadata)
        bundle_names = [TARGET_STAGE_BUNDLE, *dependencies]
        selected_entries = []
        for name in bundle_names:
            entry = by_name.get(name.lower())
            if entry is None:
                raise RuntimeError(f'current-JP 608 dependency absent from catalog: {name}')
            selected_entries.append(entry)
        paths = [
            base.download(entry, request_headers, token, temp)
            for entry in selected_entries
        ]
        env = UnityPy.load(*(str(path) for path in paths))
        objects = list(env.objects)
        object_index = {object_key(obj): obj for obj in objects}

        material_objects = {
            safe_name(obj): obj
            for obj in objects
            if str(getattr(getattr(obj, 'type', None), 'name', '')) == 'Material'
            and safe_name(obj) in TARGETS
        }
        missing_materials = sorted(TARGETS - set(material_objects))
        if missing_materials:
            raise RuntimeError(f'current-JP closure missing target Materials: {missing_materials}')

        game_object_names: dict[tuple[str, int], str] = {}
        transforms_by_go: dict[tuple[str, int], tuple[Any, dict[str, Any]]] = {}
        mesh_filters_by_go: dict[tuple[str, int], tuple[Any, dict[str, Any]]] = {}
        parsed: list[tuple[Any, str, dict[str, Any]]] = []
        for obj in objects:
            type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
            if type_name not in {
                'GameObject', 'Transform', 'MeshFilter', 'MeshRenderer', 'SkinnedMeshRenderer'
            }:
                continue
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if not isinstance(tree, dict):
                continue
            parsed.append((obj, type_name, tree))
            cab = source_cab(obj)
            if type_name == 'GameObject':
                game_object_names[(cab, int(getattr(obj, 'path_id', 0) or 0))] = str(tree.get('m_Name', ''))
            elif type_name in {'Transform', 'MeshFilter'}:
                go_file, go_path = pointer_pair(tree.get('m_GameObject'))
                if go_path:
                    go_cab = external_cab(obj, go_file)
                    key = (go_cab, go_path)
                    if type_name == 'Transform':
                        transforms_by_go[key] = (obj, tree)
                    else:
                        mesh_filters_by_go[key] = (obj, tree)

        def hierarchy_for_go(go_key: tuple[str, int]) -> str:
            names: list[str] = []
            current = go_key
            seen: set[tuple[str, int]] = set()
            while current not in seen:
                seen.add(current)
                names.append(game_object_names.get(current, f'GameObject:{current[1]}'))
                transform = transforms_by_go.get(current)
                if transform is None:
                    break
                transform_obj, transform_tree = transform
                father_file, father_path = pointer_pair(transform_tree.get('m_Father'))
                if not father_path:
                    break
                father_obj = resolve_pointer(
                    object_index, transform_obj, father_file, father_path
                )
                if father_obj is None:
                    break
                father_tree = father_obj.read_typetree()
                go_file, go_path = pointer_pair(father_tree.get('m_GameObject'))
                if not go_path:
                    break
                current = (external_cab(father_obj, go_file), go_path)
            return '/'.join(reversed(names))

        renderer_records: list[dict[str, Any]] = []
        for obj, type_name, tree in parsed:
            if type_name not in {'MeshRenderer', 'SkinnedMeshRenderer'}:
                continue
            material_ptrs = tree.get('m_Materials') or []
            resolved_materials = []
            target_slots = []
            for slot, ptr in enumerate(material_ptrs):
                file_id, path_id = pointer_pair(ptr)
                material_obj = resolve_pointer(object_index, obj, file_id, path_id)
                name = safe_name(material_obj)
                resolved_materials.append({
                    'slot': slot,
                    'name': name,
                    'serializedFile': source_cab(material_obj) if material_obj else None,
                    'pathId': str(path_id),
                })
                if name in TARGETS:
                    target_slots.append(slot)
            if not target_slots:
                continue

            go_file, go_path = pointer_pair(tree.get('m_GameObject'))
            go_key = (external_cab(obj, go_file), go_path)
            mesh_obj = None
            mesh_pointer = None
            if type_name == 'SkinnedMeshRenderer':
                mesh_file, mesh_path = pointer_pair(tree.get('m_Mesh'))
                mesh_pointer = {'fileId': mesh_file, 'pathId': str(mesh_path)}
                mesh_obj = resolve_pointer(object_index, obj, mesh_file, mesh_path)
            else:
                mesh_filter = mesh_filters_by_go.get(go_key)
                if mesh_filter:
                    mesh_filter_obj, mesh_filter_tree = mesh_filter
                    mesh_file, mesh_path = pointer_pair(mesh_filter_tree.get('m_Mesh'))
                    mesh_pointer = {'fileId': mesh_file, 'pathId': str(mesh_path)}
                    mesh_obj = resolve_pointer(
                        object_index, mesh_filter_obj, mesh_file, mesh_path
                    )
            if mesh_obj is None:
                raise RuntimeError(
                    f'{type_name} {hierarchy_for_go(go_key)} uses target materials but its Mesh could not be resolved'
                )

            renderer_records.append({
                'rendererType': type_name,
                'rendererSerializedFile': source_cab(obj),
                'rendererPathId': str(int(getattr(obj, 'path_id', 0) or 0)),
                'gameObjectName': game_object_names.get(go_key, ''),
                'hierarchyPath': hierarchy_for_go(go_key),
                'materialSlots': resolved_materials,
                'targetMaterialSlots': target_slots,
                'meshPointer': mesh_pointer,
                'mesh': compact_mesh(mesh_obj),
                'rendererState': {
                    'enabled': tree.get('m_Enabled'),
                    'castShadows': tree.get('m_CastShadows'),
                    'receiveShadows': tree.get('m_ReceiveShadows'),
                    'lightmapIndex': tree.get('m_LightmapIndex'),
                    'lightmapIndexDynamic': tree.get('m_LightmapIndexDynamic'),
                    'lightmapTilingOffset': base.jsonable(tree.get('m_LightmapTilingOffset')),
                    'lightmapTilingOffsetDynamic': base.jsonable(tree.get('m_LightmapTilingOffsetDynamic')),
                },
            })

        if not renderer_records:
            raise RuntimeError('No current-JP renderers were found for target sprite/cutout Materials')
        covered = {
            slot['name']
            for record in renderer_records
            for slot in record['materialSlots']
            if slot['slot'] in record['targetMaterialSlots']
        }
        missing_renderers = sorted(TARGETS - covered)
        if missing_renderers:
            raise RuntimeError(
                f'target Materials are not all referenced by resolved Renderers: {missing_renderers}'
            )

        texture_records: dict[str, dict[str, Any]] = {}
        material_texture_resolution: dict[str, list[dict[str, Any]]] = {}
        for material_name, report_material in materials_from_report.items():
            material_obj = material_objects[material_name]
            resolved = []
            for tex_env in report_material.get('texEnvs', []):
                prop = str(tex_env.get('property', ''))
                if prop not in {'_BaseMap', '_MainTex'}:
                    continue
                file_id = int(tex_env.get('fileId', 0) or 0)
                path_id = int(tex_env.get('pathId', 0) or 0)
                texture_obj = resolve_pointer(
                    object_index, material_obj, file_id, path_id
                )
                if texture_obj is None:
                    raise RuntimeError(
                        f'{material_name} {prop}: unresolved current-JP texture PPtr fileID={file_id} pathID={path_id}'
                    )
                type_name = str(getattr(getattr(texture_obj, 'type', None), 'name', ''))
                if type_name != 'Texture2D':
                    raise RuntimeError(
                        f'{material_name} {prop}: PPtr resolved to {type_name}, expected Texture2D'
                    )
                texture = compact_texture(texture_obj)
                texture_key = f"{texture['serializedFile']}:{texture['pathId']}"
                texture_records[texture_key] = texture
                resolved.append({
                    'property': prop,
                    'fileId': file_id,
                    'pathId': str(path_id),
                    'scale': tex_env.get('scale'),
                    'offset': tex_env.get('offset'),
                    'resolvedTextureKey': texture_key,
                    'resolvedTextureName': texture['name'],
                })
            material_texture_resolution[material_name] = resolved

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-608-dependency-closure',
            'metadata': metadata,
            'stage': {
                'rootBundle': TARGET_STAGE_BUNDLE,
                'boundedCatalogRecord': bounded_record,
                'dependencyCount': len(dependencies),
                'bundleCountIncludingRoot': len(bundle_names),
            },
            'targetMaterials': sorted(TARGETS),
            'materialTextureResolution': material_texture_resolution,
            'textures': texture_records,
            'renderers': sorted(
                renderer_records,
                key=lambda item: (item['hierarchyPath'], item['rendererPathId']),
            ),
            'interpretation': (
                'Renderer/Material/Mesh/TextureSettings pointers and serialized fields are exact current-JP evidence. '
                'OBJ-derived UV ranges are deterministic diagnostics from UnityPy Mesh.export and are not by themselves '
                'proof of which UV generation branch the ReDrive background shader uses. _UseMeshUV shader semantics remain deferred.'
            ),
            'privacyBoundary': (
                'Raw current-JP AssetBundles remain transient in the Actions temp directory. '
                'Only this bounded renderer/mesh/texture metadata report is persisted.'
            ),
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'rendererCount': len(renderer_records),
            'coveredMaterials': sorted(covered),
            'materialTextures': material_texture_resolution,
            'meshUvDiagnostics': [
                {
                    'hierarchyPath': item['hierarchyPath'],
                    'targetSlots': item['targetMaterialSlots'],
                    'mesh': item['mesh']['name'],
                    'uv': item['mesh']['objDerivedUv0'],
                }
                for item in renderer_records
            ],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
