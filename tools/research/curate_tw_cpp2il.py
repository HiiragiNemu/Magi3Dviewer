#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, re
from pathlib import Path

TARGET_PATTERNS = (
    'PokkeMsgPackAPI', 'PokkeAPI', 'AppApiBase', 'AppApiWithResponse',
    'AppApiWithRequestAndResponse', 'AppReqBase', 'AppResBase',
    'ResourceApi', 'ResourceApiHelper', 'ResourceGcsSignedUrl',
    'AppSettings', 'AppUrl', 'AppUrlData', 'AppResourceSettings',
    'AppLocalizeSettings', 'LocalizeApi', 'SetApiRequestHeader',
    'SetAppVersionHeader', 'OnSign', 'X-post-signature', 'x-app-version',
    'X-GAME-SERVER-URL', 'get_gcs_signed_url_list', 'get_resource_',
    'RequestHeader', 'ApiHeader', 'Header', 'Signature', 'Sign',
)


def parse_method_map(dump: str) -> dict[int, str]:
    lines = dump.splitlines()
    namespace = ''
    current_type = ''
    result: dict[int, str] = {}
    pending_rva: int | None = None
    for line in lines:
        if line.startswith('// Namespace:'):
            namespace = line.split(':', 1)[1].strip()
            current_type = ''
            continue
        type_match = re.match(
            r'(?:public|private|internal|protected).*?\b(?:class|struct|interface|enum)\s+([^\s:{]+)',
            line,
        )
        if type_match:
            current_type = type_match.group(1)
            continue
        rva_match = re.search(r'// RVA: 0x([0-9A-Fa-f]+)', line)
        if rva_match:
            pending_rva = int(rva_match.group(1), 16)
            continue
        if pending_rva is not None and '(' in line and line.rstrip().endswith('{ }'):
            owner = '.'.join(part for part in (namespace, current_type) if part)
            result[pending_rva] = f'{owner}::{line.strip()}'
            pending_rva = None
    return result


def annotate_disassembly(path: Path, method_map: dict[int, str]) -> None:
    text = path.read_text(errors='ignore')
    output: list[str] = []
    call_re = re.compile(r'\bbl\s+([0-9a-fA-F]+)')
    for line in text.splitlines():
        match = call_re.search(line)
        if match:
            label = method_map.get(int(match.group(1), 16))
            if label:
                line += f'    // CALL {label}'
        output.append(line)
    path.with_name(path.stem + '-annotated.txt').write_text('\n'.join(output) + '\n')


def copy_target_sources(root: Path, out: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    out.mkdir(parents=True, exist_ok=True)
    for path in root.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in {'.cs', '.il', '.txt'}:
            continue
        try:
            text = path.read_text(errors='ignore')
        except OSError:
            continue
        lower = text.lower()
        hits = [pattern for pattern in TARGET_PATTERNS if pattern.lower() in lower]
        if not hits:
            continue
        relative = path.relative_to(root)
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        bounded = text[:2_000_000]
        target.write_text(bounded, encoding='utf-8')
        records.append({'source': relative.as_posix(), 'hits': hits, 'bytes': len(bounded.encode('utf-8'))})
        if len(records) >= 300:
            break
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dump', type=Path, required=True)
    parser.add_argument('--disassembly-dir', type=Path, required=True)
    parser.add_argument('--decompiled-root', type=Path, required=True)
    parser.add_argument('--cpp2il-root', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    method_map = parse_method_map(args.dump.read_text(errors='ignore'))
    targets = {
        hex(address): method
        for address, method in method_map.items()
        if any(pattern.lower() in method.lower() for pattern in TARGET_PATTERNS)
    }
    (args.out / 'target-method-map.json').write_text(
        json.dumps(targets, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    for path in args.disassembly_dir.glob('*.txt'):
        annotate_disassembly(path, method_map)

    decompiled = (
        copy_target_sources(args.decompiled_root, args.out / 'decompiled-targets')
        if args.decompiled_root.exists()
        else []
    )
    cpp2il = (
        copy_target_sources(args.cpp2il_root, args.out / 'cpp2il-targets')
        if args.cpp2il_root.exists()
        else []
    )
    summary = {
        'schemaVersion': 1,
        'methodMapCount': len(method_map),
        'targetMethodCount': len(targets),
        'decompiledFiles': decompiled,
        'cpp2ilFiles': cpp2il,
    }
    (args.out / 'curation-summary.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()
