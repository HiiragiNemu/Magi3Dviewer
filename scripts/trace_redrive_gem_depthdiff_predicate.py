#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import decompress_modern_redrive_shader_programs as modern
import extract_official_100101_material_properties as base
import extract_targeted_redrive_formula_windows as targeted

OUTPUT = Path('research/official-redrive-gem-depthdiff-predicate-trace.json')
TARGET_CHUNK_SHA256 = '65536f9156cf560226d40a4094f1a27c448f6b2bfca1a8d6a77a8de89ee4f62a'
TARGET_TOKEN = '_UseGemDepthDiff'
TARGET_VARIABLE = 'u_xlatb59'
MAX_BACKWARD_BYTES = 131072
CONTEXT_LINES = 10
MAX_ASSIGNMENTS = 8


def code_lines(data: bytes) -> list[dict[str, Any]]:
    return [
        {
            'offset': int(offset),
            'text': text.replace('\x00', '')[:900],
        }
        for offset, text in modern.ascii_strings(data, minimum=4)
    ]


def context(lines: list[dict[str, Any]], index: int, radius: int = CONTEXT_LINES) -> list[dict[str, Any]]:
    start = max(0, index - radius)
    end = min(len(lines), index + radius + 1)
    return lines[start:end]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix='magius-gemdepth-predicate-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        character_entries = [
            entry for entry in entries
            if entry.full_path.lower() == modern.TARGET_BUNDLE
        ]
        shader_entries = [
            entry for entry in entries
            if entry.full_path.lower().startswith(('shader/', 'shaders/'))
        ]
        selected_entries = sorted(
            {entry.full_path: entry for entry in [*character_entries, *shader_entries]}.values(),
            key=lambda item: item.full_path,
        )
        downloaded = [
            base.download(entry, request_headers, token, temp)
            for entry in selected_entries
        ]
        env = UnityPy.load(*(str(path) for path in downloaded))
        material, pointer, reader, shader = modern.material_shader(env)
        chunks = targeted.reconstruct_chunks(shader)
        chunk = next(
            (
                item for item in chunks
                if item['decodedSha256'] == TARGET_CHUNK_SHA256
            ),
            None,
        )
        if chunk is None:
            raise RuntimeError(
                f'Expected current-JP compiled chunk {TARGET_CHUNK_SHA256} not found'
            )
        data: bytes = chunk['decoded']
        lines = code_lines(data)
        use_indexes = [
            index for index, row in enumerate(lines)
            if TARGET_TOKEN in row['text']
        ]
        if not use_indexes:
            raise RuntimeError(f'{TARGET_TOKEN} not found in target compiled chunk')

        # Select the executable use whose nearby code also contains the exact
        # depth-texture fetch. Uniform declarations and unrelated variants are
        # intentionally rejected.
        selected_use: int | None = None
        for index in use_indexes:
            nearby = '\n'.join(
                row['text'] for row in lines[index:index + 40]
            )
            if '_CameraDepthTexture' in nearby and TARGET_VARIABLE in nearby:
                selected_use = index
                break
        if selected_use is None:
            raise RuntimeError(
                'Could not find executable GemDepthDiff use with CameraDepthTexture and predecessor predicate'
            )

        use_offset = int(lines[selected_use]['offset'])
        floor_offset = max(0, use_offset - MAX_BACKWARD_BYTES)
        assignment_pattern = re.compile(
            rf'\b{re.escape(TARGET_VARIABLE)}\s*=\s*(.+?);\s*$'
        )
        assignments: list[dict[str, Any]] = []
        for index in range(selected_use - 1, -1, -1):
            row = lines[index]
            if int(row['offset']) < floor_offset:
                break
            match = assignment_pattern.search(str(row['text']))
            if not match:
                continue
            assignments.append({
                'offset': row['offset'],
                'expression': match.group(1),
                'distanceBytes': use_offset - int(row['offset']),
                'context': context(lines, index),
            })
            if len(assignments) >= MAX_ASSIGNMENTS:
                break

        if not assignments:
            raise RuntimeError(
                f'No {TARGET_VARIABLE} assignment found within {MAX_BACKWARD_BYTES} bytes before GemDepthDiff use'
            )

        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-modern-ReDrive-Shader-predicate-trace',
            'metadata': metadata,
            'material': str(getattr(material, 'm_Name', '')),
            'shaderPathId': int(getattr(pointer, 'm_PathID', 0) or 0),
            'shaderSerializedFile': str(
                getattr(getattr(reader, 'assets_file', None), 'name', '')
            ),
            'chunkIndex': chunk['chunkIndex'],
            'platform': chunk['platform'],
            'decodedSha256': chunk['decodedSha256'],
            'decodedLength': len(data),
            'selectedUseOffset': use_offset,
            'selectedUseContext': context(lines, selected_use, 18),
            'predecessorVariable': TARGET_VARIABLE,
            'backwardSearchBytes': MAX_BACKWARD_BYTES,
            'assignmentsNearestFirst': assignments,
            'boundedEvidenceSha256': hashlib.sha256(
                json.dumps(
                    {
                        'use': context(lines, selected_use, 18),
                        'assignments': assignments,
                    },
                    sort_keys=True,
                    ensure_ascii=False,
                ).encode('utf-8')
            ).hexdigest(),
            'interpretation': (
                'Bounded current-JP compiled GLSL trace only. The nearest reaching assignment must be '
                'interpreted with its control-flow context before Web parity is claimed; this report does '
                'not infer semantics from the temporary compiler variable name itself.'
            ),
        }
        OUTPUT.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        print(json.dumps({
            'selectedUseOffset': use_offset,
            'assignmentCount': len(assignments),
            'nearestAssignments': [
                {
                    'offset': item['offset'],
                    'distanceBytes': item['distanceBytes'],
                    'expression': item['expression'],
                }
                for item in assignments
            ],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
