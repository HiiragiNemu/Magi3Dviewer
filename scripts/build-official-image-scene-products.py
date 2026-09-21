#!/usr/bin/env python3
"""Publish official image/data scene bundles as generic glTF Viewer products."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import re
import shutil
import struct
from pathlib import Path
from typing import Any

import UnityPy
from PIL import Image, ImageDraw


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_publisher(repo: Path):
    path = repo / "scripts/publish-official-resource-batch.py"
    spec = importlib.util.spec_from_file_location("official_scene_publisher", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def clean_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-") or "image"


def append_aligned(buffer: bytearray, payload: bytes) -> tuple[int, int]:
    while len(buffer) % 4:
        buffer.append(0)
    offset = len(buffer)
    buffer.extend(payload)
    return offset, len(payload)


def build_gltf(images: list[dict[str, Any]], output: Path) -> None:
    binary = bytearray()
    buffer_views = []
    accessors = []
    meshes = []
    nodes = []
    materials = []
    textures = []
    gltf_images = []
    cursor = 0.0
    widths = [max(1.0, min(3.5, image["width"] / max(1, image["height"]))) for image in images]
    total_width = sum(widths) + max(0, len(widths) - 1) * 0.25
    cursor = -total_width / 2

    for index, (image, width) in enumerate(zip(images, widths, strict=True)):
        left = cursor
        right = cursor + width
        cursor = right + 0.25
        positions = struct.pack(
            "<12f",
            left, -1.0, 0.0,
            right, -1.0, 0.0,
            right, 1.0, 0.0,
            left, 1.0, 0.0,
        )
        normals = struct.pack("<12f", *([0.0, 0.0, 1.0] * 4))
        uvs = struct.pack("<8f", 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0)
        indices = struct.pack("<6H", 0, 1, 2, 0, 2, 3)
        position_offset, position_length = append_aligned(binary, positions)
        normal_offset, normal_length = append_aligned(binary, normals)
        uv_offset, uv_length = append_aligned(binary, uvs)
        index_offset, index_length = append_aligned(binary, indices)
        first_view = len(buffer_views)
        buffer_views.extend(
            [
                {"buffer": 0, "byteOffset": position_offset, "byteLength": position_length, "target": 34962},
                {"buffer": 0, "byteOffset": normal_offset, "byteLength": normal_length, "target": 34962},
                {"buffer": 0, "byteOffset": uv_offset, "byteLength": uv_length, "target": 34962},
                {"buffer": 0, "byteOffset": index_offset, "byteLength": index_length, "target": 34963},
            ]
        )
        first_accessor = len(accessors)
        accessors.extend(
            [
                {
                    "bufferView": first_view,
                    "componentType": 5126,
                    "count": 4,
                    "type": "VEC3",
                    "min": [left, -1.0, 0.0],
                    "max": [right, 1.0, 0.0],
                },
                {"bufferView": first_view + 1, "componentType": 5126, "count": 4, "type": "VEC3"},
                {"bufferView": first_view + 2, "componentType": 5126, "count": 4, "type": "VEC2"},
                {"bufferView": first_view + 3, "componentType": 5123, "count": 6, "type": "SCALAR"},
            ]
        )
        gltf_images.append({"uri": image["file"], "name": image["name"]})
        textures.append({"source": index})
        materials.append(
            {
                "name": image["name"],
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": index},
                    "metallicFactor": 0,
                    "roughnessFactor": 1,
                },
                "doubleSided": True,
                "alphaMode": "BLEND",
                "extensions": {"KHR_materials_unlit": {}},
            }
        )
        meshes.append(
            {
                "name": image["name"],
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": first_accessor,
                            "NORMAL": first_accessor + 1,
                            "TEXCOORD_0": first_accessor + 2,
                        },
                        "indices": first_accessor + 3,
                        "material": index,
                    }
                ],
            }
        )
        nodes.append({"name": image["name"], "mesh": index})

    document = {
        "asset": {"version": "2.0", "generator": "Magius official image scene product"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "textures": textures,
        "images": gltf_images,
        "buffers": [
            {
                "byteLength": len(binary),
                "uri": "data:application/octet-stream;base64,"
                + base64.b64encode(binary).decode("ascii"),
            }
        ],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    write_json(output, document)


def extract_images(source: Path, product: Path, resource_name: str) -> tuple[list[dict[str, Any]], bool]:
    environment = UnityPy.load(str(source))
    objects = [obj for obj in environment.objects if obj.type.name == "Sprite"]
    source_type = "Sprite"
    if not objects:
        objects = [obj for obj in environment.objects if obj.type.name == "Texture2D"]
        source_type = "Texture2D"
    images = []
    used_names: set[str] = set()
    for obj in objects:
        try:
            value = obj.read()
            image = value.image.convert("RGBA")
        except Exception:
            continue
        base = clean_name(str(getattr(value, "m_Name", None) or getattr(value, "name", None) or resource_name))
        filename = f"{base}.png"
        if filename.lower() in used_names:
            filename = f"{base}-{obj.path_id}.png"
        used_names.add(filename.lower())
        image.save(product / filename, format="PNG")
        images.append(
            {
                "name": base,
                "file": filename,
                "pathId": str(obj.path_id),
                "sourceType": source_type,
                "width": image.width,
                "height": image.height,
            }
        )
    if images:
        return images, False

    marker = Image.new("RGBA", (1024, 512), (24, 31, 48, 255))
    drawing = ImageDraw.Draw(marker)
    drawing.text((48, 220), resource_name, fill=(235, 240, 255, 255))
    marker_name = "exact-empty-root-marker.png"
    marker.save(product / marker_name, format="PNG")
    return [
        {
            "name": resource_name,
            "file": marker_name,
            "pathId": None,
            "sourceType": "exact-empty-root-marker",
            "width": marker.width,
            "height": marker.height,
        }
    ], True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--family", action="append", dest="families")
    parser.add_argument("--stage-id", action="append", dest="stage_ids")
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    work_root = args.work_root.resolve()
    work_root.mkdir(parents=True, exist_ok=True)
    inventory = read_json(
        repo
        / "artifacts/research/20260825-viewer-official-resource-gap-inventory"
        / "official-resource-gap-inventory.v1.json"
    )
    closure_document = read_json(
        repo
        / "artifacts/delivery/20260826-scene-enemy-batch01/authority"
        / "official-scene-closures.v2.json"
    )
    closures = {row["logicalPath"]: row for row in closure_document["closures"]}
    source_root = Path(closure_document["sourceRoot"])
    UnityPy.config.FALLBACK_UNITY_VERSION = closure_document["unityVersion"]
    publisher = load_publisher(repo)
    current_ids = set()
    for shard in (repo / "public/stages/catalogs").glob("official-*.v1.json"):
        current_ids.update(entry["id"] for entry in read_json(shard).get("stages") or [])

    rows = []
    for row in inventory["sceneAudit"]["officialLocalUnlisted"]:
        closure = closures[row["logicalPath"]]
        types = closure["objectTypeCounts"]
        geometry = bool(types.get("Mesh") or types.get("MeshFilter") or types.get("SkinnedMeshRenderer"))
        identifier = publisher.viewer_stage_id(row)
        forced = bool(args.stage_ids and identifier in set(args.stage_ids))
        if row["family"] == "battle-direct" or (geometry and not forced) or identifier in current_ids:
            continue
        if args.stage_ids and not forced:
            continue
        if args.families and row["family"] not in set(args.families):
            continue
        rows.append(row)
    if args.limit is not None:
        rows = rows[: args.limit]

    records_root = (
        repo
        / "artifacts/delivery/20260826-scene-enemy-batch01"
        / "build-records/image-scenes"
    )
    published = []
    marker_count = 0
    for index, row in enumerate(rows, start=1):
        identifier = publisher.viewer_stage_id(row)
        print(f"[{index}/{len(rows)}] {identifier}", flush=True)
        product = work_root / identifier
        if product.exists():
            shutil.rmtree(product)
        product.mkdir(parents=True)
        source = source_root / Path(row["logicalPath"])
        images, marker = extract_images(source, product, row["resourceName"])
        marker_count += int(marker)
        build_gltf(images, product / "scene.gltf")
        manifest = {
            "schema": "magius.official-scene-product.v1",
            "kind": "data-marker" if marker else "image",
            "presentationMode": "exact-empty-root-marker" if marker else "official-image-plane",
            "syntheticMarker": marker,
            "stableKey": row["logicalPath"],
            "stageId": identifier,
            "family": row["family"],
            "images": images,
        }
        write_json(product / "scene-product.json", manifest)
        entry = publisher.publish_stage(repo, repo / "public", identifier, product)
        record = {
            "schema": "magius.official-image-scene-build-record.v1",
            "stageId": identifier,
            "stableKey": row["logicalPath"],
            "family": row["family"],
            "imageCount": len(images),
            "syntheticMarker": marker,
            "catalogEntry": entry,
        }
        write_json(records_root / f"{identifier}.json", record)
        shutil.rmtree(product)
        published.append(identifier)

    summary = {
        "requested": len(rows),
        "published": len(published),
        "syntheticMarkers": marker_count,
        "stageIds": published,
    }
    write_json(records_root.parent / "latest-image-scenes-summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
