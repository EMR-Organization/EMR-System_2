@echo off
rem Fallback laptop: starts the EMR for this laptop only (if the hub has failed).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" -Mode standalone
set code=%ERRORLEVEL%
if "%EMR_NO_PAUSE%"=="" pause
exit /b %code%
