# Stage 600 current-JP UV1 product candidate

Target: `battle-600-00-01-002` only.

Evidence source: current-JP AssetBundleRevision `61ad830ca038a9efd58e67170a61c85e`, Unity `2022.3.62f2`.

Admission gate: all 134 Unity Mesh objects must decode streamed UV1; all 158 Three r182 FBX mesh nodes must resolve to exact official Mesh PathIDs through GameObject/MeshFilter hierarchy; reconstructed FBX UV0 must have zero mapping error; runtime must install `uv1` before `applyStageLightmaps`; prior P0 608/character/self-shadow gates and production build must remain green.

This branch targets `preview/p0-20260808` for human review only. It is not a release merge request.
