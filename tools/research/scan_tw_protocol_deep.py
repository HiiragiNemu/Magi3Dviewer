#!/usr/bin/env python3
"""Curate high-confidence Taiwan network/signing evidence from an unpacked XAPK.

Raw APK/native/client files remain runner-local. Only bounded strings, hashes,
class/method excerpts and provenance records are written to the report.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

TARGET_TERMS = (
    "TW_ApiHelper",
    "LoginAPI",
    "ResourceAPI",
    "AkamaiAPI",
    "ConfigAPI",
    "ApiRequestManager",
    "ApiHelper",
    "libsigner",
    "signer",
    "X-post-signature",
    "x-app-version",
    "X-GAME-SERVER-URL",
    "x-resource-revision",
    "get_config",
    "create_token",
    "get_resource_file_mst_list",
    "get_resource_asset_bundle_mst_list",
    "so-net.tw",
    "magiaexedra",
)
URL_START = re.compile(rb"https?://", re.I)
DOMAIN_RE = re.compile(
    r"(?<![A-Za-z0-9_-])(?:[A-Za-z0-9-]{1,63}\.)+(?:tw|jp|net|com|org|io|games)(?![A-Za-z0-9_-])",
    re.I,
)
UNITY_RE = re.compile(r"20\d{2}\.\d+\.\d+[abfp]\d+", re.I)
LOCALE_RE = re.compile(r"(?<![A-Za-z])(?:zh(?:[-_](?:Hant|Hans|TW|HK|MO|CN)){1,2}|ja[-_]Jpan|en[-_]Latn)(?![A-Za-z])", re.I)
TYPE_START_RE = re.compile(
    r"^(?:// Namespace:.*\n)?(?:\[[^\n]+\]\n)*"
    r"(?:public|private|protected|internal|static|sealed|abstract|partial|readonly|unsafe|\s)+"
    r"(?:class|struct|interface|enum)\s+[A-Za-z_][^\n{]*",
    re.M,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def printable_strings(data: bytes, minimum: int = 4) -> Iterable[tuple[int, str]]:
    ascii_re = re.compile(rb"[\x20-\x7e]{%d,8192}" % minimum)
    utf16_re = re.compile(rb"(?:[\x20-\x7e]\x00){%d,4096}" % minimum)
    for match in ascii_re.finditer(data):
        yield match.start(), match.group(0).decode("ascii", errors="ignore")
    for match in utf16_re.finditer(data):
        yield match.start(), match.group(0).decode("utf-16le", errors="ignore")


def split_urls(text: str) -> list[str]:
    starts = [match.start() for match in re.finditer(r"https?://", text, re.I)]
    values: list[str] = []
    for index, start in enumerate(starts):
        stop = starts[index + 1] if index + 1 < len(starts) else len(text)
        candidate = text[start:stop]
        candidate = re.split(r"[\s\x00\"'<>\\]", candidate, maxsplit=1)[0]
        # Serialized string tables often concatenate unrelated values without a
        # delimiter. Keep only a plausible URL prefix ending before obvious code.
        candidate = re.split(r"(?=[A-Z][A-Za-z0-9_]{8,})", candidate, maxsplit=1)[0]
        candidate = candidate.rstrip(".,;:)]}")
        if 8 <= len(candidate) <= 500:
            values.append(candidate)
    return values


def scan_sources(root: Path) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    urls: set[str] = set()
    domains: set[str] = set()
    locales: dict[str, set[str]] = {}
    unity_versions: dict[str, set[str]] = {}
    relevant_names = {
        "global-metadata.dat",
        "globalgamemanagers",
        "libil2cpp.so",
        "libsigner.so",
        "classes.dex",
        "classes2.dex",
        "classes3.dex",
        "classes4.dex",
    }
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.name not in relevant_names and path.suffix.lower() not in {".json", ".xml", ".config", ".txt", ".bytes"}:
            continue
        relative = path.relative_to(root).as_posix()
        try:
            data = path.read_bytes()
        except OSError:
            continue
        source_locales: set[str] = set()
        source_unity: set[str] = set()
        hit_count = 0
        for offset, text in printable_strings(data):
            lower = text.lower()
            source_locales.update(match.group(0) for match in LOCALE_RE.finditer(text))
            source_unity.update(match.group(0) for match in UNITY_RE.finditer(text))
            for url in split_urls(text):
                if any(token in url.lower() for token in ("so-net.tw", "magiaexedra", "akamai", "resource")):
                    urls.add(url)
            for domain in DOMAIN_RE.findall(text):
                if any(token in domain.lower() for token in ("so-net.tw", "magia", "exedra", "akamai", "pokelabo")):
                    domains.add(domain.lower())
            matched = sorted({term for term in TARGET_TERMS if term.lower() in lower})
            if not matched:
                continue
            records.append(
                {
                    "source": relative,
                    "offset": offset,
                    "terms": matched,
                    "text": text[:2000],
                }
            )
            hit_count += 1
            if hit_count >= 5000:
                break
        if source_locales:
            locales[relative] = source_locales
        if source_unity:
            unity_versions[relative] = source_unity
    return {
        "records": records,
        "urls": sorted(urls),
        "domains": sorted(domains),
        "localesBySource": {key: sorted(value) for key, value in locales.items()},
        "unityVersionsBySource": {key: sorted(value) for key, value in unity_versions.items()},
    }


def extract_il2cpp_blocks(output: Path, report: Path) -> dict[str, Any]:
    dump = next(iter(output.rglob("dump.cs")), None)
    if dump is None:
        return {"dumpFound": False, "blockCount": 0}
    text = dump.read_text(encoding="utf-8", errors="ignore")
    matches = list(TYPE_START_RE.finditer(text))
    selected: list[str] = []
    index_records: list[dict[str, Any]] = []
    needles = tuple(term.lower() for term in TARGET_TERMS) + (
        "dllimport",
        "extern",
        "native",
        "signature",
        "serverurl",
        "postsignature",
        "encrypt",
        "decrypt",
        "sha512",
        "hmac",
    )
    for index, match in enumerate(matches):
        start = match.start()
        stop = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[start:stop]
        lower = block.lower()
        hits = sorted({needle for needle in needles if needle in lower})
        if not hits:
            continue
        bounded = block[:120_000]
        selected.append(bounded)
        index_records.append({"start": start, "length": len(bounded), "hits": hits, "header": match.group(0)[:500]})
        if sum(len(value) for value in selected) >= 8_000_000:
            break
    (report / "il2cpp-network-types.cs.txt").write_text("\n\n".join(selected), encoding="utf-8")
    (report / "il2cpp-network-index.json").write_text(json.dumps(index_records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "dumpFound": True,
        "dumpSha256": sha256(dump),
        "blockCount": len(selected),
        "indexCount": len(index_records),
    }


def collect_jadx_hits(jadx_root: Path, report: Path) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    copied = 0
    for path in sorted(jadx_root.rglob("*.java")):
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lower = text.lower()
        hits = sorted({term for term in TARGET_TERMS if term.lower() in lower})
        if not hits:
            if "loadlibrary" not in lower or "signer" not in lower:
                continue
            hits = ["loadLibrary+signer"]
        excerpt_lines = []
        lines = text.splitlines()
        for number, line in enumerate(lines, 1):
            line_lower = line.lower()
            if any(term.lower() in line_lower for term in (*hits, "loadlibrary", "native")):
                start = max(0, number - 15)
                stop = min(len(lines), number + 15)
                excerpt_lines.append(f"// {path.relative_to(jadx_root)}:{number}\n" + "\n".join(lines[start:stop]))
        excerpt = "\n\n".join(excerpt_lines)[:100_000]
        records.append({"source": path.relative_to(jadx_root).as_posix(), "hits": hits, "excerpt": excerpt})
        copied += len(excerpt)
        if copied >= 4_000_000:
            break
    (report / "jadx-signing-hits.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"fileCount": len(records), "excerptBytes": copied}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--il2cpp-output", type=Path, required=True)
    parser.add_argument("--jadx-root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    args.report.mkdir(parents=True, exist_ok=True)

    sources = scan_sources(args.root)
    il2cpp = extract_il2cpp_blocks(args.il2cpp_output, args.report)
    jadx = collect_jadx_hits(args.jadx_root, args.report)

    signer = next(iter(args.root.rglob("libsigner.so")), None)
    metadata = next(iter(args.root.rglob("global-metadata.dat")), None)
    il2cpp_binary = next(iter(args.root.rglob("libil2cpp.so")), None)
    evidence = {
        "schemaVersion": 2,
        "package": "tw.sonet.magiaexedra",
        "source": "public Taiwan XAPK; private tw-client-source-v1 remains canonical",
        "nativeInputs": {
            "libsigner": None if signer is None else {"path": signer.relative_to(args.root).as_posix(), "size": signer.stat().st_size, "sha256": sha256(signer)},
            "libil2cpp": None if il2cpp_binary is None else {"path": il2cpp_binary.relative_to(args.root).as_posix(), "size": il2cpp_binary.stat().st_size, "sha256": sha256(il2cpp_binary)},
            "metadata": None if metadata is None else {"path": metadata.relative_to(args.root).as_posix(), "size": metadata.stat().st_size, "sha256": sha256(metadata)},
        },
        "highConfidence": {
            "urls": sources["urls"],
            "domains": sources["domains"],
            "localesBySource": sources["localesBySource"],
            "unityVersionsBySource": sources["unityVersionsBySource"],
        },
        "stringEvidence": sources["records"],
        "il2cpp": il2cpp,
        "jadx": jadx,
    }
    (args.report / "deep-protocol-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
