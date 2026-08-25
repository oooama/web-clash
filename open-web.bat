@echo off
cd /d "%~dp0"

echo [open-web] running start.bat ...
call start.bat

echo [open-web] opening http://127.0.0.1:7891
start "" "http://127.0.0.1:7891"
exit /b 0