from __future__ import annotations

import sys
from pathlib import Path


def replace_exact(path: Path, old: str, new: str, count: int = 1) -> bool:
    text = path.read_text(encoding="utf-8")
    actual = text.count(old)
    if actual == 0 and new in text:
        return False
    if actual != count:
        raise SystemExit(
            f"{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}"
        )
    path.write_text(text.replace(old, new, count), encoding="utf-8")
    return True


def main(root: Path) -> None:
    changed: list[str] = []
    hair = root / "magia-exedra-character-three/shaders/hair.ts"

    if replace_exact(
        hair,
        """                varying vec3 vAngelRingFaceClip;
                varying vec3 vAngelRingFaceUpVS;
                varying vec3 vAngelRingFaceForwardVS;""",
        """                varying vec3 vAngelRingFaceClip;
                varying vec3 vAngelRingFaceUpClip;
                varying vec3 vAngelRingFaceUpVS;
                varying vec3 vAngelRingFaceForwardVS;""",
        count=2,
    ):
        changed.append(str(hair))

    if replace_exact(
        hair,
        """                vAngelRingFaceClip = vec3(
                    rdAngelFaceClip.xy,
                    rdAngelFaceClip.w
                );
                vAngelRingFaceUpVS =
                    mat3(viewMatrix) * uAngelRingFaceUp;""",
        """                vAngelRingFaceClip = vec3(
                    rdAngelFaceClip.xy,
                    rdAngelFaceClip.w
                );
                vec4 rdAngelFaceUpClip =
                    projectionMatrix *
                    viewMatrix *
                    vec4(
                        uAngelRingFacePosition + uAngelRingFaceUp,
                        1.0
                    );
                vAngelRingFaceUpClip = vec3(
                    rdAngelFaceUpClip.xy,
                    rdAngelFaceUpClip.w
                );
                vAngelRingFaceUpVS =
                    mat3(viewMatrix) * uAngelRingFaceUp;""",
    ):
        changed.append(str(hair))

    if replace_exact(
        hair,
        """                        // A normalized 3D Head-Up vector does not imply a
                        // normalized 2D screen axis. When the head pitches
                        // towards the camera, FaceUp.xy becomes short; using it
                        // directly scales and clips the projected map into a
                        // diagonal stripe. Normalize the projected axis in the
                        // same aspect-correct coordinate space as the ring box.
                        vec2 rdAngelProjectedUp = rdAngelFaceUpVS.xy;
                        float rdAngelProjectedUpLength =
                            length(rdAngelProjectedUp);
                        rdAngelProjectedUp =
                            rdAngelProjectedUpLength > 0.00001
                                ? rdAngelProjectedUp /
                                    rdAngelProjectedUpLength
                                : vec2(0.0, 1.0);""",
        """                        // Project both the Head origin and its Up endpoint
                        // through the complete camera matrix. Using only
                        // FaceUp.xy omits perspective division and turns the
                        // highlight into a diagonal band under pitch/portrait.
                        float rdAngelFaceUpW = max(
                            abs(vAngelRingFaceUpClip.z),
                            0.000001
                        );
                        vec2 rdAngelFaceUpUv =
                            vAngelRingFaceUpClip.xy /
                            rdAngelFaceUpW;
                        rdAngelFaceUpUv =
                            rdAngelFaceUpUv * 0.5 + vec2(0.5);
                        vec2 rdAngelProjectedUp =
                            (rdAngelFaceUpUv - rdAngelFaceUv) /
                            max(rdAngelRectHalf, vec2(0.000001));
                        float rdAngelProjectedUpLength =
                            length(rdAngelProjectedUp);
                        rdAngelProjectedUp =
                            rdAngelProjectedUpLength > 0.00001
                                ? rdAngelProjectedUp /
                                    rdAngelProjectedUpLength
                                : vec2(0.0, 1.0);""",
    ):
        changed.append(str(hair))

    invariant = root / "angelRingHeadLock.test.mjs"
    if replace_exact(
        invariant,
        """assert.match(
    shaderSource,
    /mat3\\(viewMatrix\\) \\* uAngelRingFaceUp/,
    'Head Up must be transformed into view space',
);""",
        """assert.match(
    shaderSource,
    /vAngelRingFaceUpClip/,
    'Head Up endpoint must be projected through the full camera matrix',
);
assert.match(
    shaderSource,
    /rdAngelFaceUpUv - rdAngelFaceUv/,
    'screen-space Head Up must come from two perspective-divided points',
);
assert.match(
    shaderSource,
    /mat3\\(viewMatrix\\) \\* uAngelRingFaceUp/,
    'Head Up view-space component remains required by the official curve blend',
);""",
    ):
        changed.append(str(invariant))

    for relative in (
        "scripts/smoke-runtime-v2.mjs",
        "scripts/smoke-angelring-two-character.mjs",
    ):
        script = root / relative
        text = script.read_text(encoding="utf-8")
        original = text
        old_error = "page.on('pageerror', error => pageErrors.push(String(error)))"
        if old_error in text and "browser:requestfailed" not in text:
            text = text.replace(
                old_error,
                old_error
                + "\npage.on('requestfailed', request => {\n"
                + "  console.error(`[browser:requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`)\n"
                + "})",
                1,
            )
        old_wait = "() => document.body.classList.contains('no-demo') && window.scene,"
        new_wait = "() => window.scene && document.querySelector('#character-selector option[value=\"100107\"]'),"
        if old_wait in text:
            text = text.replace(old_wait, new_wait, 1)
        elif new_wait not in text:
            raise SystemExit(f"{script}: readiness anchor missing")
        if text != original:
            script.write_text(text, encoding="utf-8")
            changed.append(str(script))

    unique = list(dict.fromkeys(changed))
    print("Changed files:" if unique else "No changes required.")
    for item in unique:
        print(f"- {item}")


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    main(root)
