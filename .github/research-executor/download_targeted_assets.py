#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import msgpack
import requests
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

CRYPTO_KEY = b"/TZh+1VxrtkNiDEH"
SECRET_URL_HASH = "1c7f"
HOST = "api-gl.mmme.pokelabo.jp"
LANGUAGE = "ja-Jpan"
SIGNATURE = "O57rcgETm7BOEVU52UL0lmIgZS8W1yDM834d7F69oK+PafVgDXKB4gjY++Uj5sHveKxURtIC1PCrg47mgx37rg=="
POST_DATA = bytes.fromhex(
    "8846515530616782552cab5e1d7c850fa3cfbbb21e660dc1baf05c6c89dd94d7"
    "e77e9545a5ecbbbdaf1f1e7c8e633b6a85fcf684a4df112e52d8640e551c26e7"
    "8b89bccd55ca0bf3289834dde68fbd55b8b6590009612a8f27ee1ecffe81bb621"
    "c895a68ead65183db91f283857bfa4cdcca13ad6b83ed99560b7d8b4dacc0e8a3"
    "3a9ad916395d96aecbde0b9796b800e750d4855297f6f7c5cface02edc1488520"
    "a67b7b8dbabfbe990c5317050077212e02bd254fc2353e111a99255c97cc4cb76"
    "bc02ebc2db136e4e5119d79c142d617f6c621334993fc90b70483d38bb3524294"
    "106aa72ae9fac5d7f2d1b489f9bdac72c7646d4158feb2da4b99c912539f951b0"
    "7e390f1839349b16993868ec980a63a46558093ef9b5ce4bbf1fd6117e"
)
TOKENS = ("110701", "11070101", "chara_110701_battle_unit", "chara_11070101_home")
PREFIXES = ("shader/", "shaders/")
STAGE_PREFIXES = (
    "battle/stage/",
    "field/bg/",
    "dungeon/bg/",
    "dungeon/level/",
    "gallery/bg3d_gallery",
)


def url_hash(value: str) -> str:
    return base64.urlsafe_b64encode(hashlib.md5(value.encode()).digest()).decode().rstrip("=")


def decrypt_data(payload: bytes | bytearray) -> dict[str, Any]:
    iv = bytes(payload[:16])
    decrypted = unpad(
        AES.new(CRYPTO_KEY, AES.MODE_CBC, iv).decrypt(bytes(payload[16:])),
        AES.block_size,
    )
    value = msgpack.unpackb(decrypted, raw=False)
    if not isinstance(value, dict):
        raise TypeError(type(value))
    return value


def byte_key(value: str) -> bytes:
    first = hashlib.sha512(value.encode()).digest()
    return first + hashlib.sha512(first).digest()


@dataclass
class Entry:
    path_id: int
    path: str
    name: str
    full_path: str
    revision: str
    crypto_key: str
    encrypted: bool
    selected_reason: str | None = None


def headers() -> dict[str, str]:
    return {
        "Accept": "*/*",
        "Content-Type": "application/x-msgpack",
        "x-region": "AU",
        "x-language": LANGUAGE,
        "x-timezone-offset": "-14400",
        "X-GAME-SERVER-URL": f"https://{HOST}",
        "X-post-signature": SIGNATURE,
        "X-Unity-Version": "2022.3.21f1",
    }


def get_catalog(session: requests.Session) -> tuple[list[Entry], dict[str, str], str, dict[str, Any]]:
    request_headers = headers()
    config = session.post(
        f"https://{HOST}/api/config/get_config",
        headers=request_headers,
        data=POST_DATA,
        timeout=30,
    )
    config.raise_for_status()
    token_response = session.post(
        f"https://{HOST}/api/akamai/create_token",
        headers=request_headers,
        data=POST_DATA,
        timeout=30,
    )
    token_response.raise_for_status()
    token = decrypt_data(token_response.content)["payload"]["token"]
    language_hash = url_hash(LANGUAGE)[:4]
    revision = config.headers["x-resource-revision-asset-bundle"]
    key = url_hash("GetResourceAssetBundleMstList:Android")[:4] + language_hash + revision
    response = session.post(
        "https://static-masterdata-mmme.akamaized.net/api/mst/"
        f"get_resource_asset_bundle_mst_list?key={key}&{token}",
        headers=request_headers,
        data=POST_DATA,
        timeout=60,
    )
    response.raise_for_status()
    payload = decrypt_data(response.content)["payload"]
    path_map = {int(item["pathId"]): str(item["path"]) for item in payload["pathMappingMstList"]}
    entries = []
    for item in payload["mstList"]:
        path_id = int(item["pathId"])
        path = path_map[path_id]
        name = str(item["name"])
        entries.append(Entry(
            path_id=path_id,
            path=path,
            name=name,
            full_path=f"{path}{name}".replace("\\", "/").lstrip("/"),
            revision=str(item["revision"]),
            crypto_key=str(item.get("cryptoKey", "")),
            encrypted=bool(item.get("isEncrypted", True)),
        ))
    metadata = {
        "language": LANGUAGE,
        "assetBundleRevision": revision,
        "entryCount": len(entries),
        "revisionHeaders": {
            key: value for key, value in config.headers.items()
            if key.lower().startswith("x-resource-revision")
        },
    }
    return entries, request_headers, token, metadata


def select(entries: list[Entry]) -> list[Entry]:
    stage_count = {prefix: 0 for prefix in STAGE_PREFIXES}
    result = []
    for entry in sorted(entries, key=lambda item: item.full_path.lower()):
        value = entry.full_path.lower()
        reason = None
        if value.rstrip("/") == "android":
            reason = "root-android-manifest"
        elif any(token.lower() in value for token in TOKENS):
            reason = "ashley-target"
        elif any(value.startswith(prefix) for prefix in PREFIXES):
            reason = "shader-source"
        else:
            for prefix in STAGE_PREFIXES:
                if value.startswith(prefix) and stage_count[prefix] < 2:
                    stage_count[prefix] += 1
                    reason = f"stage-sample:{prefix}"
                    break
        if reason:
            entry.selected_reason = reason
            result.append(entry)
    if len(result) > 100:
        raise RuntimeError(f"Safety limit exceeded: {len(result)} selected files")
    return result


def resource_url(entry: Entry, token: str) -> str:
    parts = entry.path.split("/")
    directories = [url_hash(f"{part}{SECRET_URL_HASH}") for part in parts[:-1] if part]
    final_component = parts[-1] if parts else ""
    filename = url_hash(f"{final_component}{entry.name}{SECRET_URL_HASH}")
    resource_path = "/".join([*directories, filename])
    language_hash = url_hash(LANGUAGE)[:4]
    return (
        "https://static-files-mmme.akamaized.net/web/resource/"
        f"{url_hash('assetbundles')}/{url_hash('android')}/{resource_path}"
        f"?key={language_hash}{entry.revision}&{token}"
    )


def download(entry: Entry, request_headers: dict[str, str], token: str, out: Path) -> dict[str, Any]:
    session = requests.Session()
    response = session.get(resource_url(entry, token), headers=request_headers, timeout=120)
    response.raise_for_status()
    payload = bytearray(response.content)
    encrypted_hash = hashlib.sha256(payload).hexdigest()
    if entry.encrypted:
        key = byte_key(entry.full_path + entry.crypto_key)
        for index in range(len(payload)):
            payload[index] ^= key[index % len(key)]
    target = out / "raw" / "AssetBundles" / entry.full_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return {
        **asdict(entry),
        "encryptedSize": len(response.content),
        "encryptedSha256": encrypted_hash,
        "decryptedSize": len(payload),
        "decryptedSha256": hashlib.sha256(payload).hexdigest(),
        "unityFs": payload.startswith(b"UnityFS"),
        "output": target.relative_to(out).as_posix(),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    entries, request_headers, token, metadata = get_catalog(session)
    selected = select(entries)
    (args.out / "asset-bundle-catalog.json").write_text(
        json.dumps({"schemaVersion": 1, "metadata": metadata, "entries": [asdict(item) for item in entries]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (args.out / "selection.json").write_text(
        json.dumps({"schemaVersion": 1, "entries": [asdict(item) for item in selected]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    results = []
    failures = []
    total = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        pending = {executor.submit(download, entry, request_headers, token, args.out): entry for entry in selected}
        for future in concurrent.futures.as_completed(pending):
            entry = pending[future]
            try:
                item = future.result()
                total += int(item["decryptedSize"])
                if total > 2_000_000_000:
                    raise RuntimeError("Two-gigabyte transient safety limit exceeded")
                results.append(item)
            except Exception as error:
                failures.append({"path": entry.full_path, "error": repr(error)})

    report = {
        "schemaVersion": 1,
        "generatedAt": int(time.time()),
        "selectedCount": len(selected),
        "downloadedCount": len(results),
        "failureCount": len(failures),
        "totalBytes": total,
        "downloaded": sorted(results, key=lambda item: item["full_path"]),
        "failures": failures,
    }
    (args.out / "download-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if failures:
        raise SystemExit(f"{len(failures)} selected bundles failed")


if __name__ == "__main__":
    main()
