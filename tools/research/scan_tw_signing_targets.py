#!/usr/bin/env python3
from __future__ import annotations

import argparse
import bisect
import json
import re
import struct
from pathlib import Path
from typing import Any

from elftools.elf.elffile import ELFFile

TARGET_METHOD_FRAGMENTS = (
    "A2.GameLib.APISigning::public static string Sign(byte[] data)",
    "PokkeMsgPackAPI<object, object>::public void set_OnSign",
    "PokkeMsgPackAPI<__Il2CppFullySharedGenericType, __Il2CppFullySharedGenericType>::public void set_OnSign",
    "ReDrive.Api.ReDriveMsgPackApiFactory::protected override Dictionary<string, string> CreateRequestHeader",
    "A2.ResourceManager.ResourceApi::public static void GetGcsSignedUrlList",
    "A2.ResourceManager.ResourceRemoteUrl::public static bool get_IsGcsWebResourcesUrl",
    "A2.ResourceManager.ResourceRemoteUrl::public static void GetGcsWebResourcesUrl",
    "A2.ResourceManager.GoogleCloudCdnHelper::public static string CreateSignedUrl",
    "A2.ResourceManager.GoogleCloudCdnHelper::private static byte[] ComputeHash",
    "A2.ResourceManager.ResourceGcsSignedUrlModel::public void .ctor",
    "HTTPComm.SystemMonitor::public static string GetInfo",
    "A2.GameLib.Login.SignatureProvider::public static string GGLXUID",
    "A2.GameLib.Login.SignatureProvider::public static void SetXUID",
    "A2.GameLib.Login.LoginReq::public static LoginReq Create",
    "SonetGameLib.TW_GameLibSns::public static void GuestLogin",
    "SonetGameLib.TW_GameLibSns::public static string getNowUUID",
    "A2.GameLib.Initializer::public static bool Initialize",
    "ReDrive.ProductionDomainConfig::public string get_DefaultGameServerFQDN",
    "ReDrive.ProductionDomainConfig::public string get_DefaultHostName",
    "ReDrive.ProductionDomainConfig::public string get_RemoteGameServerDomain",
    "ReDrive.ProductionDomainConfig::public string get_AppScheme",
)
TARGET_TYPES = {
    "APISigning",
    "ReDriveMsgPackApiFactory",
    "PokkeMsgPackAPIFactory",
    "ResourceConfigData",
    "ResourceConfigModel",
    "ResourceGcsSignedUrlData",
    "ResourceGcsSignedUrlModel",
    "ResourceRemoteUrl",
    "GoogleCloudCdnHelper",
    "ResourceApi",
    "SystemMonitor",
    "SignatureProvider",
    "LoginReq",
    "LoginRes",
    "TW_GameLibSns",
    "Initializer",
    "ProductionDomainConfig",
    "StagingDomainConfig",
    "ReviewDomainConfig",
    "QaDomainConfig",
    "JudgementDomainConfig",
    "DevelopmentDomainConfig",
}
NS_RE = re.compile(r"^// Namespace:\s*(.*)$", re.M)
TYPE_RE = re.compile(
    r"^\s*(?:public|private|protected|internal)?\s*"
    r"(?:(?:abstract|sealed|static|partial|readonly|unsafe|\[Serializable\])\s+)*"
    r"(?:class|struct|interface|enum)\s+([^\s:{]+)",
    re.M,
)
METHOD_RE = re.compile(r"// RVA: 0x([0-9A-Fa-f]+).*?\n([^\n]*\([^\n]*\)\s*\{\s*\})", re.M)


def parse_dump(text: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    namespaces = [(m.start(), m.group(1).strip()) for m in NS_RE.finditer(text)]
    types = [(m.start(), m.group(1).strip()) for m in TYPE_RE.finditer(text)]
    ns_pos = [x[0] for x in namespaces]
    type_pos = [x[0] for x in types]

    methods: list[dict[str, Any]] = []
    for m in METHOD_RE.finditer(text):
        p = m.start()
        ni = bisect.bisect_right(ns_pos, p) - 1
        ti = bisect.bisect_right(type_pos, p) - 1
        ns = namespaces[ni][1] if ni >= 0 else ""
        typ = types[ti][1] if ti >= 0 else ""
        owner = ".".join(v for v in (ns, typ) if v)
        methods.append({
            "rva": int(m.group(1), 16),
            "owner": owner,
            "signature": m.group(2).strip(),
            "display": f"{owner}::{m.group(2).strip()}",
        })
    by_rva: dict[int, dict[str, Any]] = {}
    for method in methods:
        by_rva.setdefault(method["rva"], method)
    ordered = [by_rva[k] for k in sorted(by_rva)]
    for i, method in enumerate(ordered):
        method["endRva"] = ordered[i + 1]["rva"] if i + 1 < len(ordered) else method["rva"] + 4

    type_blocks: list[dict[str, Any]] = []
    for i, (start, name) in enumerate(types):
        stop = types[i + 1][0] if i + 1 < len(types) else len(text)
        short = name.split(".")[-1].split("`")[0]
        block = text[start:stop]
        if short in TARGET_TYPES or any(target in block for target in TARGET_TYPES):
            type_blocks.append({"name": name, "start": start, "text": block[:250_000]})
    return ordered, type_blocks


def sign_extend_26(value: int) -> int:
    return value - (1 << 26) if value & (1 << 25) else value


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", type=Path, required=True)
    ap.add_argument("--dump", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    text = args.dump.read_text(encoding="utf-8", errors="ignore")
    methods, type_blocks = parse_dump(text)
    starts = [m["rva"] for m in methods]
    targets: dict[int, str] = {}
    for method in methods:
        if any(fragment in method["display"] for fragment in TARGET_METHOD_FRAGMENTS):
            targets[method["rva"]] = method["display"]

    xrefs: list[dict[str, Any]] = []
    with args.binary.open("rb") as stream:
        elf = ELFFile(stream)
        for segment in elf.iter_segments():
            if segment["p_type"] != "PT_LOAD" or not (segment["p_flags"] & 1):
                continue
            data = segment.data()
            base = int(segment["p_vaddr"])
            for offset in range(0, len(data) - 3, 4):
                insn = struct.unpack_from("<I", data, offset)[0]
                if insn & 0xFC000000 != 0x94000000:
                    continue
                call = base + offset
                target = call + (sign_extend_26(insn & 0x03FFFFFF) << 2)
                if target not in targets:
                    continue
                ci = bisect.bisect_right(starts, call) - 1
                caller = methods[ci] if ci >= 0 else None
                xrefs.append({"callRva": call, "targetRva": target, "target": targets[target], "caller": caller})

    (args.out / "target-methods.json").write_text(
        json.dumps({f"0x{k:X}": v for k, v in targets.items()}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.out / "direct-xrefs.json").write_text(json.dumps(xrefs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (args.out / "disassembly-ranges.tsv").open("w", encoding="utf-8") as f:
        ranges: dict[tuple[int, int], str] = {}
        for method in methods:
            if method["rva"] in targets:
                ranges[(method["rva"], method["endRva"])] = method["display"]
        for xref in xrefs:
            caller = xref.get("caller")
            if caller:
                ranges[(caller["rva"], caller["endRva"])] = caller["display"]
        for (start, stop), display in sorted(ranges.items()):
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", display)[:180]
            f.write(f"{safe}\t{start:X}\t{stop:X}\t{display}\n")

    type_dir = args.out / "types"
    type_dir.mkdir(exist_ok=True)
    index: list[dict[str, Any]] = []
    for i, record in enumerate(type_blocks):
        safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", record["name"])[:160]
        name = f"{i:03d}-{safe}.cs.txt"
        (type_dir / name).write_text(record["text"], encoding="utf-8")
        index.append({"type": record["name"], "file": name, "bytes": len(record["text"].encode())})
    (args.out / "type-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
