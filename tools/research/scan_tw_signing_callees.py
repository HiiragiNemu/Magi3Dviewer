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

METHOD_RE = re.compile(r"// RVA: 0x([0-9A-Fa-f]+).*?\n([^\n]*\([^\n]*\)\s*\{\s*\})", re.M)
TYPE_RE = re.compile(
    r"^\s*(?:public|private|protected|internal)?\s*"
    r"(?:(?:abstract|sealed|static|partial|readonly|unsafe)\s+)*"
    r"(?:class|struct|interface|enum)\s+([^\s:{]+)",
    re.M,
)
NS_RE = re.compile(r"^// Namespace:\s*(.*)$", re.M)

# Direct callees observed in APISigning.Sign plus both generic OnSign setters.
EXACT_ADDRESSES = {
    0x86A54A4: "APISigning hash algorithm constructor",
    0x867D398: "APISigning HashAlgorithm.ComputeHash",
    0x87570FC: "APISigning Convert.ToBase64String",
    0x48143C0: "A2.GameLib.APISigning.Sign",
}


def parse_methods(text: str) -> list[dict[str, Any]]:
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
        owner = ".".join(x for x in (ns, typ) if x)
        methods.append({
            "rva": int(m.group(1), 16),
            "owner": owner,
            "signature": m.group(2).strip(),
            "display": f"{owner}::{m.group(2).strip()}",
        })
    by_rva: dict[int, dict[str, Any]] = {}
    for method in methods:
        by_rva.setdefault(method["rva"], method)
    result = [by_rva[key] for key in sorted(by_rva)]
    for index, method in enumerate(result):
        method["endRva"] = result[index + 1]["rva"] if index + 1 < len(result) else method["rva"] + 4
    return result


def sign_extend_26(value: int) -> int:
    return value - (1 << 26) if value & (1 << 25) else value


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--binary", type=Path, required=True)
    ap.add_argument("--dump", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    methods = parse_methods(args.dump.read_text(encoding="utf-8", errors="ignore"))
    starts = [m["rva"] for m in methods]
    by_rva = {m["rva"]: m for m in methods}
    setters = {
        m["rva"]: m["display"]
        for m in methods
        if "set_OnSign" in m["signature"]
    }
    targets = {**{address: label for address, label in EXACT_ADDRESSES.items()}, **setters}

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
                call = base + offset
                target = call + (sign_extend_26(instruction & 0x03FFFFFF) << 2)
                if target not in targets:
                    continue
                ci = bisect.bisect_right(starts, call) - 1
                caller = methods[ci] if ci >= 0 else None
                xrefs.append({
                    "callRva": call,
                    "targetRva": target,
                    "target": targets[target],
                    "caller": caller,
                })

    exact = {
        f"0x{address:X}": {
            "role": role,
            "method": by_rva.get(address),
        }
        for address, role in EXACT_ADDRESSES.items()
    }
    (args.out / "signing-exact-callees.json").write_text(
        json.dumps(exact, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.out / "onsign-setters.json").write_text(
        json.dumps({f"0x{k:X}": v for k, v in setters.items()}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.out / "signing-direct-xrefs.json").write_text(
        json.dumps(xrefs, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    ranges: dict[tuple[int, int], str] = {}
    for address in EXACT_ADDRESSES:
        method = by_rva.get(address)
        if method:
            ranges[(method["rva"], method["endRva"])] = method["display"]
    for xref in xrefs:
        caller = xref.get("caller")
        if caller:
            ranges[(caller["rva"], caller["endRva"])] = caller["display"]
    with (args.out / "signing-extra-ranges.tsv").open("w", encoding="utf-8") as stream:
        for (start, stop), display in sorted(ranges.items()):
            safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", display)[:180]
            stream.write(f"{safe}\t{start:X}\t{stop:X}\t{display}\n")


if __name__ == "__main__":
    main()
