#!/usr/bin/env python3
from __future__ import annotations

import argparse
import bisect
import json
import re
import subprocess
from pathlib import Path

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
        result.append(
            {
                "rva": int(match.group(1), 16),
                "namespace": namespace,
                "type": normalize_type(raw_type),
                "rawType": raw_type,
                "signature": match.group(2).strip(),
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
    mappings: list[dict[str, object]] = []
    selected: dict[int, dict[str, object]] = {}
    for address, role in TARGET_ADDRESSES.items():
        index = bisect.bisect_right(starts, address) - 1
        if index < 0:
            mappings.append({"address": f"0x{address:X}", "role": role, "method": None})
            continue
        method = methods[index]
        inside = int(method["rva"]) <= address < int(method["endRva"])
        record = {
            "address": f"0x{address:X}",
            "role": role,
            "insideMethod": inside,
            "offsetFromMethod": address - int(method["rva"]),
            "method": method,
        }
        mappings.append(record)
        if inside:
            selected[int(method["rva"])] = method

    (args.out / "response-address-map.json").write_text(
        json.dumps(mappings, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    type_keys: set[tuple[str, str]] = set()
    for method in selected.values():
        type_keys.add((str(method["namespace"]), str(method["type"])))
        label = safe_name(
            f"{method['namespace']}.{method['type']}.{method['signature']}"
        )
        target = args.out / "disassembly" / f"{label}.txt"
        target.parent.mkdir(exist_ok=True)
        completed = subprocess.run(
            [
                "aarch64-linux-gnu-objdump",
                "-d",
                f"--start-address=0x{int(method['rva']):X}",
                f"--stop-address=0x{int(method['endRva']):X}",
                str(args.binary),
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

    # Copy bounded complete type blocks for the mapped methods.
    type_matches = list(TYPE.finditer(text))
    index_records: list[dict[str, object]] = []
    type_dir = args.out / "types"
    type_dir.mkdir(exist_ok=True)
    for index, match in enumerate(type_matches):
        start = match.start()
        stop = type_matches[index + 1].start() if index + 1 < len(type_matches) else len(text)
        ns_matches = list(NS.finditer(text, 0, start))
        namespace = ns_matches[-1].group(1).strip() if ns_matches else ""
        type_name = normalize_type(match.group(1).strip())
        if (namespace, type_name) not in type_keys:
            continue
        block = text[start:stop][:800_000]
        filename = safe_name(f"{namespace}.{type_name}") + ".cs.txt"
        (type_dir / filename).write_text(block, encoding="utf-8")
        index_records.append(
            {
                "namespace": namespace,
                "type": type_name,
                "file": filename,
                "bytes": len(block.encode("utf-8")),
            }
        )
    (type_dir / "index.json").write_text(
        json.dumps(index_records, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
