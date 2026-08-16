@echo off
REM ZIA Command Deck - double-click launcher.
REM Wraps Start-Dashboard.ps1 because .ps1 files open in an editor when double-clicked,
REM and the default execution policy blocks them. -ExecutionPolicy Bypass applies to
REM this one process only; it changes nothing on the machine.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Dashboard.ps1" %*
if errorlevel 1 pause
