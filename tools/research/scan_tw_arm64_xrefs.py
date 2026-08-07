#!/usr/bin/env python3
"""Find exact AArch64 BL xrefs to Taiwan protocol methods.

The scanner maps executable ELF virtual addresses to Il2CppDumper RVAs and
reports the managed caller containing each direct call. It avoids uploading a
complete native disassembly while retaining enough bounded caller ranges for
manual recovery.
"""
from __future__ import annotations

import argparse
import bisect
import json
import re
import struct
from pathlib import Path
from typing import Any

from elftools.elf.elffile import ELFFile

METHOD_RE = re.compile(r"// RVA: 0x([0-9A-Fa-f]+).*?\n([^\n]*\([^\n]*\)\s*\{\s*\})", re.M)
TYPE_RE = re.compile(
    r"^\s*(?:public|private|protected|internal)?\s*"
    r"(?:(?:abstract|sealed|static|partial|readonly|unsafe)\s+)*"
    r"(?:class|struct|interface|enum)\s+([^\s:{]+)",
    re.M,
)
NAMESPACE_RE = re.compile(r"^// Namespace:\s*(.*)$", re.M)

TARGETS = {
    0x6FC5240: "PokkeMsgPackAPI<object,object>.set_OnSign",
    0x6FC5A70: "PokkeMsgPackAPI<shared,shared>.set_OnSign",
    0x6FC5258: "PokkeMsgPackAPI<object,object>.OnRequestStart",
    0x6FC5B70: "PokkeMsgPackAPI<shared,shared>.OnRequestStart",
    0x4763D70: "ResourceApi.GetResourceAssetBundleMstList",
    0x4764204: "ResourceApi.GetResourceAssetBundleMstCryptoKey",
    0x4764648: "ResourceApi.GetResourceFileMstList",
    0x4764AB0: "ResourceApi.GetResourceFileMstCryptoKey",
    0x4764EB4: "ResourceApi.GetResourceMasterDataMstList",
    0x476528C: "ResourceApi.GetConfig",
    0x47653F4: "ResourceApi.GetGcsSignedUrlList",
    0x4E160E8: "AppSettings.InitializeConnection",
    0x4E174DC: "AppSettings.SetAppVersionHeader",
    0x47E99BC: "LocalizeApi.SetApiRequestHeader",
}


def extract_methods(text: str) -> list[dict[str, Any]]:
    # Il2CppDumper emits types in source order. Associate each method with the
    # nearest preceding namespace and type declarations.
    namespaces = [(match.start(), match.group(1).strip()) for match in NAMESPACE_RE.finditer(text)]
    types = [(match.start(), match.group(1).strip()) for match in TYPE_RE.finditer(text)]
    namespace_positions = [item[0] for item in namespaces]
    type_positions = [item[0] for item in types]
    methods: list[dict[str, Any]] = []
    for match in METHOD_RE.finditer(text):
        rva = int(match.group(1), 16)
        position = match.start()
        ns_index = bisect.bisect_right(namespace_positions, position) - 1
        type_index = bisect.bisect_right(type_positions, position) - 1
        namespace = namespaces[ns_index][1] if ns_index >= 0 else ""
        type_name = types[type_index][1] if type_index >= 0 else ""
        owner = ".".join(part for part in (namespace, type_name) if part)
        methods.append(
            {
                "rva": rva,
                "signature": match.group(2).strip(),
                "owner": owner,
                "display": f"{owner}::{match.group(2).strip()}",
            }
        )
    # Keep the first emitted method for duplicate generic RVAs, then derive an
    # exact upper bound from the next distinct RVA.
    by_rva: dict[int, dict[str, Any]] = {}
    for method in methods:
        by_rva.setdefault(method["rva"], method)
    ordered = [by_rva[key] for key in sorted(by_rva)]
    for index, method in enumerate(ordered):
        method["endRva"] = ordered[index + 1]["rva"] if index + 1 < len(ordered) else method["rva"] + 4
    return ordered


def sign_extend_26(value: int) -> int:
    return value - (1 << 26) if value & (1 << 25) else value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    methods = extract_methods(args.dump.read_text(encoding="utf-8", errors="ignore"))
    starts = [method["rva"] for method in methods]
    target_set = set(TARGETS)
    xrefs: list[dict[str, Any]] = []

    with args.binary.open("rb") as stream:
        elf = ELFFile(stream)
        for segment in elf.iter_segments():
            if segment["p_type"] != "PT_LOAD" or not (segment["p_flags"] & 1):
                continue
            data = segment.data()
            base = int(segment["p_vaddr"])
            for offset in range(0, len(data) - 3, 4):
                instruction = struct.unpack_from("<I", data, offset)[0]
                if instruction & 0xFC000000 != 0x94000000:
                    continue
                call_rva = base + offset
                immediate = sign_extend_26(instruction & 0x03FFFFFF) << 2
                target = call_rva + immediate
                if target not in target_set:
                    continue
                caller_index = bisect.bisect_right(starts, call_rva) - 1
                caller = methods[caller_index] if caller_index >= 0 else None
                xrefs.append(
                    {
                        "callRva": call_rva,
                        "targetRva": target,
                        "target": TARGETS[target],
                        "caller": caller,
                    }
                )

    report = {
        "schemaVersion": 1,
        "methodCount": len(methods),
        "targets": {f"0x{key:x}": value for key, value in TARGETS.items()},
        "xrefCount": len(xrefs),
        "xrefs": xrefs,
    }
    (args.out / "protocol-direct-xrefs.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    ranges: dict[tuple[int, int], str] = {}
    for xref in xrefs:
        caller = xref.get("caller")
        if not caller:
            continue
        key = (int(caller["rva"]), int(caller["endRva"]))
        ranges[key] = str(caller["display"])
    with (args.out / "protocol-caller-ranges.tsv").open("w", encoding="utf-8") as stream:
        for (start, stop), display in sorted(ranges.items()):
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", display)[:180]
            stream.write(f"{safe}\t{start:X}\t{stop:X}\t{display}\n")


if __name__ == "__main__":
    main()
