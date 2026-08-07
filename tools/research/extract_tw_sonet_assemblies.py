#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

PATTERNS = (
    r"(^|\.)SONETAPI$",
    r"(^|\.)SonetRegisterDataPost$",
    r"(^|\.)SonetUserData$",
    r"(^|\.)SonetUserDataResponse$",
    r"(^|\.)SonetJwtToken$",
    r"(^|\.)SonetPostData$",
    r"(^|\.)SonetStatusDataResponse$",
    r"(^|\.)SonetRegister.*$",
    r"(^|\.)Sonet.*Token.*$",
    r"(^|\.)SnsSaveData$",
    r"(^|\.)TW_GameLibSns$",
    r"(^|\.)SystemMonitor$",
    r"(^|\.)NativeBridge$",
    r"(^|\.)SonetUserDataSignTool$",
    r"(^|\.)SonetMember$",
    r"(^|\.)SonetMemberUrl$",
)


def run(command: list[str], timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        errors="replace",
        check=False,
        timeout=timeout,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ilspy", type=Path, required=True)
    ap.add_argument("--assembly-root", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, object]] = []
    assemblies: list[dict[str, object]] = []
    for assembly in sorted(args.assembly_root.rglob("*.dll")):
        listed = run([str(args.ilspy), "-l", "c", str(assembly)])
        if listed.returncode:
            continue
        matches: list[str] = []
        for line in listed.stdout.splitlines():
            value = re.sub(r"^(Class|Struct|Interface|Enum)\s+", "", line.strip())
            if value and any(re.search(pattern, value) for pattern in PATTERNS):
                matches.append(value)
        if not matches:
            continue
        assembly_name = assembly.stem
        assemblies.append({"assembly": assembly_name, "typeCount": len(matches)})
        for type_name in list(dict.fromkeys(matches))[:100]:
            safe_assembly = re.sub(r"[^A-Za-z0-9_.-]+", "_", assembly_name)[:100]
            safe_type = re.sub(r"[^A-Za-z0-9_.-]+", "_", type_name)[:180]
            target = args.out / safe_assembly / f"{safe_type}.cs"
            target.parent.mkdir(parents=True, exist_ok=True)
            result = run([str(args.ilspy), "-t", type_name, str(assembly)])
            text = result.stdout
            if len(text) > 1_500_000:
                text = text[:1_500_000] + "\n// truncated\n"
            target.write_text(text, encoding="utf-8")
            records.append(
                {
                    "assembly": assembly_name,
                    "type": type_name,
                    "file": target.relative_to(args.out).as_posix(),
                    "returnCode": result.returncode,
                    "bytes": len(text.encode("utf-8")),
                }
            )
            if len(records) >= 300:
                break
        if len(records) >= 300:
            break

    (args.out / "assemblies.json").write_text(
        json.dumps(assemblies, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (args.out / "types.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if not records:
        raise SystemExit("No So-net SDK types found in recovered assemblies")


if __name__ == "__main__":
    main()
