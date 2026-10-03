# Touka hybrid arms and requested db8e279 contact release

User authorization: 2026-10-03, use Tart (111501) motion with 114501 arm spread,
push and deploy this version while sharp-cloth deformation remains in progress.

## Scope
- Restore db8e279 contact driver and surface projection, not the whole motion module.
- Keep the later material-slot outline buffer binding fix; it changes draw-view
  coherence, not collision response. Preserve all other current rendering/resource code.
- Touka 101901: Tart idle arm directions and walk/run arm, wrist and finger motion;
  phase-matched 114501 outward-angle floor rotates upper arm and forearm together.
  Forward swing and elbow angle remain unchanged by widening. Existing jump arm
  sampling receives the same widening. This is not a native Tart jump replacement.
- Existing wide-skirt characters retain the requested 114501 arm profile.
- Idle fingers retain the target baseline; the native hand dataset has walk/run only.
- Keep original idle prop/hide channels, 101002 generation-facing and foot-frame fixes,
  TPS pose-editor final pivot, free rotation versus translation IK separation,
  input ownership, and white selected leader lines.
- Native pose gravity remains available independently and unchecked by default.
- Production contacts default on; explicit build opt-out remains functional.
- Parent 2ff3ab9 contains the previously authorized publication-traversal optimization.

## Verification before publishing
- Website suite: 629 tests passed, 0 failures/skips.
- TypeScript: zero diagnostics.
- Local candidate: 17 tests, including actual retargeted idle on held 101901 rig,
  original prop-hide track retention, facing and bind-frame regressions.
- Native wrist/finger comparison: 400 samples; 399 differ from previous 114501 source.
- Hybrid spread: 600 samples; 560 widen, maximum extra angle 20.2062 degrees;
  no loss of authored forward swing or elbow bend.
- Exact local patch replay and previous-preview rollback rehearsal passed.

Previous v4 topology/cap tests described the rejected solver, not db8e279.
The runtime tests now cover the selected driver plus projection and preserve the
independent outline, gravity, camera and replay tests. No bounded-edge or visual
zero-penetration claim is made for this release.

## Explicitly unresolved
Knee/jump contact can still stretch cloth into sharp triangles. The separate
`artifacts/db8e279-local-fold-20261003` experiments are not part of this release.
Early topology iterations improve extreme extension but still fail shape/performance
criteria; they must not silently replace the production or arm-style preview.
User visual acceptance of the hybrid style remains pending.
