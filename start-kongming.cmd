@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -Command "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%~dp0scripts\supervise.ps1""'"
