#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

OUTPUT = Path('research/release-stage-runtime-hooks.json')
REF = 'origin/magius3dviewer'
PATTERNS = [
    'renderProfile',
    'rotators',
    'materialBindings',
    'StageMaterialBinding',
    'stageMaterialBindings',
    'ParticleSystem',
    'particle',
    'runtime',
]
MAX_MATCHES_PER_PATTERN = 120


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def grep(pattern: str) -> list[dict[str, object]]:
    command = ['git', 'grep', '-n', '-I', '-e', pattern, REF, '--', '*.ts', '*.tsx', '*.mjs', '*.json']
    try:
        text = run(*command)
    except subprocess.CalledProcessError as exc:
        if exc.returncode == 1:
            return []
        raise
    rows = []
    for line in text.splitlines()[:MAX_MATCHES_PER_PATTERN]:
        prefix, content = line.split(':', 1)
        if ':' in content:
            line_no_text, content = content.split(':', 1)
        else:
            line_no_text = '0'
        path = prefix.split(':', 1)[-1]
        try:
            line_no = int(line_no_text)
        except ValueError:
            line_no = 0
        rows.append({'path': path, 'line': line_no, 'text': content[:500]})
    return rows


def main() -> int:
    sha = run('git', 'rev-parse', REF).strip()
    matches = {pattern: grep(pattern) for pattern in PATTERNS}
    paths = sorted({
        str(row['path'])
        for rows in matches.values()
        for row in rows
        if row.get('path')
    })
    report = {
        'schemaVersion': 1,
        'ref': REF,
        'sha': sha,
        'patterns': matches,
        'candidateFiles': paths,
        'note': (
            'Bounded git-grep of the release branch to locate existing stage runtime extension points. '
            'This is repository code only; no private game payload is included.'
        ),
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'sha': sha,
        'candidateFileCount': len(paths),
        'candidateFiles': paths,
        'counts': {key: len(value) for key, value in matches.items()},
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
