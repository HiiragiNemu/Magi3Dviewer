#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import msgpack
import requests
import UnityPy
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad

# Same public JP resource protocol already used by the repository's bounded
# official-asset investigation.  This extractor deliberately selects only the
# Madoka 100107/100101 battle-unit bundles and persists no original bundle bytes.
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
TARGET_BUNDLE_TOKENS = (
    "100107",
    "100101",
    "chara_100107_battle_unit",
    "chara_100101_battle_unit",
)
TARGET_MATERIALS = {
    "mt_chara_100101_body_aniso",
    "mt_chara_100101_body_sj",
    "mt_chara_100101_weapon_a_sj",
}


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
    path: str
    name: str
    full_path: str
    revision: str
    crypto_key: str
    encrypted: bool


def headers() -> dict[str, str]:
    return {
        "Accept": "*/*",
        "Content-Type": "application/x-msgpack",
        "x-region": "AU",
        "x-language": LANGUAGE,
        "x-timezone-offset": "-14400",
        "X-GAME-SERVER-URL": f"https://{HOST}",
        "X-post-signature": SIGNATURE,
        "X-Unity-Version": "2022.3.62f2",
    }


def catalog(session: requests.Session) -> tuple[list[Entry], dict[str, str], str, dict[str, Any]]:
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
    raw_items = payload["mstList"]

    def pick(item: dict[str, Any], names: tuple[str, ...], default=None):
        for name in names:
            if item.get(name) is not None:
                return item[name]
        return default

    entries: list[Entry] = []
    for item in raw_items:
        path = path_map[int(item["pathId"])]
        name = pick(item, ("name", "fileName", "assetBundleName"))
        if name is None:
            continue
        item_revision = pick(
            item,
            ("revision", "revisionVer", "revisionVersion", "resourceRevision", "assetBundleRevision", "version"),
            revision,
        )
        full_path = f"{path}{name}".replace("\\", "/").lstrip("/")
        entries.append(Entry(
            path=path,
            name=str(name),
            full_path=full_path,
            revision=str(item_revision),
            crypto_key=str(item.get("cryptoKey", item.get("cryptKey", ""))),
            encrypted=bool(item.get("isEncrypted", item.get("encrypted", True))),
        ))
    return entries, request_headers, token, {
        "assetBundleRevision": revision,
        "catalogEntryCount": len(entries),
        "unityVersion": "2022.3.62f2",
    }


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


def download(entry: Entry, request_headers: dict[str, str], token: str, root: Path) -> Path:
    response = requests.get(resource_url(entry, token), headers=request_headers, timeout=120)
    response.raise_for_status()
    payload = bytearray(response.content)
    if entry.encrypted:
        key = byte_key(entry.full_path + entry.crypto_key)
        for index in range(len(payload)):
            payload[index] ^= key[index % len(key)]
    if not payload.startswith(b"UnityFS"):
        raise RuntimeError(f"not UnityFS after decrypt: {entry.full_path}")
    target = root / Path(*entry.full_path.split("/"))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return target


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"byteCount": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    if isinstance(value, dict):
        return {str(key): jsonable(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(child) for child in value]
    return {"repr": repr(value), "type": type(value).__name__}


def normalize_material_name(value: str) -> str:
    return value.strip().replace("\x00\x01", "::").removesuffix("::Material").lower()


def material_name(tree: dict[str, Any]) -> str:
    value = tree.get("m_Name") or tree.get("name") or ""
    return str(value)


def shader_identity(obj: Any) -> dict[str, Any] | None:
    try:
        material = obj.read()
        pointer = getattr(material, "m_Shader", None)
        shader = pointer.read() if pointer is not None else None
    except Exception as exc:
        return {"error": repr(exc)}
    if shader is None:
        return None
    result = {
        "name": str(getattr(shader, "m_Name", "")),
    }
    try:
        exported = shader.export()
    except Exception as exc:
        result["exportError"] = repr(exc)
    else:
        result["exportSha256"] = hashlib.sha256(exported.encode("utf-8", errors="replace")).hexdigest()
        wanted = sorted(set(
            token for token in (
                "_IsAniso", "_AnisoMaskByMetallic", "_AnisoColor", "_AnisoThreshold", "_AnisoFeather",
                "_IsGem", "_UseGemDepthDiff", "_UseMatCap", "_MatCapIntensity", "_MaskMatcapMetallic",
                "_MaskMatcapSpecular", "_Gem1stHighlightSize", "_Gem1stShadSize", "_Gem2ndHighlightSize",
                "_Gem2ndShadSize", "_GemDepthDiffThreshold", "_GemHeightCorrection", "_GemRimFresnel",
                "_UseFresnel", "_FresnelMaskByMetallic", "_FresnelColor", "_FresnelThreshold", "_FresnelFeather",
                "_UseDepthTex", "_DepthTexWidth", "_DepthTexYOffset", "_DepthRimLightDiffThreshold", "_DepthShadowDiffThreshold",
            ) if token in exported
        ))
        result["relevantDeclaredProperties"] = wanted
    return result


def main() -> int:
    output = Path("research/official-100101-material-properties.json")
    with tempfile.TemporaryDirectory(prefix="magius-100101-material-") as temporary:
        temp = Path(temporary)
        session = requests.Session()
        entries, request_headers, token, metadata = catalog(session)
        selected = [
            entry for entry in entries
            if any(token_value in entry.full_path.lower() for token_value in TARGET_BUNDLE_TOKENS)
            and "battle" in entry.full_path.lower()
        ]
        selected = sorted({entry.full_path: entry for entry in selected}.values(), key=lambda item: item.full_path)
        if not selected:
            raise RuntimeError("catalog contained no 100101/100107 battle-unit bundles")
        if len(selected) > 20:
            raise RuntimeError(f"unexpectedly broad selection: {len(selected)}")
        downloaded = [download(entry, request_headers, token, temp) for entry in selected]

        env = UnityPy.load(*(str(path) for path in downloaded))
        all_material_names: list[str] = []
        targets: list[dict[str, Any]] = []
        for obj in env.objects:
            if str(getattr(getattr(obj, "type", None), "name", "")) != "Material":
                continue
            try:
                tree = obj.read_typetree()
            except Exception as exc:
                tree = {"typetreeError": repr(exc)}
            if not isinstance(tree, dict):
                continue
            name = material_name(tree)
            normalized = normalize_material_name(name)
            all_material_names.append(name)
            if normalized not in TARGET_MATERIALS:
                continue
            targets.append({
                "name": name,
                "normalizedName": normalized,
                "pathId": int(getattr(obj, "path_id", 0) or 0),
                "sourceFile": str(getattr(getattr(obj, "assets_file", None), "name", "")),
                "shader": shader_identity(obj),
                "savedProperties": jsonable(tree.get("m_SavedProperties")),
                "materialTypetree": jsonable(tree),
            })

        report = {
            "schemaVersion": 1,
            "source": "official-jp-assetbundle",
            "metadata": metadata,
            "selectedBundles": [entry.full_path for entry in selected],
            "selectedBundleCount": len(selected),
            "materialCount": len(all_material_names),
            "allMaterialNames": sorted(set(all_material_names), key=str.lower),
            "targetMaterialCount": len(targets),
            "targetMaterials": targets,
        }
        if not targets:
            raise RuntimeError(
                "download succeeded but target materials were not found; "
                f"observed {len(all_material_names)} material objects"
            )
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # TemporaryDirectory removal is the explicit raw-bundle deletion boundary.
    print(json.dumps({
        "targetMaterialCount": len(report["targetMaterials"]),
        "selectedBundles": report["selectedBundles"],
        "targetNames": [item["name"] for item in report["targetMaterials"]],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
