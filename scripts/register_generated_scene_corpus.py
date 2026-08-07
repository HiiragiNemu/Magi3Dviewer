#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

path = Path('public/stages/catalog.json')
data = json.loads(path.read_text(encoding='utf-8'))
catalogs = data.setdefault('catalogs', [])
registration = './stages/generated-corpus.json'
if registration not in catalogs:
    catalogs.append(registration)
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Registered generated scene corpus: {registration}')
