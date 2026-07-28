# Magius3Dviewer reconstruction checkpoint

This branch is an evidence-driven reconstruction, not a claim that every official effect is already complete.

Current validated scope:

- generic full-body/companion animation-family binding correction across the bundled character corpus;
- character-profile-gated AngelRing (Madoka enabled, Ashley disabled by official profile evidence);
- smooth-normal AngelRing wedge mapping without the invalid UV3 crown artifact;
- Control R/G/B separation and exported specular-gradient support;
- per-FBX-material-slot profiles, including recovered Soul Gem/Gem/MatCap scalar values;
- official Battle/Dungeon/Gallery geometry catalog and stage runtime;
- root-relative official FBX texture resolution;
- scene-level camera, light, fog, colour-filter, bloom, spawn and ReDriveVolume data schema;
- automated TypeScript build, all-character animation audit, Chromium WebGL regressions and Pages deployment.

Still incomplete and kept explicit:

- full official Shader source/pass translation;
- exact profile extraction for every character/material;
- dedicated self-shadow/depth-texture, Cosmic and all MatCap variants;
- all on-demand official stages and complete dependencies;
- full Timeline/Cinemachine playback of special-skill sequences;
- exact per-stage ReDriveVolume and reflection/lightmap reconstruction for every scene.
