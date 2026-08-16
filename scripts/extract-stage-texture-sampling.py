#!/usr/bin/env python3
"""Extract official Texture2D sampling state from local Unity AssetBundles.

The extractor is intentionally fixed to the JP Android/Steam Unity profile.
It emits no partial JSON: any unreadable Texture2D or unknown enum value makes
the command fail with a non-zero exit status.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Iterable


PROFILE_NAME = "jp-unity-2022.3.62f2"
UNITY_VERSION = "2022.3.62f2"

FILTER_MODES = {
    0: "point",
    1: "bilinear",
    2: "trilinear",
}

WRAP_MODES = {
    0: "repeat",
    1: "clamp",
    2: "mirror",
    3: "mirror-once",
}

COLOR_SPACES = {
    0: "linear",
    1: "sRGB",
}


class ExtractionError(RuntimeError):
    """Raised when extraction cannot produce a complete, trustworthy result."""


def _enum_name(mapping: dict[int, str], value: Any, label: str) -> str:
    try:
        numeric = int(value)
    except (TypeError, ValueError) as exc:
        raise ExtractionError(f"{label} is not an integer: {value!r}") from exc
    if numeric not in mapping:
        raise ExtractionError(f"unsupported {label}: {numeric}")
    return mapping[numeric]


def filter_mode_name(value: Any) -> str:
    return _enum_name(FILTER_MODES, value, "filterMode")


def wrap_mode_name(value: Any) -> str:
    return _enum_name(WRAP_MODES, value, "wrapMode")


def color_space_name(value: Any) -> str:
    return _enum_name(COLOR_SPACES, value, "colorSpace")


def _required_attr(value: Any, name: str) -> Any:
    if not hasattr(value, name):
        raise ExtractionError(f"missing required Texture2D field: {name}")
    return getattr(value, name)


def texture_record(reader: Any, data: Any) -> dict[str, Any]:
    """Map one UnityPy Texture2D object to the stable public JSON schema."""

    settings = _required_attr(data, "m_TextureSettings")
    path_id = int(_required_attr(reader, "path_id"))
    source_cab = str(
        _required_attr(_required_attr(reader, "assets_file"), "name")
    )
    aniso = int(_required_attr(settings, "m_Aniso"))
    mip_count = int(_required_attr(data, "m_MipCount"))
    mip_bias = float(_required_attr(settings, "m_MipBias"))

    if aniso < 0:
        raise ExtractionError(f"negative anisotropy for pathId {path_id}: {aniso}")
    if mip_count < 1:
        raise ExtractionError(f"invalid mipCount for pathId {path_id}: {mip_count}")
    if not math.isfinite(mip_bias):
        raise ExtractionError(f"non-finite mipBias for pathId {path_id}: {mip_bias}")

    return {
        "name": str(_required_attr(data, "m_Name")),
        "pathId": str(path_id),
        "sourceCab": source_cab,
        "filterMode": filter_mode_name(_required_attr(settings, "m_FilterMode")),
        "aniso": aniso,
        "mipBias": mip_bias,
        "mipCount": mip_count,
        "colorSpace": color_space_name(_required_attr(data, "m_ColorSpace")),
        "wrapU": wrap_mode_name(_required_attr(settings, "m_WrapU")),
        "wrapV": wrap_mode_name(_required_attr(settings, "m_WrapV")),
        "wrapW": wrap_mode_name(_required_attr(settings, "m_WrapW")),
    }


def _validated_inputs(values: Iterable[str]) -> list[Path]:
    paths = sorted(
        (Path(value).expanduser().resolve() for value in values),
        key=lambda path: (str(path).casefold(), str(path)),
    )
    for path in paths:
        if not path.exists():
            raise ExtractionError(f"input does not exist: {path}")
        if not path.is_file():
            raise ExtractionError(f"input is not a file: {path}")
    return paths


def extract_texture_sampling(paths: list[Path]) -> dict[str, Any]:
    try:
        import UnityPy  # Imported lazily so --help remains independently usable.
    except Exception as exc:
        raise ExtractionError(f"UnityPy import failed: {exc}") from exc

    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    try:
        environment = UnityPy.load(*(str(path) for path in paths))
    except Exception as exc:
        raise ExtractionError(f"AssetBundle load failed: {exc}") from exc

    textures: list[dict[str, Any]] = []
    failures: list[str] = []
    for reader in environment.objects:
        if reader.type.name != "Texture2D":
            continue
        try:
            textures.append(texture_record(reader, reader.read()))
        except Exception as exc:
            asset_name = getattr(getattr(reader, "assets_file", None), "name", "unknown")
            path_id = getattr(reader, "path_id", "unknown")
            failures.append(f"{asset_name}:pathId={path_id}: {exc}")

    if failures:
        raise ExtractionError(
            "Texture2D extraction failed; no output written:\n  " + "\n  ".join(failures)
        )

    textures.sort(
        key=lambda row: (
            row["name"].casefold(),
            row["name"],
            row["sourceCab"],
            int(row["pathId"]),
        )
    )
    return {
        "schemaVersion": 1,
        "profile": PROFILE_NAME,
        "unityVersion": UNITY_VERSION,
        "inputs": [str(path) for path in paths],
        "textureCount": len(textures),
        "textures": textures,
    }


def _write_atomic(path: Path, payload: str) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(payload, encoding="utf-8", newline="\n")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Extract stable Texture2D sampler state from local Unity AssetBundles "
            f"using the explicit {UNITY_VERSION} profile."
        )
    )
    parser.add_argument(
        "asset_bundle",
        nargs="+",
        help="one or more local Unity AssetBundle files",
    )
    parser.add_argument(
        "--profile",
        choices=[PROFILE_NAME],
        default=PROFILE_NAME,
        help=f"release parser profile (default: {PROFILE_NAME})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="write JSON atomically to this path instead of stdout",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        paths = _validated_inputs(args.asset_bundle)
        document = extract_texture_sampling(paths)
        payload = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.output:
            _write_atomic(args.output, payload)
        else:
            sys.stdout.write(payload)
        return 0
    except ExtractionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
