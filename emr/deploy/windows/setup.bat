@echo off
rem One-time setup of this laptop. Run as administrator for the firewall rule and PC rename.
rem Fallback laptops: setup.bat -Role fallback -SyncKeyFile E:\sync-key.txt -ProvisionFile E:\provision.hfprov -FirstNumber 5001
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
set code=%ERRORLEVEL%
if "%EMR_NO_PAUSE%"=="" pause
exit /b %code%
