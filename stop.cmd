@echo off
rem Double-click to stop the karaoke app (see scripts\stop.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
pause
