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
uniform 	vec4 _TimeParameters;
uniform 	vec4 hlslcc_mtx4x4unity_MatrixVP[4];
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
UNITY_BINDING(0) uniform UnityPerDraw {
#endif
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_ObjectToWorld[4];
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_WorldToObject[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_LODFade;
	UNITY_UNIFORM mediump vec4                unity_WorldTransformParams;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RenderingLayer;
	UNITY_UNIFORM mediump vec4                unity_LightData;
	UNITY_UNIFORM mediump vec4                unity_LightIndices[2];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_ProbesOcclusion;
	UNITY_UNIFORM mediump vec4                unity_SpecCube0_HDR;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SpecCube1_HDR;
	UNITY_UNIFORM vec4                unity_SpecCube0_BoxMax;
	UNITY_UNIFORM vec4                unity_SpecCube0_BoxMin;
	UNITY_UNIFORM vec4                unity_SpecCube0_ProbePosition;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMax;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMin;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_ProbePosition;
	UNITY_UNIFORM vec4                unity_LightmapST;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_DynamicLightmapST;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHAr;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHAg;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHAb;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHBr;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHBg;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHBb;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHC;
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
	UNITY_UNIFORM vec2                _offsetRetio;
	UNITY_UNIFORM float                _Tilling_Noise1;
	UNITY_UNIFORM float                _FresnelPower;
	UNITY_UNIFORM float                _ScrollSpeed_Noise1;
	UNITY_UNIFORM float                _PositionOffset;
	UNITY_UNIFORM vec4                _CloudColor_2nd;
	UNITY_UNIFORM float                _UseVertexColor;
	UNITY_UNIFORM vec4                _CloudColor_1st;
	UNITY_UNIFORM float                _Emission;
	UNITY_UNIFORM float                _FogDepth;
	UNITY_UNIFORM float                _Intensity_Noise2;
	UNITY_UNIFORM float                _Intensity_Noise3;
	UNITY_UNIFORM float                _Intensity_Noise1;
	UNITY_UNIFORM float                _Smoothness;
	UNITY_UNIFORM float                _noiseAlphaDencity;
	UNITY_UNIFORM float                _UseFrenel;
	UNITY_UNIFORM float                _NormalStrength;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedX_AlphaClipNoiseTex_TexelSize;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
};
#endif
UNITY_LOCATION(9) uniform mediump sampler3D _3DTexure_Noise1;
in highp vec3 in_POSITION0;
in highp vec3 in_NORMAL0;
in highp vec4 in_TANGENT0;
in highp vec4 in_TEXCOORD1;
in highp vec4 in_COLOR0;
out highp vec2 vs_INTERP0;
out highp vec4 vs_INTERP4;
out highp vec4 vs_INTERP5;
out highp vec4 vs_INTERP6;
out highp vec3 vs_INTERP7;
out highp vec3 vs_INTERP8;
vec4 u_xlat0;
vec4 u_xlat1;
vec3 u_xlat2;
bool u_xlatb3;
float u_xlat6;
float u_xlat7;
void main()
{
    u_xlat0.x = _TimeParameters.x * _ScrollSpeed_Noise1;
    u_xlat0.x = u_xlat0.x * 0.100000001;
    u_xlat2.xyz = in_POSITION0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat2.xyz = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * in_POSITION0.xxx + u_xlat2.xyz;
    u_xlat2.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * in_POSITION0.zzz + u_xlat2.xyz;
    u_xlat2.xyz = u_xlat2.xyz + hlslcc_mtx4x4unity_ObjectToWorld[3].xyz;
    u_xlat1.x = _Tilling_Noise1 * 0.100000001;
    u_xlat1.xyz = u_xlat1.xxx * u_xlat2.xyz + u_xlat0.xxx;
    u_xlat1.xyz = textureLod(_3DTexure_Noise1, u_xlat1.xyz, 0.0).xyz;
    u_xlat0.x = u_xlat1.y * _Intensity_Noise2;
    u_xlat0.x = _Intensity_Noise1 * u_xlat1.x + u_xlat0.x;
    u_xlat0.x = _Intensity_Noise3 * u_xlat1.z + u_xlat0.x;
    u_xlat1.x = _Intensity_Noise2 + _Intensity_Noise1;
    u_xlat1.x = u_xlat1.x + _Intensity_Noise3;
    u_xlat1.x = float(1.0) / u_xlat1.x;
    u_xlat0.x = u_xlat0.x * u_xlat1.x;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat1.x = u_xlat0.x * -2.0 + 3.0;
    u_xlat0.x = u_xlat0.x * u_xlat0.x;
    u_xlat0.x = u_xlat0.x * u_xlat1.x;
    u_xlat1.x = (-_offsetRetio.x) + _offsetRetio.y;
    u_xlat0.x = u_xlat0.x * u_xlat1.x + _offsetRetio.x;
    u_xlat1.x = (-in_COLOR0.z) + 1.0;
    u_xlatb3 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseVertexColor);
    u_xlat1.x = (u_xlatb3) ? u_xlat1.x : 1.0;
    u_xlat1.x = u_xlat1.x * _PositionOffset;
    u_xlat0.x = u_xlat0.x * u_xlat1.x;
    u_xlat1.x = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[0].xyz);
    u_xlat1.y = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[1].xyz);
    u_xlat1.z = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[2].xyz);
    u_xlat7 = dot(u_xlat1.xyz, u_xlat1.xyz);
    u_xlat7 = max(u_xlat7, 1.17549435e-38);
    u_xlat7 = inversesqrt(u_xlat7);
    u_xlat1.xyz = vec3(u_xlat7) * u_xlat1.xyz;
    u_xlat0.xyz = u_xlat1.xyz * u_xlat0.xxx + u_xlat2.xyz;
    vs_INTERP8.xyz = u_xlat1.xyz;
    u_xlat1.xyz = u_xlat0.yyy * hlslcc_mtx4x4unity_WorldToObject[1].xyz;
    u_xlat0.xyw = hlslcc_mtx4x4unity_WorldToObject[0].xyz * u_xlat0.xxx + u_xlat1.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_WorldToObject[2].xyz * u_xlat0.zzz + u_xlat0.xyw;
    u_xlat0.xyz = u_xlat0.xyz + hlslcc_mtx4x4unity_WorldToObject[3].xyz;
    u_xlat1.xyz = u_xlat0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat0.xyw = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * u_xlat0.xxx + u_xlat1.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * u_xlat0.zzz + u_xlat0.xyw;
    u_xlat0.xyz = u_xlat0.xyz + hlslcc_mtx4x4unity_ObjectToWorld[3].xyz;
    u_xlat1 = u_xlat0.yyyy * hlslcc_mtx4x4unity_MatrixVP[1];
    u_xlat1 = hlslcc_mtx4x4unity_MatrixVP[0] * u_xlat0.xxxx + u_xlat1;
    u_xlat1 = hlslcc_mtx4x4unity_MatrixVP[2] * u_xlat0.zzzz + u_xlat1;
    vs_INTERP7.xyz = u_xlat0.xyz;
    gl_Position = u_xlat1 + hlslcc_mtx4x4unity_MatrixVP[3];
    vs_INTERP0.xy = in_TEXCOORD1.xy * unity_LightmapST.xy + unity_LightmapST.zw;
    u_xlat0.xyz = in_TANGENT0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * in_TANGENT0.xxx + u_xlat0.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * in_TANGENT0.zzz + u_xlat0.xyz;
    u_xlat6 = dot(u_xlat0.xyz, u_xlat0.xyz);
    u_xlat6 = max(u_xlat6, 1.17549435e-38);
    u_xlat6 = inversesqrt(u_xlat6);
    vs_INTERP4.xyz = vec3(u_xlat6) * u_xlat0.xyz;
    vs_INTERP4.w = in_TANGENT0.w;
    vs_INTERP5 = in_COLOR0;
    vs_INTERP6 = vec4(0.0, 0.0, 0.0, 0.0);
    return;
}

#endif
#ifdef FRAGMENT
#version 300 es
#ifdef GL_EXT_shader_texture_lod
#extension GL_EXT_shader_texture_lod : enable
#endif

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
vec4 ImmCB_0[4];
uniform 	vec4 _ScaledScreenParams;
uniform 	vec2 _GlobalMipBias;
uniform 	float _AlphaToMaskAvailable;
uniform 	vec4 _MainLightPosition;
uniform 	mediump vec4 _MainLightColor;
uniform 	mediump vec4 _AdditionalLightsCount;
uniform 	vec4 _AdditionalLightsPosition[16];
uniform 	mediump vec4 _AdditionalLightsColor[16];
uniform 	mediump vec4 _AdditionalLightsAttenuation[16];
uniform 	mediump vec4 _AdditionalLightsSpotDir[16];
uniform 	vec4 _TimeParameters;
uniform 	vec3 _WorldSpaceCameraPos;
uniform 	vec4 _ProjectionParams;
uniform 	vec4 _ZBufferParams;
uniform 	vec4 unity_OrthoParams;
uniform 	vec4 hlslcc_mtx4x4unity_MatrixV[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixVP[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixInvVP[4];
uniform 	vec4 hlslcc_mtx4x4_MainLightWorldToShadow[20];
uniform 	vec4 _CascadeShadowSplitSpheres0;
uniform 	vec4 _CascadeShadowSplitSpheres1;
uniform 	vec4 _CascadeShadowSplitSpheres2;
uniform 	vec4 _CascadeShadowSplitSpheres3;
uniform 	vec4 _CascadeShadowSplitSphereRadii;
uniform 	vec4 _MainLightShadowParams;
uniform 	vec4 _AdditionalShadowFadeParams;
uniform 	vec4 _AdditionalShadowParams[16];
uniform 	vec4 hlslcc_mtx4x4_AdditionalLightsWorldToShadow[64];
uniform 	vec4 hlslcc_mtx4x4_MainLightWorldToLight[4];
uniform 	float _AdditionalLightsCookieEnableBits;
uniform 	float _MainLightCookieTextureFormat;
uniform 	float _AdditionalLightsCookieAtlasTextureFormat;
uniform 	vec4 hlslcc_mtx4x4_AdditionalLightsWorldToLights[64];
uniform 	vec4 _AdditionalLightsCookieAtlasUVRects[16];
uniform 	float _AdditionalLightsLightTypes[16];
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
UNITY_BINDING(0) uniform UnityPerDraw {
#endif
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_ObjectToWorld[4];
	UNITY_UNIFORM vec4                hlslcc_mtx4x4unity_WorldToObject[4];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_LODFade;
	UNITY_UNIFORM mediump vec4                unity_WorldTransformParams;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_RenderingLayer;
	UNITY_UNIFORM mediump vec4                unity_LightData;
	UNITY_UNIFORM mediump vec4                unity_LightIndices[2];
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_ProbesOcclusion;
	UNITY_UNIFORM mediump vec4                unity_SpecCube0_HDR;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SpecCube1_HDR;
	UNITY_UNIFORM vec4                unity_SpecCube0_BoxMax;
	UNITY_UNIFORM vec4                unity_SpecCube0_BoxMin;
	UNITY_UNIFORM vec4                unity_SpecCube0_ProbePosition;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMax;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_BoxMin;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_SpecCube1_ProbePosition;
	UNITY_UNIFORM vec4                unity_LightmapST;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedXunity_DynamicLightmapST;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHAr;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHAg;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHAb;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHBr;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHBg;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHBb;
	UNITY_UNIFORM mediump vec4 Xhlslcc_UnusedXunity_SHC;
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
	UNITY_UNIFORM vec2                _offsetRetio;
	UNITY_UNIFORM float                _Tilling_Noise1;
	UNITY_UNIFORM float                _FresnelPower;
	UNITY_UNIFORM float                _ScrollSpeed_Noise1;
	UNITY_UNIFORM float                _PositionOffset;
	UNITY_UNIFORM vec4                _CloudColor_2nd;
	UNITY_UNIFORM float                _UseVertexColor;
	UNITY_UNIFORM vec4                _CloudColor_1st;
	UNITY_UNIFORM float                _Emission;
	UNITY_UNIFORM float                _FogDepth;
	UNITY_UNIFORM float                _Intensity_Noise2;
	UNITY_UNIFORM float                _Intensity_Noise3;
	UNITY_UNIFORM float                _Intensity_Noise1;
	UNITY_UNIFORM float                _Smoothness;
	UNITY_UNIFORM float                _noiseAlphaDencity;
	UNITY_UNIFORM float                _UseFrenel;
	UNITY_UNIFORM float                _NormalStrength;
	UNITY_UNIFORM vec4 Xhlslcc_UnusedX_AlphaClipNoiseTex_TexelSize;
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
};
#endif
UNITY_LOCATION(0) uniform mediump samplerCube unity_SpecCube0;
UNITY_LOCATION(1) uniform mediump sampler2D unity_Lightmap;
UNITY_LOCATION(2) uniform mediump sampler2D _MainLightShadowmapTexture;
UNITY_LOCATION(3) uniform mediump sampler2DShadow hlslcc_zcmp_MainLightShadowmapTexture;
UNITY_LOCATION(4) uniform mediump sampler2D _AdditionalLightsShadowmapTexture;
UNITY_LOCATION(5) uniform mediump sampler2DShadow hlslcc_zcmp_AdditionalLightsShadowmapTexture;
UNITY_LOCATION(6) uniform mediump sampler2D _MainLightCookieTexture;
UNITY_LOCATION(7) uniform mediump sampler2D _AdditionalLightsCookieAtlasTexture;
UNITY_LOCATION(8) uniform highp sampler2D _CameraDepthTexture;
UNITY_LOCATION(9) uniform mediump sampler3D _3DTexure_Noise1;
UNITY_LOCATION(10) uniform mediump sampler2D _AlphaClipNoiseTex;
in highp vec2 vs_INTERP0;
in highp vec4 vs_INTERP4;
in highp vec4 vs_INTERP5;
in highp vec3 vs_INTERP7;
in highp vec3 vs_INTERP8;
layout(location = 0) out mediump vec4 SV_Target0;
vec3 u_xlat0;
mediump vec4 u_xlat16_0;
bool u_xlatb0;
mediump vec3 u_xlat16_1;
vec3 u_xlat2;
mediump vec4 u_xlat16_2;
uint u_xlatu2;
bool u_xlatb2;
vec3 u_xlat3;
bool u_xlatb3;
vec4 u_xlat4;
mediump vec4 u_xlat16_4;
vec4 u_xlat5;
bvec2 u_xlatb5;
vec3 u_xlat6;
mediump vec4 u_xlat16_6;
bvec4 u_xlatb6;
vec4 u_xlat7;
mediump vec4 u_xlat16_7;
vec4 u_xlat8;
mediump vec4 u_xlat16_8;
int u_xlati8;
bvec4 u_xlatb8;
vec4 u_xlat9;
vec3 u_xlat10;
vec3 u_xlat11;
mediump vec3 u_xlat16_12;
mediump vec3 u_xlat16_13;
mediump vec4 u_xlat16_14;
mediump vec3 u_xlat16_15;
mediump vec3 u_xlat16_16;
mediump vec3 u_xlat16_17;
mediump vec3 u_xlat16_18;
vec3 u_xlat19;
bvec2 u_xlatb19;
vec3 u_xlat21;
bvec3 u_xlatb21;
vec3 u_xlat22;
int u_xlati22;
uint u_xlatu22;
bvec2 u_xlatb22;
vec3 u_xlat27;
mediump float u_xlat16_33;
mediump vec3 u_xlat16_36;
float u_xlat41;
int u_xlati41;
bool u_xlatb41;
bool u_xlatb44;
mediump float u_xlat16_52;
float u_xlat57;
mediump float u_xlat16_57;
int u_xlati57;
uint u_xlatu57;
bool u_xlatb57;
mediump float u_xlat16_58;
float u_xlat59;
uint u_xlatu59;
bool u_xlatb59;
float u_xlat60;
float u_xlat61;
float u_xlat62;
mediump float u_xlat16_62;
int u_xlati62;
bool u_xlatb62;
float u_xlat63;
int u_xlati63;
bool u_xlatb63;
float u_xlat65;
mediump float u_xlat16_69;
mediump float u_xlat16_70;
mediump float u_xlat16_71;
mediump float u_xlat16_72;
void main()
{
ImmCB_0[0] = vec4(1.0,0.0,0.0,0.0);
ImmCB_0[1] = vec4(0.0,1.0,0.0,0.0);
ImmCB_0[2] = vec4(0.0,0.0,1.0,0.0);
ImmCB_0[3] = vec4(0.0,0.0,0.0,1.0);
vec4 hlslcc_FragCoord = vec4(gl_FragCoord.xyz, 1.0/gl_FragCoord.w);
    u_xlat0.x = dot(vs_INTERP8.xyz, vs_INTERP8.xyz);
    u_xlat0.x = sqrt(u_xlat0.x);
    u_xlat0.x = float(1.0) / u_xlat0.x;
    u_xlatb19.x = 0.0<vs_INTERP4.w;
    u_xlatb19.y = unity_WorldTransformParams.w>=0.0;
    u_xlat19.x = (u_xlatb19.x) ? float(1.0) : float(-1.0);
    u_xlat19.y = (u_xlatb19.y) ? float(1.0) : float(-1.0);
    u_xlat16_1.x = u_xlat19.y * u_xlat19.x;
    u_xlat19.xyz = vs_INTERP4.zxy * vs_INTERP8.xyz;
    u_xlat19.xyz = vs_INTERP8.zxy * vs_INTERP4.xyz + (-u_xlat19.xyz);
    u_xlat19.xyz = u_xlat19.xyz * u_xlat16_1.xxx;
    u_xlat2.xyz = u_xlat0.xxx * vs_INTERP8.zxy;
    u_xlat3.xyz = u_xlat0.xxx * vs_INTERP4.xyz;
    u_xlat4.xyz = u_xlat19.xyz * u_xlat0.xxx;
    u_xlatb5.xy = equal(unity_OrthoParams.wwww, vec4(0.0, 1.0, 0.0, 0.0)).xy;
    u_xlat6.xyz = (-vs_INTERP7.xyz) + _WorldSpaceCameraPos.xyz;
    u_xlat0.x = dot(u_xlat6.xyz, u_xlat6.xyz);
    u_xlat0.x = inversesqrt(u_xlat0.x);
    u_xlat6.xyz = u_xlat0.xxx * u_xlat6.xyz;
    u_xlat7.x = hlslcc_mtx4x4unity_MatrixV[0].z;
    u_xlat7.y = hlslcc_mtx4x4unity_MatrixV[1].z;
    u_xlat7.z = hlslcc_mtx4x4unity_MatrixV[2].z;
    u_xlat16_1.xyz = (u_xlatb5.x) ? u_xlat6.xyz : u_xlat7.xyz;
    u_xlat0.x = vs_INTERP7.y * hlslcc_mtx4x4unity_MatrixVP[1].w;
    u_xlat0.x = hlslcc_mtx4x4unity_MatrixVP[0].w * vs_INTERP7.x + u_xlat0.x;
    u_xlat0.x = hlslcc_mtx4x4unity_MatrixVP[2].w * vs_INTERP7.z + u_xlat0.x;
    u_xlat0.x = u_xlat0.x + hlslcc_mtx4x4unity_MatrixVP[3].w;
    u_xlatb59 = 0.0<_ProjectionParams.x;
    u_xlat60 = (-hlslcc_FragCoord.y) + _ScaledScreenParams.y;
    u_xlat6.y = (u_xlatb59) ? u_xlat60 : hlslcc_FragCoord.y;
    u_xlat6.x = hlslcc_FragCoord.x;
    u_xlat7.xy = u_xlat6.xy / _ScaledScreenParams.xy;
    u_xlat59 = _Intensity_Noise2 + _Intensity_Noise1;
    u_xlat59 = u_xlat59 + _Intensity_Noise3;
    u_xlat60 = _Tilling_Noise1 * 0.100000001;
    u_xlat61 = _TimeParameters.x * _ScrollSpeed_Noise1;
    u_xlat61 = u_xlat61 * 0.100000001;
    u_xlat5.xzw = vec3(u_xlat60) * vs_INTERP7.xyz + vec3(u_xlat61);
    u_xlat16_8 = textureLod(_3DTexure_Noise1, u_xlat5.xzw, 0.0);
    u_xlat60 = u_xlat16_8.y * _Intensity_Noise2;
    u_xlat60 = _Intensity_Noise1 * u_xlat16_8.x + u_xlat60;
    u_xlat60 = _Intensity_Noise3 * u_xlat16_8.z + u_xlat60;
    u_xlat59 = float(1.0) / u_xlat59;
    u_xlat59 = u_xlat59 * u_xlat60;
    u_xlat59 = clamp(u_xlat59, 0.0, 1.0);
    u_xlat60 = u_xlat59 * -2.0 + 3.0;
    u_xlat59 = u_xlat59 * u_xlat59;
    u_xlat59 = u_xlat59 * u_xlat60;
    u_xlat5.xzw = (-_CloudColor_2nd.xyz) + _CloudColor_1st.xyz;
    u_xlat5.xzw = vec3(u_xlat59) * u_xlat5.xzw + _CloudColor_2nd.xyz;
    u_xlat60 = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat60 = inversesqrt(u_xlat60);
    u_xlat8.xyz = u_xlat2.yzx * vec3(u_xlat60);
    u_xlat60 = dot(u_xlat16_1.xyz, u_xlat16_1.xyz);
    u_xlat60 = inversesqrt(u_xlat60);
    u_xlat9.xyz = u_xlat16_1.xyz * vec3(u_xlat60);
    u_xlat60 = dot(u_xlat8.xyz, u_xlat9.xyz);
    u_xlat60 = clamp(u_xlat60, 0.0, 1.0);
    u_xlat60 = (-u_xlat60) + 1.0;
    u_xlat60 = log2(u_xlat60);
    u_xlat60 = u_xlat60 * _FresnelPower;
    u_xlat60 = exp2(u_xlat60);
    u_xlat61 = u_xlat60 * u_xlat60;
    u_xlatb44 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseFrenel);
    u_xlat61 = u_xlatb44 ? u_xlat61 : float(0.0);
    u_xlat5.xzw = vec3(_Emission) * u_xlat5.xzw + vec3(u_xlat61);
    u_xlat8.xyz = dFdx(vs_INTERP7.xyz);
    u_xlat9.xyz = dFdy(vs_INTERP7.zxy);
    u_xlat10.xyz = u_xlat2.xyz * u_xlat8.yzx;
    u_xlat10.xyz = u_xlat2.zxy * u_xlat8.zxy + (-u_xlat10.xyz);
    u_xlat11.xyz = u_xlat2.zxy * u_xlat9.xyz;
    u_xlat9.xyz = u_xlat9.zxy * u_xlat2.xyz + (-u_xlat11.xyz);
    u_xlat61 = dot(u_xlat8.xyz, u_xlat9.xyz);
    u_xlatb63 = u_xlat61<0.0;
    u_xlat63 = (u_xlatb63) ? -1.0 : 1.0;
    u_xlat61 = max(abs(u_xlat61), 1.19209299e-15);
    u_xlat61 = u_xlat63 / u_xlat61;
    u_xlat63 = dFdx(u_xlat59);
    u_xlat8.x = dFdy(u_xlat59);
    u_xlat8.xyz = u_xlat10.xyz * u_xlat8.xxx;
    u_xlat8.xyz = vec3(u_xlat63) * u_xlat9.xyz + u_xlat8.xyz;
    u_xlat8.xyz = vec3(u_xlat61) * u_xlat8.xyz;
    u_xlat8.xyz = (-vec3(_NormalStrength)) * u_xlat8.xyz + u_xlat2.yzx;
    u_xlat61 = dot(u_xlat8.xyz, u_xlat8.xyz);
    u_xlat61 = max(u_xlat61, 1.17549435e-38);
    u_xlat61 = inversesqrt(u_xlat61);
    u_xlat8.xyz = vec3(u_xlat61) * u_xlat8.xyz;
    u_xlat9.xyz = u_xlat2.zxy * u_xlat4.yzx;
    u_xlat9.xyz = u_xlat4.xyz * u_xlat2.xyz + (-u_xlat9.xyz);
    u_xlat10.xyz = u_xlat2.xyz * u_xlat3.yzx;
    u_xlat2.xyz = u_xlat2.zxy * u_xlat3.zxy + (-u_xlat10.xyz);
    u_xlat10.xyz = u_xlat3.zxy * u_xlat4.xyz;
    u_xlat4.xyz = u_xlat3.yzx * u_xlat4.yzx + (-u_xlat10.xyz);
    u_xlat3.x = dot(u_xlat3.xyz, u_xlat9.xyz);
    u_xlat16_12.x = dot(u_xlat9.xyz, u_xlat8.xyz);
    u_xlat16_12.y = dot(u_xlat2.xyz, u_xlat8.xyz);
    u_xlat16_12.z = dot(u_xlat4.xyz, u_xlat8.xyz);
    u_xlatb2 = u_xlat3.x<0.0;
    u_xlat2.x = (u_xlatb2) ? -1.0 : 1.0;
    u_xlat2.xyz = u_xlat16_12.xyz * u_xlat2.xxx;
    u_xlat3.x = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat3.x = max(u_xlat3.x, 1.17549435e-38);
    u_xlat3.x = inversesqrt(u_xlat3.x);
    u_xlat2.xyz = u_xlat2.xyz * u_xlat3.xxx;
    u_xlat59 = u_xlat59 * _Smoothness;
    u_xlat59 = clamp(u_xlat59, 0.0, 1.0);
    u_xlatb3 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseVertexColor);
    u_xlat3.xy = (bool(u_xlatb3)) ? vs_INTERP5.xy : vec2(1.0, 1.0);
    if(u_xlatb5.y){
        u_xlat7.z = (-u_xlat7.y) + 1.0;
        u_xlat41 = texture(_CameraDepthTexture, u_xlat7.xz, _GlobalMipBias.x).x;
        u_xlat4.xy = u_xlat7.xz * vec2(2.0, 2.0) + vec2(-1.0, -1.0);
        u_xlat9 = u_xlat4.yyyy * hlslcc_mtx4x4unity_MatrixInvVP[1];
        u_xlat4 = hlslcc_mtx4x4unity_MatrixInvVP[0] * u_xlat4.xxxx + u_xlat9;
        u_xlat4 = hlslcc_mtx4x4unity_MatrixInvVP[2] * vec4(u_xlat41) + u_xlat4;
        u_xlat4 = u_xlat4 + hlslcc_mtx4x4unity_MatrixInvVP[3];
        u_xlat4.xyz = u_xlat4.xyz / u_xlat4.www;
        u_xlat41 = u_xlat4.y * hlslcc_mtx4x4unity_MatrixV[1].z;
        u_xlat41 = hlslcc_mtx4x4unity_MatrixV[0].z * u_xlat4.x + u_xlat41;
        u_xlat41 = hlslcc_mtx4x4unity_MatrixV[2].z * u_xlat4.z + u_xlat41;
        u_xlat41 = u_xlat41 + hlslcc_mtx4x4unity_MatrixV[3].z;
        u_xlat41 = abs(u_xlat41);
    } else {
        u_xlat7.w = (-u_xlat7.y) + 1.0;
        u_xlat4.x = texture(_CameraDepthTexture, u_xlat7.xw, _GlobalMipBias.x).x;
        u_xlat4.x = _ZBufferParams.z * u_xlat4.x + _ZBufferParams.w;
        u_xlat41 = float(1.0) / u_xlat4.x;
    }
    u_xlat0.x = u_xlat0.x + -1.0;
    u_xlat0.x = (-u_xlat0.x) + u_xlat41;
    u_xlat0.x = u_xlat0.x * _FogDepth;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat41 = (-u_xlat60) * u_xlat60 + u_xlat16_8.w;
    u_xlat41 = (-u_xlat60) + u_xlat41;
    u_xlat41 = u_xlat41 + 1.0;
    u_xlat41 = (u_xlatb44) ? u_xlat41 : 1.0;
    u_xlat0.x = u_xlat0.x * u_xlat41;
    u_xlat0.x = _noiseAlphaDencity * u_xlat3.y + u_xlat0.x;
    u_xlat0.x = u_xlat0.x * u_xlat3.x;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat3.xy = u_xlat6.xy * vec2(0.015625, 0.015625);
    u_xlat3.x = texture(_AlphaClipNoiseTex, u_xlat3.xy, _GlobalMipBias.x).x;
    u_xlatb22.x = u_xlat0.x>=u_xlat3.x;
    u_xlat22.x = u_xlatb22.x ? u_xlat0.x : float(0.0);
    u_xlatb41 = 0.0>=u_xlat3.x;
    u_xlat3.x = u_xlat0.x + (-u_xlat3.x);
    u_xlat60 = dFdx(u_xlat0.x);
    u_xlat0.x = dFdy(u_xlat0.x);
    u_xlat0.x = abs(u_xlat0.x) + abs(u_xlat60);
    u_xlat0.x = max(u_xlat0.x, 9.99999975e-05);
    u_xlat0.x = u_xlat3.x / u_xlat0.x;
    u_xlat0.x = u_xlat0.x + 0.5;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat0.x = (u_xlatb41) ? 1.0 : u_xlat0.x;
    u_xlatb3 = _AlphaToMaskAvailable!=0.0;
    u_xlat16_4.w = (u_xlatb3) ? u_xlat0.x : u_xlat22.x;
    u_xlat16_58 = u_xlat16_4.w + -9.99999975e-05;
    u_xlatb0 = u_xlat16_58<0.0;
    if(u_xlatb0){discard;}
    u_xlat6.x = vs_INTERP4.x;
    u_xlat6.y = u_xlat19.z;
    u_xlat6.z = vs_INTERP8.x;
    u_xlat6.x = dot(u_xlat2.xyz, u_xlat6.xyz);
    u_xlat7.x = vs_INTERP4.y;
    u_xlat7.y = u_xlat19.x;
    u_xlat7.z = vs_INTERP8.y;
    u_xlat6.y = dot(u_xlat2.xyz, u_xlat7.xyz);
    u_xlat19.x = vs_INTERP4.z;
    u_xlat19.z = vs_INTERP8.z;
    u_xlat6.z = dot(u_xlat2.xyz, u_xlat19.xyz);
    u_xlat0.x = dot(u_xlat6.xyz, u_xlat6.xyz);
    u_xlat0.x = inversesqrt(u_xlat0.x);
    u_xlat0.xyz = u_xlat0.xxx * u_xlat6.xyz;
    u_xlat2.xyz = vs_INTERP7.xyz + (-_CascadeShadowSplitSpheres0.xyz);
    u_xlat22.xyz = vs_INTERP7.xyz + (-_CascadeShadowSplitSpheres1.xyz);
    u_xlat6.xyz = vs_INTERP7.xyz + (-_CascadeShadowSplitSpheres2.xyz);
    u_xlat7.xyz = vs_INTERP7.xyz + (-_CascadeShadowSplitSpheres3.xyz);
    u_xlat8.x = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat8.y = dot(u_xlat22.xyz, u_xlat22.xyz);
    u_xlat8.z = dot(u_xlat6.xyz, u_xlat6.xyz);
    u_xlat8.w = dot(u_xlat7.xyz, u_xlat7.xyz);
    u_xlatb6 = lessThan(u_xlat8, _CascadeShadowSplitSphereRadii);
    u_xlat16_7.x = (u_xlatb6.x) ? float(1.0) : float(0.0);
    u_xlat16_7.y = (u_xlatb6.y) ? float(1.0) : float(0.0);
    u_xlat16_7.z = (u_xlatb6.z) ? float(1.0) : float(0.0);
    u_xlat16_7.w = (u_xlatb6.w) ? float(1.0) : float(0.0);
    u_xlat16_12.x = (u_xlatb6.x) ? float(-1.0) : float(-0.0);
    u_xlat16_12.y = (u_xlatb6.y) ? float(-1.0) : float(-0.0);
    u_xlat16_12.z = (u_xlatb6.z) ? float(-1.0) : float(-0.0);
    u_xlat16_12.xyz = u_xlat16_7.yzw + u_xlat16_12.xyz;
    u_xlat16_7.yzw = max(u_xlat16_12.xyz, vec3(0.0, 0.0, 0.0));
    u_xlat16_58 = dot(u_xlat16_7, vec4(4.0, 3.0, 2.0, 1.0));
    u_xlat16_58 = (-u_xlat16_58) + 4.0;
    u_xlatu57 = uint(u_xlat16_58);
    u_xlati57 = int(int(u_xlatu57) << (2 & int(0x1F)));
    u_xlat2.xyz = vs_INTERP7.yyy * hlslcc_mtx4x4_MainLightWorldToShadow[(u_xlati57 + 1)].xyz;
    u_xlat2.xyz = hlslcc_mtx4x4_MainLightWorldToShadow[u_xlati57].xyz * vs_INTERP7.xxx + u_xlat2.xyz;
    u_xlat2.xyz = hlslcc_mtx4x4_MainLightWorldToShadow[(u_xlati57 + 2)].xyz * vs_INTERP7.zzz + u_xlat2.xyz;
    u_xlat2.xyz = u_xlat2.xyz + hlslcc_mtx4x4_MainLightWorldToShadow[(u_xlati57 + 3)].xyz;
    u_xlat16_6 = texture(unity_Lightmap, vs_INTERP0.xy, _GlobalMipBias.x);
    u_xlat16_58 = log2(abs(u_xlat16_6.w));
    u_xlat16_58 = u_xlat16_58 * 2.20000005;
    u_xlat16_58 = exp2(u_xlat16_58);
    u_xlat16_58 = u_xlat16_58 * 34.4932404;
    u_xlat16_12.xyz = vec3(u_xlat16_58) * u_xlat16_6.xyz;
    u_xlat16_13.xyz = u_xlat5.xzw * vec3(0.959999979, 0.959999979, 0.959999979);
    u_xlat16_58 = (-u_xlat59) + 1.0;
    u_xlat16_69 = u_xlat16_58 * u_xlat16_58;
    u_xlat16_69 = max(u_xlat16_69, 0.0078125);
    u_xlat16_70 = u_xlat16_69 * u_xlat16_69;
    u_xlat16_14.x = u_xlat59 + 0.0400000215;
    u_xlat16_14.x = min(u_xlat16_14.x, 1.0);
    u_xlat16_33 = u_xlat16_69 * 4.0 + 2.0;
    vec3 txVec0 = vec3(u_xlat2.xy,u_xlat2.z);
    u_xlat16_57 = textureLod(hlslcc_zcmp_MainLightShadowmapTexture, txVec0, 0.0);
    u_xlat16_52 = (-_MainLightShadowParams.x) + 1.0;
    u_xlat16_52 = u_xlat16_57 * _MainLightShadowParams.x + u_xlat16_52;
    u_xlatb57 = 0.0>=u_xlat2.z;
    u_xlatb2 = u_xlat2.z>=1.0;
    u_xlatb57 = u_xlatb57 || u_xlatb2;
    u_xlat16_52 = (u_xlatb57) ? 1.0 : u_xlat16_52;
    u_xlat2.xyz = vs_INTERP7.xyz + (-_WorldSpaceCameraPos.xyz);
    u_xlat57 = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat2.x = u_xlat57 * _MainLightShadowParams.z + _MainLightShadowParams.w;
    u_xlat2.x = clamp(u_xlat2.x, 0.0, 1.0);
    u_xlat16_71 = (-u_xlat16_52) + 1.0;
    u_xlat16_52 = u_xlat2.x * u_xlat16_71 + u_xlat16_52;
    u_xlatb2 = _MainLightCookieTextureFormat!=-1.0;
    if(u_xlatb2){
        u_xlat2.xy = vs_INTERP7.yy * hlslcc_mtx4x4_MainLightWorldToLight[1].xy;
        u_xlat2.xy = hlslcc_mtx4x4_MainLightWorldToLight[0].xy * vs_INTERP7.xx + u_xlat2.xy;
        u_xlat2.xy = hlslcc_mtx4x4_MainLightWorldToLight[2].xy * vs_INTERP7.zz + u_xlat2.xy;
        u_xlat2.xy = u_xlat2.xy + hlslcc_mtx4x4_MainLightWorldToLight[3].xy;
        u_xlat2.xy = u_xlat2.xy * vec2(0.5, 0.5) + vec2(0.5, 0.5);
        u_xlat16_2 = texture(_MainLightCookieTexture, u_xlat2.xy, _GlobalMipBias.x);
        u_xlatb22.xy = equal(vec4(vec4(_MainLightCookieTextureFormat, _MainLightCookieTextureFormat, _MainLightCookieTextureFormat, _MainLightCookieTextureFormat)), vec4(0.0, 1.0, 0.0, 0.0)).xy;
        u_xlat16_71 = (u_xlatb22.y) ? u_xlat16_2.w : u_xlat16_2.x;
        u_xlat16_15.xyz = (u_xlatb22.x) ? u_xlat16_2.xyz : vec3(u_xlat16_71);
    } else {
        u_xlat16_15.x = float(1.0);
        u_xlat16_15.y = float(1.0);
        u_xlat16_15.z = float(1.0);
    }
    u_xlat16_15.xyz = u_xlat16_15.xyz * _MainLightColor.xyz;
    u_xlat16_71 = dot((-u_xlat16_1.xyz), u_xlat0.xyz);
    u_xlat16_71 = u_xlat16_71 + u_xlat16_71;
    u_xlat16_16.xyz = u_xlat0.xyz * (-vec3(u_xlat16_71)) + (-u_xlat16_1.xyz);
    u_xlat16_71 = dot(u_xlat0.xyz, u_xlat16_1.xyz);
    u_xlat16_71 = clamp(u_xlat16_71, 0.0, 1.0);
    u_xlat16_71 = (-u_xlat16_71) + 1.0;
    u_xlat16_71 = u_xlat16_71 * u_xlat16_71;
    u_xlat16_71 = u_xlat16_71 * u_xlat16_71;
    u_xlatb2 = 0.0<unity_SpecCube0_ProbePosition.w;
    u_xlatb21.xyz = lessThan(vec4(0.0, 0.0, 0.0, 0.0), u_xlat16_16.xyzz).xyz;
    u_xlat21.x = (u_xlatb21.x) ? unity_SpecCube0_BoxMax.x : unity_SpecCube0_BoxMin.x;
    u_xlat21.y = (u_xlatb21.y) ? unity_SpecCube0_BoxMax.y : unity_SpecCube0_BoxMin.y;
    u_xlat21.z = (u_xlatb21.z) ? unity_SpecCube0_BoxMax.z : unity_SpecCube0_BoxMin.z;
    u_xlat21.xyz = u_xlat21.xyz + (-vs_INTERP7.xyz);
    u_xlat16_17.xyz = u_xlat21.xyz / u_xlat16_16.xyz;
    u_xlat16_72 = min(u_xlat16_17.y, u_xlat16_17.x);
    u_xlat16_72 = min(u_xlat16_17.z, u_xlat16_72);
    u_xlat21.xyz = vs_INTERP7.xyz + (-unity_SpecCube0_ProbePosition.xyz);
    u_xlat16_17.xyz = u_xlat16_16.xyz * vec3(u_xlat16_72) + u_xlat21.xyz;
    u_xlat16_16.xyz = (bool(u_xlatb2)) ? u_xlat16_17.xyz : u_xlat16_16.xyz;
    u_xlat16_72 = (-u_xlat16_58) * 0.699999988 + 1.70000005;
    u_xlat16_58 = u_xlat16_58 * u_xlat16_72;
    u_xlat16_58 = u_xlat16_58 * 6.0;
    u_xlat16_2 = textureLod(unity_SpecCube0, u_xlat16_16.xyz, u_xlat16_58);
    u_xlat16_58 = u_xlat16_2.w + -1.0;
    u_xlat16_58 = unity_SpecCube0_HDR.w * u_xlat16_58 + 1.0;
    u_xlat16_58 = max(u_xlat16_58, 0.0);
    u_xlat16_58 = log2(u_xlat16_58);
    u_xlat16_58 = u_xlat16_58 * unity_SpecCube0_HDR.y;
    u_xlat16_58 = exp2(u_xlat16_58);
    u_xlat16_58 = u_xlat16_58 * unity_SpecCube0_HDR.x;
    u_xlat16_16.xyz = u_xlat16_2.xyz * vec3(u_xlat16_58);
    u_xlat16_17.xy = vec2(u_xlat16_69) * vec2(u_xlat16_69) + vec2(-1.0, 1.0);
    u_xlat16_58 = float(1.0) / u_xlat16_17.y;
    u_xlat16_69 = u_xlat16_14.x + -0.0399999991;
    u_xlat16_69 = u_xlat16_71 * u_xlat16_69 + 0.0399999991;
    u_xlat2.x = u_xlat16_58 * u_xlat16_69;
    u_xlat16_16.xyz = u_xlat2.xxx * u_xlat16_16.xyz;
    u_xlat16_12.xyz = u_xlat16_12.xyz * u_xlat16_13.xyz + u_xlat16_16.xyz;
    u_xlat2.x = u_xlat16_52 * unity_LightData.z;
    u_xlat16_58 = dot(u_xlat0.xyz, _MainLightPosition.xyz);
    u_xlat16_58 = clamp(u_xlat16_58, 0.0, 1.0);
    u_xlat16_58 = u_xlat16_58 * u_xlat2.x;
    u_xlat16_14.xzw = vec3(u_xlat16_58) * u_xlat16_15.xyz;
    u_xlat2.xyz = u_xlat16_1.xyz + _MainLightPosition.xyz;
    u_xlat59 = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat59 = max(u_xlat59, 1.17549435e-38);
    u_xlat59 = inversesqrt(u_xlat59);
    u_xlat2.xyz = vec3(u_xlat59) * u_xlat2.xyz;
    u_xlat59 = dot(u_xlat0.xyz, u_xlat2.xyz);
    u_xlat59 = clamp(u_xlat59, 0.0, 1.0);
    u_xlat2.x = dot(_MainLightPosition.xyz, u_xlat2.xyz);
    u_xlat2.x = clamp(u_xlat2.x, 0.0, 1.0);
    u_xlat21.x = u_xlat59 * u_xlat59;
    u_xlat21.x = u_xlat21.x * u_xlat16_17.x + 1.00001001;
    u_xlat16_58 = u_xlat2.x * u_xlat2.x;
    u_xlat2.x = u_xlat21.x * u_xlat21.x;
    u_xlat21.x = max(u_xlat16_58, 0.100000001);
    u_xlat2.x = u_xlat21.x * u_xlat2.x;
    u_xlat2.x = u_xlat16_33 * u_xlat2.x;
    u_xlat2.x = u_xlat16_70 / u_xlat2.x;
    u_xlat16_58 = u_xlat2.x + -6.10351562e-05;
    u_xlat16_58 = max(u_xlat16_58, 0.0);
    u_xlat16_58 = min(u_xlat16_58, 1000.0);
    u_xlat16_15.xyz = vec3(u_xlat16_58) * vec3(0.0399999991, 0.0399999991, 0.0399999991) + u_xlat16_13.xyz;
    u_xlat16_58 = min(_AdditionalLightsCount.x, unity_LightData.y);
    u_xlatu2 =  uint(int(u_xlat16_58));
    u_xlat57 = u_xlat57 * _AdditionalShadowFadeParams.x + _AdditionalShadowFadeParams.y;
    u_xlat57 = clamp(u_xlat57, 0.0, 1.0);
    u_xlatb21.xy = equal(vec4(vec4(_AdditionalLightsCookieAtlasTextureFormat, _AdditionalLightsCookieAtlasTextureFormat, _AdditionalLightsCookieAtlasTextureFormat, _AdditionalLightsCookieAtlasTextureFormat)), vec4(0.0, 1.0, 0.0, 0.0)).xy;
    u_xlat16_16.x = float(0.0);
    u_xlat16_16.y = float(0.0);
    u_xlat16_16.z = float(0.0);
    for(uint u_xlatu_loop_1 = uint(0u) ; u_xlatu_loop_1<u_xlatu2 ; u_xlatu_loop_1++)
    {
        u_xlatu22 = uint(u_xlatu_loop_1 >> (2u & uint(0x1F)));
        u_xlati41 = int(uint(u_xlatu_loop_1 & 3u));
        u_xlat22.x = dot(unity_LightIndices[int(u_xlatu22)], ImmCB_0[u_xlati41]);
        u_xlati22 = int(u_xlat22.x);
        u_xlat5.xyz = (-vs_INTERP7.xyz) * _AdditionalLightsPosition[u_xlati22].www + _AdditionalLightsPosition[u_xlati22].xyz;
        u_xlat41 = dot(u_xlat5.xyz, u_xlat5.xyz);
        u_xlat41 = max(u_xlat41, 6.10351562e-05);
        u_xlat60 = inversesqrt(u_xlat41);
        u_xlat6.xyz = vec3(u_xlat60) * u_xlat5.xyz;
        u_xlat62 = float(1.0) / float(u_xlat41);
        u_xlat41 = u_xlat41 * _AdditionalLightsAttenuation[u_xlati22].x;
        u_xlat16_58 = (-u_xlat41) * u_xlat41 + 1.0;
        u_xlat16_58 = max(u_xlat16_58, 0.0);
        u_xlat16_58 = u_xlat16_58 * u_xlat16_58;
        u_xlat41 = u_xlat16_58 * u_xlat62;
        u_xlat16_58 = dot(_AdditionalLightsSpotDir[u_xlati22].xyz, u_xlat6.xyz);
        u_xlat16_58 = u_xlat16_58 * _AdditionalLightsAttenuation[u_xlati22].z + _AdditionalLightsAttenuation[u_xlati22].w;
        u_xlat16_58 = clamp(u_xlat16_58, 0.0, 1.0);
        u_xlat16_58 = u_xlat16_58 * u_xlat16_58;
        u_xlat41 = u_xlat16_58 * u_xlat41;
        u_xlati62 = int(_AdditionalShadowParams[u_xlati22].w);
        u_xlatb63 = u_xlati62>=0;
        if(u_xlatb63){
            u_xlatb63 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_AdditionalShadowParams[u_xlati22].z);
            if(u_xlatb63){
                u_xlatb8.xyz = greaterThanEqual(abs(u_xlat6.zzyz), abs(u_xlat6.xyxx)).xyz;
                u_xlatb63 = u_xlatb8.y && u_xlatb8.x;
                u_xlatb8.xyw = lessThan((-u_xlat6.zyzx), vec4(0.0, 0.0, 0.0, 0.0)).xyw;
                u_xlat8.x = (u_xlatb8.x) ? float(5.0) : float(4.0);
                u_xlat8.y = (u_xlatb8.y) ? float(3.0) : float(2.0);
                u_xlat65 = u_xlatb8.w ? 1.0 : float(0.0);
                u_xlat27.x = (u_xlatb8.z) ? u_xlat8.y : u_xlat65;
                u_xlat63 = (u_xlatb63) ? u_xlat8.x : u_xlat27.x;
                u_xlat8.x = trunc(_AdditionalShadowParams[u_xlati22].w);
                u_xlat63 = u_xlat63 + u_xlat8.x;
                u_xlati62 = int(u_xlat63);
            }
            u_xlati62 = int(u_xlati62 << (2 & int(0x1F)));
            u_xlat7 = vs_INTERP7.yyyy * hlslcc_mtx4x4_AdditionalLightsWorldToShadow[(u_xlati62 + 1)];
            u_xlat7 = hlslcc_mtx4x4_AdditionalLightsWorldToShadow[u_xlati62] * vs_INTERP7.xxxx + u_xlat7;
            u_xlat7 = hlslcc_mtx4x4_AdditionalLightsWorldToShadow[(u_xlati62 + 2)] * vs_INTERP7.zzzz + u_xlat7;
            u_xlat7 = u_xlat7 + hlslcc_mtx4x4_AdditionalLightsWorldToShadow[(u_xlati62 + 3)];
            u_xlat8.xyz = u_xlat7.xyz / u_xlat7.www;
            vec3 txVec1 = vec3(u_xlat8.xy,u_xlat8.z);
            u_xlat16_62 = textureLod(hlslcc_zcmp_AdditionalLightsShadowmapTexture, txVec1, 0.0);
            u_xlat16_58 = 1.0 + (-_AdditionalShadowParams[u_xlati22].x);
            u_xlat16_58 = u_xlat16_62 * _AdditionalShadowParams[u_xlati22].x + u_xlat16_58;
            u_xlatb62 = 0.0>=u_xlat8.z;
            u_xlatb63 = u_xlat8.z>=1.0;
            u_xlatb62 = u_xlatb62 || u_xlatb63;
            u_xlat16_58 = (u_xlatb62) ? 1.0 : u_xlat16_58;
        } else {
            u_xlat16_58 = 1.0;
        }
        u_xlat16_69 = (-u_xlat16_58) + 1.0;
        u_xlat16_58 = u_xlat57 * u_xlat16_69 + u_xlat16_58;
        u_xlati62 = int(1 << (u_xlati22 & int(0x1F)));
        u_xlati62 = int(uint(uint(u_xlati62) & uint(floatBitsToUint(_AdditionalLightsCookieEnableBits))));
        if(u_xlati62 != 0) {
            u_xlati62 = int(_AdditionalLightsLightTypes[u_xlati22]);
            u_xlati63 = (u_xlati62 != 0) ? 0 : 1;
            u_xlati8 = int(u_xlati22 << (2 & int(0x1F)));
            if(u_xlati63 != 0) {
                u_xlat27.xyz = vs_INTERP7.yyy * hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 1)].xyw;
                u_xlat27.xyz = hlslcc_mtx4x4_AdditionalLightsWorldToLights[u_xlati8].xyw * vs_INTERP7.xxx + u_xlat27.xyz;
                u_xlat27.xyz = hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 2)].xyw * vs_INTERP7.zzz + u_xlat27.xyz;
                u_xlat27.xyz = u_xlat27.xyz + hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 3)].xyw;
                u_xlat27.xy = u_xlat27.xy / u_xlat27.zz;
                u_xlat27.xy = u_xlat27.xy * vec2(0.5, 0.5) + vec2(0.5, 0.5);
                u_xlat27.xy = clamp(u_xlat27.xy, 0.0, 1.0);
                u_xlat27.xy = _AdditionalLightsCookieAtlasUVRects[u_xlati22].xy * u_xlat27.xy + _AdditionalLightsCookieAtlasUVRects[u_xlati22].zw;
            } else {
                u_xlatb62 = u_xlati62==1;
                u_xlati62 = u_xlatb62 ? 1 : int(0);
                if(u_xlati62 != 0) {
                    u_xlat9.xy = vs_INTERP7.yy * hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 1)].xy;
                    u_xlat9.xy = hlslcc_mtx4x4_AdditionalLightsWorldToLights[u_xlati8].xy * vs_INTERP7.xx + u_xlat9.xy;
                    u_xlat9.xy = hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 2)].xy * vs_INTERP7.zz + u_xlat9.xy;
                    u_xlat9.xy = u_xlat9.xy + hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 3)].xy;
                    u_xlat9.xy = u_xlat9.xy * vec2(0.5, 0.5) + vec2(0.5, 0.5);
                    u_xlat9.xy = fract(u_xlat9.xy);
                    u_xlat27.xy = _AdditionalLightsCookieAtlasUVRects[u_xlati22].xy * u_xlat9.xy + _AdditionalLightsCookieAtlasUVRects[u_xlati22].zw;
                } else {
                    u_xlat7 = vs_INTERP7.yyyy * hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 1)];
                    u_xlat7 = hlslcc_mtx4x4_AdditionalLightsWorldToLights[u_xlati8] * vs_INTERP7.xxxx + u_xlat7;
                    u_xlat7 = hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 2)] * vs_INTERP7.zzzz + u_xlat7;
                    u_xlat7 = u_xlat7 + hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati8 + 3)];
                    u_xlat9.xyz = u_xlat7.xyz / u_xlat7.www;
                    u_xlat62 = dot(u_xlat9.xyz, u_xlat9.xyz);
                    u_xlat62 = inversesqrt(u_xlat62);
                    u_xlat9.xyz = vec3(u_xlat62) * u_xlat9.xyz;
                    u_xlat62 = dot(abs(u_xlat9.xyz), vec3(1.0, 1.0, 1.0));
                    u_xlat62 = max(u_xlat62, 9.99999997e-07);
                    u_xlat62 = float(1.0) / float(u_xlat62);
                    u_xlat10.xyz = vec3(u_xlat62) * u_xlat9.zxy;
                    u_xlat10.x = (-u_xlat10.x);
                    u_xlat10.x = clamp(u_xlat10.x, 0.0, 1.0);
                    u_xlatb8.xw = greaterThanEqual(u_xlat10.yyyz, vec4(0.0, 0.0, 0.0, 0.0)).xw;
                    u_xlat8.x = (u_xlatb8.x) ? u_xlat10.x : (-u_xlat10.x);
                    u_xlat8.w = (u_xlatb8.w) ? u_xlat10.x : (-u_xlat10.x);
                    u_xlat8.xw = u_xlat9.xy * vec2(u_xlat62) + u_xlat8.xw;
                    u_xlat8.xw = u_xlat8.xw * vec2(0.5, 0.5) + vec2(0.5, 0.5);
                    u_xlat8.xw = clamp(u_xlat8.xw, 0.0, 1.0);
                    u_xlat27.xy = _AdditionalLightsCookieAtlasUVRects[u_xlati22].xy * u_xlat8.xw + _AdditionalLightsCookieAtlasUVRects[u_xlati22].zw;
                }
            }
            u_xlat16_7 = textureLod(_AdditionalLightsCookieAtlasTexture, u_xlat27.xy, 0.0);
            u_xlat16_69 = (u_xlatb21.y) ? u_xlat16_7.w : u_xlat16_7.x;
            u_xlat16_36.xyz = (u_xlatb21.x) ? u_xlat16_7.xyz : vec3(u_xlat16_69);
        } else {
            u_xlat16_36.x = float(1.0);
            u_xlat16_36.y = float(1.0);
            u_xlat16_36.z = float(1.0);
        }
        u_xlat16_36.xyz = u_xlat16_36.xyz * _AdditionalLightsColor[u_xlati22].xyz;
        u_xlat22.x = u_xlat16_58 * u_xlat41;
        u_xlat16_58 = dot(u_xlat0.xyz, u_xlat6.xyz);
        u_xlat16_58 = clamp(u_xlat16_58, 0.0, 1.0);
        u_xlat16_58 = u_xlat16_58 * u_xlat22.x;
        u_xlat16_36.xyz = vec3(u_xlat16_58) * u_xlat16_36.xyz;
        u_xlat22.xyz = u_xlat5.xyz * vec3(u_xlat60) + u_xlat16_1.xyz;
        u_xlat5.x = dot(u_xlat22.xyz, u_xlat22.xyz);
        u_xlat5.x = max(u_xlat5.x, 1.17549435e-38);
        u_xlat5.x = inversesqrt(u_xlat5.x);
        u_xlat22.xyz = u_xlat22.xyz * u_xlat5.xxx;
        u_xlat5.x = dot(u_xlat0.xyz, u_xlat22.xyz);
        u_xlat5.x = clamp(u_xlat5.x, 0.0, 1.0);
        u_xlat22.x = dot(u_xlat6.xyz, u_xlat22.xyz);
        u_xlat22.x = clamp(u_xlat22.x, 0.0, 1.0);
        u_xlat41 = u_xlat5.x * u_xlat5.x;
        u_xlat41 = u_xlat41 * u_xlat16_17.x + 1.00001001;
        u_xlat16_58 = u_xlat22.x * u_xlat22.x;
        u_xlat22.x = u_xlat41 * u_xlat41;
        u_xlat41 = max(u_xlat16_58, 0.100000001);
        u_xlat22.x = u_xlat41 * u_xlat22.x;
        u_xlat22.x = u_xlat16_33 * u_xlat22.x;
        u_xlat22.x = u_xlat16_70 / u_xlat22.x;
        u_xlat16_58 = u_xlat22.x + -6.10351562e-05;
        u_xlat16_58 = max(u_xlat16_58, 0.0);
        u_xlat16_58 = min(u_xlat16_58, 1000.0);
        u_xlat16_18.xyz = vec3(u_xlat16_58) * vec3(0.0399999991, 0.0399999991, 0.0399999991) + u_xlat16_13.xyz;
        u_xlat16_16.xyz = u_xlat16_18.xyz * u_xlat16_36.xyz + u_xlat16_16.xyz;
    }
    u_xlat16_1.xyz = u_xlat16_15.xyz * u_xlat16_14.xzw + u_xlat16_12.xyz;
    u_xlat16_4.xyz = u_xlat16_16.xyz + u_xlat16_1.xyz;
    u_xlat16_0 = min(u_xlat16_4, vec4(65504.0, 65504.0, 65504.0, 65504.0));
    SV_Target0.w = (u_xlatb3) ? u_xlat16_0.w : 1.0;
    SV_Target0.xyz = u_xlat16_0.xyz;
    return;
}

#endif
