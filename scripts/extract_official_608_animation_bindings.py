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
    r'active|enabled|renderer|material|alpha|localposition|localrotation|localscale|state|motion|clip)',
    re.IGNORECASE,
)
MAX_MATCHES = 220
MAX_VALUE_CHARS = 260
MAX_KEYFRAMES = 6


def normalize_name(value: Any) -> str:
    return str(value).replace('\\', '/').strip('/')


def ptr(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if 'm_FileID' not in value or 'm_PathID' not in value:
        return None
    try:
        return {
            'fileId': int(value.get('m_FileID', 0) or 0),
            'pathId': str(int(value.get('m_PathID', 0) or 0)),
        }
    except Exception:
        return None


def local_ptr(value: Any) -> int:
    p = ptr(value)
    if p is None or p['fileId'] != 0:
        return 0
    try:
        return int(p['pathId'])
    except Exception:
        return 0


def pointer_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    rows: list[dict[str, Any]] = []
    for item in value:
        p = ptr(item)
        if p is None and isinstance(item, dict):
            p = ptr(item.get('component'))
        if p is not None:
            rows.append(p)
    return rows


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
            scalar = bounded_scalar(item.get(key)) if key in item else None
            if scalar is not None:
                row[key] = scalar
        if row:
            result.append(row)
    return result


def curve_summary(curve: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = {}
    for key in ('path', 'attribute', 'classID', 'script', 'flags', 'm_Path', 'm_Attribute', 'm_ClassID', 'm_Script'):
        if key in curve:
            scalar = bounded_scalar(curve.get(key))
            if scalar is not None:
                row[key] = scalar
    inner = curve.get('curve') or curve.get('m_Curve')
    if isinstance(inner, dict):
        keys = inner.get('m_Curve') or inner.get('keys') or inner.get('keyframes')
        frames = summarize_keyframes(keys)
        if frames:
            row['keyframes'] = frames
    return row


def walk_focus(value: Any, path: str = '') -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    if isinstance(value, dict):
        text = path + ' ' + ' '.join(
            str(value.get(key, ''))
            for key in ('path', 'attribute', 'm_Path', 'm_Attribute', 'name', 'm_Name')
        )
        if FOCUS_RE.search(text):
            compact: dict[str, Any] = {'jsonPath': path or '$'}
            for key, child in value.items():
                scalar = bounded_scalar(child)
                if scalar is not None:
                    compact[str(key)] = scalar
            if 'curve' in value or 'm_Curve' in value:
                compact.update(curve_summary(value))
            matches.append(compact)
        for key, child in value.items():
            matches.extend(walk_focus(child, f'{path}.{key}' if path else str(key)))
            if len(matches) >= MAX_MATCHES:
                break
    elif isinstance(value, list):
        for index, child in enumerate(value):
            matches.extend(walk_focus(child, f'{path}[{index}]'))
            if len(matches) >= MAX_MATCHES:
                break
    elif FOCUS_RE.search(f'{path} {value}'):
        scalar = bounded_scalar(value)
        if scalar is not None:
            matches.append({'jsonPath': path or '$', 'value': scalar})
    return matches[:MAX_MATCHES]


def walk_pointers(value: Any, path: str = '') -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if isinstance(value, dict):
        p = ptr(value)
        if p is not None and re.search(r'(motion|clip|animation|controller|state)', path, re.IGNORECASE):
            result.append({'jsonPath': path or '$', **p})
        for key, child in value.items():
            result.extend(walk_pointers(child, f'{path}.{key}' if path else str(key)))
            if len(result) >= MAX_MATCHES:
                break
    elif isinstance(value, list):
        for index, child in enumerate(value):
            result.extend(walk_pointers(child, f'{path}[{index}]'))
            if len(result) >= MAX_MATCHES:
                break
    return result[:MAX_MATCHES]


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='magius-608-animation-bindings-') as temporary:
        temp = Path(temporary)
        session = base.requests.Session()
        entries, request_headers, token, metadata = base.catalog(session)
        dependencies, bounded_record = closure.current_dependencies(metadata)
        by_name = {normalize_name(entry.full_path).lower(): entry for entry in entries}
        names = [TARGET_STAGE_BUNDLE, *dependencies]
        selected = []
        for name in names:
            entry = by_name.get(name.lower())
            if entry is None:
                raise RuntimeError(f'current-JP 608 closure missing catalog entry: {name}')
            selected.append(entry)

        clip_rows: list[dict[str, Any]] = []
        animator_rows: list[dict[str, Any]] = []
        animation_rows: list[dict[str, Any]] = []
        controller_rows: list[dict[str, Any]] = []
        director_rows: list[dict[str, Any]] = []
        type_counts: dict[str, int] = {}
        root_game_objects: dict[int, dict[str, Any]] = {}
        root_transforms: dict[int, dict[str, Any]] = {}
        transform_by_go: dict[int, int] = {}

        loaded: list[tuple[Any, Any]] = []
        for entry in selected:
            path = base.download(entry, request_headers, token, temp)
            env = UnityPy.load(str(path))
            loaded.append((entry, env))
            for obj in env.objects:
                type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
                type_counts[type_name] = type_counts.get(type_name, 0) + 1
                if normalize_name(entry.full_path) != TARGET_STAGE_BUNDLE or type_name not in {'GameObject', 'Transform'}:
                    continue
                try:
                    tree = obj.read_typetree()
                except Exception:
                    continue
                if not isinstance(tree, dict):
                    continue
                path_id = int(getattr(obj, 'path_id', 0) or 0)
                if type_name == 'GameObject':
                    root_game_objects[path_id] = {'name': str(tree.get('m_Name', ''))}
                else:
                    go_id = local_ptr(tree.get('m_GameObject'))
                    root_transforms[path_id] = {
                        'gameObjectPathId': go_id,
                        'fatherTransformPathId': local_ptr(tree.get('m_Father')),
                    }
                    if go_id:
                        transform_by_go[go_id] = path_id

        def hierarchy(go_id: int) -> str:
            names_out: list[str] = []
            transform_id = transform_by_go.get(go_id, 0)
            seen: set[int] = set()
            while transform_id and transform_id not in seen:
                seen.add(transform_id)
                tr = root_transforms.get(transform_id)
                if tr is None:
                    break
                current_go = int(tr.get('gameObjectPathId') or 0)
                names_out.append(str(root_game_objects.get(current_go, {}).get('name') or f'GameObject:{current_go}'))
                transform_id = int(tr.get('fatherTransformPathId') or 0)
            return '/'.join(reversed(names_out))

        for entry, env in loaded:
            is_root = normalize_name(entry.full_path) == TARGET_STAGE_BUNDLE
            for obj in env.objects:
                type_name = str(getattr(getattr(obj, 'type', None), 'name', ''))
                if type_name not in {'AnimationClip', 'Animator', 'Animation', 'AnimatorController', 'PlayableDirector'}:
                    continue
                try:
                    tree = obj.read_typetree()
                except Exception as exc:
                    tree = {'typetreeError': f'{type(exc).__name__}: {exc}'}
                if not isinstance(tree, dict):
                    continue
                row: dict[str, Any] = {
                    'sourceBundle': entry.full_path,
                    'serializedFile': str(getattr(getattr(obj, 'assets_file', None), 'name', '')),
                    'pathId': str(int(getattr(obj, 'path_id', 0) or 0)),
                    'name': str(tree.get('m_Name', '')),
                }
                go_id = local_ptr(tree.get('m_GameObject')) if is_root else 0
                if go_id:
                    row['gameObjectPathId'] = str(go_id)
                    row['hierarchyPath'] = hierarchy(go_id)
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
                    row.update({
                        'enabled': tree.get('m_Enabled'),
                        'controller': ptr(tree.get('m_Controller')),
                        'avatar': ptr(tree.get('m_Avatar')),
                        'focusMatches': walk_focus(tree),
                    })
                    animator_rows.append(row)
                elif type_name == 'Animation':
                    row.update({
                        'enabled': tree.get('m_Enabled'),
                        'playAutomatically': tree.get('m_PlayAutomatically'),
                        'wrapMode': tree.get('m_WrapMode'),
                        'defaultAnimation': ptr(tree.get('m_Animation')),
                        'animations': pointer_list(tree.get('m_Animations')),
                        'focusMatches': walk_focus(tree),
                    })
                    animation_rows.append(row)
                elif type_name == 'AnimatorController':
                    row.update({
                        'motionAndStatePointers': walk_pointers(tree),
                        'focusMatches': walk_focus(tree),
                    })
                    controller_rows.append(row)
                else:
                    row['focusMatches'] = walk_focus(tree)
                    director_rows.append(row)

        report = {
            'schemaVersion': 2,
            'source': 'official-jp-current-608-15-bundle-closure-bounded-animation-audit',
            'metadata': metadata,
            'stage': {
                'rootBundle': TARGET_STAGE_BUNDLE,
                'boundedCatalogRecord': bounded_record,
                'bundleCountIncludingRoot': len(names),
                'dependencyCount': len(dependencies),
            },
            'animationClipCount': len(clip_rows),
            'animatorCount': len(animator_rows),
            'legacyAnimationCount': len(animation_rows),
            'animatorControllerCount': len(controller_rows),
            'playableDirectorCount': len(director_rows),
            'typeCounts': dict(sorted(type_counts.items())),
            'animationClips': clip_rows,
            'animators': animator_rows,
            'legacyAnimations': animation_rows,
            'animatorControllers': controller_rows,
            'playableDirectors': director_rows,
            'interpretation': (
                'Exact current-JP serialized ownership and pointer evidence for AnimationClip, Animation, Animator and '
                'AnimatorController across the 15-bundle 608 closure. Hierarchy paths are resolved for root-stage '
                'components. Bounded focus/keyframe snippets do not infer hashed compressed-curve semantics.'
            ),
            'privacyBoundary': 'Raw current-JP AssetBundles remain transient; no complete dump is persisted.',
        }
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({
            'animationClipCount': len(clip_rows),
            'legacyAnimationCount': len(animation_rows),
            'animatorCount': len(animator_rows),
            'animatorControllerCount': len(controller_rows),
            'rootAnimationOwners': [
                {
                    'type': 'Animation',
                    'hierarchyPath': row.get('hierarchyPath'),
                    'defaultAnimation': row.get('defaultAnimation'),
                    'animations': row.get('animations'),
                }
                for row in animation_rows if row.get('hierarchyPath')
            ],
            'rootAnimatorOwners': [
                {
                    'type': 'Animator',
                    'hierarchyPath': row.get('hierarchyPath'),
                    'controller': row.get('controller'),
                }
                for row in animator_rows if row.get('hierarchyPath')
            ],
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
