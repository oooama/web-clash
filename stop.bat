@echo off
cd /d "%~dp0"

rem Prefer the PID recorded by the console (server/lib/core.js): kill only
rem that process, never every mihomo-run.exe on the machine.
set COREPID=
if exist "data\core.pid" set /p COREPID=<data\core.pid

if not "%COREPID%"=="" goto :killpid

rem No PID file: fall back to whatever listens on the core ports
rem (7892 mixed / 9090 controller), still not every mihomo-run.exe.
for %%p in (7892 9090) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":%%p " ^| findstr LISTENING') do (
        taskkill /F /PID %%a >nul 2>&1
    )
)
goto :killweb

:killpid
tasklist /FI "PID eq %COREPID%" 2>nul | find /I "mihomo-run.exe" >nul
if not errorlevel 1 taskkill /F /PID %COREPID% >nul 2>&1
del /q "data\core.pid" >nul 2>&1

:killweb
rem Only kill the process listening on the web console port (7891),
rem instead of killing every node.exe on the system.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":7891 " ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1

exit /b 0
