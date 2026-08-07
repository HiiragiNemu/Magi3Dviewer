#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

import extract_official_100101_material_properties as base

TARGETS = {
    "mt_chara_100101_body_aniso",
    "mt_chara_100101_body_sj",
    "mt_chara_100101_weapon_a_sj",
}
FEATURE_TOKENS = (
    "_IsAniso", "_AnisoColor", "_AnisoThreshold", "_AnisoFeather",
    "_IsGem", "_UseGemDepthDiff", "_GemDepthDiffThreshold", "_GemHeightCorrection",
    "_UseFresnel", "_FresnelColor", "_FresnelThreshold", "_FresnelFeather",
    "_UseDepthTex", "_DepthTexWidth", "_DepthRimLightDiffThreshold", "_DepthShadowDiffThreshold",
)


def bounded_context(text: str, tokens: tuple[str, ...], radius: int = 10) -> list[dict[str, Any]]:
    lines = text.splitlines()
    regions: list[tuple[int, int]] = []
    for index, line in enumerate(lines):
        if any(token in line for token in tokens):
            regions.append((max(0, index - radius), min(len(lines), index + radius + 1)))
    merged: list[tuple[int, int]] = []
    for start, stop in regions:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], stop))
        else:
            merged.append((start, stop))
    return [
        {
            "startLine": start + 1,
            "endLine": stop,
            "text": "\n".join(lines[start:stop]),
        }
        for start, stop in merged[:30]
    ]


def main() -> int:
    output = Path("research/official-100101-redrive-shader-evidence.json")
    with tempfile.TemporaryDirectory(prefix="magius-100101-shader-") as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        character_entries = [
            entry for entry in entries
            if any(value in entry.full_path.lower() for value in base.TARGET_BUNDLE_TOKENS)
            and "battle/character/" in entry.full_path.lower()
        ]
        shader_entries = [
            entry for entry in entries
            if entry.full_path.lower().startswith(("shader/", "shaders/"))
        ]
        selected = sorted(
            {entry.full_path: entry for entry in [*character_entries, *shader_entries]}.values(),
            key=lambda item: item.full_path,
        )
        if not character_entries:
            raise RuntimeError("no target battle-character bundles")
        if not shader_entries:
            raise RuntimeError("catalog exposes no shader/ or shaders/ bundles")
        if len(selected) > 120:
            raise RuntimeError(f"shader evidence selection unexpectedly broad: {len(selected)}")

        downloaded = [base.download(entry, request_headers, token, temp) for entry in selected]
        env = UnityPy.load(*(str(path) for path in downloaded))
        material_results = []
        shader_exports: dict[tuple[str, int], dict[str, Any]] = {}
        for obj in env.objects:
            if str(getattr(getattr(obj, "type", None), "name", "")) != "Material":
                continue
            try:
                tree = obj.read_typetree()
            except Exception:
                continue
            if not isinstance(tree, dict):
                continue
            name = base.normalize_material_name(base.material_name(tree))
            if name not in TARGETS:
                continue
            material = obj.read()
            pointer = getattr(material, "m_Shader", None)
            if pointer is None:
                material_results.append({"material": name, "shader": None})
                continue
            try:
                shader = pointer.read()
            except Exception as exc:
                material_results.append({"material": name, "shaderError": repr(exc)})
                continue
            shader_name = str(getattr(shader, "m_Name", ""))
            shader_path_id = int(getattr(getattr(pointer, "object_reader", None), "path_id", 0) or getattr(pointer, "path_id", 0) or 0)
            key = (shader_name, shader_path_id)
            if key not in shader_exports:
                try:
                    exported = shader.export()
                except Exception as exc:
                    shader_exports[key] = {
                        "name": shader_name,
                        "pathId": shader_path_id,
                        "exportError": repr(exc),
                    }
                else:
                    shader_exports[key] = {
                        "name": shader_name,
                        "pathId": shader_path_id,
                        "sha256": hashlib.sha256(exported.encode("utf-8", errors="replace")).hexdigest(),
                        "lineCount": len(exported.splitlines()),
                        "featureContexts": bounded_context(exported, FEATURE_TOKENS),
                    }
            material_results.append({
                "material": name,
                "shaderName": shader_name,
                "shaderPathId": shader_path_id,
            })

        if not material_results:
            raise RuntimeError("target materials were not found after loading shader dependencies")
        report = {
            "schemaVersion": 1,
            "source": "official-jp-current-assetbundles",
            "metadata": metadata,
            "characterBundleCount": len(character_entries),
            "shaderBundleCount": len(shader_entries),
            "selectedBundleCount": len(selected),
            "materials": material_results,
            "shaders": list(shader_exports.values()),
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "materialCount": len(report["materials"]),
        "shaderCount": len(report["shaders"]),
        "shaderBundleCount": report["shaderBundleCount"],
        "shaderNames": [item.get("name") for item in report["shaders"]],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
