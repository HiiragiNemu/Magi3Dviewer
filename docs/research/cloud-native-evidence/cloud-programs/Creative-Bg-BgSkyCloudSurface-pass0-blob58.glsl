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
uniform 	vec4 hlslcc_mtx4x4_MainLightWorldToShadow[20];
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
UNITY_LOCATION(8) uniform mediump sampler3D _3DTexure_Noise1;
in highp vec3 in_POSITION0;
in highp vec3 in_NORMAL0;
in highp vec4 in_TANGENT0;
in highp vec4 in_COLOR0;
out highp vec3 vs_INTERP2;
out highp vec4 vs_INTERP3;
out highp vec4 vs_INTERP4;
out highp vec4 vs_INTERP5;
out highp vec4 vs_INTERP6;
out highp vec3 vs_INTERP7;
out highp vec3 vs_INTERP8;
vec4 u_xlat0;
vec4 u_xlat1;
vec4 u_xlat2;
mediump vec4 u_xlat16_2;
mediump vec3 u_xlat16_3;
mediump vec3 u_xlat16_4;
vec3 u_xlat5;
bool u_xlatb6;
float u_xlat15;
float u_xlat16;
void main()
{
    u_xlat0.x = _TimeParameters.x * _ScrollSpeed_Noise1;
    u_xlat0.x = u_xlat0.x * 0.100000001;
    u_xlat5.xyz = in_POSITION0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat5.xyz = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * in_POSITION0.xxx + u_xlat5.xyz;
    u_xlat5.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * in_POSITION0.zzz + u_xlat5.xyz;
    u_xlat5.xyz = u_xlat5.xyz + hlslcc_mtx4x4unity_ObjectToWorld[3].xyz;
    u_xlat1.x = _Tilling_Noise1 * 0.100000001;
    u_xlat1.xyz = u_xlat1.xxx * u_xlat5.xyz + u_xlat0.xxx;
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
    u_xlatb6 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseVertexColor);
    u_xlat1.x = (u_xlatb6) ? u_xlat1.x : 1.0;
    u_xlat1.x = u_xlat1.x * _PositionOffset;
    u_xlat0.x = u_xlat0.x * u_xlat1.x;
    u_xlat1.x = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[0].xyz);
    u_xlat1.y = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[1].xyz);
    u_xlat1.z = dot(in_NORMAL0.xyz, hlslcc_mtx4x4unity_WorldToObject[2].xyz);
    u_xlat16 = dot(u_xlat1.xyz, u_xlat1.xyz);
    u_xlat16 = max(u_xlat16, 1.17549435e-38);
    u_xlat16 = inversesqrt(u_xlat16);
    u_xlat1.xyz = vec3(u_xlat16) * u_xlat1.xyz;
    u_xlat0.xyz = u_xlat1.xyz * u_xlat0.xxx + u_xlat5.xyz;
    u_xlat2.xyz = u_xlat0.yyy * hlslcc_mtx4x4unity_WorldToObject[1].xyz;
    u_xlat0.xyw = hlslcc_mtx4x4unity_WorldToObject[0].xyz * u_xlat0.xxx + u_xlat2.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_WorldToObject[2].xyz * u_xlat0.zzz + u_xlat0.xyw;
    u_xlat0.xyz = u_xlat0.xyz + hlslcc_mtx4x4unity_WorldToObject[3].xyz;
    u_xlat2.xyz = u_xlat0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat0.xyw = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * u_xlat0.xxx + u_xlat2.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * u_xlat0.zzz + u_xlat0.xyw;
    u_xlat0.xyz = u_xlat0.xyz + hlslcc_mtx4x4unity_ObjectToWorld[3].xyz;
    u_xlat2 = u_xlat0.yyyy * hlslcc_mtx4x4unity_MatrixVP[1];
    u_xlat2 = hlslcc_mtx4x4unity_MatrixVP[0] * u_xlat0.xxxx + u_xlat2;
    u_xlat2 = hlslcc_mtx4x4unity_MatrixVP[2] * u_xlat0.zzzz + u_xlat2;
    gl_Position = u_xlat2 + hlslcc_mtx4x4unity_MatrixVP[3];
    u_xlat16_3.x = u_xlat1.y * u_xlat1.y;
    u_xlat16_3.x = u_xlat1.x * u_xlat1.x + (-u_xlat16_3.x);
    u_xlat16_2 = u_xlat1.yzzx * u_xlat1.xyzz;
    u_xlat16_4.x = dot(unity_SHBr, u_xlat16_2);
    u_xlat16_4.y = dot(unity_SHBg, u_xlat16_2);
    u_xlat16_4.z = dot(unity_SHBb, u_xlat16_2);
    u_xlat16_3.xyz = unity_SHC.xyz * u_xlat16_3.xxx + u_xlat16_4.xyz;
    vs_INTERP8.xyz = u_xlat1.xyz;
    u_xlat1.w = 1.0;
    u_xlat16_4.x = dot(unity_SHAr, u_xlat1);
    u_xlat16_4.y = dot(unity_SHAg, u_xlat1);
    u_xlat16_4.z = dot(unity_SHAb, u_xlat1);
    u_xlat16_3.xyz = u_xlat16_3.xyz + u_xlat16_4.xyz;
    u_xlat16_3.xyz = max(u_xlat16_3.xyz, vec3(0.0, 0.0, 0.0));
    vs_INTERP2.xyz = u_xlat16_3.xyz;
    u_xlat1.xyz = u_xlat0.yyy * hlslcc_mtx4x4_MainLightWorldToShadow[1].xyz;
    u_xlat1.xyz = hlslcc_mtx4x4_MainLightWorldToShadow[0].xyz * u_xlat0.xxx + u_xlat1.xyz;
    u_xlat1.xyz = hlslcc_mtx4x4_MainLightWorldToShadow[2].xyz * u_xlat0.zzz + u_xlat1.xyz;
    vs_INTERP7.xyz = u_xlat0.xyz;
    vs_INTERP3.xyz = u_xlat1.xyz + hlslcc_mtx4x4_MainLightWorldToShadow[3].xyz;
    vs_INTERP3.w = 0.0;
    u_xlat0.xyz = in_TANGENT0.yyy * hlslcc_mtx4x4unity_ObjectToWorld[1].xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[0].xyz * in_TANGENT0.xxx + u_xlat0.xyz;
    u_xlat0.xyz = hlslcc_mtx4x4unity_ObjectToWorld[2].xyz * in_TANGENT0.zzz + u_xlat0.xyz;
    u_xlat15 = dot(u_xlat0.xyz, u_xlat0.xyz);
    u_xlat15 = max(u_xlat15, 1.17549435e-38);
    u_xlat15 = inversesqrt(u_xlat15);
    vs_INTERP4.xyz = vec3(u_xlat15) * u_xlat0.xyz;
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
uniform 	vec4 unity_FogParams;
uniform 	mediump vec4 unity_FogColor;
uniform 	vec4 hlslcc_mtx4x4unity_MatrixV[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixVP[4];
uniform 	vec4 hlslcc_mtx4x4unity_MatrixInvVP[4];
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
UNITY_LOCATION(1) uniform mediump sampler2D _MainLightShadowmapTexture;
UNITY_LOCATION(2) uniform mediump sampler2DShadow hlslcc_zcmp_MainLightShadowmapTexture;
UNITY_LOCATION(3) uniform mediump sampler2D _AdditionalLightsShadowmapTexture;
UNITY_LOCATION(4) uniform mediump sampler2DShadow hlslcc_zcmp_AdditionalLightsShadowmapTexture;
UNITY_LOCATION(5) uniform mediump sampler2D _MainLightCookieTexture;
UNITY_LOCATION(6) uniform mediump sampler2D _AdditionalLightsCookieAtlasTexture;
UNITY_LOCATION(7) uniform highp sampler2D _CameraDepthTexture;
UNITY_LOCATION(8) uniform mediump sampler3D _3DTexure_Noise1;
UNITY_LOCATION(9) uniform mediump sampler2D _AlphaClipNoiseTex;
in highp vec3 vs_INTERP2;
in highp vec4 vs_INTERP3;
in highp vec4 vs_INTERP4;
in highp vec4 vs_INTERP5;
in highp vec3 vs_INTERP7;
in highp vec3 vs_INTERP8;
layout(location = 0) out mediump vec4 SV_Target0;
vec3 u_xlat0;
bool u_xlatb0;
mediump vec4 u_xlat16_1;
vec3 u_xlat2;
mediump float u_xlat16_2;
bool u_xlatb2;
vec3 u_xlat3;
bool u_xlatb3;
vec4 u_xlat4;
mediump vec4 u_xlat16_4;
vec4 u_xlat5;
mediump vec4 u_xlat16_5;
bvec2 u_xlatb5;
vec3 u_xlat6;
vec4 u_xlat7;
mediump vec4 u_xlat16_7;
int u_xlati7;
bvec3 u_xlatb7;
vec4 u_xlat8;
mediump vec4 u_xlat16_8;
bvec3 u_xlatb8;
vec4 u_xlat9;
vec3 u_xlat10;
vec3 u_xlat11;
mediump vec3 u_xlat16_12;
mediump float u_xlat16_13;
mediump vec3 u_xlat16_14;
mediump vec3 u_xlat16_15;
mediump vec3 u_xlat16_16;
mediump vec3 u_xlat16_17;
mediump vec3 u_xlat16_18;
mediump vec3 u_xlat16_19;
vec3 u_xlat20;
bvec2 u_xlatb20;
vec3 u_xlat22;
uint u_xlatu22;
bvec2 u_xlatb22;
vec3 u_xlat23;
uint u_xlatu23;
bvec3 u_xlatb23;
vec3 u_xlat27;
int u_xlati27;
bvec3 u_xlatb27;
mediump float u_xlat16_33;
mediump vec3 u_xlat16_36;
float u_xlat42;
bvec2 u_xlatb42;
float u_xlat43;
int u_xlati43;
uint u_xlatu43;
bool u_xlatb43;
bool u_xlatb46;
float u_xlat47;
mediump float u_xlat16_53;
float u_xlat60;
mediump float u_xlat16_61;
float u_xlat62;
bool u_xlatb62;
float u_xlat63;
int u_xlati63;
float u_xlat64;
float u_xlat65;
float u_xlat66;
mediump float u_xlat16_66;
int u_xlati66;
bool u_xlatb66;
mediump float u_xlat16_72;
mediump float u_xlat16_73;
mediump float u_xlat16_74;
mediump float u_xlat16_75;
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
    u_xlatb20.x = 0.0<vs_INTERP4.w;
    u_xlatb20.y = unity_WorldTransformParams.w>=0.0;
    u_xlat20.x = (u_xlatb20.x) ? float(1.0) : float(-1.0);
    u_xlat20.y = (u_xlatb20.y) ? float(1.0) : float(-1.0);
    u_xlat16_1.x = u_xlat20.y * u_xlat20.x;
    u_xlat20.xyz = vs_INTERP4.zxy * vs_INTERP8.xyz;
    u_xlat20.xyz = vs_INTERP8.zxy * vs_INTERP4.xyz + (-u_xlat20.xyz);
    u_xlat20.xyz = u_xlat20.xyz * u_xlat16_1.xxx;
    u_xlat2.xyz = u_xlat0.xxx * vs_INTERP8.zxy;
    u_xlat3.xyz = u_xlat0.xxx * vs_INTERP4.xyz;
    u_xlat4.xyz = u_xlat20.xyz * u_xlat0.xxx;
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
    u_xlatb62 = 0.0<_ProjectionParams.x;
    u_xlat63 = (-hlslcc_FragCoord.y) + _ScaledScreenParams.y;
    u_xlat6.y = (u_xlatb62) ? u_xlat63 : hlslcc_FragCoord.y;
    u_xlat6.x = hlslcc_FragCoord.x;
    u_xlat7.xy = u_xlat6.xy / _ScaledScreenParams.xy;
    u_xlat62 = _Intensity_Noise2 + _Intensity_Noise1;
    u_xlat62 = u_xlat62 + _Intensity_Noise3;
    u_xlat63 = _Tilling_Noise1 * 0.100000001;
    u_xlat64 = _TimeParameters.x * _ScrollSpeed_Noise1;
    u_xlat64 = u_xlat64 * 0.100000001;
    u_xlat5.xzw = vec3(u_xlat63) * vs_INTERP7.xyz + vec3(u_xlat64);
    u_xlat16_8 = textureLod(_3DTexure_Noise1, u_xlat5.xzw, 0.0);
    u_xlat63 = u_xlat16_8.y * _Intensity_Noise2;
    u_xlat63 = _Intensity_Noise1 * u_xlat16_8.x + u_xlat63;
    u_xlat63 = _Intensity_Noise3 * u_xlat16_8.z + u_xlat63;
    u_xlat62 = float(1.0) / u_xlat62;
    u_xlat62 = u_xlat62 * u_xlat63;
    u_xlat62 = clamp(u_xlat62, 0.0, 1.0);
    u_xlat63 = u_xlat62 * -2.0 + 3.0;
    u_xlat62 = u_xlat62 * u_xlat62;
    u_xlat62 = u_xlat62 * u_xlat63;
    u_xlat5.xzw = (-_CloudColor_2nd.xyz) + _CloudColor_1st.xyz;
    u_xlat5.xzw = vec3(u_xlat62) * u_xlat5.xzw + _CloudColor_2nd.xyz;
    u_xlat63 = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat63 = inversesqrt(u_xlat63);
    u_xlat8.xyz = u_xlat2.yzx * vec3(u_xlat63);
    u_xlat63 = dot(u_xlat16_1.xyz, u_xlat16_1.xyz);
    u_xlat63 = inversesqrt(u_xlat63);
    u_xlat9.xyz = u_xlat16_1.xyz * vec3(u_xlat63);
    u_xlat63 = dot(u_xlat8.xyz, u_xlat9.xyz);
    u_xlat63 = clamp(u_xlat63, 0.0, 1.0);
    u_xlat63 = (-u_xlat63) + 1.0;
    u_xlat63 = log2(u_xlat63);
    u_xlat63 = u_xlat63 * _FresnelPower;
    u_xlat63 = exp2(u_xlat63);
    u_xlat64 = u_xlat63 * u_xlat63;
    u_xlatb46 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseFrenel);
    u_xlat64 = u_xlatb46 ? u_xlat64 : float(0.0);
    u_xlat5.xzw = vec3(_Emission) * u_xlat5.xzw + vec3(u_xlat64);
    u_xlat8.xyz = dFdx(vs_INTERP7.xyz);
    u_xlat9.xyz = dFdy(vs_INTERP7.zxy);
    u_xlat10.xyz = u_xlat2.xyz * u_xlat8.yzx;
    u_xlat10.xyz = u_xlat2.zxy * u_xlat8.zxy + (-u_xlat10.xyz);
    u_xlat11.xyz = u_xlat2.zxy * u_xlat9.xyz;
    u_xlat9.xyz = u_xlat9.zxy * u_xlat2.xyz + (-u_xlat11.xyz);
    u_xlat64 = dot(u_xlat8.xyz, u_xlat9.xyz);
    u_xlatb66 = u_xlat64<0.0;
    u_xlat66 = (u_xlatb66) ? -1.0 : 1.0;
    u_xlat64 = max(abs(u_xlat64), 1.19209299e-15);
    u_xlat64 = u_xlat66 / u_xlat64;
    u_xlat66 = dFdx(u_xlat62);
    u_xlat8.x = dFdy(u_xlat62);
    u_xlat8.xyz = u_xlat10.xyz * u_xlat8.xxx;
    u_xlat8.xyz = vec3(u_xlat66) * u_xlat9.xyz + u_xlat8.xyz;
    u_xlat8.xyz = vec3(u_xlat64) * u_xlat8.xyz;
    u_xlat8.xyz = (-vec3(_NormalStrength)) * u_xlat8.xyz + u_xlat2.yzx;
    u_xlat64 = dot(u_xlat8.xyz, u_xlat8.xyz);
    u_xlat64 = max(u_xlat64, 1.17549435e-38);
    u_xlat64 = inversesqrt(u_xlat64);
    u_xlat8.xyz = vec3(u_xlat64) * u_xlat8.xyz;
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
    u_xlat62 = u_xlat62 * _Smoothness;
    u_xlat62 = clamp(u_xlat62, 0.0, 1.0);
    u_xlatb3 = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_UseVertexColor);
    u_xlat3.xy = (bool(u_xlatb3)) ? vs_INTERP5.xy : vec2(1.0, 1.0);
    if(u_xlatb5.y){
        u_xlat7.z = (-u_xlat7.y) + 1.0;
        u_xlat43 = texture(_CameraDepthTexture, u_xlat7.xz, _GlobalMipBias.x).x;
        u_xlat4.xy = u_xlat7.xz * vec2(2.0, 2.0) + vec2(-1.0, -1.0);
        u_xlat9 = u_xlat4.yyyy * hlslcc_mtx4x4unity_MatrixInvVP[1];
        u_xlat4 = hlslcc_mtx4x4unity_MatrixInvVP[0] * u_xlat4.xxxx + u_xlat9;
        u_xlat4 = hlslcc_mtx4x4unity_MatrixInvVP[2] * vec4(u_xlat43) + u_xlat4;
        u_xlat4 = u_xlat4 + hlslcc_mtx4x4unity_MatrixInvVP[3];
        u_xlat4.xyz = u_xlat4.xyz / u_xlat4.www;
        u_xlat43 = u_xlat4.y * hlslcc_mtx4x4unity_MatrixV[1].z;
        u_xlat43 = hlslcc_mtx4x4unity_MatrixV[0].z * u_xlat4.x + u_xlat43;
        u_xlat43 = hlslcc_mtx4x4unity_MatrixV[2].z * u_xlat4.z + u_xlat43;
        u_xlat43 = u_xlat43 + hlslcc_mtx4x4unity_MatrixV[3].z;
        u_xlat43 = abs(u_xlat43);
    } else {
        u_xlat7.w = (-u_xlat7.y) + 1.0;
        u_xlat4.x = texture(_CameraDepthTexture, u_xlat7.xw, _GlobalMipBias.x).x;
        u_xlat4.x = _ZBufferParams.z * u_xlat4.x + _ZBufferParams.w;
        u_xlat43 = float(1.0) / u_xlat4.x;
    }
    u_xlat0.x = u_xlat0.x + -1.0;
    u_xlat0.x = (-u_xlat0.x) + u_xlat43;
    u_xlat0.x = u_xlat0.x * _FogDepth;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat43 = (-u_xlat63) * u_xlat63 + u_xlat16_8.w;
    u_xlat43 = (-u_xlat63) + u_xlat43;
    u_xlat43 = u_xlat43 + 1.0;
    u_xlat43 = (u_xlatb46) ? u_xlat43 : 1.0;
    u_xlat0.x = u_xlat0.x * u_xlat43;
    u_xlat0.x = _noiseAlphaDencity * u_xlat3.y + u_xlat0.x;
    u_xlat0.x = u_xlat0.x * u_xlat3.x;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat3.xy = u_xlat6.xy * vec2(0.015625, 0.015625);
    u_xlat3.x = texture(_AlphaClipNoiseTex, u_xlat3.xy, _GlobalMipBias.x).x;
    u_xlatb23.x = u_xlat0.x>=u_xlat3.x;
    u_xlat23.x = u_xlatb23.x ? u_xlat0.x : float(0.0);
    u_xlatb43 = 0.0>=u_xlat3.x;
    u_xlat3.x = u_xlat0.x + (-u_xlat3.x);
    u_xlat63 = dFdx(u_xlat0.x);
    u_xlat0.x = dFdy(u_xlat0.x);
    u_xlat0.x = abs(u_xlat0.x) + abs(u_xlat63);
    u_xlat0.x = max(u_xlat0.x, 9.99999975e-05);
    u_xlat0.x = u_xlat3.x / u_xlat0.x;
    u_xlat0.x = u_xlat0.x + 0.5;
    u_xlat0.x = clamp(u_xlat0.x, 0.0, 1.0);
    u_xlat0.x = (u_xlatb43) ? 1.0 : u_xlat0.x;
    u_xlatb3 = _AlphaToMaskAvailable!=0.0;
    u_xlat16_4.w = (u_xlatb3) ? u_xlat0.x : u_xlat23.x;
    u_xlat16_61 = u_xlat16_4.w + -9.99999975e-05;
    u_xlatb0 = u_xlat16_61<0.0;
    if(u_xlatb0){discard;}
    u_xlat6.x = vs_INTERP4.x;
    u_xlat6.y = u_xlat20.z;
    u_xlat6.z = vs_INTERP8.x;
    u_xlat6.x = dot(u_xlat2.xyz, u_xlat6.xyz);
    u_xlat7.x = vs_INTERP4.y;
    u_xlat7.y = u_xlat20.x;
    u_xlat7.z = vs_INTERP8.y;
    u_xlat6.y = dot(u_xlat2.xyz, u_xlat7.xyz);
    u_xlat20.x = vs_INTERP4.z;
    u_xlat20.z = vs_INTERP8.z;
    u_xlat6.z = dot(u_xlat2.xyz, u_xlat20.xyz);
    u_xlat0.x = dot(u_xlat6.xyz, u_xlat6.xyz);
    u_xlat0.x = inversesqrt(u_xlat0.x);
    u_xlat0.xyz = u_xlat0.xxx * u_xlat6.xyz;
    u_xlat60 = vs_INTERP7.y * hlslcc_mtx4x4unity_MatrixV[1].z;
    u_xlat60 = hlslcc_mtx4x4unity_MatrixV[0].z * vs_INTERP7.x + u_xlat60;
    u_xlat60 = hlslcc_mtx4x4unity_MatrixV[2].z * vs_INTERP7.z + u_xlat60;
    u_xlat60 = u_xlat60 + hlslcc_mtx4x4unity_MatrixV[3].z;
    u_xlat60 = (-u_xlat60) + (-_ProjectionParams.y);
    u_xlat60 = max(u_xlat60, 0.0);
    u_xlat60 = u_xlat60 * unity_FogParams.z + unity_FogParams.w;
    u_xlat60 = clamp(u_xlat60, 0.0, 1.0);
    u_xlat16_12.xyz = u_xlat5.xzw * vec3(0.959999979, 0.959999979, 0.959999979);
    u_xlat16_61 = (-u_xlat62) + 1.0;
    u_xlat16_72 = u_xlat16_61 * u_xlat16_61;
    u_xlat16_72 = max(u_xlat16_72, 0.0078125);
    u_xlat16_13 = u_xlat16_72 * u_xlat16_72;
    u_xlat16_33 = u_xlat62 + 0.0400000215;
    u_xlat16_33 = min(u_xlat16_33, 1.0);
    u_xlat16_53 = u_xlat16_72 * 4.0 + 2.0;
    vec3 txVec0 = vec3(vs_INTERP3.xy,vs_INTERP3.z);
    u_xlat16_2 = textureLod(hlslcc_zcmp_MainLightShadowmapTexture, txVec0, 0.0);
    u_xlat16_73 = (-_MainLightShadowParams.x) + 1.0;
    u_xlat16_73 = u_xlat16_2 * _MainLightShadowParams.x + u_xlat16_73;
    u_xlatb2 = 0.0>=vs_INTERP3.z;
    u_xlatb22.x = vs_INTERP3.z>=1.0;
    u_xlatb2 = u_xlatb22.x || u_xlatb2;
    u_xlat16_73 = (u_xlatb2) ? 1.0 : u_xlat16_73;
    u_xlat2.xyz = vs_INTERP7.xyz + (-_WorldSpaceCameraPos.xyz);
    u_xlat2.x = dot(u_xlat2.xyz, u_xlat2.xyz);
    u_xlat22.x = u_xlat2.x * _MainLightShadowParams.z + _MainLightShadowParams.w;
    u_xlat22.x = clamp(u_xlat22.x, 0.0, 1.0);
    u_xlat16_14.x = (-u_xlat16_73) + 1.0;
    u_xlat16_73 = u_xlat22.x * u_xlat16_14.x + u_xlat16_73;
    u_xlatb22.x = _MainLightCookieTextureFormat!=-1.0;
    if(u_xlatb22.x){
        u_xlat22.xy = vs_INTERP7.yy * hlslcc_mtx4x4_MainLightWorldToLight[1].xy;
        u_xlat22.xy = hlslcc_mtx4x4_MainLightWorldToLight[0].xy * vs_INTERP7.xx + u_xlat22.xy;
        u_xlat22.xy = hlslcc_mtx4x4_MainLightWorldToLight[2].xy * vs_INTERP7.zz + u_xlat22.xy;
        u_xlat22.xy = u_xlat22.xy + hlslcc_mtx4x4_MainLightWorldToLight[3].xy;
        u_xlat22.xy = u_xlat22.xy * vec2(0.5, 0.5) + vec2(0.5, 0.5);
        u_xlat16_5 = texture(_MainLightCookieTexture, u_xlat22.xy, _GlobalMipBias.x);
        u_xlatb22.xy = equal(vec4(vec4(_MainLightCookieTextureFormat, _MainLightCookieTextureFormat, _MainLightCookieTextureFormat, _MainLightCookieTextureFormat)), vec4(0.0, 1.0, 0.0, 0.0)).xy;
        u_xlat16_14.x = (u_xlatb22.y) ? u_xlat16_5.w : u_xlat16_5.x;
        u_xlat16_14.xyz = (u_xlatb22.x) ? u_xlat16_5.xyz : u_xlat16_14.xxx;
    } else {
        u_xlat16_14.x = float(1.0);
        u_xlat16_14.y = float(1.0);
        u_xlat16_14.z = float(1.0);
    }
    u_xlat16_14.xyz = u_xlat16_14.xyz * _MainLightColor.xyz;
    u_xlat16_74 = dot((-u_xlat16_1.xyz), u_xlat0.xyz);
    u_xlat16_74 = u_xlat16_74 + u_xlat16_74;
    u_xlat16_15.xyz = u_xlat0.xyz * (-vec3(u_xlat16_74)) + (-u_xlat16_1.xyz);
    u_xlat16_74 = dot(u_xlat0.xyz, u_xlat16_1.xyz);
    u_xlat16_74 = clamp(u_xlat16_74, 0.0, 1.0);
    u_xlat16_74 = (-u_xlat16_74) + 1.0;
    u_xlat16_74 = u_xlat16_74 * u_xlat16_74;
    u_xlat16_74 = u_xlat16_74 * u_xlat16_74;
    u_xlatb22.x = 0.0<unity_SpecCube0_ProbePosition.w;
    u_xlatb23.xyz = lessThan(vec4(0.0, 0.0, 0.0, 0.0), u_xlat16_15.xyzz).xyz;
    u_xlat23.x = (u_xlatb23.x) ? unity_SpecCube0_BoxMax.x : unity_SpecCube0_BoxMin.x;
    u_xlat23.y = (u_xlatb23.y) ? unity_SpecCube0_BoxMax.y : unity_SpecCube0_BoxMin.y;
    u_xlat23.z = (u_xlatb23.z) ? unity_SpecCube0_BoxMax.z : unity_SpecCube0_BoxMin.z;
    u_xlat23.xyz = u_xlat23.xyz + (-vs_INTERP7.xyz);
    u_xlat16_16.xyz = u_xlat23.xyz / u_xlat16_15.xyz;
    u_xlat16_75 = min(u_xlat16_16.y, u_xlat16_16.x);
    u_xlat16_75 = min(u_xlat16_16.z, u_xlat16_75);
    u_xlat23.xyz = vs_INTERP7.xyz + (-unity_SpecCube0_ProbePosition.xyz);
    u_xlat16_16.xyz = u_xlat16_15.xyz * vec3(u_xlat16_75) + u_xlat23.xyz;
    u_xlat16_15.xyz = (u_xlatb22.x) ? u_xlat16_16.xyz : u_xlat16_15.xyz;
    u_xlat16_75 = (-u_xlat16_61) * 0.699999988 + 1.70000005;
    u_xlat16_61 = u_xlat16_61 * u_xlat16_75;
    u_xlat16_61 = u_xlat16_61 * 6.0;
    u_xlat16_5 = textureLod(unity_SpecCube0, u_xlat16_15.xyz, u_xlat16_61);
    u_xlat16_61 = u_xlat16_5.w + -1.0;
    u_xlat16_61 = unity_SpecCube0_HDR.w * u_xlat16_61 + 1.0;
    u_xlat16_61 = max(u_xlat16_61, 0.0);
    u_xlat16_61 = log2(u_xlat16_61);
    u_xlat16_61 = u_xlat16_61 * unity_SpecCube0_HDR.y;
    u_xlat16_61 = exp2(u_xlat16_61);
    u_xlat16_61 = u_xlat16_61 * unity_SpecCube0_HDR.x;
    u_xlat16_15.xyz = u_xlat16_5.xyz * vec3(u_xlat16_61);
    u_xlat16_16.xy = vec2(u_xlat16_72) * vec2(u_xlat16_72) + vec2(-1.0, 1.0);
    u_xlat16_61 = float(1.0) / u_xlat16_16.y;
    u_xlat16_72 = u_xlat16_33 + -0.0399999991;
    u_xlat16_72 = u_xlat16_74 * u_xlat16_72 + 0.0399999991;
    u_xlat22.x = u_xlat16_61 * u_xlat16_72;
    u_xlat16_15.xyz = u_xlat22.xxx * u_xlat16_15.xyz;
    u_xlat16_15.xyz = vs_INTERP2.xyz * u_xlat16_12.xyz + u_xlat16_15.xyz;
    u_xlat22.x = u_xlat16_73 * unity_LightData.z;
    u_xlat16_61 = dot(u_xlat0.xyz, _MainLightPosition.xyz);
    u_xlat16_61 = clamp(u_xlat16_61, 0.0, 1.0);
    u_xlat16_61 = u_xlat16_61 * u_xlat22.x;
    u_xlat16_14.xyz = vec3(u_xlat16_61) * u_xlat16_14.xyz;
    u_xlat22.xyz = u_xlat16_1.xyz + _MainLightPosition.xyz;
    u_xlat23.x = dot(u_xlat22.xyz, u_xlat22.xyz);
    u_xlat23.x = max(u_xlat23.x, 1.17549435e-38);
    u_xlat23.x = inversesqrt(u_xlat23.x);
    u_xlat22.xyz = u_xlat22.xyz * u_xlat23.xxx;
    u_xlat23.x = dot(u_xlat0.xyz, u_xlat22.xyz);
    u_xlat23.x = clamp(u_xlat23.x, 0.0, 1.0);
    u_xlat22.x = dot(_MainLightPosition.xyz, u_xlat22.xyz);
    u_xlat22.x = clamp(u_xlat22.x, 0.0, 1.0);
    u_xlat42 = u_xlat23.x * u_xlat23.x;
    u_xlat42 = u_xlat42 * u_xlat16_16.x + 1.00001001;
    u_xlat16_61 = u_xlat22.x * u_xlat22.x;
    u_xlat22.x = u_xlat42 * u_xlat42;
    u_xlat42 = max(u_xlat16_61, 0.100000001);
    u_xlat22.x = u_xlat42 * u_xlat22.x;
    u_xlat22.x = u_xlat16_53 * u_xlat22.x;
    u_xlat22.x = u_xlat16_13 / u_xlat22.x;
    u_xlat16_61 = u_xlat22.x + -6.10351562e-05;
    u_xlat16_61 = max(u_xlat16_61, 0.0);
    u_xlat16_61 = min(u_xlat16_61, 1000.0);
    u_xlat16_36.xyz = vec3(u_xlat16_61) * vec3(0.0399999991, 0.0399999991, 0.0399999991) + u_xlat16_12.xyz;
    u_xlat16_61 = min(_AdditionalLightsCount.x, unity_LightData.y);
    u_xlatu22 =  uint(int(u_xlat16_61));
    u_xlat2.x = u_xlat2.x * _AdditionalShadowFadeParams.x + _AdditionalShadowFadeParams.y;
    u_xlat2.x = clamp(u_xlat2.x, 0.0, 1.0);
    u_xlatb42.xy = equal(vec4(vec4(_AdditionalLightsCookieAtlasTextureFormat, _AdditionalLightsCookieAtlasTextureFormat, _AdditionalLightsCookieAtlasTextureFormat, _AdditionalLightsCookieAtlasTextureFormat)), vec4(0.0, 1.0, 0.0, 1.0)).xy;
    u_xlat16_17.x = float(0.0);
    u_xlat16_17.y = float(0.0);
    u_xlat16_17.z = float(0.0);
    for(uint u_xlatu_loop_1 = uint(0u) ; u_xlatu_loop_1<u_xlatu22 ; u_xlatu_loop_1++)
    {
        u_xlatu43 = uint(u_xlatu_loop_1 >> (2u & uint(0x1F)));
        u_xlati63 = int(uint(u_xlatu_loop_1 & 3u));
        u_xlat43 = dot(unity_LightIndices[int(u_xlatu43)], ImmCB_0[u_xlati63]);
        u_xlati43 = int(u_xlat43);
        u_xlat5.xyz = (-vs_INTERP7.xyz) * _AdditionalLightsPosition[u_xlati43].www + _AdditionalLightsPosition[u_xlati43].xyz;
        u_xlat63 = dot(u_xlat5.xyz, u_xlat5.xyz);
        u_xlat63 = max(u_xlat63, 6.10351562e-05);
        u_xlat65 = inversesqrt(u_xlat63);
        u_xlat6.xyz = vec3(u_xlat65) * u_xlat5.xyz;
        u_xlat66 = float(1.0) / float(u_xlat63);
        u_xlat63 = u_xlat63 * _AdditionalLightsAttenuation[u_xlati43].x;
        u_xlat16_61 = (-u_xlat63) * u_xlat63 + 1.0;
        u_xlat16_61 = max(u_xlat16_61, 0.0);
        u_xlat16_61 = u_xlat16_61 * u_xlat16_61;
        u_xlat63 = u_xlat16_61 * u_xlat66;
        u_xlat16_61 = dot(_AdditionalLightsSpotDir[u_xlati43].xyz, u_xlat6.xyz);
        u_xlat16_61 = u_xlat16_61 * _AdditionalLightsAttenuation[u_xlati43].z + _AdditionalLightsAttenuation[u_xlati43].w;
        u_xlat16_61 = clamp(u_xlat16_61, 0.0, 1.0);
        u_xlat16_61 = u_xlat16_61 * u_xlat16_61;
        u_xlat63 = u_xlat16_61 * u_xlat63;
        u_xlati66 = int(_AdditionalShadowParams[u_xlati43].w);
        u_xlatb7.x = u_xlati66>=0;
        if(u_xlatb7.x){
            u_xlatb7.x = vec4(0.0, 0.0, 0.0, 0.0)!=vec4(_AdditionalShadowParams[u_xlati43].z);
            if(u_xlatb7.x){
                u_xlatb7.xyz = greaterThanEqual(abs(u_xlat6.zzyz), abs(u_xlat6.xyxx)).xyz;
                u_xlatb7.x = u_xlatb7.y && u_xlatb7.x;
                u_xlatb8.xyz = lessThan((-u_xlat6.zyxz), vec4(0.0, 0.0, 0.0, 0.0)).xyz;
                u_xlat27.x = (u_xlatb8.x) ? float(5.0) : float(4.0);
                u_xlat27.z = (u_xlatb8.y) ? float(3.0) : float(2.0);
                u_xlat8.x = u_xlatb8.z ? 1.0 : float(0.0);
                u_xlat47 = (u_xlatb7.z) ? u_xlat27.z : u_xlat8.x;
                u_xlat7.x = (u_xlatb7.x) ? u_xlat27.x : u_xlat47;
                u_xlat27.x = trunc(_AdditionalShadowParams[u_xlati43].w);
                u_xlat7.x = u_xlat7.x + u_xlat27.x;
                u_xlati66 = int(u_xlat7.x);
            }
            u_xlati66 = int(u_xlati66 << (2 & int(0x1F)));
            u_xlat7 = vs_INTERP7.yyyy * hlslcc_mtx4x4_AdditionalLightsWorldToShadow[(u_xlati66 + 1)];
            u_xlat7 = hlslcc_mtx4x4_AdditionalLightsWorldToShadow[u_xlati66] * vs_INTERP7.xxxx + u_xlat7;
            u_xlat7 = hlslcc_mtx4x4_AdditionalLightsWorldToShadow[(u_xlati66 + 2)] * vs_INTERP7.zzzz + u_xlat7;
            u_xlat7 = u_xlat7 + hlslcc_mtx4x4_AdditionalLightsWorldToShadow[(u_xlati66 + 3)];
            u_xlat7.xyz = u_xlat7.xyz / u_xlat7.www;
            vec3 txVec1 = vec3(u_xlat7.xy,u_xlat7.z);
            u_xlat16_66 = textureLod(hlslcc_zcmp_AdditionalLightsShadowmapTexture, txVec1, 0.0);
            u_xlat16_61 = 1.0 + (-_AdditionalShadowParams[u_xlati43].x);
            u_xlat16_61 = u_xlat16_66 * _AdditionalShadowParams[u_xlati43].x + u_xlat16_61;
            u_xlatb66 = 0.0>=u_xlat7.z;
            u_xlatb7.x = u_xlat7.z>=1.0;
            u_xlatb66 = u_xlatb66 || u_xlatb7.x;
            u_xlat16_61 = (u_xlatb66) ? 1.0 : u_xlat16_61;
        } else {
            u_xlat16_61 = 1.0;
        }
        u_xlat16_72 = (-u_xlat16_61) + 1.0;
        u_xlat16_61 = u_xlat2.x * u_xlat16_72 + u_xlat16_61;
        u_xlati66 = int(1 << (u_xlati43 & int(0x1F)));
        u_xlati66 = int(uint(uint(u_xlati66) & uint(floatBitsToUint(_AdditionalLightsCookieEnableBits))));
        if(u_xlati66 != 0) {
            u_xlati66 = int(_AdditionalLightsLightTypes[u_xlati43]);
            u_xlati7 = (u_xlati66 != 0) ? 0 : 1;
            u_xlati27 = int(u_xlati43 << (2 & int(0x1F)));
            if(u_xlati7 != 0) {
                u_xlat7.xzw = vs_INTERP7.yyy * hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 1)].xyw;
                u_xlat7.xzw = hlslcc_mtx4x4_AdditionalLightsWorldToLights[u_xlati27].xyw * vs_INTERP7.xxx + u_xlat7.xzw;
                u_xlat7.xzw = hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 2)].xyw * vs_INTERP7.zzz + u_xlat7.xzw;
                u_xlat7.xzw = u_xlat7.xzw + hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 3)].xyw;
                u_xlat7.xz = u_xlat7.xz / u_xlat7.ww;
                u_xlat7.xz = u_xlat7.xz * vec2(0.5, 0.5) + vec2(0.5, 0.5);
                u_xlat7.xz = clamp(u_xlat7.xz, 0.0, 1.0);
                u_xlat7.xz = _AdditionalLightsCookieAtlasUVRects[u_xlati43].xy * u_xlat7.xz + _AdditionalLightsCookieAtlasUVRects[u_xlati43].zw;
            } else {
                u_xlatb66 = u_xlati66==1;
                u_xlati66 = u_xlatb66 ? 1 : int(0);
                if(u_xlati66 != 0) {
                    u_xlat8.xy = vs_INTERP7.yy * hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 1)].xy;
                    u_xlat8.xy = hlslcc_mtx4x4_AdditionalLightsWorldToLights[u_xlati27].xy * vs_INTERP7.xx + u_xlat8.xy;
                    u_xlat8.xy = hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 2)].xy * vs_INTERP7.zz + u_xlat8.xy;
                    u_xlat8.xy = u_xlat8.xy + hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 3)].xy;
                    u_xlat8.xy = u_xlat8.xy * vec2(0.5, 0.5) + vec2(0.5, 0.5);
                    u_xlat8.xy = fract(u_xlat8.xy);
                    u_xlat7.xz = _AdditionalLightsCookieAtlasUVRects[u_xlati43].xy * u_xlat8.xy + _AdditionalLightsCookieAtlasUVRects[u_xlati43].zw;
                } else {
                    u_xlat8 = vs_INTERP7.yyyy * hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 1)];
                    u_xlat8 = hlslcc_mtx4x4_AdditionalLightsWorldToLights[u_xlati27] * vs_INTERP7.xxxx + u_xlat8;
                    u_xlat8 = hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 2)] * vs_INTERP7.zzzz + u_xlat8;
                    u_xlat8 = u_xlat8 + hlslcc_mtx4x4_AdditionalLightsWorldToLights[(u_xlati27 + 3)];
                    u_xlat8.xyz = u_xlat8.xyz / u_xlat8.www;
                    u_xlat66 = dot(u_xlat8.xyz, u_xlat8.xyz);
                    u_xlat66 = inversesqrt(u_xlat66);
                    u_xlat8.xyz = vec3(u_xlat66) * u_xlat8.xyz;
                    u_xlat66 = dot(abs(u_xlat8.xyz), vec3(1.0, 1.0, 1.0));
                    u_xlat66 = max(u_xlat66, 9.99999997e-07);
                    u_xlat66 = float(1.0) / float(u_xlat66);
                    u_xlat9.xyz = vec3(u_xlat66) * u_xlat8.zxy;
                    u_xlat9.x = (-u_xlat9.x);
                    u_xlat9.x = clamp(u_xlat9.x, 0.0, 1.0);
                    u_xlatb27.xz = greaterThanEqual(u_xlat9.yyzz, vec4(0.0, 0.0, 0.0, 0.0)).xz;
                    u_xlat27.x = (u_xlatb27.x) ? u_xlat9.x : (-u_xlat9.x);
                    u_xlat27.z = (u_xlatb27.z) ? u_xlat9.x : (-u_xlat9.x);
                    u_xlat27.xz = u_xlat8.xy * vec2(u_xlat66) + u_xlat27.xz;
                    u_xlat27.xz = u_xlat27.xz * vec2(0.5, 0.5) + vec2(0.5, 0.5);
                    u_xlat27.xz = clamp(u_xlat27.xz, 0.0, 1.0);
                    u_xlat7.xz = _AdditionalLightsCookieAtlasUVRects[u_xlati43].xy * u_xlat27.xz + _AdditionalLightsCookieAtlasUVRects[u_xlati43].zw;
                }
            }
            u_xlat16_7 = textureLod(_AdditionalLightsCookieAtlasTexture, u_xlat7.xz, 0.0);
            u_xlat16_72 = (u_xlatb42.y) ? u_xlat16_7.w : u_xlat16_7.x;
            u_xlat16_18.xyz = (u_xlatb42.x) ? u_xlat16_7.xyz : vec3(u_xlat16_72);
        } else {
            u_xlat16_18.x = float(1.0);
            u_xlat16_18.y = float(1.0);
            u_xlat16_18.z = float(1.0);
        }
        u_xlat16_18.xyz = u_xlat16_18.xyz * _AdditionalLightsColor[u_xlati43].xyz;
        u_xlat43 = u_xlat16_61 * u_xlat63;
        u_xlat16_61 = dot(u_xlat0.xyz, u_xlat6.xyz);
        u_xlat16_61 = clamp(u_xlat16_61, 0.0, 1.0);
        u_xlat16_61 = u_xlat16_61 * u_xlat43;
        u_xlat16_18.xyz = vec3(u_xlat16_61) * u_xlat16_18.xyz;
        u_xlat5.xyz = u_xlat5.xyz * vec3(u_xlat65) + u_xlat16_1.xyz;
        u_xlat43 = dot(u_xlat5.xyz, u_xlat5.xyz);
        u_xlat43 = max(u_xlat43, 1.17549435e-38);
        u_xlat43 = inversesqrt(u_xlat43);
        u_xlat5.xyz = vec3(u_xlat43) * u_xlat5.xyz;
        u_xlat43 = dot(u_xlat0.xyz, u_xlat5.xyz);
        u_xlat43 = clamp(u_xlat43, 0.0, 1.0);
        u_xlat63 = dot(u_xlat6.xyz, u_xlat5.xyz);
        u_xlat63 = clamp(u_xlat63, 0.0, 1.0);
        u_xlat43 = u_xlat43 * u_xlat43;
        u_xlat43 = u_xlat43 * u_xlat16_16.x + 1.00001001;
        u_xlat16_61 = u_xlat63 * u_xlat63;
        u_xlat43 = u_xlat43 * u_xlat43;
        u_xlat63 = max(u_xlat16_61, 0.100000001);
        u_xlat43 = u_xlat63 * u_xlat43;
        u_xlat43 = u_xlat16_53 * u_xlat43;
        u_xlat43 = u_xlat16_13 / u_xlat43;
        u_xlat16_61 = u_xlat43 + -6.10351562e-05;
        u_xlat16_61 = max(u_xlat16_61, 0.0);
        u_xlat16_61 = min(u_xlat16_61, 1000.0);
        u_xlat16_19.xyz = vec3(u_xlat16_61) * vec3(0.0399999991, 0.0399999991, 0.0399999991) + u_xlat16_12.xyz;
        u_xlat16_17.xyz = u_xlat16_19.xyz * u_xlat16_18.xyz + u_xlat16_17.xyz;
    }
    u_xlat16_1.xyz = u_xlat16_36.xyz * u_xlat16_14.xyz + u_xlat16_15.xyz;
    u_xlat16_4.xyz = u_xlat16_17.xyz + u_xlat16_1.xyz;
    u_xlat16_1 = min(u_xlat16_4, vec4(65504.0, 65504.0, 65504.0, 65504.0));
    u_xlat16_1.xyz = u_xlat16_1.xyz + (-unity_FogColor.xyz);
    SV_Target0.xyz = vec3(u_xlat60) * u_xlat16_1.xyz + unity_FogColor.xyz;
    SV_Target0.w = (u_xlatb3) ? u_xlat16_1.w : 1.0;
    return;
}

#endif
