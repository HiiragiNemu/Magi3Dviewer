@echo off
setlocal enabledelayedexpansion
chcp 65001

:: --- CONFIGURATION ---
set "CLI_PATH=C:\Users\31126\Desktop\AssetStudio\AssetStudioCLI\bin\Release\net9.0\AssetStudioModCLI.exe"
set "SRC_DIR=D:\madodora\下载解密一条龙脚本\magia_exedra_decrypted_new\battle\character"
set "BASE_OUT_DIR=D:\madodora\character_models\latest_animate"

:: Release-specific input is mandatory. Resolve from the tracked manifest;
:: an unknown, cross-region, or legacy evidence-only profile fails closed.
if "%RELEASE_PROFILE%"=="" (
    echo [ERROR] RELEASE_PROFILE is required. Examples: jp-android-3.13.0 or tw-android-1.1.2.
    exit /b 2
)
set "UNITY_VERSION="
set "RESOLVE_OUT=%TEMP%\magius-unity-version-%RANDOM%-%RANDOM%.txt"
python "%~dp0resolve-unity-release-profile.py" --profile "%RELEASE_PROFILE%" > "%RESOLVE_OUT%"
set "RESOLVE_EXIT=!ERRORLEVEL!"
if not "!RESOLVE_EXIT!"=="0" (
    del /q "%RESOLVE_OUT%" >nul 2>&1
    exit /b !RESOLVE_EXIT!
)
for /f "usebackq delims=" %%V in ("%RESOLVE_OUT%") do set "UNITY_VERSION=%%V"
del /q "%RESOLVE_OUT%" >nul 2>&1
if not defined UNITY_VERSION (
    echo [ERROR] RELEASE_PROFILE "%RELEASE_PROFILE%" resolved without a Unity version.
    exit /b 3
)

:: Loop through every folder in the source directory
for %%F in ("%SRC_DIR%\*.*") do (
    set "FILE_NAME=%%~nxF"
    set "CURRENT_OUT_DIR=%BASE_OUT_DIR%\!FILE_NAME!"

    echo --------------------------------------------------------
    echo Processing: !FILE_NAME!
    echo --------------------------------------------------------

    "%CLI_PATH%" "%%F" --unity-version "%UNITY_VERSION%" --mode animator --fbx-animation all --fbx-uvs-as-diffuse -o "!CURRENT_OUT_DIR!"

    if exist "!CURRENT_OUT_DIR!\FBX_Animator\VisualRoot\" (
        echo Moving files and cleaning up...
        move "!CURRENT_OUT_DIR!\FBX_Animator\VisualRoot\*.*" "!CURRENT_OUT_DIR!\"
        rd /s /q "!CURRENT_OUT_DIR!\FBX_Animator"
    ) else (
        echo [WARNING] FBX_Animator\VisualRoot not found for !FILE_NAME!.
    )
)

echo --------------------------------------------------------
echo DONE: All characters processed.
pause
