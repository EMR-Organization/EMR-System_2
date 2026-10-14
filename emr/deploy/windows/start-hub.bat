@echo off
rem Starts the EMR for everyone on the Wi-Fi. Keep the window open while the clinic runs.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" -Mode hub
set code=%ERRORLEVEL%
if "%EMR_NO_PAUSE%"=="" pause
exit /b %code%
