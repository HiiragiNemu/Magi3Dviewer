#!/usr/bin/env python3
from __future__ import annotations

import argparse
import bisect
import json
import re
import struct
import subprocess
from pathlib import Path

from elftools.elf.elffile import ELFFile

TARGET_ADDRESSES = {
    0x8853128: "OnRequestStart preflight factory",
    0x88531E8: "OnRequestStart preflight predicate",
    0x8747E58: "delegate construction helper",
    0x7E806C4: "request encoder allocation/helper",
    0x4810400: "RequestEncoder constructor candidate",
    0x4810430: "RequestEncoder routine candidate",
    0x48214C8: "request dispatch/encoder coroutine",
    0x4821DB4: "alternate request dispatch",
    0x8045F20: "response decoder allocation/helper",
    0x952EFF8: "web response bytes getter candidate",
    0x952DA80: "web response body getter candidate",
    0x8853548: "response decode routine constructor/call",
    0x8856008: "response decode coroutine start/call",
    0x63FBAE0: "response success handler helper",
    0x6540D04: "response logical error helper",
    0x475B020: "response callback dispatcher",
}

CRYPTO_IDENTITIES = (
    ("A2.Crypto", "BasicCrypto", "Decrypt"),
    ("A2.Crypto", "Hash", "HashString"),
    ("ReDrive.Config", "AppMsgPackConfig", "GetCryptKey"),
    ("A2.Http", "MsgPackDefaultConfig", "GetCryptKey"),
    ("ReDrive.Config", "AppCryptoConfig", "get_CryptoKey"),
)

NS = re.compile(r"^// Namespace:\s*(.*)$", re.M)
TYPE = re.compile(
    r"^\s*(?:public|private|protected|internal)?\s*"
    r"(?:(?:sealed|static|abstract|partial|readonly|unsafe)\s+)*"
    r"(?:class|struct|interface|enum)\s+([^\s:{]+)",
    re.M,
)
METHOD = re.compile(
    r"// RVA: 0x([0-9A-Fa-f]+).*?\n([^\n]*\([^\n]*\)\s*\{\s*\})",
    re.M,
)


def normalize_type(value: str) -> str:
    return value.split("//", 1)[0].strip().split("<", 1)[0].strip()


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)[:220]


def method_name(signature: str) -> str:
    match = re.search(r"([A-Za-z_<>][A-Za-z0-9_<>]*)\s*\(", signature)
    return match.group(1) if match else ""


def parse_methods(text: str) -> list[dict[str, object]]:
    namespaces = [(match.start(), match.group(1).strip()) for match in NS.finditer(text)]
    types = [(match.start(), match.group(1).strip()) for match in TYPE.finditer(text)]
    ns_positions = [item[0] for item in namespaces]
    type_positions = [item[0] for item in types]
    result: list[dict[str, object]] = []
    for match in METHOD.finditer(text):
        position = match.start()
        ns_index = bisect.bisect_right(ns_positions, position) - 1
        type_index = bisect.bisect_right(type_positions, position) - 1
        namespace = namespaces[ns_index][1] if ns_index >= 0 else ""
        raw_type = types[type_index][1] if type_index >= 0 else ""
        signature = match.group(2).strip()
        result.append(
            {
                "rva": int(match.group(1), 16),
                "namespace": namespace,
                "type": normalize_type(raw_type),
                "rawType": raw_type,
                "name": method_name(signature),
                "signature": signature,
                "sourcePosition": position,
            }
        )
    by_rva: dict[int, dict[str, object]] = {}
    for method in result:
        by_rva.setdefault(int(method["rva"]), method)
    ordered = [by_rva[key] for key in sorted(by_rva)]
    for index, method in enumerate(ordered):
        method["endRva"] = (
            int(ordered[index + 1]["rva"])
            if index + 1 < len(ordered)
            else int(method["rva"]) + 0x400
        )
    return ordered


def sign_extend_26(value: int) -> int:
    return value - (1 << 26) if value & (1 << 25) else value


def scan_direct_xrefs(
    binary: Path,
    methods: list[dict[str, object]],
    target_methods: dict[int, dict[str, object]],
) -> list[dict[str, object]]:
    starts = [int(method["rva"]) for method in methods]
    targets = set(target_methods)
    results: list[dict[str, object]] = []
    with binary.open("rb") as stream:
        elf = ELFFile(stream)
        for segment in elf.iter_segments():
            if segment["p_type"] != "PT_LOAD" or not (int(segment["p_flags"]) & 1):
                continue
            data = segment.data()
            base = int(segment["p_vaddr"])
            for offset in range(0, len(data) - 3, 4):
                instruction = struct.unpack_from("<I", data, offset)[0]
                if instruction & 0xFC000000 != 0x94000000:
                    continue
                call_rva = base + offset
                destination = call_rva + (sign_extend_26(instruction & 0x03FFFFFF) << 2)
                if destination not in targets:
                    continue
                caller_index = bisect.bisect_right(starts, call_rva) - 1
                caller = methods[caller_index] if caller_index >= 0 else None
                inside = bool(
                    caller
                    and int(caller["rva"]) <= call_rva < int(caller["endRva"])
                )
                results.append(
                    {
                        "callRva": f"0x{call_rva:X}",
                        "targetRva": f"0x{destination:X}",
                        "target": target_methods[destination],
                        "callerInsideMethod": inside,
                        "caller": caller,
                    }
                )
    return results


def write_disassembly(
    binary: Path,
    out: Path,
    methods: dict[int, dict[str, object]],
) -> None:
    directory = out / "disassembly"
    directory.mkdir(exist_ok=True)
    for method in methods.values():
        label = safe_name(
            f"{method['namespace']}.{method['type']}.{method['signature']}"
        )
        target = directory / f"{label}.txt"
        completed = subprocess.run(
            [
                "aarch64-linux-gnu-objdump",
                "-d",
                f"--start-address=0x{int(method['rva']):X}",
                f"--stop-address=0x{int(method['endRva']):X}",
                str(binary),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            errors="replace",
            check=False,
        )
        target.write_text(
            f"{method['signature']}\nRVA 0x{int(method['rva']):X}-0x{int(method['endRva']):X}\n\n"
            + completed.stdout,
            encoding="utf-8",
        )


def write_type_blocks(
    text: str,
    out: Path,
    type_keys: set[tuple[str, str]],
) -> None:
    type_matches = list(TYPE.finditer(text))
    namespace_matches = list(NS.finditer(text))
    namespace_positions = [match.start() for match in namespace_matches]
    records: list[dict[str, object]] = []
    directory = out / "types"
    directory.mkdir(exist_ok=True)
    for index, match in enumerate(type_matches):
        start = match.start()
        stop = type_matches[index + 1].start() if index + 1 < len(type_matches) else len(text)
        ns_index = bisect.bisect_right(namespace_positions, start) - 1
        namespace = namespace_matches[ns_index].group(1).strip() if ns_index >= 0 else ""
        type_name = normalize_type(match.group(1).strip())
        if (namespace, type_name) not in type_keys:
            continue
        block = text[start:stop][:800_000]
        filename = safe_name(f"{namespace}.{type_name}") + ".cs.txt"
        (directory / filename).write_text(block, encoding="utf-8")
        records.append(
            {
                "namespace": namespace,
                "type": type_name,
                "file": filename,
                "bytes": len(block.encode("utf-8")),
            }
        )
    (directory / "index.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    text = args.dump.read_text(encoding="utf-8", errors="ignore")
    methods = parse_methods(text)
    starts = [int(method["rva"]) for method in methods]
    selected: dict[int, dict[str, object]] = {}
    mappings: list[dict[str, object]] = []
    for address, role in TARGET_ADDRESSES.items():
        index = bisect.bisect_right(starts, address) - 1
        method = methods[index] if index >= 0 else None
        inside = bool(
            method and int(method["rva"]) <= address < int(method["endRva"])
        )
        mappings.append(
            {
                "address": f"0x{address:X}",
                "role": role,
                "insideMethod": inside,
                "offsetFromMethod": address - int(method["rva"]) if method else None,
                "method": method,
            }
        )
        if inside and method:
            selected[int(method["rva"])] = method
    (args.out / "response-address-map.json").write_text(
        json.dumps(mappings, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    crypto_targets: dict[int, dict[str, object]] = {}
    for method in methods:
        identity = (
            str(method["namespace"]),
            str(method["type"]),
            str(method["name"]),
        )
        if identity in CRYPTO_IDENTITIES:
            crypto_targets[int(method["rva"])] = method
    missing_identities = [
        identity
        for identity in CRYPTO_IDENTITIES
        if not any(
            (str(method["namespace"]), str(method["type"]), str(method["name"]))
            == identity
            for method in crypto_targets.values()
        )
    ]
    xrefs = scan_direct_xrefs(args.binary, methods, crypto_targets)
    for xref in xrefs:
        caller = xref.get("caller")
        if isinstance(caller, dict) and xref.get("callerInsideMethod"):
            selected[int(caller["rva"])] = caller
    for method in crypto_targets.values():
        selected[int(method["rva"])] = method
    (args.out / "response-crypto-xrefs.json").write_text(
        json.dumps(
            {
                "targetMethods": {
                    f"0x{address:X}": method
                    for address, method in sorted(crypto_targets.items())
                },
                "missingIdentities": missing_identities,
                "xrefCount": len(xrefs),
                "xrefs": xrefs,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    write_disassembly(args.binary, args.out, selected)
    type_keys = {
        (str(method["namespace"]), str(method["type"]))
        for method in selected.values()
    }
    write_type_blocks(text, args.out, type_keys)


if __name__ == "__main__":
    main()
