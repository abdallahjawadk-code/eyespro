@echo off
REM Launch EyesPro in developer bypass mode (no license required)
REM This is for the owner/developer only — do NOT distribute this script
set EYESPRO_BYPASS_LICENSE=1
start "" "release\win-unpacked\EyesPro.exe"
