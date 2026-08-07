#!/usr/bin/env python3
from __future__ import annotations

import UnityPy

# The current JP Android bundles are Unity 2022.3.62f2. Some UnityFS files do
# not serialize a parseable engine version in the bundle header, so UnityPy
# requires the known client version as an explicit fallback before loading.
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

from extract_official_100101_material_properties import main


if __name__ == "__main__":
    raise SystemExit(main())
