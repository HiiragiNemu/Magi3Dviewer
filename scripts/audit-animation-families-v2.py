#!/usr/bin/env python3
"""Protocol-correct entry point for the all-character FBX family audit."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('audit-animation-families.py')
spec = importlib.util.spec_from_file_location('animation_family_audit', MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'Unable to load {MODULE_PATH}')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def clean_name(value):
    name = str(value).split('::', 1)[-1].replace('\x00\x01', '::')
    return re.sub(r'::(?:AnimStack|AnimationStack|Material|Model)$', '', name)


def family_name(name: str) -> str:
    name = re.sub(r'::(?:AnimStack|AnimationStack)$', '', name)
    name = re.sub(r'_weapon_[a-z0-9]+(?=_|$)', '', name, flags=re.I)
    return re.sub(r'_\d+$', '', name)


audit.clean_name = clean_name
audit.family_name = family_name

if __name__ == '__main__':
    audit.main()
