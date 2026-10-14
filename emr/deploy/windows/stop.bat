@echo off
rem Stops the EMR (app, HTTPS and database).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
exit /b %ERRORLEVEL%
