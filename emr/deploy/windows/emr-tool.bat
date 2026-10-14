@echo off
rem Runs an EMR tool with this laptop's settings, e.g. emr-tool.bat provision-node
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tool.ps1" %*
exit /b %ERRORLEVEL%
