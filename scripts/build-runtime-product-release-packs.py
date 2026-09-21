#!/usr/bin/env python3
"""Build deterministic, browser-streamable ZIP assets for GitHub Releases."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlparse

SCHEMA = "magius.runtime-product-delivery.v1"
REPOSITORY = "HiiragiNemu/Magi3Dviewer"
BASE_RELEASE_TAGS = ("runtime-products-v1-a", "runtime-products-v1-b")
ENEMY_MODEL_RELEASE_TAG = "runtime-products-enemy-models-v2"
VOICE_RELEASE_TAG = "runtime-products-voice-v1"
RELEASE_TAGS = (*BASE_RELEASE_TAGS, ENEMY_MODEL_RELEASE_TAG, VOICE_RELEASE_TAG)
DELIVERY_GATEWAY = "https://magius3dviewer-runtime-products.crynetsystemscell.workers.dev"
MAX_ASSETS_PER_RELEASE = 1000
TARGET_ASSETS_IN_FIRST_RELEASE = 900
MAX_RELEASE_ASSET_BYTES = 2 * 1024 * 1024 * 1024
MAX_GATEWAY_ASSET_BYTES = 25 * 1024 * 1024
ENEMY_TEXTURE_SOURCE_PREFIX = "/enemies/textures/"
ENEMY_TEXTURE_ARCHIVE_PREFIX = "runtime-textures/"
VOICE_CATALOG_PATH = Path("artifacts/research/20260827-voice-catalog-source-ready/manifest.v1.json")
VOICE_SCENARIO_PATH = Path("artifacts/research/20260827-voice-scenario-source-ready/manifest.v1.json")
VOICE_STABLE_KEY = re.compile(
    r"^soundMstId=\d+\|cueSheetName=([A-Za-z0-9_]+)\|cueName=([A-Za-z0-9_]+)$"
)
VOICE_SOURCE_STABLE_KEY = re.compile(
    r"^cri-cue:cueSheetName=([A-Za-z0-9_]+)\|cueName=([A-Za-z0-9_]+)$"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--artifact-root",
        type=Path,
        default=None,
        help="Defaults to artifacts/release/20260826-runtime-product-release-v1",
    )
    parser.add_argument(
        "--catalog-output",
        type=Path,
        default=None,
        help="Defaults to public/catalogs/runtime-product-delivery.v1.json",
    )
    parser.add_argument(
        "--only-stable-key",
        default=None,
        help="Refresh one existing catalog product and emit only its release asset",
    )
    parser.add_argument(
        "--enemy-models-only",
        action="store_true",
        help=(
            "Build only enemy-model assets with archive-local runtime textures, "
            "preserving every non-enemy catalog entry"
        ),
    )
    parser.add_argument(
        "--voice-only",
        action="store_true",
        help=(
            "Build only exact CRI cue-sheet voice assets, preserving every "
            "non-voice catalog entry"
        ),
    )
    parser.add_argument("--plan-only", action="store_true")
    return parser.parse_args()


def file_records(root: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        records.append({
            "path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size,
            "_sourcePath": str(path),
        })
    if not records:
        raise RuntimeError(f"Runtime product directory is empty: {root}")
    return records


def safe_archive_path(value: str, label: str) -> str:
    if (
        not value
        or value.startswith("/")
        or "\\" in value
        or "?" in value
        or "#" in value
        or "%" in value
    ):
        raise RuntimeError(f"Unsafe {label}: {value}")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise RuntimeError(f"Unsafe {label}: {value}")
    if any("\x00" in part for part in parts):
        raise RuntimeError(f"Unsafe {label}: {value}")
    return "/".join(parts)


def public_file_records(records: list[dict[str, object]]) -> list[dict[str, object]]:
    public: list[dict[str, object]] = []
    for record in records:
        projected = {"path": str(record["path"]), "bytes": int(record["bytes"])}
        for key in ("voiceStableKey", "sourceStableKey", "characterResourceId"):
            if key in record:
                projected[key] = record[key]
        public.append(projected)
    return public


def validate_archive_records(records: list[dict[str, object]], stable_key: str) -> None:
    destinations: dict[str, str] = {}
    for record in records:
        relative = safe_archive_path(str(record["path"]), "archive member path")
        folded = relative.casefold()
        previous = destinations.get(folded)
        if previous is not None:
            raise RuntimeError(
                f"Archive destination collision: {previous} <> {relative} ({stable_key})"
            )
        destinations[folded] = relative


def runtime_url_slots(value: object) -> list[tuple[dict[str, object], str]]:
    slots: list[tuple[dict[str, object], str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "runtimeUrl":
                slots.append((value, key))
            else:
                slots.extend(runtime_url_slots(child))
    elif isinstance(value, list):
        for child in value:
            slots.extend(runtime_url_slots(child))
    return slots


def archive_local_enemy_records(
    repo: Path,
    source: Path,
    root_path: str,
    stable_key: str,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    base_records = file_records(source)
    record_names = {str(record["path"]) for record in base_records}
    required = {"VisualRoot.fbxdata", "material-profile.v1.json", "model-runtime.v1.json"}
    missing = sorted(required - record_names)
    if missing:
        raise RuntimeError(
            f"Enemy model product missing required files: {', '.join(missing)} ({stable_key})"
        )

    profile_path = source / "material-profile.v1.json"
    profile_source_bytes = profile_path.read_bytes()
    try:
        material_profile = json.loads(profile_source_bytes.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Enemy material profile is invalid: {stable_key}") from error
    if not isinstance(material_profile, dict) or material_profile.get("schema") != "magius.enemy-material-profile.v1":
        raise RuntimeError(f"Enemy material profile schema is invalid: {stable_key}")

    model_runtime_path = source / "model-runtime.v1.json"
    try:
        model_runtime = json.loads(model_runtime_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Enemy model runtime metadata is invalid: {stable_key}") from error
    texture_files = model_runtime.get("runtime", {}).get("textureFiles")
    if not isinstance(texture_files, list) or any(
        not isinstance(name, str) or not name or Path(name).name != name
        for name in texture_files
    ):
        raise RuntimeError(f"Enemy model texture file list is invalid: {stable_key}")
    missing_local_textures = sorted(set(texture_files) - record_names)
    if missing_local_textures:
        raise RuntimeError(
            "Enemy model product missing declared textures: "
            f"{', '.join(missing_local_textures)} ({stable_key})"
        )

    shared_root = repo / "public/enemies/textures"
    if not shared_root.is_dir():
        raise RuntimeError(f"Missing shared enemy texture root: {shared_root}")
    root_prefix = root_path if root_path.endswith("/") else f"{root_path}/"
    dependencies: dict[str, dict[str, object]] = {}
    source_by_destination: dict[str, str] = {}
    reference_rows = 0
    for container, key in runtime_url_slots(material_profile):
        runtime_url = container.get(key)
        if not isinstance(runtime_url, str) or not runtime_url.startswith(ENEMY_TEXTURE_SOURCE_PREFIX):
            raise RuntimeError(f"Enemy runtime texture URL is invalid: {runtime_url} ({stable_key})")
        source_relative = safe_archive_path(
            runtime_url[len(ENEMY_TEXTURE_SOURCE_PREFIX):],
            "enemy texture source path",
        )
        archive_relative = safe_archive_path(
            f"{ENEMY_TEXTURE_ARCHIVE_PREFIX}{source_relative}",
            "enemy texture archive path",
        )
        folded = archive_relative.casefold()
        prior_source = source_by_destination.get(folded)
        if prior_source is not None and prior_source != source_relative:
            raise RuntimeError(
                "Enemy texture archive destination collision: "
                f"{prior_source} <> {source_relative} ({stable_key})"
            )
        source_by_destination[folded] = source_relative
        texture_source = shared_root.joinpath(*source_relative.split("/"))
        if not texture_source.is_file():
            raise RuntimeError(
                f"Enemy runtime texture input is missing: {source_relative} ({stable_key})"
            )
        dependencies.setdefault(archive_relative, {
            "path": archive_relative,
            "bytes": texture_source.stat().st_size,
            "_sourcePath": str(texture_source),
            "_sourceRelative": source_relative,
        })
        container[key] = f"{root_prefix}{archive_relative}"
        reference_rows += 1
    if reference_rows == 0:
        raise RuntimeError(f"Enemy material profile has no runtime texture references: {stable_key}")

    localized_profile_bytes = (
        json.dumps(material_profile, ensure_ascii=False, indent=2) + "\n"
    ).encode("utf-8")
    records: list[dict[str, object]] = []
    for record in base_records:
        if record["path"] == "material-profile.v1.json":
            records.append({
                "path": "material-profile.v1.json",
                "bytes": len(localized_profile_bytes),
                "_payload": localized_profile_bytes,
            })
        else:
            records.append(record)
    records.extend(dependencies.values())
    records.sort(key=lambda record: (str(record["path"]).casefold(), str(record["path"])))
    validate_archive_records(records, stable_key)
    dependency_bytes = sum(int(record["bytes"]) for record in dependencies.values())
    localization = {
        "status": "PASS_ARCHIVE_LOCAL",
        "profilePath": "material-profile.v1.json",
        "profileSourceBytes": len(profile_source_bytes),
        "profileLocalizedBytes": len(localized_profile_bytes),
        "referenceRows": reference_rows,
        "uniqueTextureDependencies": len(dependencies),
        "dependencyBytes": dependency_bytes,
        "sourceUrlPrefix": ENEMY_TEXTURE_SOURCE_PREFIX,
        "archiveMemberPrefix": ENEMY_TEXTURE_ARCHIVE_PREFIX,
        "runtimeUrlPrefix": f"{root_prefix}{ENEMY_TEXTURE_ARCHIVE_PREFIX}",
        "allRuntimeUrlsResolveInsideArchive": True,
        "workspaceProfileUnchanged": profile_path.read_bytes() == profile_source_bytes,
        "dependencies": [
            {
                "source": str(record["_sourceRelative"]),
                "member": str(record["path"]),
                "bytes": int(record["bytes"]),
            }
            for record in dependencies.values()
        ],
    }
    return records, localization


def product_roots(repo: Path) -> list[dict[str, object]]:
    groups = (
        ("stage", repo / "public/stages/official", "/stages/official/"),
        ("enemy-model", repo / "public/enemies/models", "/enemies/models/"),
        ("enemy-vfx", repo / "public/vfx/enemy", "/vfx/enemy/"),
        ("character-vfx", repo / "public/vfx/character", "/vfx/character/"),
    )
    products: list[dict[str, object]] = []
    for kind, root, public_prefix in groups:
        if not root.is_dir():
            raise RuntimeError(f"Missing product root: {root}")
        for product_dir in sorted(path for path in root.iterdir() if path.is_dir()):
            stable_key = f"{kind}|{product_dir.name}"
            root_path = f"{public_prefix}{product_dir.name}/"
            if kind == "enemy-model":
                records, localization = archive_local_enemy_records(
                    repo,
                    product_dir,
                    root_path,
                    stable_key,
                )
            else:
                records = file_records(product_dir)
                localization = None
            product = {
                "stableKey": stable_key,
                "kind": kind,
                "rootPath": root_path,
                "sourceDirectory": str(product_dir),
                "files": records,
                "fileCount": len(records),
                "unpackedBytes": sum(int(record["bytes"]) for record in records),
            }
            if localization is not None:
                product["archiveLocalization"] = localization
            products.append(product)
    products.sort(key=lambda item: str(item["rootPath"]))
    return products


def voice_source_path(value: str, stable_key: str) -> Path:
    parsed = urlparse(value)
    if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
        raise RuntimeError(f"Voice source URL is not a local file authority: {stable_key}")
    decoded = unquote(parsed.path)
    if os.name == "nt" and re.match(r"^/[A-Za-z]:/", decoded):
        decoded = decoded[1:]
    source = Path(decoded)
    if not source.is_file():
        raise RuntimeError(f"Voice source file is missing: {stable_key}")
    return source


def voice_products(repo: Path) -> list[dict[str, object]]:
    catalog_path = repo / VOICE_CATALOG_PATH
    scenario_path = repo / VOICE_SCENARIO_PATH
    if not catalog_path.is_file() or not scenario_path.is_file():
        raise RuntimeError("Voice catalog/scenario authority is missing")
    try:
        voice_catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        scenario_catalog = json.loads(scenario_path.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Voice catalog/scenario authority is invalid") from error
    entries = voice_catalog.get("entries") if isinstance(voice_catalog, dict) else None
    scenarios = scenario_catalog.get("entries") if isinstance(scenario_catalog, dict) else None
    if (
        voice_catalog.get("schema") != "magius.voice-catalog.v1"
        or scenario_catalog.get("schema") != "magius.voice-scenario.v1"
        or not isinstance(entries, list)
        or not isinstance(scenarios, list)
    ):
        raise RuntimeError("Voice catalog/scenario schema is invalid")
    voice_counts = voice_catalog.get("counts")
    scenario_counts = scenario_catalog.get("counts")
    if (
        not isinstance(voice_counts, dict)
        or not isinstance(scenario_counts, dict)
        or voice_counts.get("voiceEntries") != len(entries)
        or voice_counts.get("audioRuntimeReady") != len(entries)
        or scenario_counts.get("voiceEntries") != len(scenarios)
        or scenario_counts.get("scenarioReady") != len(scenarios)
    ):
        raise RuntimeError("Voice catalog/scenario counts are not fully runtime-ready")
    scenario_keys = [
        row.get("voiceStableKey")
        for row in scenarios
        if isinstance(row, dict) and isinstance(row.get("voiceStableKey"), str)
    ]
    if len(scenario_keys) != len(scenarios) or len(set(scenario_keys)) != len(scenario_keys):
        raise RuntimeError("Voice scenario stable-key denominator is invalid")

    groups: dict[str, list[dict[str, object]]] = {}
    catalog_keys: list[str] = []
    source_paths: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise RuntimeError(f"Voice catalog entry is invalid: {index}")
        stable_key = entry.get("stableKey")
        audio = entry.get("audio")
        character_id = entry.get("characterResourceId")
        stable_match = VOICE_STABLE_KEY.fullmatch(stable_key) if isinstance(stable_key, str) else None
        if (
            stable_match is None
            or not isinstance(audio, dict)
            or not isinstance(character_id, str)
            or not re.fullmatch(r"\d{6}", character_id)
        ):
            raise RuntimeError(f"Voice catalog identity is invalid: {index}")
        source_stable_key = audio.get("sourceStableKey")
        source_match = (
            VOICE_SOURCE_STABLE_KEY.fullmatch(source_stable_key)
            if isinstance(source_stable_key, str)
            else None
        )
        cue_sheet, cue_name = stable_match.groups()
        if (
            source_match is None
            or source_match.groups() != (cue_sheet, cue_name)
            or audio.get("format") != "ogg"
            or audio.get("runtimeReady") is not True
            or audio.get("failClosedReasons") != []
            or not isinstance(audio.get("runtimeUrl"), str)
        ):
            raise RuntimeError(f"Voice audio authority is invalid: {stable_key}")
        source = voice_source_path(str(audio["runtimeUrl"]), stable_key)
        if source.parent.name != cue_sheet or source.name != f"{cue_name}.ogg":
            raise RuntimeError(f"Voice source path identity mismatch: {stable_key}")
        source_identity = os.path.normcase(str(source.resolve()))
        if source_identity in source_paths:
            raise RuntimeError(f"Voice source file is duplicated: {stable_key}")
        source_paths.add(source_identity)
        member = safe_archive_path(f"{cue_name}.ogg", f"voice member {stable_key}")
        groups.setdefault(cue_sheet, []).append({
            "path": member,
            "bytes": source.stat().st_size,
            "voiceStableKey": stable_key,
            "sourceStableKey": source_stable_key,
            "characterResourceId": character_id,
            "_sourcePath": str(source),
        })
        catalog_keys.append(stable_key)

    if len(set(catalog_keys)) != len(catalog_keys) or set(catalog_keys) != set(scenario_keys):
        raise RuntimeError("Voice catalog/scenario stable-key join is not exact")

    products: list[dict[str, object]] = []
    for cue_sheet in sorted(groups):
        records = sorted(groups[cue_sheet], key=lambda record: str(record["path"]))
        validate_archive_records(records, f"voice|{cue_sheet}")
        character_ids = {str(record["characterResourceId"]) for record in records}
        source_directories = {str(Path(str(record["_sourcePath"])).parent) for record in records}
        if len(character_ids) != 1 or len(source_directories) != 1:
            raise RuntimeError(f"Voice cue-sheet identity is ambiguous: {cue_sheet}")
        products.append({
            "stableKey": f"voice|{cue_sheet}",
            "kind": "voice",
            "rootPath": f"/voice/Cv/{cue_sheet}/",
            "sourceDirectory": next(iter(source_directories)),
            "characterResourceId": next(iter(character_ids)),
            "files": records,
            "fileCount": len(records),
            "unpackedBytes": sum(int(record["bytes"]) for record in records),
        })
    if sum(int(product["fileCount"]) for product in products) != len(entries):
        raise RuntimeError("Voice product member denominator is incomplete")
    return products


def voice_archive_aggregate(products: list[dict[str, object]]) -> dict[str, object]:
    return {
        "releaseTag": VOICE_RELEASE_TAG,
        "cueSheets": len(products),
        "voiceEntries": sum(int(product["fileCount"]) for product in products),
        "scenarioEntriesJoined": sum(int(product["fileCount"]) for product in products),
        "sourceBytes": sum(int(product["unpackedBytes"]) for product in products),
        "packedBytes": sum(int(product["packedBytes"]) for product in products),
        "maxAssetBytes": max(int(product["packedBytes"]) for product in products),
        "compression": "ZIP_STORED",
        "missing": 0,
        "duplicateStableKeys": 0,
        "sourceStableKeysPreserved": True,
    }


def asset_name(index: int, product: dict[str, object]) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", str(product["stableKey"]))
    stem = stem.strip("-.")[:170] or "product"
    return f"{index + 1:04d}-{stem}.zip"


def assign_releases(products: list[dict[str, object]]) -> None:
    if len(products) > MAX_ASSETS_PER_RELEASE * len(BASE_RELEASE_TAGS):
        raise RuntimeError("Runtime products exceed the bounded two-release plan")
    for index, product in enumerate(products):
        tag = (
            BASE_RELEASE_TAGS[0]
            if index < TARGET_ASSETS_IN_FIRST_RELEASE
            else BASE_RELEASE_TAGS[1]
        )
        if product["kind"] == "enemy-model":
            tag = ENEMY_MODEL_RELEASE_TAG
        elif product["kind"] == "voice":
            tag = VOICE_RELEASE_TAG
        name = asset_name(index, product)
        product["releaseTag"] = tag
        product["assetName"] = name
        product["originUrl"] = (
            f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
        )
        product["packUrl"] = f"{DELIVERY_GATEWAY}/{tag}/{name}"


def write_stored_zip(source: Path, destination: Path, records: list[dict[str, object]]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    if temporary.exists():
        temporary.unlink()
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for record in records:
            relative = safe_archive_path(str(record["path"]), "archive member path")
            payload = record.get("_payload")
            source_file = Path(str(record.get("_sourcePath", source / Path(relative))))
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.file_size = int(record["bytes"])
            with archive.open(info, "w") as output_file:
                if isinstance(payload, bytes):
                    if len(payload) != int(record["bytes"]):
                        raise RuntimeError(f"Archive payload size mismatch: {relative}")
                    output_file.write(payload)
                else:
                    if not source_file.is_file() or source_file.stat().st_size != int(record["bytes"]):
                        raise RuntimeError(f"Archive source size mismatch: {source_file}")
                    with source_file.open("rb") as input_file:
                        shutil.copyfileobj(input_file, output_file, length=8 * 1024 * 1024)
    temporary.replace(destination)


def reopen_zip(
    path: Path,
    expected_files: int,
    expected_bytes: int,
    records: list[dict[str, object]] | None = None,
) -> None:
    if path.stat().st_size >= MAX_RELEASE_ASSET_BYTES:
        raise RuntimeError(f"Release asset exceeds GitHub's 2 GiB file limit: {path}")
    with zipfile.ZipFile(path, "r") as archive:
        infos = archive.infolist()
        if len(infos) != expected_files:
            raise RuntimeError(f"ZIP file count mismatch: {path}")
        if sum(info.file_size for info in infos) != expected_bytes:
            raise RuntimeError(f"ZIP unpacked byte count mismatch: {path}")
        if any(info.compress_type != zipfile.ZIP_STORED for info in infos):
            raise RuntimeError(f"ZIP is not stream-pass-through compatible: {path}")
        if records is not None:
            expected = {
                str(record["path"]): int(record["bytes"])
                for record in records
            }
            actual = {info.filename: info.file_size for info in infos}
            if actual != expected:
                raise RuntimeError(f"ZIP member closure mismatch: {path}")
            for record in records:
                relative = str(record["path"])
                payload = record.get("_payload")
                with archive.open(relative, "r") as archived:
                    if isinstance(payload, bytes):
                        if archived.read() != payload:
                            raise RuntimeError(f"ZIP payload identity mismatch: {path}!/{relative}")
                    else:
                        source_file = Path(str(record.get("_sourcePath", "")))
                        if not source_file.is_file():
                            raise RuntimeError(f"ZIP identity source is missing: {relative}")
                        with source_file.open("rb") as source:
                            while True:
                                expected_chunk = source.read(8 * 1024 * 1024)
                                actual_chunk = archived.read(8 * 1024 * 1024)
                                if actual_chunk != expected_chunk:
                                    raise RuntimeError(
                                        f"ZIP payload identity mismatch: {path}!/{relative}"
                                    )
                                if not expected_chunk:
                                    break


def reopen_archive_local_urls(path: Path, product: dict[str, object]) -> None:
    localization = product.get("archiveLocalization")
    if not isinstance(localization, dict):
        return
    runtime_prefix = str(localization["runtimeUrlPrefix"])
    with zipfile.ZipFile(path, "r") as archive:
        names = set(archive.namelist())
        try:
            profile = json.loads(archive.read("material-profile.v1.json").decode("utf-8"))
        except (KeyError, UnicodeError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Archive-local material profile is invalid: {path}") from error
        resolved = 0
        for container, key in runtime_url_slots(profile):
            runtime_url = container.get(key)
            if not isinstance(runtime_url, str) or not runtime_url.startswith(runtime_prefix):
                raise RuntimeError(f"Archive-local runtime URL is invalid: {path}")
            member = runtime_url[len(str(product["rootPath"])):]
            if member not in names:
                raise RuntimeError(f"Archive-local runtime URL is unresolved: {path}!/{member}")
            resolved += 1
        if resolved != int(localization["referenceRows"]):
            raise RuntimeError(f"Archive-local runtime URL count mismatch: {path}")


def manifest_product(product: dict[str, object]) -> dict[str, object]:
    manifest = dict(product)
    if isinstance(manifest.get("files"), list):
        manifest["files"] = public_file_records(list(manifest["files"]))
    return manifest


def targeted_product(
    repo: Path,
    stable_key: str,
    public_manifest: dict[str, object],
) -> tuple[dict[str, object], dict[str, object]]:
    try:
        kind, directory_name = stable_key.split("|", 1)
    except ValueError as error:
        raise RuntimeError(f"Invalid runtime product stable key: {stable_key}") from error
    groups = {
        "stage": (repo / "public/stages/official", "/stages/official/"),
        "enemy-model": (repo / "public/enemies/models", "/enemies/models/"),
        "enemy-vfx": (repo / "public/vfx/enemy", "/vfx/enemy/"),
        "character-vfx": (repo / "public/vfx/character", "/vfx/character/"),
    }
    if kind not in groups:
        raise RuntimeError(f"Unknown runtime product kind: {kind}")
    if not directory_name or Path(directory_name).name != directory_name:
        raise RuntimeError(f"Unsafe runtime product directory name: {directory_name}")
    root, public_prefix = groups[kind]
    source = root / directory_name
    if not source.is_dir():
        raise RuntimeError(f"Missing runtime product directory: {source}")

    entries = public_manifest.get("entries")
    if not isinstance(entries, list):
        raise RuntimeError("Runtime product catalog has no entries array")
    matches = [entry for entry in entries if isinstance(entry, dict) and entry.get("stableKey") == stable_key]
    if len(matches) != 1:
        raise RuntimeError(f"Runtime product catalog target count is {len(matches)}: {stable_key}")
    previous = dict(matches[0])
    expected_root = f"{public_prefix}{directory_name}/"
    if previous.get("kind") != kind or previous.get("rootPath") != expected_root:
        raise RuntimeError(f"Runtime product catalog identity mismatch: {stable_key}")
    release_tag = str(previous.get("releaseTag", ""))
    release_asset = str(previous.get("assetName", ""))
    if release_tag not in RELEASE_TAGS or not release_asset.endswith(".zip"):
        raise RuntimeError(f"Runtime product release identity is invalid: {stable_key}")
    expected_origin = f"https://github.com/{REPOSITORY}/releases/download/{release_tag}/{release_asset}"
    expected_pack = f"{DELIVERY_GATEWAY}/{release_tag}/{release_asset}"
    if previous.get("originUrl") != expected_origin or previous.get("packUrl") != expected_pack:
        raise RuntimeError(f"Runtime product release URLs are invalid: {stable_key}")

    if kind == "enemy-model":
        records, localization = archive_local_enemy_records(
            repo,
            source,
            expected_root,
            stable_key,
        )
    else:
        records = file_records(source)
        localization = None

    product = {
        "stableKey": stable_key,
        "kind": kind,
        "rootPath": expected_root,
        "sourceDirectory": str(source),
        "files": records,
        "fileCount": len(records),
        "unpackedBytes": sum(int(record["bytes"]) for record in records),
        "releaseTag": release_tag,
        "assetName": release_asset,
        "originUrl": expected_origin,
        "packUrl": expected_pack,
    }
    if localization is not None:
        product["archiveLocalization"] = localization
    return product, previous


def refresh_targeted_product(
    repo: Path,
    artifact_root: Path,
    catalog_output: Path,
    stable_key: str,
) -> int:
    if not catalog_output.is_file():
        raise RuntimeError(f"Targeted refresh requires an existing catalog: {catalog_output}")
    public_manifest = json.loads(catalog_output.read_text(encoding="utf-8"))
    if (
        public_manifest.get("schema") != SCHEMA
        or public_manifest.get("repository") != REPOSITORY
        or public_manifest.get("deliveryGateway") != DELIVERY_GATEWAY
    ):
        raise RuntimeError("Targeted refresh catalog authority is invalid")
    product, previous = targeted_product(repo, stable_key, public_manifest)
    destination = (
        artifact_root / "assets" / str(product["releaseTag"]) / str(product["assetName"])
    )
    write_stored_zip(Path(str(product["sourceDirectory"])), destination, list(product["files"]))
    reopen_zip(
        destination,
        int(product["fileCount"]),
        int(product["unpackedBytes"]),
        list(product["files"]),
    )
    reopen_archive_local_urls(destination, product)
    product["assetPath"] = str(destination)
    product["packedBytes"] = destination.stat().st_size

    public_entry = {
        key: product[key]
        for key in (
            "stableKey", "kind", "rootPath", "releaseTag", "assetName",
            "packUrl", "originUrl", "fileCount", "unpackedBytes", "packedBytes",
        )
    }
    entry_index = next(
        index
        for index, entry in enumerate(public_manifest["entries"])
        if entry.get("stableKey") == stable_key
    )
    public_manifest["entries"][entry_index] = public_entry
    counts = public_manifest.get("counts")
    if not isinstance(counts, dict):
        raise RuntimeError("Runtime product catalog has no counts object")
    for field in ("unpackedBytes", "packedBytes"):
        if not isinstance(counts.get(field), int) or not isinstance(previous.get(field), int):
            raise RuntimeError(f"Runtime product catalog count is invalid: {field}")
        counts[field] = int(counts[field]) - int(previous[field]) + int(public_entry[field])

    catalog_output.write_text(
        json.dumps(public_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    artifact_root.mkdir(parents=True, exist_ok=True)
    delta = {
        "stableKey": stable_key,
        "previous": previous,
        "modified": public_entry,
        "unpackedBytesDelta": int(public_entry["unpackedBytes"]) - int(previous["unpackedBytes"]),
        "packedBytesDelta": int(public_entry["packedBytes"]) - int(previous["packedBytes"]),
    }
    release_manifest = {
        "schema": "magius.runtime-product-release-refresh.v1",
        "repository": REPOSITORY,
        "artifactRoot": str(artifact_root),
        "catalogOutput": str(catalog_output),
        "target": manifest_product(product),
        "catalogDelta": delta,
    }
    (artifact_root / "release-assets-manifest.v1.json").write_text(
        json.dumps(release_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    upload_plan = {
        "schema": "magius.runtime-product-release-upload-plan.v1",
        "repository": REPOSITORY,
        "releaseTags": [{
            "tag": product["releaseTag"],
            "assetCount": 1,
            "assets": [{
                "stableKey": stable_key,
                "assetName": product["assetName"],
                "assetPath": str(destination),
            }],
            "uploadCommand": (
                f'gh release upload {product["releaseTag"]} "{destination}" '
                f'--repo {REPOSITORY} --clobber'
            ),
        }],
        "mutationPerformed": False,
    }
    (artifact_root / "upload-plan.v1.json").write_text(
        json.dumps(upload_plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = {
        "mode": "targeted-refresh",
        "stableKey": stable_key,
        "catalog": str(catalog_output),
        "artifactRoot": str(artifact_root),
        "assetPath": str(destination),
        "fileCount": product["fileCount"],
        "unpackedBytes": product["unpackedBytes"],
        "packedBytes": product["packedBytes"],
        "catalogDelta": delta,
    }
    (artifact_root / "build-summary.literal.txt").write_text(
        json.dumps(summary, ensure_ascii=False) + "\nEXIT_STATUS=0\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def load_catalog_authority(catalog_output: Path) -> dict[str, object]:
    if not catalog_output.is_file():
        raise RuntimeError(f"Runtime product catalog is missing: {catalog_output}")
    try:
        catalog = json.loads(catalog_output.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Runtime product catalog is invalid: {catalog_output}") from error
    if (
        not isinstance(catalog, dict)
        or catalog.get("schema") != SCHEMA
        or catalog.get("repository") != REPOSITORY
        or catalog.get("deliveryGateway") != DELIVERY_GATEWAY
        or not isinstance(catalog.get("entries"), list)
        or not isinstance(catalog.get("counts"), dict)
        or not isinstance(catalog.get("releasePolicy"), dict)
    ):
        raise RuntimeError("Runtime product catalog authority is invalid")
    return catalog


def enemy_model_products(
    repo: Path,
    catalog: dict[str, object],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    entries = list(catalog["entries"])
    enemy_entries = [
        entry for entry in entries
        if isinstance(entry, dict) and entry.get("kind") == "enemy-model"
    ]
    if not enemy_entries:
        raise RuntimeError("Runtime product catalog has no enemy-model entries")
    previous_by_key: dict[str, dict[str, object]] = {}
    for entry in enemy_entries:
        stable_key = str(entry.get("stableKey", ""))
        if not stable_key or stable_key in previous_by_key:
            raise RuntimeError(f"Enemy catalog stable key is invalid or duplicated: {stable_key}")
        previous_by_key[stable_key] = entry

    models_root = repo / "public/enemies/models"
    if not models_root.is_dir():
        raise RuntimeError(f"Missing enemy model root: {models_root}")
    products: list[dict[str, object]] = []
    previous_entries: list[dict[str, object]] = []
    asset_names: set[str] = set()
    for source in sorted(path for path in models_root.iterdir() if path.is_dir()):
        stable_key = f"enemy-model|{source.name}"
        previous = previous_by_key.pop(stable_key, None)
        if previous is None:
            raise RuntimeError(f"Enemy model is absent from runtime product catalog: {stable_key}")
        root_path = f"/enemies/models/{source.name}/"
        if previous.get("rootPath") != root_path:
            raise RuntimeError(f"Enemy model catalog root mismatch: {stable_key}")
        asset = str(previous.get("assetName", ""))
        if not asset.endswith(".zip") or Path(asset).name != asset or asset in asset_names:
            raise RuntimeError(f"Enemy model release asset name is invalid: {stable_key}")
        asset_names.add(asset)
        records, localization = archive_local_enemy_records(repo, source, root_path, stable_key)
        product = {
            "stableKey": stable_key,
            "kind": "enemy-model",
            "rootPath": root_path,
            "sourceDirectory": str(source),
            "files": records,
            "fileCount": len(records),
            "unpackedBytes": sum(int(record["bytes"]) for record in records),
            "releaseTag": ENEMY_MODEL_RELEASE_TAG,
            "assetName": asset,
            "originUrl": (
                f"https://github.com/{REPOSITORY}/releases/download/"
                f"{ENEMY_MODEL_RELEASE_TAG}/{asset}"
            ),
            "packUrl": f"{DELIVERY_GATEWAY}/{ENEMY_MODEL_RELEASE_TAG}/{asset}",
            "archiveLocalization": localization,
        }
        products.append(product)
        previous_entries.append(dict(previous))
    if previous_by_key:
        raise RuntimeError(
            "Catalog enemy-model entries have no source directory: "
            + ", ".join(sorted(previous_by_key))
        )
    return products, previous_entries


def enemy_archive_aggregate(products: list[dict[str, object]]) -> dict[str, object]:
    shared_sources: dict[str, int] = {}
    max_asset = {"stableKey": None, "assetName": None, "bytes": 0}
    for product in products:
        localization = product["archiveLocalization"]
        for dependency in localization["dependencies"]:
            source = str(dependency["source"])
            size = int(dependency["bytes"])
            prior = shared_sources.get(source)
            if prior is not None and prior != size:
                raise RuntimeError(f"Shared enemy texture size is inconsistent: {source}")
            shared_sources[source] = size
        packed_value = product.get("packedBytes")
        packed_bytes = int(packed_value) if isinstance(packed_value, int) else 0
        if packed_bytes > int(max_asset["bytes"]):
            max_asset = {
                "stableKey": product["stableKey"],
                "assetName": product["assetName"],
                "bytes": packed_bytes,
            }
    reference_rows = sum(
        int(product["archiveLocalization"]["referenceRows"])
        for product in products
    )
    per_model_dependencies = sum(
        int(product["archiveLocalization"]["uniqueTextureDependencies"])
        for product in products
    )
    duplicate_dependency_bytes = sum(
        int(product["archiveLocalization"]["dependencyBytes"])
        for product in products
    )
    return {
        "status": "PASS_ARCHIVE_LOCAL_CLOSURE",
        "releaseTag": ENEMY_MODEL_RELEASE_TAG,
        "modelProducts": len(products),
        "referenceRows": reference_rows,
        "runtimeUrlsResolvedInsideArchives": reference_rows,
        "globalUniqueTextureAuthorities": len(shared_sources),
        "sharedTextureAuthorityBytes": sum(shared_sources.values()),
        "perModelUniqueTextureCopies": per_model_dependencies,
        "duplicatedTextureBytes": duplicate_dependency_bytes,
        "workspaceMaterialProfileBytes": sum(
            int(product["archiveLocalization"]["profileSourceBytes"])
            for product in products
        ),
        "archiveLocalMaterialProfileBytes": sum(
            int(product["archiveLocalization"]["profileLocalizedBytes"])
            for product in products
        ),
        "archiveFiles": sum(int(product["fileCount"]) for product in products),
        "archiveUnpackedBytes": sum(int(product["unpackedBytes"]) for product in products),
        "archivePackedBytes": sum(
            int(product["packedBytes"])
            for product in products
            if isinstance(product.get("packedBytes"), int)
        ),
        "maxAsset": max_asset,
        "missingInputs": 0,
        "unsafePaths": 0,
        "destinationCollisions": 0,
        "workspaceMaterialProfilesUnchanged": all(
            bool(product["archiveLocalization"]["workspaceProfileUnchanged"])
            for product in products
        ),
    }


def build_enemy_models_only(
    repo: Path,
    artifact_root: Path,
    catalog_output: Path,
) -> int:
    catalog = load_catalog_authority(catalog_output)
    original_catalog = json.loads(json.dumps(catalog, ensure_ascii=False))
    products, previous_entries = enemy_model_products(repo, catalog)
    asset_directory = artifact_root / "assets" / ENEMY_MODEL_RELEASE_TAG
    asset_directory.mkdir(parents=True, exist_ok=True)
    for index, product in enumerate(products):
        destination = asset_directory / str(product["assetName"])
        records = list(product["files"])
        write_stored_zip(Path(str(product["sourceDirectory"])), destination, records)
        reopen_zip(
            destination,
            int(product["fileCount"]),
            int(product["unpackedBytes"]),
            records,
        )
        reopen_archive_local_urls(destination, product)
        product["assetPath"] = str(destination)
        product["packedBytes"] = destination.stat().st_size
        if (index + 1) % 25 == 0 or index + 1 == len(products):
            print(f"PACKED_ENEMY_MODELS={index + 1}/{len(products)}")
    expected_assets = sorted(str(product["assetName"]) for product in products)
    actual_assets = sorted(path.name for path in asset_directory.iterdir() if path.is_file())
    if actual_assets != expected_assets:
        raise RuntimeError("Enemy-model asset directory has an unexpected file closure")

    aggregate = enemy_archive_aggregate(products)
    public_by_key = {str(product["stableKey"]): product for product in products}
    modified_entries: list[dict[str, object]] = []
    for entry in catalog["entries"]:
        if not isinstance(entry, dict):
            raise RuntimeError("Runtime product catalog entry is invalid")
        product = public_by_key.get(str(entry.get("stableKey", "")))
        if product is None:
            modified_entries.append(entry)
            continue
        modified_entries.append({
            "stableKey": product["stableKey"],
            "kind": product["kind"],
            "rootPath": product["rootPath"],
            "releaseTag": product["releaseTag"],
            "assetName": product["assetName"],
            "packUrl": product["packUrl"],
            "originUrl": product["originUrl"],
            "fileCount": product["fileCount"],
            "unpackedBytes": product["unpackedBytes"],
            "packedBytes": product["packedBytes"],
        })
    catalog["entries"] = modified_entries
    previous_unpacked = sum(int(entry["unpackedBytes"]) for entry in previous_entries)
    previous_packed = sum(int(entry["packedBytes"]) for entry in previous_entries)
    catalog["counts"]["unpackedBytes"] = (
        int(catalog["counts"]["unpackedBytes"])
        - previous_unpacked
        + int(aggregate["archiveUnpackedBytes"])
    )
    catalog["counts"]["packedBytes"] = (
        int(catalog["counts"]["packedBytes"])
        - previous_packed
        + int(aggregate["archivePackedBytes"])
    )
    catalog["releasePolicy"]["tags"] = list(RELEASE_TAGS)
    catalog["enemyTextureArchive"] = aggregate

    original_non_enemy = [
        entry for entry in original_catalog["entries"]
        if entry.get("kind") != "enemy-model"
    ]
    modified_non_enemy = [
        entry for entry in catalog["entries"]
        if entry.get("kind") != "enemy-model"
    ]
    if modified_non_enemy != original_non_enemy:
        raise RuntimeError("Non-enemy runtime product catalog entries changed")
    if len(products) > MAX_ASSETS_PER_RELEASE:
        raise RuntimeError("Enemy-model release asset-count limit exceeded")
    if any(int(product["packedBytes"]) >= MAX_RELEASE_ASSET_BYTES for product in products):
        raise RuntimeError("Enemy-model release asset size limit exceeded")

    catalog_output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    artifact_root.mkdir(parents=True, exist_ok=True)
    closure = {
        "schema": "magius.enemy-texture-archive-closure.v1",
        **aggregate,
        "models": [
            {
                "stableKey": product["stableKey"],
                "rootPath": product["rootPath"],
                "releaseTag": product["releaseTag"],
                "assetName": product["assetName"],
                "assetPath": product["assetPath"],
                "fileCount": product["fileCount"],
                "unpackedBytes": product["unpackedBytes"],
                "packedBytes": product["packedBytes"],
                "archiveLocalization": product["archiveLocalization"],
            }
            for product in products
        ],
    }
    (artifact_root / "enemy-texture-archive-closure.v1.json").write_text(
        json.dumps(closure, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    release_manifest = {
        "schema": "magius.runtime-product-enemy-model-release.v2",
        "repository": REPOSITORY,
        "releaseTag": ENEMY_MODEL_RELEASE_TAG,
        "artifactRoot": str(artifact_root),
        "catalogOutput": str(catalog_output),
        "aggregate": aggregate,
        "products": [manifest_product(product) for product in products],
    }
    (artifact_root / "release-assets-manifest.v1.json").write_text(
        json.dumps(release_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    upload_plan = {
        "schema": "magius.runtime-product-release-upload-plan.v1",
        "repository": REPOSITORY,
        "releaseTags": [{
            "tag": ENEMY_MODEL_RELEASE_TAG,
            "assetCount": len(products),
            "assetsDirectory": str(asset_directory),
            "createCommand": (
                f'gh release create {ENEMY_MODEL_RELEASE_TAG} --repo {REPOSITORY} '
                '--title "Runtime enemy models v2" '
                '--notes "Archive-local enemy model texture closure."'
            ),
            "uploadCommand": (
                f'gh release upload {ENEMY_MODEL_RELEASE_TAG} "{asset_directory}/*" '
                f'--repo {REPOSITORY} --clobber=false'
            ),
        }],
        "mutationPerformed": False,
    }
    (artifact_root / "upload-plan.v1.json").write_text(
        json.dumps(upload_plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = {
        "mode": "enemy-models-only",
        "catalog": str(catalog_output),
        "artifactRoot": str(artifact_root),
        "aggregate": aggregate,
        "releaseCounts": {ENEMY_MODEL_RELEASE_TAG: len(products)},
    }
    (artifact_root / "build-summary.literal.txt").write_text(
        json.dumps(summary, ensure_ascii=False) + "\nEXIT_STATUS=0\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def public_product_entry(product: dict[str, object]) -> dict[str, object]:
    return {
        "stableKey": product["stableKey"],
        "kind": product["kind"],
        "rootPath": product["rootPath"],
        "releaseTag": product["releaseTag"],
        "assetName": product["assetName"],
        "packUrl": product["packUrl"],
        "originUrl": product["originUrl"],
        "fileCount": product["fileCount"],
        "unpackedBytes": product["unpackedBytes"],
        "packedBytes": product["packedBytes"],
    }


def build_voice_only(
    repo: Path,
    artifact_root: Path,
    catalog_output: Path,
) -> int:
    catalog = load_catalog_authority(catalog_output)
    existing_entries = catalog["entries"]
    non_voice_entries = [
        json.loads(json.dumps(entry, ensure_ascii=False))
        for entry in existing_entries
        if isinstance(entry, dict) and entry.get("kind") != "voice"
    ]
    if len(non_voice_entries) + sum(
        isinstance(entry, dict) and entry.get("kind") == "voice"
        for entry in existing_entries
    ) != len(existing_entries):
        raise RuntimeError("Runtime product catalog contains an invalid entry")

    products = voice_products(repo)
    if not products or len(products) > MAX_ASSETS_PER_RELEASE:
        raise RuntimeError(f"Voice release asset count is invalid: {len(products)}")
    existing_voice_entries = [entry for entry in existing_entries if entry["kind"] == "voice"]
    existing_voice_by_key = {entry["stableKey"]: entry for entry in existing_voice_entries}
    if len(existing_voice_by_key) != len(existing_voice_entries):
        raise RuntimeError("Duplicate existing voice delivery identity")
    product_keys = {product["stableKey"] for product in products}
    if not set(existing_voice_by_key).issubset(product_keys):
        raise RuntimeError("Existing voice delivery identity is absent from source")
    old_order = {entry["stableKey"]: index for index, entry in enumerate(existing_voice_entries)}
    products.sort(key=lambda product: (
        old_order.get(product["stableKey"], len(old_order)), str(product["rootPath"]),
    ))
    next_index = max([
        len(existing_entries),
        *(int(match.group(1)) for entry in existing_entries
          if (match := re.match(r"^(\d+)-", str(entry["assetName"])))),
    ])
    used_names = {str(entry["assetName"]) for entry in existing_entries}
    for product in products:
        prior = existing_voice_by_key.get(product["stableKey"])
        if prior:
            name = str(prior["assetName"])
            if (
                prior["rootPath"] != product["rootPath"]
                or prior["releaseTag"] != VOICE_RELEASE_TAG
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.zip", name)
                or prior["packUrl"] != f"{DELIVERY_GATEWAY}/{VOICE_RELEASE_TAG}/{name}"
            ):
                raise RuntimeError("Existing voice delivery route differs from authority")
        else:
            name = asset_name(next_index, product)
            next_index += 1
            if name in used_names:
                raise RuntimeError("New voice delivery asset name collides")
            used_names.add(name)
        product["releaseTag"] = VOICE_RELEASE_TAG
        product["assetName"] = name
        product["originUrl"] = (
            f"https://github.com/{REPOSITORY}/releases/download/"
            f"{VOICE_RELEASE_TAG}/{name}"
        )
        product["packUrl"] = f"{DELIVERY_GATEWAY}/{VOICE_RELEASE_TAG}/{name}"
        source = Path(str(product["sourceDirectory"]))
        destination = artifact_root / "assets" / VOICE_RELEASE_TAG / name
        records = list(product["files"])
        if destination.exists():
            reopen_zip(
                destination,
                int(product["fileCount"]),
                int(product["unpackedBytes"]),
                records,
            )
        else:
            write_stored_zip(source, destination, records)
            reopen_zip(
                destination,
                int(product["fileCount"]),
                int(product["unpackedBytes"]),
                records,
            )
        product["assetPath"] = str(destination)
        product["packedBytes"] = destination.stat().st_size
        if int(product["packedBytes"]) > MAX_GATEWAY_ASSET_BYTES:
            raise RuntimeError(f"Voice release asset exceeds 25 MiB: {name}")

    aggregate = voice_archive_aggregate(products)
    voice_entries = [public_product_entry(product) for product in products]
    catalog["entries"] = non_voice_entries + voice_entries
    counts = catalog["counts"]
    counts["products"] = len(catalog["entries"])
    counts["stageProducts"] = sum(entry["kind"] == "stage" for entry in catalog["entries"])
    counts["enemyModels"] = sum(entry["kind"] == "enemy-model" for entry in catalog["entries"])
    counts["enemyVfxProducts"] = sum(entry["kind"] == "enemy-vfx" for entry in catalog["entries"])
    counts["characterVfxProducts"] = sum(
        entry["kind"] == "character-vfx" for entry in catalog["entries"]
    )
    counts["voiceProducts"] = len(voice_entries)
    counts["releaseAssets"] = len(catalog["entries"])
    counts["unpackedBytes"] = sum(int(entry["unpackedBytes"]) for entry in catalog["entries"])
    counts["packedBytes"] = sum(int(entry["packedBytes"]) for entry in catalog["entries"])
    catalog["releasePolicy"]["tags"] = list(RELEASE_TAGS)
    catalog["voiceArchive"] = aggregate
    if [entry for entry in catalog["entries"] if entry["kind"] != "voice"] != non_voice_entries:
        raise RuntimeError("Non-voice runtime product catalog entries changed")

    artifact_root.mkdir(parents=True, exist_ok=True)
    catalog_output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    release_manifest = {
        "schema": "magius.runtime-product-voice-release-assets.v1",
        "repository": REPOSITORY,
        "releaseTag": VOICE_RELEASE_TAG,
        "artifactRoot": str(artifact_root),
        "catalogOutput": str(catalog_output),
        "aggregate": aggregate,
        "products": [manifest_product(product) for product in products],
    }
    (artifact_root / "release-assets-manifest.v1.json").write_text(
        json.dumps(release_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    upload_plan = {
        "schema": "magius.runtime-product-release-upload-plan.v1",
        "repository": REPOSITORY,
        "releaseTags": [{
            "tag": VOICE_RELEASE_TAG,
            "assetCount": len(products),
            "assetsDirectory": str(artifact_root / "assets" / VOICE_RELEASE_TAG),
            "createCommand": (
                f'gh release create {VOICE_RELEASE_TAG} --repo {REPOSITORY} '
                '--title "Runtime voice products v1" '
                '--notes "Exact CRI cue-sheet audio runtime products."'
            ),
            "uploadCommand": (
                f'gh release upload {VOICE_RELEASE_TAG} '
                f'"{artifact_root / "assets" / VOICE_RELEASE_TAG}/*" '
                f'--repo {REPOSITORY} --clobber=false'
            ),
        }],
        "mutationPerformed": False,
    }
    (artifact_root / "upload-plan.v1.json").write_text(
        json.dumps(upload_plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = {
        "status": "PASS_VOICE_RUNTIME_PRODUCT_CLOSURE",
        "catalog": str(catalog_output),
        "artifactRoot": str(artifact_root),
        "aggregate": aggregate,
    }
    (artifact_root / "build-summary.literal.txt").write_text(
        json.dumps(summary, ensure_ascii=False) + "\nEXIT_STATUS=0\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def main() -> int:
    args = parse_args()
    repo = args.repo_root.resolve()
    artifact_root = (
        args.artifact_root
        or repo / "artifacts/release/20260826-runtime-product-release-v1"
    ).resolve()
    catalog_output = (
        args.catalog_output
        or repo / "public/catalogs/runtime-product-delivery.v1.json"
    ).resolve()
    selected_modes = sum(bool(value) for value in (
        args.only_stable_key,
        args.enemy_models_only,
        args.voice_only,
    ))
    if selected_modes > 1:
        raise RuntimeError("Choose only one bounded runtime product generation mode")
    if args.only_stable_key:
        if args.plan_only:
            raise RuntimeError("Targeted refresh does not support --plan-only")
        return refresh_targeted_product(
            repo,
            artifact_root,
            catalog_output,
            args.only_stable_key,
        )
    if args.enemy_models_only:
        if args.plan_only:
            raise RuntimeError("Enemy-model-only generation does not support --plan-only")
        return build_enemy_models_only(repo, artifact_root, catalog_output)
    if args.voice_only:
        if args.plan_only:
            raise RuntimeError("Voice-only generation does not support --plan-only")
        return build_voice_only(repo, artifact_root, catalog_output)
    products = product_roots(repo)
    products.sort(key=lambda item: str(item["rootPath"]))
    products.extend(voice_products(repo))
    assign_releases(products)

    release_counts = {tag: 0 for tag in RELEASE_TAGS}
    for product in products:
        release_counts[str(product["releaseTag"])] += 1
    if any(count > MAX_ASSETS_PER_RELEASE for count in release_counts.values()):
        raise RuntimeError(f"Release asset-count limit exceeded: {release_counts}")

    if not args.plan_only:
        for index, product in enumerate(products):
            source = Path(str(product["sourceDirectory"]))
            destination = artifact_root / "assets" / str(product["releaseTag"]) / str(product["assetName"])
            expected_files = int(product["fileCount"])
            expected_bytes = int(product["unpackedBytes"])
            if destination.exists():
                reopen_zip(destination, expected_files, expected_bytes, list(product["files"]))
            else:
                write_stored_zip(source, destination, list(product["files"]))
                reopen_zip(destination, expected_files, expected_bytes, list(product["files"]))
            reopen_archive_local_urls(destination, product)
            product["assetPath"] = str(destination)
            product["packedBytes"] = destination.stat().st_size
            if (index + 1) % 50 == 0 or index + 1 == len(products):
                print(f"PACKED={index + 1}/{len(products)}")
    else:
        for product in products:
            product["packedBytes"] = None

    public_entries = [public_product_entry(product) for product in products]
    counts = {
        "products": len(products),
        "stageProducts": sum(product["kind"] == "stage" for product in products),
        "enemyModels": sum(product["kind"] == "enemy-model" for product in products),
        "enemyVfxProducts": sum(product["kind"] == "enemy-vfx" for product in products),
        "characterVfxProducts": sum(product["kind"] == "character-vfx" for product in products),
        "voiceProducts": sum(product["kind"] == "voice" for product in products),
        "releaseAssets": len(products),
        "unpackedBytes": sum(int(product["unpackedBytes"]) for product in products),
        "packedBytes": None if args.plan_only else sum(int(product["packedBytes"]) for product in products),
    }
    public_manifest = {
        "schema": SCHEMA,
        "repository": REPOSITORY,
        "deliveryGateway": DELIVERY_GATEWAY,
        "activation": {
            "hosts": ["hiiraginemu.github.io", "magius3dviewer.pages.dev"],
            "queryOverride": "runtimeDelivery=release",
            "localMode": "prefer-workspace-files",
        },
        "releasePolicy": {
            "tags": list(RELEASE_TAGS),
            "maxAssetsPerRelease": MAX_ASSETS_PER_RELEASE,
            "maxAssetBytesExclusive": MAX_RELEASE_ASSET_BYTES,
            "compression": "zip-stored-stream-pass-through",
        },
        "counts": counts,
        "entries": public_entries,
    }
    if not args.plan_only:
        public_manifest["enemyTextureArchive"] = enemy_archive_aggregate([
            product for product in products if product["kind"] == "enemy-model"
        ])
        public_manifest["voiceArchive"] = voice_archive_aggregate([
            product for product in products if product["kind"] == "voice"
        ])
    catalog_output.parent.mkdir(parents=True, exist_ok=True)
    catalog_output.write_text(json.dumps(public_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    artifact_root.mkdir(parents=True, exist_ok=True)
    delivery_manifest = {
        **public_manifest,
        "artifactRoot": str(artifact_root),
        "entries": [manifest_product(product) for product in products],
    }
    (artifact_root / "release-assets-manifest.v1.json").write_text(
        json.dumps(delivery_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    upload_plan = {
        "schema": "magius.runtime-product-release-upload-plan.v1",
        "repository": REPOSITORY,
        "releaseTags": [
            {
                "tag": tag,
                "assetCount": release_counts[tag],
                "assetsDirectory": str(artifact_root / "assets" / tag),
                "createCommand": f'gh release create {tag} --repo {REPOSITORY} --title "Runtime products v1 ({tag[-1].upper()})" --notes "Data-driven Viewer runtime products."',
                "uploadCommand": f'gh release upload {tag} "{artifact_root / "assets" / tag}/*" --repo {REPOSITORY} --clobber=false',
            }
            for tag in RELEASE_TAGS
        ],
        "mutationPerformed": False,
    }
    (artifact_root / "upload-plan.v1.json").write_text(
        json.dumps(upload_plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    summary = {
        "catalog": str(catalog_output),
        "artifactRoot": str(artifact_root),
        "counts": counts,
        "releaseCounts": release_counts,
        "planOnly": args.plan_only,
    }
    (artifact_root / "build-summary.literal.txt").write_text(
        json.dumps(summary, ensure_ascii=False) + "\nEXIT_STATUS=0\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
