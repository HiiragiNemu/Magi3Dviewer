#!/usr/bin/env python3
"""Bounded fixture regression for the Viewer-owned Magius scene tools."""

from __future__ import annotations

import gzip
import importlib.util
import json
import math
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


stages = load_module("viewer_magius_stages", ROOT / "export_magius_stages.py")
cubemaps = load_module(
    "viewer_magius_cubemaps",
    ROOT / "extract_magius_reflection_probe_cubemaps.py",
)
scene_profiles = load_module(
    "viewer_magius_scene_profiles",
    ROOT / "extract_magius_scene_profile.py",
)
scene_closures = load_module(
    "viewer_magius_scene_closures",
    ROOT / "resolve_magius_scene_closure.py",
)
scene_profile_sync = load_module(
    "viewer_magius_scene_profile_sync",
    ROOT / "sync_magius_scene_profiles.py",
)
shader_variants = load_module(
    "viewer_magius_shader_variants",
    ROOT / "extract_magius_shader_variants.py",
)
character_profiles = load_module(
    "viewer_magius_character_profiles",
    ROOT / "extract_magius_character_render_profiles.py",
)
camera_presets = load_module(
    "viewer_magius_camera_presets",
    ROOT / "extract_magius_camera_presets.py",
)


class CharacterRenderProfileExtractorTests(unittest.TestCase):
    def test_selects_only_character_controller_and_preserves_official_offset(self) -> None:
        character = {
            "IsCharacter": 1,
            "headOffset": 0.18000000715255737,
            "faceForwardDirection": 3,
            "faceUpDirection": 1,
            "faceRightDirection": 2,
            "headBoneTransform": {"m_PathID": 101},
            "pelvisBoneTransform": {"m_PathID": 102},
            "m_GameObject": {"m_PathID": 103},
            "reDriveToonRenderers": [
                {"m_PathID": 201},
                {"m_PathID": 202},
            ],
            "CharacterCancelPerspective": 1.0,
            "AdditionalLightInfluenceByLuminance": 0.0,
        }
        attachment = {**character, "IsCharacter": 0, "headOffset": 0.2}
        self.assertIsNone(
            character_profiles.extract_character_controller(attachment)
        )
        extracted = character_profiles.extract_character_controller(character)
        self.assertIsNotNone(extracted)
        assert extracted is not None
        self.assertAlmostEqual(extracted["headOffset"], 0.18000000715255737)
        self.assertEqual(
            (
                extracted["faceForwardAxis"],
                extracted["faceUpAxis"],
                extracted["faceRightAxis"],
            ),
            ("-x", "y", "z"),
        )
        self.assertEqual(extracted["headBonePathId"], 101)
        self.assertEqual(extracted["rendererPathIds"], [201, 202])

    def test_angel_ring_requires_hair_flag_and_non_null_texture_pptr(self) -> None:
        material = {
            "m_Name": "mt_chara_fixture_hair",
            "m_SavedProperties": {
                "m_Floats": [
                    ["_IsHair", 1.0],
                    ["_YuugenHighlight", 0.0],
                ],
                "m_TexEnvs": [
                    [
                        "_AngelRingMap",
                        {"m_Texture": {"m_FileID": 1, "m_PathID": 9001}},
                    ]
                ],
            },
        }
        extracted = character_profiles.extract_hair_material(material)
        self.assertEqual(
            extracted,
            {
                "name": "mt_chara_fixture_hair",
                "angelRingTexturePathId": 9001,
                "angelRingEnabled": True,
                "hairUvAngelRing": False,
            },
        )
        material["m_SavedProperties"]["m_Floats"][0][1] = 0.0
        self.assertIsNone(character_profiles.extract_hair_material(material))

    def test_builds_compact_runtime_controller_table(self) -> None:
        row = {
            "characterId": 101901,
            "headOffset": 0.18000000715255737,
            "faceForwardAxis": "-x",
            "faceUpAxis": "y",
            "faceRightAxis": "z",
            "headBoneName": "Head",
            "characterCancelPerspective": 1.0,
            "additionalLightInfluenceByLuminance": 0.0,
            "angelRingEnabled": True,
            "hairUvAngelRing": False,
            "controllerPathId": 999,
        }
        runtime = character_profiles.build_runtime_report(
            {
                "unityVersion": "2022.3.62f2",
                "profiles": [row],
            }
        )
        self.assertEqual(
            runtime["schema"],
            "magius-character-controller-runtime-profiles-v1",
        )
        self.assertEqual(runtime["profileCount"], 1)
        self.assertEqual(
            set(runtime["profiles"][0]),
            set(character_profiles.RUNTIME_PROFILE_KEYS),
        )
        self.assertNotIn("controllerPathId", runtime["profiles"][0])
        self.assertEqual(
            runtime["profiles"][0]["headOffset"],
            0.18000000715255737,
        )


class CameraPresetExtractorTests(unittest.TestCase):
    def test_preserves_controller_order_and_default_cinemachine_lens(self) -> None:
        def pointer(path_id: int) -> dict[str, int]:
            return {"m_FileID": 0, "m_PathID": path_id}

        def transform(
            path_id: int,
            game_object: int,
            parent: int = 0,
            position: tuple[float, float, float] = (0.0, 0.0, 0.0),
        ) -> dict[str, object]:
            return {
                "pathId": path_id,
                "typeName": "Transform",
                "scriptName": "",
                "tree": {
                    "m_GameObject": pointer(game_object),
                    "m_Father": pointer(parent),
                    "m_LocalPosition": dict(zip(("x", "y", "z"), position)),
                    "m_LocalRotation": {"x": 0, "y": 0, "z": 0, "w": 1},
                    "m_LocalScale": {"x": 1, "y": 1, "z": 1},
                },
            }

        def game_object(
            path_id: int, name: str, components: list[int]
        ) -> dict[str, object]:
            return {
                "pathId": path_id,
                "typeName": "GameObject",
                "scriptName": "",
                "tree": {
                    "m_Name": name,
                    "m_Component": [
                        {"component": pointer(component)} for component in components
                    ],
                },
            }

        def virtual_camera(
            path_id: int, game_object_path_id: int, field_of_view: float
        ) -> dict[str, object]:
            return {
                "pathId": path_id,
                "typeName": "MonoBehaviour",
                "scriptName": "CinemachineVirtualCamera",
                "tree": {
                    "m_GameObject": pointer(game_object_path_id),
                    "m_Priority": 10,
                    "m_StandbyUpdate": 2,
                    "m_ComponentOwner": pointer(0),
                    "m_Lens": {
                        "FieldOfView": field_of_view,
                        "OrthographicSize": 5.0,
                        "NearClipPlane": 0.3,
                        "FarClipPlane": 1000.0,
                        "Dutch": 0.0,
                        "ModeOverride": 0,
                        "GateFit": 2,
                        "FocusDistance": 10.0,
                        "LensShift": {"x": 0.0, "y": 0.0},
                        "m_SensorSize": {"x": 1.0, "y": 1.0},
                    },
                },
            }

        records = [
            game_object(10, "camera_preset_600000102", [11, 1]),
            transform(11, 10),
            {
                "pathId": 1,
                "typeName": "MonoBehaviour",
                "scriptName": "LevelCameraController",
                "tree": {
                    "m_GameObject": pointer(10),
                    "cameraList": [pointer(2), pointer(3)],
                },
            },
            game_object(20, "TemplateCamera", [21, 2]),
            transform(21, 20, 11),
            {
                "pathId": 2,
                "typeName": "MonoBehaviour",
                "scriptName": "LevelCameraBase",
                "tree": {"m_GameObject": pointer(20), "levelCamera": pointer(4)},
            },
            game_object(30, "TemplateZoningCamera", [31, 3]),
            transform(31, 30, 11),
            {
                "pathId": 3,
                "typeName": "MonoBehaviour",
                "scriptName": "ZoningCamera",
                "tree": {
                    "m_GameObject": pointer(30),
                    "levelCamera": pointer(5),
                    "zoningCollider": pointer(6),
                },
            },
            game_object(40, "Camera_Cut", [41, 4]),
            transform(41, 40, 21, (0.0, 3.74, -10.116617)),
            virtual_camera(4, 40, 40.0),
            game_object(50, "Camera_Ease", [51, 5]),
            transform(51, 50, 31, (2.0, 1.6, -5.116617)),
            virtual_camera(5, 50, 35.0),
            game_object(60, "ZoningCollider", [61, 6]),
            transform(61, 60, 31, (0.0, 0.0, 1.2)),
            {
                "pathId": 6,
                "typeName": "BoxCollider",
                "scriptName": "",
                "tree": {
                    "m_GameObject": pointer(60),
                    "m_Center": {"x": 0, "y": 0, "z": 0},
                    "m_Size": {"x": 1, "y": 2, "z": 3},
                    "m_IsTrigger": 1,
                },
            },
        ]
        profile = camera_presets.extract_camera_preset_records(
            records, "camera_preset_600000102", 6673
        )
        self.assertEqual(profile["cameraListPathIds"], [2, 3])
        self.assertEqual(profile["cameras"][0]["role"], "default")
        self.assertEqual(
            profile["cameras"][0]["virtualCamera"]["lens"]["fieldOfView"],
            40.0,
        )
        self.assertEqual(
            profile["cameras"][0]["virtualCamera"]["transform"]["world"][
                "position"
            ],
            [0.0, 3.74, -10.116617],
        )
        self.assertEqual(profile["cameras"][1]["entryType"], "ZoningCamera")
        self.assertTrue(profile["cameras"][1]["zoningCollider"]["isTrigger"])

        runtime = camera_presets.build_runtime_report(
            {"unityVersion": "2022.3.62f2", "profiles": [profile]}
        )
        self.assertEqual(runtime["profileCount"], 1)
        self.assertEqual(runtime["profiles"][0]["cameraPresetId"], "600000102")
        self.assertEqual(runtime["profiles"][0]["lens"]["fieldOfView"], 40.0)


class ShaderVariantExtractorTests(unittest.TestCase):
    def test_unity_2022_chunk_table_and_keyword_indices_are_exact(self) -> None:
        header = struct.pack(
            "<I" + "III" * 2,
            2,
            0,
            48,
            1,
            48,
            72,
            2,
        )
        self.assertEqual(
            shader_variants.parse_chunk_table(header),
            [
                shader_variants.ChunkEntry(0, 48, 1),
                shader_variants.ChunkEntry(48, 72, 2),
            ],
        )
        self.assertEqual(
            shader_variants.keyword_names([2, 0], ["A", "B", "C"]),
            ["C", "A"],
        )

    def test_chunk_table_rejects_truncated_or_ambiguous_headers(self) -> None:
        with self.assertRaisesRegex(ValueError, "shorter"):
            shader_variants.parse_chunk_table(b"\x00\x00")
        with self.assertRaisesRegex(ValueError, "length mismatch"):
            shader_variants.parse_chunk_table(struct.pack("<I", 1))

    def test_player_resources_chunk_table_accepts_exact_embedded_payload(self) -> None:
        table_end = 4 + 2 * 12
        segment = struct.pack(
            "<I" + "III" * 2,
            2,
            table_end,
            3,
            0,
            table_end + 3,
            2,
            0,
        ) + b"abcde"
        self.assertEqual(
            shader_variants.parse_chunk_table(segment),
            [
                shader_variants.ChunkEntry(table_end, 3, 0),
                shader_variants.ChunkEntry(table_end + 3, 2, 0),
            ],
        )

        ambiguous = bytearray(segment)
        struct.pack_into("<I", ambiguous, 4 + 8, 1)
        with self.assertRaisesRegex(ValueError, "contiguous"):
            shader_variants.parse_chunk_table(bytes(ambiguous))

    def test_compiled_program_payload_preserves_text_and_strips_dxbc_wrapper(self) -> None:
        glsl = b"#ifdef VERTEX\n#version 300 es\nvoid main(){}\n"
        self.assertEqual(
            shader_variants.compiled_program_payload(
                glsl,
                "kShaderGpuProgramGLES31AEP",
            ),
            (glsl, ".glsl", "glsl", 0),
        )

        dxbc = b"DXBC" + bytes(16) + struct.pack("<III", 1, 32, 0)
        wrapper = b"unity-wrapper" + dxbc
        self.assertEqual(
            shader_variants.compiled_program_payload(
                wrapper,
                "kShaderGpuProgramDX11PixelSM40",
            ),
            (dxbc, ".dxbc", "dxbc", len(b"unity-wrapper")),
        )


class StageExporterTests(unittest.TestCase):
    def test_discovers_known_roots_and_packages_fbx_with_textures(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            asset_bundles = root / "gamedata" / "AssetBundles"
            stage_root = asset_bundles / "battle" / "stage"
            stage_root.mkdir(parents=True)
            self.assertEqual(
                stages.find_source_roots(asset_bundles),
                [("battle/stage", stage_root)],
            )

            extracted = root / "assetstudio" / "battle-stage" / "scene"
            extracted.mkdir(parents=True)
            fbx = extracted / "bg_3d_600.fbx"
            fbx.write_bytes(b"FBX fixture")
            (extracted / "albedo.png").write_bytes(b"PNG fixture")
            discovered = stages.discover_stages(root / "assetstudio", None, 0)
            self.assertEqual(len(discovered), 1)

            public_root = root / "public" / "stages"
            record = stages.write_stage_package(discovered[0], public_root, None, 0.01)
            package = public_root / discovered[0].stage_id
            with gzip.open(package / "stage.fbx.gz", "rb") as handle:
                self.assertEqual(handle.read(), b"FBX fixture")
            self.assertEqual((package / "albedo.png").read_bytes(), b"PNG fixture")
            self.assertEqual(record["type"], "fbx")
            self.assertEqual(record["scale"], 0.01)

    def test_stage_ids_are_stable_and_collision_safe(self) -> None:
        used: set[str] = set()
        base = stages.safe_id(r"Battle\Stage\BG_3D_600")
        self.assertEqual(base, "battle-stage-bg-3d-600")
        self.assertEqual(stages.unique_id(base, used), base)
        self.assertEqual(stages.unique_id(base, used), base + "-2")

    def test_scene_profile_manifest_specs_are_explicit_and_bounded(self) -> None:
        stage_id, path = stages.parse_scene_profile_spec(
            "battle-600=fixtures/stage600-closure.json"
        )
        self.assertEqual(stage_id, "battle-600")
        self.assertEqual(path, Path("fixtures/stage600-closure.json"))
        with self.assertRaises(ValueError):
            stages.parse_scene_profile_spec("fixtures/stage600-closure.json")


class SceneProfileTests(unittest.TestCase):
    def test_vlb_1970_player_config_layout_is_exact(self) -> None:
        raw = bytes.fromhex(
            "00000000000000000000000001000000010000007024000000000000"
            "11000000564c42436f6e6669674f766572726964650000000100000006000000"
            "08000000556e746167676564b80b000001000000010000000000000018000000"
            "050000000000003f295c8f3dec51383ecdcc4c3d0a0000004d61696e43616d65"
            "72610000000000001c03000000000000000000001e7000000000000000000000"
            "a701000000000000010000000100000000000000000000000000000000000000"
            "b2070000000000001901000000000000000000008e02000000000000"
        )
        config = scene_profiles.parse_vlb_config_override_raw(raw)
        self.assertEqual(config["pluginVersion"], 1970)
        self.assertEqual(config["renderPipeline"], 1)
        self.assertEqual(config["renderingMode"], 1)
        self.assertEqual(config["geometryRenderQueue"], 3000)
        self.assertEqual(config["sharedMeshSides"], 24)
        self.assertEqual(config["sharedMeshSegments"], 5)
        self.assertTrue(config["featureEnabledDepthBlend"])
        self.assertFalse(config["featureEnabledNoise3D"])
        self.assertEqual(config["dustParticlesPrefab"]["pathID"], 28702)
        self.assertEqual(config["dummyMaterial"]["pathID"], 281)
        self.assertEqual(config["beamShader"]["pathID"], 654)

    def test_renderer_reflection_probe_binding_keeps_usage_and_anchor_world_position(self) -> None:
        anchor = SimpleNamespace(
            m_FileID=0,
            m_PathID=9,
            deref=lambda: SimpleNamespace(
                type=SimpleNamespace(name="Transform"),
                assets_file=SimpleNamespace(name="fixture-cab"),
            ),
            read=lambda: SimpleNamespace(m_Name="Probe Anchor"),
        )
        reader = SimpleNamespace(
            path_id=7,
            type=SimpleNamespace(name="MeshRenderer"),
        )
        renderer = SimpleNamespace(
            m_ReflectionProbeUsage=3,
            m_ProbeAnchor=anchor,
        )
        records, failures = scene_profiles.renderer_reflection_probe_records(
            [(reader, renderer)],
            {7: 1},
            {9: 2},
            lambda go_id: {1: "Root/Renderer", 2: "Root/Probe Anchor"}[go_id],
            lambda transform_id: [
                [1.0, 0.0, 0.0, 10.0],
                [0.0, 1.0, 0.0, 20.0],
                [0.0, 0.0, 1.0, 30.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            {9: {}},
        )
        self.assertEqual(failures, [])
        self.assertEqual(records[0]["reflectionProbeUsage"], 3)
        self.assertEqual(records[0]["reflectionProbeUsageName"], "simple")
        self.assertEqual(records[0]["probeAnchorHierarchyPath"], "Root/Probe Anchor")
        self.assertEqual(records[0]["probeAnchorPosition"], [10.0, 20.0, 30.0])

    def test_untextured_bg_uber_keeps_hdr_emission_and_shader_identity(self) -> None:
        shader_reader = SimpleNamespace(
            type=SimpleNamespace(name="Shader"),
            assets_file=SimpleNamespace(name="shader-cab"),
        )
        shader_pointer = SimpleNamespace(
            m_FileID=1,
            m_PathID=7496099449604649442,
            deref=lambda: shader_reader,
            read=lambda: SimpleNamespace(m_Name="Creative/Bg/BgUberShader"),
        )
        properties = SimpleNamespace(
            m_TexEnvs=[],
            m_Floats=[
                ("_Unlitness", 0.0),
                ("_ZWrite", 1.0),
                ("_FogInfluence", 0.25),
                ("_UseSmoothnessMaskMatcap", 1.0),
            ],
            m_Colors=[
                (
                    "_BaseColor",
                    SimpleNamespace(r=0.5, g=0.4, b=0.3, a=1.0),
                ),
                (
                    "_EmissionColor",
                    SimpleNamespace(r=12.0, g=10.0, b=6.0, a=1.0),
                ),
            ],
        )
        material = SimpleNamespace(
            m_Name="fixture_hdr_light",
            m_CustomRenderQueue=2000,
            m_Shader=shader_pointer,
            m_SavedProperties=properties,
            m_DisabledShaderPasses=[],
            disabledShaderPasses=["SHADOWCASTER"],
            m_ValidKeywords=["_ALPHATEST_ON"],
            m_InvalidKeywords=["_RECEIVE_SHADOWS_OFF"],
            m_ShaderKeywords=None,
        )
        reader = SimpleNamespace(
            type=SimpleNamespace(name="Material"),
            path_id=101,
            read=lambda: material,
        )

        raw, bindings = scene_profiles.material_records([reader], "./fixture")
        self.assertEqual(len(raw), 1)
        self.assertEqual(len(bindings), 1)
        self.assertEqual(bindings[0]["sourceShader"], "Creative/Bg/BgUberShader")
        self.assertEqual(raw[0]["validKeywords"], ["_ALPHATEST_ON"])
        self.assertEqual(raw[0]["disabledShaderPasses"], ["SHADOWCASTER"])
        self.assertEqual(bindings[0]["renderQueue"], 2000)
        self.assertEqual(bindings[0]["validKeywords"], ["_ALPHATEST_ON"])
        self.assertEqual(bindings[0]["invalidKeywords"], ["_RECEIVE_SHADOWS_OFF"])
        self.assertEqual(bindings[0]["alphaTest"], 0.5)
        self.assertFalse(bindings[0]["castShadow"])
        self.assertFalse(bindings[0]["useMatCap"])
        self.assertTrue(bindings[0]["useSmoothnessMaskMatCap"])
        self.assertEqual(bindings[0]["fogInfluence"], 0.25)
        self.assertFalse(bindings[0]["smoothnessFromBaseAlpha"])
        self.assertNotIn("normalPacking", bindings[0])
        self.assertNotIn("base", bindings[0]["textures"])
        self.assertEqual(bindings[0]["emissionColor"], [12.0, 10.0, 6.0, 1.0])

    def test_reflection_probe_world_box_handles_rotation_scale_and_reflection(self) -> None:
        matrix = scene_profiles.transform_matrix(
            [10.0, 20.0, 30.0],
            [0.0, 0.0, math.sqrt(0.5), math.sqrt(0.5)],
            [-2.0, 3.0, 4.0],
        )
        box_min, box_max = scene_profiles.transformed_axis_aligned_box(
            matrix,
            [1.0, 2.0, 3.0],
            [2.0, 4.0, 6.0],
        )
        for actual, expected in zip(box_min, [-2.0, 16.0, 30.0]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip(box_max, [10.0, 20.0, 54.0]):
            self.assertAlmostEqual(actual, expected)

    def test_stage608_local_and_global_reflection_probes_remain_distinct(self) -> None:
        profile_path = (
            ROOT.parents[1]
            / "public"
            / "stages"
            / "official"
            / "battle-608-00-00-001"
            / "scene-profile.json"
        )
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        render_profile = profile["renderProfile"]
        local_probe = render_profile["reflectionProbes"][0]
        self.assertEqual(
            profile["sourceRecords"]["reDriveReflectionProbe"]["pointer"]["pathID"],
            "4939737858652595000",
        )
        self.assertTrue(render_profile["environmentTextureUrl"].endswith("ReflectionProbe-1-bc6h.dds"))
        self.assertEqual(local_probe["id"], "3318311746613360191")
        self.assertTrue(local_probe["textureUrl"].endswith("ReflectionProbe-0-bc6h.dds"))
        self.assertEqual(local_probe["boxMin"], [-35.0, -34.5, -35.0])
        self.assertEqual(local_probe["boxMax"], [35.0, 35.5, 35.0])
        self.assertEqual(local_probe["intensity"], 3.0)

    def test_bc6h_cubemap_dds_preserves_all_face_mip_bytes(self) -> None:
        width = 8
        height = 8
        mip_count = 4
        mip_byte_counts = scene_profiles.bc6h_mip_byte_counts(
            width,
            height,
            mip_count,
        )
        face_chain_size = sum(mip_byte_counts)
        payload = bytes(index % 251 for index in range(face_chain_size * 6))
        dds, actual_mip_byte_counts = scene_profiles.build_bc6h_cubemap_dds(
            payload,
            width,
            height,
            mip_count,
            face_chain_size,
        )
        header = struct.unpack("<37I", dds[:148])
        self.assertEqual(dds[:4], b"DDS ")
        self.assertEqual(header[1], 124)
        self.assertEqual(header[3:5], (height, width))
        self.assertEqual(header[7], mip_count)
        self.assertEqual(header[28], 0xFE00)
        self.assertEqual(header[32], 95)
        self.assertEqual(header[34], 0x4)
        self.assertEqual(actual_mip_byte_counts, mip_byte_counts)
        self.assertEqual(dds[148:], payload)

    def test_bc6h_texture2d_dds_preserves_exact_lightmap_mips(self) -> None:
        self.assertEqual(scene_profiles.UNITY_TEXTURE_FORMAT_BC6H, 24)
        width = 8
        height = 8
        mip_count = 4
        mip_byte_counts = scene_profiles.bc6h_mip_byte_counts(
            width,
            height,
            mip_count,
        )
        payload = bytes(index % 251 for index in range(sum(mip_byte_counts)))
        dds, actual_mip_byte_counts = scene_profiles.build_bc6h_texture2d_dds(
            payload,
            width,
            height,
            mip_count,
        )
        header = struct.unpack("<37I", dds[:148])
        self.assertEqual(dds[:4], b"DDS ")
        self.assertEqual(header[1], 124)
        self.assertEqual(header[3:5], (height, width))
        self.assertEqual(header[7], mip_count)
        self.assertEqual(header[28], 0)
        self.assertEqual(header[32], 95)
        self.assertEqual(header[34], 0)
        self.assertEqual(actual_mip_byte_counts, mip_byte_counts)
        self.assertEqual(dds[148:], payload)

    def test_non_finite_source_values_remain_typed_strict_json(self) -> None:
        records: list[dict[str, str]] = []
        value = scene_profiles.json_safe_numbers(
            {"cameraFade": [0.0, float("inf"), float("-inf"), float("nan")]},
            records=records,
        )
        encoded = json.dumps(value, allow_nan=False)
        decoded = json.loads(encoded)
        self.assertEqual(
            [item["value"] for item in decoded["cameraFade"][1:]],
            ["Infinity", "-Infinity", "NaN"],
        )
        self.assertEqual(
            [record["value"] for record in records],
            ["Infinity", "-Infinity", "NaN"],
        )

    def test_unity_cubemap_face_order_and_orientation(self) -> None:
        # Unity serializes Cubemap image chains in +X,-X,+Y,-Y,+Z,-Z order.
        axes = [
            ((1, 0, 0), (0, 0.0, 0.0)),
            ((-1, 0, 0), (1, 0.0, 0.0)),
            ((0, 1, 0), (2, 0.0, 0.0)),
            ((0, -1, 0), (3, 0.0, 0.0)),
            ((0, 0, 1), (4, 0.0, 0.0)),
            ((0, 0, -1), (5, 0.0, 0.0)),
        ]
        for direction, expected in axes:
            self.assertEqual(
                scene_profiles.cubemap_face_uv(*direction),
                expected,
            )

        # Off-axis fixtures lock the per-face orientation, not only face order.
        self.assertEqual(
            scene_profiles.cubemap_face_uv(1, 0.25, -0.5),
            (0, 0.5, -0.25),
        )
        self.assertEqual(
            scene_profiles.cubemap_face_uv(0.25, 1, -0.5),
            (2, 0.25, -0.5),
        )
        self.assertEqual(
            scene_profiles.cubemap_face_uv(-0.25, 0.5, -1),
            (5, 0.25, -0.5),
        )

    def test_reference_closure_uses_manifest_dependencies_without_staging(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            asset_root = root / "AssetBundles"
            target = asset_root / "battle" / "stage" / "scene"
            dependency = asset_root / "shader" / "bg"
            target.parent.mkdir(parents=True)
            dependency.parent.mkdir(parents=True)
            target.write_bytes(b"scene")
            dependency.write_bytes(b"shader")
            dump = root / "AssetBundleManifest.txt"
            dump.write_text(
                "\n".join(
                    [
                        "map AssetBundleNames",
                        " int first = 10",
                        ' string second = "battle/stage/scene"',
                        " int first = 20",
                        ' string second = "shader/bg"',
                        "map AssetBundleInfos",
                        " int first = 10",
                        " int data = 20",
                        " int first = 20",
                    ]
                ),
                encoding="utf-8",
            )
            closure = scene_closures.build_reference_manifest(
                "battle/stage/scene",
                dump,
                asset_root,
                "2022.3.fixture",
            )
            self.assertEqual(closure["mode"], "read-only-source-reference")
            self.assertEqual([item["manifestKey"] for item in closure["files"]], [10, 20])
            self.assertTrue(all("staged" not in item for item in closure["files"]))
            self.assertEqual(
                scene_profiles.manifest_file_paths(closure),
                [target, dependency],
            )

    def test_catalog_package_location_drives_profile_url_without_stage_rules(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            public_root = Path(raw) / "public"
            package, prefix = scene_profile_sync.package_location(
                {
                    "id": "any-scene",
                    "url": "./stages/official/any-scene/model.fbxdata",
                },
                public_root,
            )
            self.assertEqual(
                package,
                public_root / "stages" / "official" / "any-scene",
            )
            self.assertEqual(prefix, "./stages/official/any-scene")

    def test_catalog_sync_includes_external_entry_documents(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            public = Path(raw) / "public"
            entry_path = public / "stages" / "catalog" / "external.json"
            entry_path.parent.mkdir(parents=True)
            entry_path.write_text(
                '{"id":"external","assetBundleName":"battle/stage/external"}',
                encoding="utf-8",
            )
            catalog_path = public / "stages" / "catalog.json"
            catalog_path.write_text(
                '{"entries":["./stages/catalog/external.json"],'
                '"stages":[{"id":"inline","assetBundleName":"battle/stage/inline"}]}',
                encoding="utf-8",
            )
            _, targets = scene_profile_sync.catalog_stage_targets(
                catalog_path,
                public,
            )
            self.assertEqual([target[0]["id"] for target in targets], ["inline", "external"])
            self.assertEqual(targets[0][1], catalog_path)
            self.assertEqual(targets[1][1], entry_path)

    def test_volume_stack_follows_override_states_and_priority(self) -> None:
        volumes = [
            {
                "pathID": 1,
                "priority": 0,
                "enabled": True,
                "activeInHierarchy": True,
                "isGlobal": True,
                "weight": 1,
                "profilePathID": 10,
            },
            {
                "pathID": 2,
                "priority": 5,
                "enabled": True,
                "activeInHierarchy": True,
                "isGlobal": True,
                "weight": 1,
                "profilePathID": 20,
            },
        ]
        components = {
            100: (
                "ColorAdjustments",
                {
                    "active": 1,
                    "contrast": {"m_OverrideState": 1, "m_Value": 10},
                    "saturation": {"m_OverrideState": 1, "m_Value": 5},
                },
            ),
            200: (
                "ColorAdjustments",
                {
                    "active": 1,
                    "contrast": {"m_OverrideState": 0, "m_Value": 99},
                    "saturation": {"m_OverrideState": 1, "m_Value": 15},
                },
            ),
        }
        resolved, trace = scene_profiles.resolved_volume_components(
            volumes,
            {10: [100], 20: [200]},
            components,
        )
        self.assertEqual(resolved["ColorAdjustments"]["contrast"]["m_Value"], 10)
        self.assertEqual(resolved["ColorAdjustments"]["saturation"]["m_Value"], 15)
        self.assertEqual([item["pathID"] for item in trace], [1, 2])

    def test_stage_layer_and_sh_are_data_driven(self) -> None:
        lights = [
            {"role": "background", "cullingMask": 64},
            {"role": "background", "cullingMask": 64},
            {"role": "character-key", "cullingMask": 0x7FFFFFFF},
        ]
        self.assertEqual(scene_profiles.infer_stage_layer(lights, [0, 6]), 6)
        values = {f"sh[{index:2d}]": float(index) for index in range(27)}
        self.assertEqual(scene_profiles.sh_coefficients(values), list(map(float, range(27))))

    def test_lightmap_bindings_offset_each_prefab_local_index(self) -> None:
        def renderer(path_id: int, index: int, offset: tuple[float, ...]):
            return SimpleNamespace(
                renderer=SimpleNamespace(m_PathID=path_id),
                lightmapIndex=index,
                lightmapOffsetScale=offset,
            )

        sources = [
            SimpleNamespace(
                m_Lightmaps=[object(), object()],
                m_RendererInfo=[renderer(100, 1, (0.5, 0.5, 0.25, 0.25))],
            ),
            SimpleNamespace(
                m_Lightmaps=[object()],
                m_RendererInfo=[renderer(200, 0, (1.0, 1.0, 0.0, 0.0))],
            ),
        ]
        document, failures = scene_profiles.build_lightmap_binding_document(
            sources,
            {100: 10, 200: 20},
            lambda go_id: f"scene/renderer-{go_id}",
            "battle/stage/fixture",
        )
        self.assertEqual(failures, [])
        self.assertEqual(
            [item["lightmapIndex"] for item in document["renderers"]],
            [1, 2],
        )
        self.assertEqual(
            document["renderers"][0]["lightmapScaleOffset"],
            [0.5, 0.5, 0.25, 0.25],
        )

    def test_existing_lightmaps_must_form_a_contiguous_ordered_set(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "Lightmap-0_comp_light.png").write_bytes(b"zero")
            (root / "Lightmap-2_comp_light.png").write_bytes(b"two")
            self.assertEqual(scene_profiles.existing_lightmap_urls(root, "."), [])
            (root / "Lightmap-1-comp-light.png").write_bytes(b"one")
            self.assertEqual(
                scene_profiles.existing_lightmap_urls(root, "./fixture"),
                [
                    "./fixture/Lightmap-0_comp_light.png",
                    "./fixture/Lightmap-1-comp-light.png",
                    "./fixture/Lightmap-2_comp_light.png",
                ],
            )


class FakeCubemap:
    path_id = 77
    type = SimpleNamespace(name="Cubemap")
    assets_file = SimpleNamespace(name="scene.bundle")

    def peek_name(self):
        return "Scene/Cubemap"

    def parse_as_object(self):
        raise RuntimeError("fixture decoder unavailable")

    def get_raw_data(self):
        return b"serialized cubemap fixture"

    def parse_as_dict(self):
        return {"m_Name": "Scene/Cubemap", "m_Width": 4, "m_Height": 4}


class CubemapExtractorTests(unittest.TestCase):
    def test_raw_only_fallback_preserves_payload_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            record = cubemaps.extract_cubemap(FakeCubemap(), root)
            destination = root / record["directory"]
            self.assertEqual(record["source"], "scene.bundle")
            self.assertEqual(record["pathId"], 77)
            self.assertEqual(record["type"], "Cubemap")
            self.assertEqual(record["decoded"]["mode"], "raw-only")
            self.assertEqual(
                (destination / "serialized-object.bin").read_bytes(),
                b"serialized cubemap fixture",
            )
            self.assertEqual(record["raw"]["byteCount"], 26)
            self.assertEqual(len(record["raw"]["sha256"]), 64)
            self.assertTrue((destination / "typetree.json").is_file())
            self.assertTrue((destination / "cubemap.json").is_file())

    def test_pointer_summary_and_cross_file_resolution_contract(self) -> None:
        target = object()
        pointer = SimpleNamespace(m_FileID=3, m_PathID=91, deref=lambda: target)
        self.assertIs(cubemaps.pointer_target(pointer), target)
        self.assertEqual(cubemaps.pptr_summary(pointer), {"fileID": 3, "pathID": 91})


if __name__ == "__main__":
    unittest.main(verbosity=2)
