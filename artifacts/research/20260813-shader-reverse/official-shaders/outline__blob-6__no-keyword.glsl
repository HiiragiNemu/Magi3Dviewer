#ifdef VERTEX
#version 300 es

#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 1
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
uniform 	vec4 _ProjectionParams;
uniform 	vec4 unity_OrthoParams;
uniform 	vec4 hlslcc_mtx4x4glstate_matrix_projection[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixV[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixVP[4];
uniform 	float _CurrentCameraFOV;
uniform 	float _GlobalCharacterCancelPerspective;
uniform 	mediump float IsKageWitchBg;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
UNITY_BINDING(0) uniform UnityPerDraw {
#endif
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_ObjectToWorld[4];
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_WorldToObject[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_LODFade;
	UNITY_UNIFORM mediump vec4                unity_WorldTransformParams;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RenderingLayer;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_LightData;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_LightIndices[2];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_ProbesOcclusion;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SpecCube0_HDR;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SpecCube1_HDR;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube0_BoxMax;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube0_BoxMin;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube0_ProbePosition;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMax;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMin;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_ProbePosition;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_LightmapST;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_DynamicLightmapST;
	UNITY_UNIFORM mediump vec4                unity_SHAr;
	UNITY_UNIFORM mediump vec4                unity_SHAg;
	UNITY_UNIFORM mediump vec4                unity_SHAb;
	UNITY_UNIFORM mediump vec4                unity_SHBr;
	UNITY_UNIFORM mediump vec4                unity_SHBg;
	UNITY_UNIFORM mediump vec4                unity_SHBb;
	UNITY_UNIFORM mediump vec4                unity_SHC;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RendererBounds_Min;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RendererBounds_Max;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXhlslcc_mtx4x4unity_MatrixPreviousM[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXhlslcc_mtx4x4unity_MatrixPreviousMI[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_MotionVectorsParams;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
};
#endif
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
UNITY_BINDING(1) uniform UnityPerMaterial {
#endif
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ReceiveSelfShadow;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CastSelfShadow;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseRimLight;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseDepthTex;
	UNITY_UNIFORM mediump float                _UseOutline;
	UNITY_UNIFORM mediump float                _UseBakedNormal;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsHair;
	UNITY_UNIFORM mediump float                _AlphaClipping;
	UNITY_UNIFORM mediump float                _Transparency;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_YuugenHighlight;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsMainTarget;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsWhiteSelectionOutline;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsEnemy;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShouldApplyFaceAdditional;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsAlphaAdditive;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedX_BaseColor;
	UNITY_UNIFORM mediump vec4                _ShadowColor;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_EmissionColor;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedX_RimLightColor;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedX_CheekColor;
	UNITY_UNIFORM mediump vec4                _OutlineColor;
	UNITY_UNIFORM mediump vec4                _OutlineEmissionColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShadowOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShadowFeather;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShadowOffsetMapOffset;
	UNITY_UNIFORM mediump float                _OutlineWidth;
	UNITY_UNIFORM mediump float                _OutlineTexBlend;
	UNITY_UNIFORM mediump float                _OutlineZOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_HighlightThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_HighlightRotation;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ZOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthTexWidth;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthTexYOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthRimLightDiffThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthShadowDiffThreshold;
	UNITY_UNIFORM mediump float                _FaceOutlineAdjust;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FaceAreaCameraDepthTextureZWriteOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CheekValue;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FaceShadowGradientMapYOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_NoseShadowGradientMapYOffset;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_FaceForwardDirection;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_FaceUpDirection;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_FaceRightDirection;
	UNITY_UNIFORM vec3                _FacePositionWS;
	UNITY_UNIFORM float                _DitherFade;
	UNITY_UNIFORM float                _CharacterCancelPerspective;
	UNITY_UNIFORM float Xhlslcc_UnusedX_Debug;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_FillColor;
	UNITY_UNIFORM float Xhlslcc_UnusedX_AdditionalLightInfluenceByLuminance;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseMatCap;
	UNITY_UNIFORM float Xhlslcc_UnusedX_MatCapIntensity;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_MaskMatcapSpecular;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_MaskMatcapMetallic;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseGemDepthDiff;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_GemDepthDiffThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_GemHeightCorrection;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem1stShadSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem2ndShadSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_GemRimFresnel;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem1stHighlightSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem2ndHighlightSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsAniso;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_AnisoMaskByMetallic;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_AnisoColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_AnisoThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_AnisoFeather;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseFresnel;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FresnelMaskByMetallic;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_FresnelColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FresnelThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FresnelFeather;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsCosmic;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicMaskByCtrlA;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsScreenBaseMap;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicGetShadowTex;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_CosmicShadowTintColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicGetShadowTint;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosBaseMapTilling;
	UNITY_UNIFORM mediump vec2 Xhlslcc_UnusedX_CosBaseMapScroll;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicTilling;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicNoiseInfluence;
	UNITY_UNIFORM mediump vec2 Xhlslcc_UnusedX_CosmicScroll;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicNoiseTilling;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicNoiseSpeed;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsCosmicOverlay;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicApplyAmbientLighting;
	UNITY_UNIFORM mediump float                _IsDissolve;
	UNITY_UNIFORM mediump float                _DissolveTilling;
	UNITY_UNIFORM mediump vec2                _DissolveScroll;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_StencilTransparency;
	UNITY_UNIFORM float Xhlslcc_UnusedX_Cutoff;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
};
#endif
in highp vec4 in_POSITION0;
in highp vec3 in_NORMAL0;
in highp vec4 in_TANGENT0;
in mediump vec4 in_COLOR0;
in highp vec2 in_TEXCOORD0;
in highp vec3 in_TEXCOORD3;
out highp vec2 vs_TEXCOORD0;
highp  vec4 phase0_Output0_1;
out highp float vs_TEXCOORD1;
out highp vec3 vs_TEXCOORD2;
out highp vec3 vs_TEXCOORD3;
vec3 u_xlat0;
int u_xlati0;
vec3 u_xlat1;
bool u_xlatb1;
vec4 u_xlat2;
mediump vec3 u_xlat16_2;
vec4 u_xlat3;
vec4 u_xlat4;
bool u_xlatb4;
vec4 u_xlat5;
bool u_xlatb6;
float u_xlat10;
float u_xlat15;
float u_xlat16;
float u_xlat18;
bool u_xlatb18;
float u_xlat19;
bool u_xlatb19;
mediump float u_xlat16_20;
float u_xlat21;
bool u_xlatb21;
int op_not(int value) { return -value - 1; }
ivec2 op_not(ivec2 a) { a.x = op_not(a.x); a.y = op_not(a.y); return a; }
ivec3 op_not(ivec3 a) { a.x = op_not(a.x); a.y = op_not(a.y); a.z = op_not(a.z); return a; }
ivec4 op_not(ivec4 a) { a.x = op_not(a.x); a.y = op_not(a.y); a.z = op_not(a.z); a.w = op_not(a.w); return a; }

void main()
{
    u_xlati0 = int((vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseOutline)) ? 0xFFFFFFFFu : uint(0));
    u_xlati0 = op_not(u_xlati0);
    u_xlatb6 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_Transparency);
    u_xlati0 = int(uint((uint(u_xlatb6) * 0xffffffffu) | uint(u_xlati0)));
    if(u_xlati0 != 0) {
        gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
        phase0_Output0_1.xyz = vec3(0.0, 0.0, 0.0);
        vs_TEXCOORD2.xyz = vec3(0.0, 0.0, 0.0);
        vs_TEXCOORD3.xyz = vec3(0.0, 0.0, 0.0);
vs_TEXCOORD0 = phase0_Output0_1.xy;
vs_TEXCOORD1 = phase0_Output0_1.z;
        return;
    }
    u_xlat0.xyz = in_POSITION0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * in_POSITION0.xxx + u_xlat0.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * in_POSITION0.zzz + u_xlat0.xyz;
    u_xlat0.xyz = u_xlat0.xyz + hlslcc_mtx4x4unity_ObjectToWorld[3].xyz;
    u_xlat18 = u_xlat0.y * hlslcc_mtx4x4unity_MatrixV[1].z;
    u_xlat18 = hlslcc_mtx4x4unity_MatrixV[0].z * u_xlat0.x + u_xlat18;
    u_xlat18 = hlslcc_mtx4x4unity_MatrixV[2].z * u_xlat0.z + u_xlat18;
    u_xlat18 = u_xlat18 + hlslcc_mtx4x4unity_MatrixV[3].z;
    u_xlatb1 = unity_WorldTransformParams.w>=0.0;
    u_xlat1.x = (u_xlatb1) ? 1.0 : -1.0;
    u_xlat16_2.x = u_xlat1.x * in_TANGENT0.w;
    u_xlat1.x = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[0].xyz);
    u_xlat1.y = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[1].xyz);
    u_xlat1.z = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[2].xyz);
    u_xlat19 = dot(u_xlat1.xyz, u_xlat1.xyz);
    u_xlat19 = max(u_xlat19, 1.17549435e-38);
    u_xlat19 = inversesqrt(u_xlat19);
    u_xlat1.xyz = vec3(u_xlat19) * u_xlat1.xyz;
    u_xlat3.xyz = in_TANGENT0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat3.xyz = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * in_TANGENT0.xxx + u_xlat3.xyz;
    u_xlat3.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * in_TANGENT0.zzz + u_xlat3.xyz;
    u_xlat19 = dot(u_xlat3.xyz, u_xlat3.xyz);
    u_xlat19 = max(u_xlat19, 1.17549435e-38);
    u_xlat19 = inversesqrt(u_xlat19);
    u_xlat3.xyz = vec3(u_xlat19) * u_xlat3.xyz;
    u_xlat4.xyz = u_xlat1.zxy * u_xlat3.yzx;
    u_xlat4.xyz = u_xlat1.yzx * u_xlat3.zxy + (-u_xlat4.xyz);
    u_xlat16_2.xyz = u_xlat16_2.xxx * u_xlat4.xyz;
    u_xlat16_20 = _OutlineWidth * 0.00999999978;
    u_xlatb19 = unity_OrthoParams.w==0.0;
    u_xlat21 = 60.0 / _CurrentCameraFOV;
    u_xlat18 = min(abs(u_xlat18), u_xlat21);
    u_xlat18 = u_xlat18 * _CurrentCameraFOV;
    u_xlat21 = min(abs(unity_OrthoParams.y), 0.5);
    u_xlat21 = u_xlat21 * 100.0;
    u_xlat18 = (u_xlatb19) ? u_xlat18 : u_xlat21;
    u_xlat18 = u_xlat18 * 0.00300000003;
    u_xlat18 = u_xlat18 * u_xlat16_20;
    u_xlatb21 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(IsKageWitchBg);
    u_xlat4.x = u_xlat0.y * 0.0659999996 + _OutlineZOffset;
    u_xlat16_20 = (u_xlatb21) ? u_xlat4.x : _OutlineZOffset;
    u_xlatb21 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseBakedNormal);
    u_xlat4.xyz = u_xlat16_2.xyz * in_TEXCOORD3.yyy;
    u_xlat3.xyz = in_TEXCOORD3.xxx * u_xlat3.xyz + u_xlat4.xyz;
    u_xlat3.xyz = in_TEXCOORD3.zzz * u_xlat1.xyz + u_xlat3.xyz;
    u_xlat4.x = dot(u_xlat3.xyz, u_xlat3.xyz);
    u_xlat4.x = inversesqrt(u_xlat4.x);
    u_xlat3.xyz = u_xlat3.xyz * u_xlat4.xxx;
    u_xlat3.xyz = vec3(u_xlat18) * u_xlat3.xyz;
    u_xlat3.xyz = u_xlat3.xyz * in_COLOR0.xxx + u_xlat0.xyz;
    u_xlat4 = u_xlat3.yyyy * hlslcc_mtx4x4unity_MatrixVP[1];
    u_xlat4 = hlslcc_mtx4x4unity_MatrixVP[0] * u_xlat3.xxxx + u_xlat4;
    u_xlat4 = hlslcc_mtx4x4unity_MatrixVP[2] * u_xlat3.zzzz + u_xlat4;
    u_xlat4 = u_xlat4 + hlslcc_mtx4x4unity_MatrixVP[3];
    u_xlat3.xyz = vec3(u_xlat18) * u_xlat1.xyz;
    u_xlat3.xyz = u_xlat3.xyz * in_COLOR0.xxx + u_xlat0.xyz;
    u_xlat5 = u_xlat3.yyyy * hlslcc_mtx4x4unity_MatrixVP[1];
    u_xlat5 = hlslcc_mtx4x4unity_MatrixVP[0] * u_xlat3.xxxx + u_xlat5;
    u_xlat5 = hlslcc_mtx4x4unity_MatrixVP[2] * u_xlat3.zzzz + u_xlat5;
    u_xlat5 = u_xlat5 + hlslcc_mtx4x4unity_MatrixVP[3];
    u_xlat3 = (bool(u_xlatb21)) ? u_xlat4 : u_xlat5;
    u_xlat16_2.x = in_COLOR0.z;
    u_xlat16_2.x = clamp(u_xlat16_2.x, 0.0, 1.0);
    u_xlat16_2.x = u_xlat16_2.x * _FaceOutlineAdjust + u_xlat16_20;
    u_xlatb18 = u_xlat16_2.x!=0.0;
    u_xlatb4 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(unity_OrthoParams.w);
    u_xlat10 = (-_ProjectionParams.y) + _ProjectionParams.z;
    u_xlat10 = (-u_xlat16_2.x) / u_xlat10;
    u_xlat5.z = u_xlat10 * -2.0 + u_xlat3.z;
    u_xlat10 = _ProjectionParams.y + 5.96046448e-08;
    u_xlat16 = u_xlat16_2.x + abs(u_xlat3.w);
    u_xlat10 = max(u_xlat16, u_xlat10);
    u_xlat16 = (-u_xlat10) * hlslcc_mtx4x4glstate_matrix_projection[2].z + hlslcc_mtx4x4glstate_matrix_projection[3].z;
    u_xlat16 = u_xlat3.w * u_xlat16;
    u_xlat2.z = u_xlat16 / u_xlat10;
    u_xlat5.xyw = u_xlat3.xyw;
    u_xlat2.xyw = u_xlat5.xyw;
    u_xlat2 = (bool(u_xlatb4)) ? u_xlat5 : u_xlat2;
    u_xlat2 = (bool(u_xlatb18)) ? u_xlat2 : u_xlat3;
    u_xlat3.xy = abs(u_xlat2.ww) * u_xlat2.xy;
    u_xlat18 = hlslcc_mtx4x4unity_MatrixV[1].z * _FacePositionWS.y;
    u_xlat18 = hlslcc_mtx4x4unity_MatrixV[0].z * _FacePositionWS.x + u_xlat18;
    u_xlat18 = hlslcc_mtx4x4unity_MatrixV[2].z * _FacePositionWS.z + u_xlat18;
    u_xlat18 = u_xlat18 + hlslcc_mtx4x4unity_MatrixV[3].z;
    u_xlat18 = float(1.0) / float(abs(u_xlat18));
    u_xlat15 = _GlobalCharacterCancelPerspective * _CharacterCancelPerspective;
    u_xlat21 = u_xlat0.y;
    u_xlat21 = clamp(u_xlat21, 0.0, 1.0);
    u_xlat15 = u_xlat21 * u_xlat15;
    u_xlat4.xyz = (-u_xlat0.xyz) + _FacePositionWS.xyz;
    u_xlat21 = dot(u_xlat4.xyz, u_xlat4.xyz);
    u_xlat21 = sqrt(u_xlat21);
    u_xlat21 = (-u_xlat21) * 2.25 + 1.0;
    u_xlat21 = max(u_xlat21, 0.0);
    u_xlat15 = u_xlat21 * u_xlat15;
    u_xlat3.xy = u_xlat3.xy * vec2(u_xlat18) + (-u_xlat2.xy);
    u_xlat3.xy = vec2(u_xlat15) * u_xlat3.xy + u_xlat2.xy;
    gl_Position.xy = (bool(u_xlatb19)) ? u_xlat3.xy : u_xlat2.xy;
    gl_Position.zw = u_xlat2.zw;
    phase0_Output0_1.xy = in_TEXCOORD0.xy;
    phase0_Output0_1.z = 0.0;
    vs_TEXCOORD2.xyz = u_xlat0.xyz;
    vs_TEXCOORD3.xyz = u_xlat1.xyz;
vs_TEXCOORD0 = phase0_Output0_1.xy;
vs_TEXCOORD1 = phase0_Output0_1.z;
    return;
}

#endif
#ifdef FRAGMENT
#version 300 es

precision highp float;
precision highp int;
#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 1
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
vec4 ImmCB_0[16];
uniform 	vec4 _ScaledScreenParams;
uniform 	vec2 _GlobalMipBias;
uniform 	mediump vec4 _MainLightColor;
uniform 	vec4 _Time;
uniform 	vec4 _ScreenParams;
uniform 	mediump vec3 _GlobalCharacterTintColor;
uniform 	mediump float IsKageWitchBg;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
UNITY_BINDING(0) uniform UnityPerDraw {
#endif
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_ObjectToWorld[4];
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_WorldToObject[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_LODFade;
	UNITY_UNIFORM mediump vec4                unity_WorldTransformParams;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RenderingLayer;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_LightData;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_LightIndices[2];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_ProbesOcclusion;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SpecCube0_HDR;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SpecCube1_HDR;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube0_BoxMax;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube0_BoxMin;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube0_ProbePosition;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMax;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMin;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_ProbePosition;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_LightmapST;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_DynamicLightmapST;
	UNITY_UNIFORM mediump vec4                unity_SHAr;
	UNITY_UNIFORM mediump vec4                unity_SHAg;
	UNITY_UNIFORM mediump vec4                unity_SHAb;
	UNITY_UNIFORM mediump vec4                unity_SHBr;
	UNITY_UNIFORM mediump vec4                unity_SHBg;
	UNITY_UNIFORM mediump vec4                unity_SHBb;
	UNITY_UNIFORM mediump vec4                unity_SHC;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RendererBounds_Min;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RendererBounds_Max;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXhlslcc_mtx4x4unity_MatrixPreviousM[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXhlslcc_mtx4x4unity_MatrixPreviousMI[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_MotionVectorsParams;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
};
#endif
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
UNITY_BINDING(1) uniform UnityPerMaterial {
#endif
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ReceiveSelfShadow;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CastSelfShadow;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseRimLight;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseDepthTex;
	UNITY_UNIFORM mediump float                _UseOutline;
	UNITY_UNIFORM mediump float                _UseBakedNormal;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsHair;
	UNITY_UNIFORM mediump float                _AlphaClipping;
	UNITY_UNIFORM mediump float                _Transparency;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_YuugenHighlight;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsMainTarget;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsWhiteSelectionOutline;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsEnemy;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShouldApplyFaceAdditional;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsAlphaAdditive;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedX_BaseColor;
	UNITY_UNIFORM mediump vec4                _ShadowColor;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_EmissionColor;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedX_RimLightColor;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedX_CheekColor;
	UNITY_UNIFORM mediump vec4                _OutlineColor;
	UNITY_UNIFORM mediump vec4                _OutlineEmissionColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShadowOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShadowFeather;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ShadowOffsetMapOffset;
	UNITY_UNIFORM mediump float                _OutlineWidth;
	UNITY_UNIFORM mediump float                _OutlineTexBlend;
	UNITY_UNIFORM mediump float                _OutlineZOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_HighlightThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_HighlightRotation;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_ZOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthTexWidth;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthTexYOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthRimLightDiffThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_DepthShadowDiffThreshold;
	UNITY_UNIFORM mediump float                _FaceOutlineAdjust;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FaceAreaCameraDepthTextureZWriteOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CheekValue;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FaceShadowGradientMapYOffset;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_NoseShadowGradientMapYOffset;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_FaceForwardDirection;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_FaceUpDirection;
	UNITY_UNIFORM vec3 Xhlslcc_UnusedX_FaceRightDirection;
	UNITY_UNIFORM vec3                _FacePositionWS;
	UNITY_UNIFORM float                _DitherFade;
	UNITY_UNIFORM float                _CharacterCancelPerspective;
	UNITY_UNIFORM float Xhlslcc_UnusedX_Debug;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_FillColor;
	UNITY_UNIFORM float Xhlslcc_UnusedX_AdditionalLightInfluenceByLuminance;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseMatCap;
	UNITY_UNIFORM float Xhlslcc_UnusedX_MatCapIntensity;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_MaskMatcapSpecular;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_MaskMatcapMetallic;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseGemDepthDiff;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_GemDepthDiffThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_GemHeightCorrection;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem1stShadSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem2ndShadSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_GemRimFresnel;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem1stHighlightSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_Gem2ndHighlightSize;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsAniso;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_AnisoMaskByMetallic;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_AnisoColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_AnisoThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_AnisoFeather;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_UseFresnel;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FresnelMaskByMetallic;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_FresnelColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FresnelThreshold;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_FresnelFeather;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsCosmic;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicMaskByCtrlA;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsScreenBaseMap;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicGetShadowTex;
	UNITY_UNIFORM mediump vec3 Xhlslcc_UnusedX_CosmicShadowTintColor;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicGetShadowTint;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosBaseMapTilling;
	UNITY_UNIFORM mediump vec2 Xhlslcc_UnusedX_CosBaseMapScroll;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicTilling;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicNoiseInfluence;
	UNITY_UNIFORM mediump vec2 Xhlslcc_UnusedX_CosmicScroll;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicNoiseTilling;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicNoiseSpeed;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_IsCosmicOverlay;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_CosmicApplyAmbientLighting;
	UNITY_UNIFORM mediump float                _IsDissolve;
	UNITY_UNIFORM mediump float                _DissolveTilling;
	UNITY_UNIFORM mediump vec2                _DissolveScroll;
	UNITY_UNIFORM mediump float Xhlslcc_UnusedX_StencilTransparency;
	UNITY_UNIFORM float Xhlslcc_UnusedX_Cutoff;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
};
#endif
UNITY_LOCATION(0) uniform mediump sampler2D _ShadowTex;
UNITY_LOCATION(1) uniform mediump sampler2D _DissolveTex;
in highp vec2 vs_TEXCOORD0;
in highp vec3 vs_TEXCOORD3;
layout(location = 0) out highp vec4 SV_Target0;
vec4 u_xlat0;
mediump vec4 u_xlat16_0;
vec3 u_xlat1;
uvec2 u_xlatu1;
mediump vec3 u_xlat16_2;
mediump vec3 u_xlat16_3;
mediump vec3 u_xlat16_4;
mediump float u_xlat16_7;
vec2 u_xlat11;
mediump float u_xlat16_11;
bool u_xlatb11;
float u_xlat15;
int u_xlati15;
bool u_xlatb15;
mediump float u_xlat16_17;
int int_bitfieldInsert(int base, int insert, int offset, int bits) {
    uint mask = uint(~(int(~0) << uint(bits)) << uint(offset));
    return int((uint(base) & ~mask) | ((uint(insert) << uint(offset)) & mask));
}

void main()
{
ImmCB_0[0] = vec4(0.0588235296,0.0,0.0,0.0);
ImmCB_0[1] = vec4(0.529411793,0.0,0.0,0.0);
ImmCB_0[2] = vec4(0.176470593,0.0,0.0,0.0);
ImmCB_0[3] = vec4(0.647058845,0.0,0.0,0.0);
ImmCB_0[4] = vec4(0.764705896,0.0,0.0,0.0);
ImmCB_0[5] = vec4(0.294117659,0.0,0.0,0.0);
ImmCB_0[6] = vec4(0.882352948,0.0,0.0,0.0);
ImmCB_0[7] = vec4(0.411764711,0.0,0.0,0.0);
ImmCB_0[8] = vec4(0.235294119,0.0,0.0,0.0);
ImmCB_0[9] = vec4(0.70588237,0.0,0.0,0.0);
ImmCB_0[10] = vec4(0.117647059,0.0,0.0,0.0);
ImmCB_0[11] = vec4(0.588235319,0.0,0.0,0.0);
ImmCB_0[12] = vec4(0.941176474,0.0,0.0,0.0);
ImmCB_0[13] = vec4(0.470588237,0.0,0.0,0.0);
ImmCB_0[14] = vec4(0.823529422,0.0,0.0,0.0);
ImmCB_0[15] = vec4(0.352941185,0.0,0.0,0.0);
vec4 hlslcc_FragCoord = vec4(gl_FragCoord.xyz, 1.0/gl_FragCoord.w);
    u_xlat16_0 = texture(_ShadowTex, vs_TEXCOORD0.xy, _GlobalMipBias.x);
    u_xlat1.xy = hlslcc_FragCoord.xy / _ScaledScreenParams.xy;
    u_xlatb11 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_AlphaClipping);
    if(u_xlatb11){
        u_xlat11.xy = _Time.yy * vec2(_DissolveScroll.x, _DissolveScroll.y);
        u_xlat11.xy = vec2(vec2(_DissolveTilling, _DissolveTilling)) * vs_TEXCOORD0.xy + u_xlat11.xy;
        u_xlat11.xy = fract(u_xlat11.xy);
        u_xlat16_2.x = u_xlat16_0.w * _ShadowColor.w;
        u_xlat16_11 = texture(_DissolveTex, u_xlat11.xy, _GlobalMipBias.x).x;
        u_xlat16_7 = _IsDissolve * 0.5;
        u_xlat11.x = (-u_xlat16_11) + 1.0;
        u_xlat15 = (-u_xlat16_0.w) * _ShadowColor.w + 1.0;
        u_xlat15 = (-u_xlat11.x) * u_xlat15 + (-u_xlat16_2.x);
        u_xlat15 = u_xlat15 + 1.0;
        u_xlat15 = u_xlat16_7 * u_xlat15 + u_xlat16_2.x;
        u_xlat16_2.x = u_xlat15 + -0.5;
        u_xlatb15 = u_xlat16_2.x<0.0;
        if(u_xlatb15){discard;}
    }
    u_xlat1.xy = u_xlat1.xy * _ScreenParams.xy;
    u_xlatu1.xy = uvec2(u_xlat1.xy);
    u_xlati15 = int(int_bitfieldInsert(0, int(u_xlatu1.x), 2 & int(0x1F), 2));
    u_xlati15 = int(int_bitfieldInsert(u_xlati15, int(u_xlatu1.y), 0 & int(0x1F), 2));
    u_xlat15 = 0.5 + (-ImmCB_0[u_xlati15].x);
    u_xlat15 = _DitherFade * u_xlat15 + 0.5;
    u_xlat1.x = (-_DitherFade) + 1.0;
    u_xlat15 = (-u_xlat15) + u_xlat1.x;
    u_xlatb15 = u_xlat15<0.0;
    if(u_xlatb15){discard;}
    u_xlatb15 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(IsKageWitchBg);
    if(u_xlatb15){
        u_xlat16_2.x = dot(_OutlineEmissionColor.xyz, vec3(0.298911989, 0.586610973, 0.114478));
        u_xlat16_2.x = clamp(u_xlat16_2.x, 0.0, 1.0);
        u_xlat1.xyz = max(_OutlineEmissionColor.xyz, vec3(0.00100000005, 0.00100000005, 0.00100000005));
        u_xlat15 = dot(u_xlat1.xyz, u_xlat1.xyz);
        u_xlat15 = inversesqrt(u_xlat15);
        u_xlat1.xyz = vec3(u_xlat15) * u_xlat1.xyz;
        SV_Target0.xyz = u_xlat1.xyz * u_xlat16_2.xxx + vec3(1.0, 1.0, 1.0);
        SV_Target0.w = 1.0;
        return;
    } else {
        u_xlat16_2.xyz = u_xlat16_0.xyz * _ShadowColor.xyz + (-_OutlineColor.xyz);
        u_xlat16_2.xyz = vec3(_OutlineTexBlend) * u_xlat16_2.xyz + _OutlineColor.xyz;
        u_xlat0.xyz = vs_TEXCOORD3.xyz;
        u_xlat0.w = 1.0;
        u_xlat16_3.x = dot(unity_SHAr, u_xlat0);
        u_xlat16_3.y = dot(unity_SHAg, u_xlat0);
        u_xlat16_3.z = dot(unity_SHAb, u_xlat0);
        u_xlat16_0 = vs_TEXCOORD3.yzzx * vs_TEXCOORD3.xyzz;
        u_xlat16_4.x = dot(unity_SHBr, u_xlat16_0);
        u_xlat16_4.y = dot(unity_SHBg, u_xlat16_0);
        u_xlat16_4.z = dot(unity_SHBb, u_xlat16_0);
        u_xlat16_17 = vs_TEXCOORD3.y * vs_TEXCOORD3.y;
        u_xlat16_17 = vs_TEXCOORD3.x * vs_TEXCOORD3.x + (-u_xlat16_17);
        u_xlat16_4.xyz = unity_SHC.xyz * vec3(u_xlat16_17) + u_xlat16_4.xyz;
        u_xlat16_3.xyz = u_xlat16_3.xyz + u_xlat16_4.xyz;
        u_xlat16_3.xyz = max(u_xlat16_3.xyz, vec3(0.0, 0.0, 0.0));
        u_xlat16_3.xyz = u_xlat16_3.xyz + _MainLightColor.xyz;
        u_xlat16_3.xyz = clamp(u_xlat16_3.xyz, 0.0, 1.0);
        u_xlat16_3.xyz = max(u_xlat16_3.xyz, vec3(0.100000001, 0.100000001, 0.100000001));
        u_xlat1.xyz = u_xlat16_2.xyz * u_xlat16_3.xyz + _OutlineEmissionColor.xyz;
    }
    SV_Target0.xyz = u_xlat1.xyz * _GlobalCharacterTintColor.xyz;
    SV_Target0.w = 1.0;
    return;
}

#endif
