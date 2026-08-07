#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f2'

import extract_official_100101_material_properties as base
import resolve_official_608_particle_texture as closure

TARGET_STAGE_BUNDLE = 'battle/stage/bg_3d_608_00_00_001'
OUTPUT = Path('research/official-608-animation-bindings.json')
FOCUS_RE = re.compile(
    r'(bg3d608|bg_3d_608|red|blue|violin|chair|music|note|fish|bubble|eff_|'
    r'active|enabled|renderer|material|alpha|localposition|localrotation|localscale)',
    re.IGNORECASE,
)
MAX_MATCHES_PER_CLIP = 180
MAX_VALUE_CHARS = 260
MAX_KEYFRAMES = 6


def normalize_name(value: Any) -> str:
    return str(value).replace('\\', '/').strip('/')


def bounded_scalar(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:MAX_VALUE_CHARS]
    return None


def summarize_keyframes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for item in value[:MAX_KEYFRAMES]:
        if not isinstance(item, dict):
            continue
        row: dict[str, Any] = {}
        for key in ('time', 'value', 'inSlope', 'outSlope', 'weightedMode'):
            if key in item:
                scalar = bounded_scalar(item.get(key))
                if scalar is not None:
                    row[key] = scalar
        if row:
            result.append(row)
    return result


def curve_summary(curve: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = {}
    for key in (
        'path', 'attribute', 'classID', 'script', 'flags',
        'm_Path', 'm_Attribute', 'm_ClassID', 'm_Script',
    ):
        if key in curve:
            scalar = bounded_scalar(curve.get(key))
            if scalar is not None:
                row[key] = scalar
    inner = curve.get('curve') or curve.get('m_Curve')
    if isinstance(inner, dict):
        keys = inner.get('m_Curve') or inner.get('keys') or inner.get('keyframes')
        keyframes = summarize_keyframes(keys)
        if keyframes:
            row['keyframes'] = keyframes
        for key in ('m_PreInfinity', 'm_PostInfinity', 'm_RotationOrder'):
            if key in inner:
                scalar = bounded_scalar(inner.get(key))
                if scalar is not None:
                    row[key] = scalar
    return row


def focus_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (bool, int, float)):
        return str(value)
    if isinstance(value, dict):
        parts: list[str] = []
        for key in ('path', 'attribute', 'm_Path', 'm_Attribute', 'name', 'm_Name'):
            if key in value:
                parts.append(str(value.get(key)))
        return ' '.join(parts)
    return ''


def walk_focus(value: Any, path: str = '') -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    if isinstance(value, dict):
        combined = f'{path} {focus_text(value)}'
        if FOCUS_RE.search(combined):
            compact: dict[str, Any] = {'jsonPath': path or '$'}
            for key, child in value.items():
                scalar = bounded_scalar(child)
                if scalar is not None:
                    compact[str(key)] = scalar
            if 'curve' in value or 'm_Curve' in value:
                compact.update(curve_summary(value))
            matches.append(compact)
        for key, child in value.items():
            child_path = f'{path}.{key}' if path else str(key)
            matches.extend(walk_focus(child, child_path))
            if len(matches) >= MAX_MATCHES_PER_CLIP:
                break
    elif isinstance(value, list):
        for index, child in enumerate(value):
            child_path = f'{path}[{index}]'
            matches.extend(walk_focus(child, child_path))
            if len(matches) >= MAX_MATCHES_PER_CLIP:
                break
    elif FOCUS_RE.search(f'{path} {focus_text(value)}'):
        scalar = bounded_scalar(value)
        if scalar is not None:
            matches.append({'jsonPath': path or '$', 'value': scalar})
    return matches[:MAX_MATCHES_PER_CLIP]


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='magius-608-animation-bindings-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        dependencies, bounded_record = closure.current_dependencies(metadata)
        by_name = {
            normalize_name(entry.full_path).lower(): entry
            for entry in entries
        }
        names = [TARGET_STAGE_BUNDLE, *dependencies]
        selected = []
        missing = []
        for name in names:
            entry = by_name.get(name.lower())
            if entry is None:
                missing.append(name)
            else:
                selected.append(entry)
        if missing:
            raise RuntimeError(f'current-JP 608 closure missing catalog entries: {missing}')

        clip_rows: list[dict[str, Any]] = []
        animator_rows: list[dict[str, Any]] = []
        director_rows: list[dict[str, Any]] = []
        type_counts: dict[str, int] = {}

        for entry in selected:
            path = base.download(entry, request_headers, token, temp)
            env = UnityPy.load(str(path))
            for obj in env.objects:
                type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
                type_counts[type_name] = type_counts.get(type_name, 0) + 1
                if type_name not in {'AnimationClip', 'Animator', 'PlayableDirector'}:
                    continue
                try:
                    tree = obj.read_typetree()
                except Exception as exc:
                    tree = {'typetreeError': f'{type(exc).__name__}: {exc}'}
                if not isinstance(tree, dict):
                    continue
                row = {
                    'sourceBundle': entry.full_path,
                    'serializedFile': str(
                        getattr(getattr(obj, 'assets_file', None), 'name', '')
                    ),
                    'pathId': str(int(getattr(obj, 'path_id', 0) or 0)),
                    'name': str(tree.get('m_Name', '')),
                }
                if type_name == 'AnimationClip':
                    row.update({
                        'sampleRate': tree.get('m_SampleRate'),
                        'wrapMode': tree.get('m_WrapMode'),
                        'legacy': tree.get('m_Legacy'),
                        'compressed': tree.get('m_Compressed'),
                        'useHighQualityCurve': tree.get('m_UseHighQualityCurve'),
                        'focusMatches': walk_focus(tree),
                    })
                    clip_rows.append(row)
                elif type_name == 'Animator':
                    row['focusMatches'] = walk_focus(tree)
                    animator_rows.append(row)
                else:
                    row['focusMatches'] = walk_focus(tree)
                    director_rows.append(row)

        focused_clips = [row for row in clip_rows if row.get('focusMatches')]
        report = {
            'schemaVersion': 1,
            'source': 'official-jp-current-608-15-bundle-closure-bounded-animation-audit',
            'metadata': metadata,
            'stage': {
                'rootBundle': TARGET_STAGE_BUNDLE,
                'boundedCatalogRecord': bounded_record,
                'bundleCountIncludingRoot': len(names),
                'dependencyCount': len(dependencies),
            },
            'animationClipCount': len(clip_rows),
            'focusedAnimationClipCount': len(focused_clips),
            'animatorCount': len(animator_rows),
            'playableDirectorCount': len(director_rows),
            'typeCounts': dict(sorted(type_counts.items())),
            'focusedAnimationClips': focused_clips,
            'allAnimationClips': [
                {
                    key: row.get(key)
                    for key in (
                        'sourceBundle', 'serializedFile', 'pathId', 'name',
                        'sampleRate', 'wrapMode', 'legacy', 'compressed',
                    )
                }
                for row in clip_rows
            ],
            'animators': animator_rows,
            'playableDirectors': director_rows,
            'interpretation': (
                'This is bounded current-JP serialized AnimationClip/Animator/PlayableDirector evidence. '
                'Focus matches only expose paths/attributes and a small keyframe prefix for 608 red/blue, '
                'violin/chair/music and visibility/material-related bindings. It does not infer runtime state '
                'for hashed/compressed bindings that cannot yet be mapped to hierarchy paths.'
            ),
            'privacyBoundary': (
                'Raw current-JP AssetBundles are transient. No complete dump or AssetBundle bytes are persisted.'
            ),
        }
        OUTPUT.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n',
            encoding='utf-8',
        )
        print(json.dumps({
            'animationClipCount': report['animationClipCount'],
            'focusedAnimationClipCount': report['focusedAnimationClipCount'],
            'animatorCount': report['animatorCount'],
            'playableDirectorCount': report['playableDirectorCount'],
            'focused': [
                {
                    'name': row['name'],
                    'sourceBundle': row['sourceBundle'],
                    'matchCount': len(row.get('focusMatches') or []),
                }
                for row in focused_clips
            ],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
