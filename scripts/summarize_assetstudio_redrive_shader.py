#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

TOKENS = (
    '_IsAniso', '_AnisoMaskByMetallic', '_AnisoColor', '_AnisoThreshold', '_AnisoFeather',
    '_IsGem', '_UseGemDepthDiff', '_GemDepthDiffThreshold', '_GemHeightCorrection',
    '_Gem1stHighlightSize', '_Gem2ndHighlightSize', '_GemRimFresnel',
    '_UseMatCap', '_MatCapIntensity', '_MaskMatcapMetallic', '_MaskMatcapSpecular',
    '_UseFresnel', '_FresnelMaskByMetallic', '_FresnelColor', '_FresnelThreshold', '_FresnelFeather',
    '_UseDepthTex', '_DepthTexWidth', '_DepthTexYOffset', '_DepthRimLightDiffThreshold', '_DepthShadowDiffThreshold',
)


def merge_regions(regions: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, stop in sorted(regions):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], stop))
        else:
            merged.append((start, stop))
    return merged


def summarize_file(path: Path, root: Path) -> dict | None:
    raw = path.read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        text = raw.decode('utf-8', errors='replace')
    if not any(token in text for token in TOKENS):
        return None
    lines = text.splitlines()
    hits = [
        {'line': index + 1, 'tokens': [token for token in TOKENS if token in line]}
        for index, line in enumerate(lines)
        if any(token in line for token in TOKENS)
    ]
    regions = merge_regions([
        (max(0, hit['line'] - 1 - 18), min(len(lines), hit['line'] + 18))
        for hit in hits
    ])
    # Keep evidence bounded even if AssetStudio repeats property declarations in
    # many compiled variants.  The full Shader export remains runner-local.
    contexts = []
    total_lines = 0
    for start, stop in regions:
        if len(contexts) >= 12 or total_lines >= 360:
            break
        stop = min(stop, start + max(0, 360 - total_lines))
        contexts.append({
            'startLine': start + 1,
            'endLine': stop,
            'text': '\n'.join(lines[start:stop]),
        })
        total_lines += stop - start
    return {
        'path': path.relative_to(root).as_posix(),
        'byteCount': len(raw),
        'sha256': hashlib.sha256(raw).hexdigest(),
        'lineCount': len(lines),
        'hitCount': len(hits),
        'tokens': sorted({token for hit in hits for token in hit['tokens']}),
        'contexts': contexts,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('export_root', type=Path)
    parser.add_argument('-o', '--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.export_root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(root)
    files = []
    for path in sorted(root.rglob('*')):
        if not path.is_file():
            continue
        result = summarize_file(path, root)
        if result:
            files.append(result)
    if not files:
        raise RuntimeError('AssetStudio export contained no ReDrive feature tokens')
    report = {
        'schemaVersion': 1,
        'source': 'AssetStudioModCLI-official-jp-current-shader-export',
        'fileCount': len(files),
        'files': files,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(json.dumps({
        'fileCount': len(files),
        'paths': [item['path'] for item in files],
        'tokens': sorted({token for item in files for token in item['tokens']}),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
