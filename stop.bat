@echo off
cd /d "%~dp0"

taskkill /F /IM mihomo-run.exe >nul 2>&1

rem Only kill the process listening on the web console port (7891),
rem instead of killing every node.exe on the system.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7891" ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1

exit /b 0
