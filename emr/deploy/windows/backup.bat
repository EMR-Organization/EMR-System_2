@echo off
rem Writes an encrypted backup to data\backups now. Scheduled nightly by setup (with /scheduled).
if /i "%~1"=="/scheduled" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1" -Scheduled
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1"
set code=%ERRORLEVEL%
if "%EMR_NO_PAUSE%"=="" pause
exit /b %code%
