#!/usr/bin/env python3
"""Extract ReDriveToon baked normals from one official character bundle.

Unity stores the authored outline/MatCap normal as TEXCOORD3 in tangent space.
AssetStudio's tracked FBX keeps TEXCOORD3.xy as ``uv1`` but drops its z
component and the tangent channel.  This tool reconstructs the exact object-
space vector from the official Mesh, expands it to the FBX triangle stream,
and applies the same Unity-to-FBX X reflection used by AssetStudio.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import struct
from pathlib import Path
from typing import Iterable, Sequence

import UnityPy
from UnityPy.helpers.MeshHelper import MeshHandler


MAGIC = b"RDBN0001"
UNITY_VERSION = "2022.3.62f2"


def normalize(value: Sequence[float]) -> tuple[float, float, float]:
    length = math.sqrt(sum(component * component for component in value))
    if length <= 1e-12:
        raise ValueError(f"Cannot normalize zero baked normal: {value!r}")
    return tuple(component / length for component in value)  # type: ignore[return-value]


def cross(
    left: Sequence[float],
    right: Sequence[float],
) -> tuple[float, float, float]:
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def baked_normal(
    normal: Sequence[float],
    tangent: Sequence[float],
    texcoord3: Sequence[float],
) -> tuple[float, float, float]:
    tangent_xyz = normalize(tangent[:3])
    normal_xyz = normalize(normal[:3])
    bitangent = tuple(
        component * tangent[3]
        for component in cross(normal_xyz, tangent_xyz)
    )
    baked = tuple(
        tangent_xyz[axis] * texcoord3[0]
        + bitangent[axis] * texcoord3[1]
        + normal_xyz[axis] * texcoord3[2]
        for axis in range(3)
    )
    # Authored zero TEXCOORD3 values intentionally suppress extrusion/highlight
    # on selected vertices. Preserve that exact branch; the official shader
    # also receives a zero baked-normal vector there.
    if sum(component * component for component in baked) <= 1e-24:
        return (0.0, 0.0, 0.0)
    unity = normalize(baked)
    # AssetStudio mirrors Unity's object-space X axis when exporting FBX.
    return (-unity[0], unity[1], unity[2])


def expanded_triangle_indices(mesh, handler: MeshHandler) -> Iterable[int]:
    indices = handler.m_IndexBuffer
    if indices is None:
        raise ValueError(f"Mesh {mesh.m_Name} has no index buffer")
    index_size = 2 if handler.m_Use16BitIndices else 4
    for submesh_index, submesh in enumerate(mesh.m_SubMeshes):
        if submesh.topology != 0:
            raise ValueError(
                f"Mesh {mesh.m_Name} submesh {submesh_index} is not triangles"
            )
        start = submesh.firstByte // index_size
        segment = indices[start : start + submesh.indexCount]
        if len(segment) % 3:
            raise ValueError(
                f"Mesh {mesh.m_Name} submesh {submesh_index} index count "
                f"{len(segment)} is not divisible by 3"
            )
        for offset in range(0, len(segment), 3):
            # AssetStudio reverses each triangle while reflecting X.
            yield segment[offset + 2] + submesh.baseVertex
            yield segment[offset + 1] + submesh.baseVertex
            yield segment[offset] + submesh.baseVertex


def extract_mesh(
    mesh,
) -> tuple[str, list[tuple[float, float, float]]] | None:
    handler = MeshHandler(mesh)
    handler.process()
    normals = handler.m_Normals
    tangents = handler.m_Tangents
    texcoord3 = handler.m_UV3
    if normals is None or tangents is None or texcoord3 is None:
        return None
    if not (len(normals) == len(tangents) == len(texcoord3)):
        raise ValueError(f"Mesh {mesh.m_Name} vertex channel counts differ")
    per_vertex = [
        baked_normal(normal, tangent, uv3)
        for normal, tangent, uv3 in zip(normals, tangents, texcoord3)
    ]
    expanded = [per_vertex[index] for index in expanded_triangle_indices(mesh, handler)]
    return mesh.m_Name, expanded


def encode(character_id: int, meshes) -> bytes:
    payload = bytearray(struct.pack("<8sII", MAGIC, character_id, len(meshes)))
    for name, values in meshes:
        encoded_name = name.encode("utf-8")
        if len(encoded_name) > 0xFFFF:
            raise ValueError(f"Mesh name is too long: {name!r}")
        payload.extend(struct.pack("<H", len(encoded_name)))
        payload.extend(encoded_name)
        while len(payload) % 4:
            payload.append(0)
        payload.extend(struct.pack("<I", len(values)))
        for value in values:
            if not all(math.isfinite(component) for component in value):
                raise ValueError(f"Mesh {name} contains a non-finite normal")
            payload.extend(struct.pack("<3f", *value))
    return bytes(payload)


def load_submesh_manifest(path: Path) -> dict[int, dict[str, int]]:
    source = path.read_text(encoding="utf-8")
    result: dict[int, dict[str, int]] = {}
    character_pattern = re.compile(
        r"^    (\d+): \{\n(?P<body>.*?)^    \},$",
        re.MULTILINE | re.DOTALL,
    )
    mesh_pattern = re.compile(r'^        ("(?:[^"\\]|\\.)+"): (\[[^\]]*\]),$')
    for character_match in character_pattern.finditer(source):
        character_id = int(character_match.group(1))
        meshes: dict[str, int] = {}
        for line in character_match.group("body").splitlines():
            mesh_match = mesh_pattern.fullmatch(line)
            if mesh_match is None:
                continue
            name = json.loads(mesh_match.group(1))
            counts = json.loads(mesh_match.group(2))
            meshes[name] = sum(int(count) for count in counts)
        result[character_id] = meshes
    if not result:
        raise ValueError(f"No character submesh records found in {path}")
    return result


def game_object_path(game_object) -> str:
    names = []
    current = game_object
    while current is not None:
        names.append(str(current.m_Name))
        transform = None
        for component in current.m_Component:
            candidate = component.component.read()
            if hasattr(candidate, "m_Father"):
                transform = candidate
                break
        if transform is None or not int(getattr(transform.m_Father, "path_id", 0) or 0):
            break
        current = transform.m_Father.read().m_GameObject.read()
    return "/".join(reversed(names))


def load_renderer_paths(environment) -> dict[int, set[str]]:
    paths: dict[int, set[str]] = {}
    for obj in environment.objects:
        if obj.type.name != "SkinnedMeshRenderer":
            continue
        renderer = obj.read()
        mesh_pointer = getattr(renderer, "m_Mesh", None)
        mesh_path_id = int(getattr(mesh_pointer, "path_id", 0) or 0)
        if not mesh_path_id:
            continue
        paths.setdefault(mesh_path_id, set()).add(
            game_object_path(renderer.m_GameObject.read())
        )
    return paths


def extract_bundle(
    bundle: Path,
    character_id: int,
    expected_mesh_counts: dict[str, int] | None = None,
) -> bytes:
    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    environment = UnityPy.load(str(bundle))
    renderer_paths = load_renderer_paths(environment)
    candidates: list[
        tuple[
            str,
            list[tuple[float, float, float]] | None,
            set[str],
        ]
    ] = []
    matched_expected_meshes: set[str] = set()
    for obj in environment.objects:
        if obj.type.name == "Mesh":
            mesh = obj.read()
            expanded_count = sum(
                int(submesh.indexCount) for submesh in mesh.m_SubMeshes
            )
            mesh_paths = renderer_paths.get(int(obj.path_id), set())
            if expected_mesh_counts is not None:
                visual_root_prefix = f"{bundle.name}/VisualRoot/"
                mesh_paths = {
                    path for path in mesh_paths
                    if path.startswith(visual_root_prefix)
                }
                if not mesh_paths:
                    continue
                expected_count = expected_mesh_counts.get(mesh.m_Name)
                if expected_count is None or expected_count != expanded_count:
                    continue
                matched_expected_meshes.add(mesh.m_Name)
            extracted = extract_mesh(mesh)
            if extracted is None:
                print(
                    f"skipped {bundle.name}/{mesh.m_Name}: "
                    "no official tangent-space baked-normal channel"
                )
                values = None
            else:
                _, values = extracted
            candidates.append((
                mesh.m_Name,
                values,
                mesh_paths,
            ))
    if expected_mesh_counts is not None:
        missing = sorted(set(expected_mesh_counts) - matched_expected_meshes)
        if missing:
            print(
                f"skipped {bundle.name}: no one-to-one official Mesh/count "
                f"for FBX entries {missing}"
            )
    candidates_by_name: dict[
        str,
        list[tuple[list[tuple[float, float, float]] | None, set[str]]],
    ] = {}
    for name, values, paths in candidates:
        candidates_by_name.setdefault(name, []).append((values, paths))

    records: dict[str, list[tuple[float, float, float]]] = {}
    for name, named_candidates in candidates_by_name.items():
        requires_signature = len(named_candidates) > 1
        for values, paths in named_candidates:
            if values is None:
                continue
            if requires_signature:
                if not paths:
                    raise ValueError(
                        f"Duplicate tracked mesh {bundle.name}/{name} has no "
                        "SkinnedMeshRenderer hierarchy path"
                    )
                keys = [f"{name}\x00{path}" for path in sorted(paths)]
            else:
                keys = [name]
            for key in keys:
                if key in records:
                    raise ValueError(
                        f"Duplicate baked-normal lookup key in {bundle.name}: {key!r}"
                    )
                records[key] = values

    meshes = sorted(records.items())
    meshes.sort(key=lambda item: item[0])
    if not meshes:
        raise ValueError(f"No Mesh objects found in {bundle}")

    return encode(character_id, meshes)


def write_companion(
    bundle: Path,
    output: Path,
    character_id: int,
    expected_mesh_counts: dict[str, int] | None = None,
) -> tuple[int, int]:
    raw = extract_bundle(bundle, character_id, expected_mesh_counts)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    mesh_count = struct.unpack_from("<I", raw, 12)[0]
    vertex_count = 0
    offset = 16
    for _ in range(mesh_count):
        name_length = struct.unpack_from("<H", raw, offset)[0]
        offset = (offset + 2 + name_length + 3) & ~3
        count = struct.unpack_from("<I", raw, offset)[0]
        vertex_count += count
        offset += 4 + count * 12
    print(
        f"wrote {output}: {mesh_count} meshes, {vertex_count} expanded vertices, "
        f"{len(raw)} raw bytes, {output.stat().st_size} gzip bytes"
    )
    return mesh_count, vertex_count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", nargs="?", type=Path)
    parser.add_argument("output", nargs="?", type=Path)
    parser.add_argument("--character-id", type=int)
    parser.add_argument(
        "--bundle-root",
        type=Path,
        help="Exact official character-bundle directory for bounded batch mode",
    )
    parser.add_argument(
        "--models-root",
        type=Path,
        help="Viewer model directory whose exact chara_*_battle_unit children are generated",
    )
    parser.add_argument(
        "--submesh-manifest",
        type=Path,
        help="Generated exact FBX mesh/index manifest used to exclude bundle-only effects",
    )
    args = parser.parse_args()

    if args.bundle_root is not None or args.models_root is not None:
        if args.bundle_root is None or args.models_root is None:
            parser.error("--bundle-root and --models-root must be supplied together")
        if args.bundle is not None or args.output is not None or args.character_id is not None:
            parser.error("batch mode does not accept bundle/output/--character-id")
        manifest_path = args.submesh_manifest \
            or args.models_root.parent / "submeshGroups.generated.ts"
        expected_by_character = load_submesh_manifest(manifest_path)
        pattern = re.compile(r"chara_(\d+)_battle_unit")
        generated = 0
        mesh_total = 0
        vertex_total = 0
        model_dirs = sorted(
            path for path in args.models_root.iterdir()
            if path.is_dir() and pattern.fullmatch(path.name)
        )
        for model_dir in model_dirs:
            match = pattern.fullmatch(model_dir.name)
            assert match is not None
            bundle = args.bundle_root / model_dir.name
            if not bundle.is_file():
                raise FileNotFoundError(
                    f"Official bundle for tracked model is missing: {bundle}"
                )
            mesh_count, vertex_count = write_companion(
                bundle,
                model_dir / "redrive-baked-normals.bin.gz",
                int(match.group(1)),
                expected_by_character.get(int(match.group(1))),
            )
            generated += 1
            mesh_total += mesh_count
            vertex_total += vertex_count
        print(
            f"generated {generated} exact model companions: "
            f"{mesh_total} meshes, {vertex_total} expanded vertices"
        )
        return

    if args.bundle is None or args.output is None or args.character_id is None:
        parser.error("single mode requires bundle, output, and --character-id")

    expected = None
    if args.submesh_manifest is not None:
        expected = load_submesh_manifest(args.submesh_manifest).get(args.character_id)
    write_companion(args.bundle, args.output, args.character_id, expected)


if __name__ == "__main__":
    main()
