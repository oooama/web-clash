@echo off
cd /d "%~dp0"

rem Usage: start.bat [--no-proxy]
rem   --no-proxy   start core and web console without enabling the system proxy

if not exist "node_modules" (
    echo Installing dependencies...
    npm install --production --omit=dev
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed!
        goto :fail
    )
)

if not exist "bin\mihomo-run.exe" (
    echo [ERROR] bin\mihomo-run.exe not found!
    goto :fail
)

echo Starting ProxyNexus...

rem Start the web console first: it generates data\config.yaml on first run,
rem which mihomo needs in order to boot.
powershell -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WindowStyle Hidden"

timeout /t 2 /nobreak >nul

if not exist "data\config.yaml" (
    echo [ERROR] data\config.yaml was not generated!
    goto :fail
)

powershell -Command "Start-Process -FilePath 'bin\mihomo-run.exe' -ArgumentList '-d','data','-f','data\config.yaml' -WindowStyle Hidden"

timeout /t 2 /nobreak >nul

tasklist /FI "IMAGENAME eq mihomo-run.exe" 2>nul | find /I "mihomo-run.exe" >nul
if %errorlevel% neq 0 (
    echo [ERROR] mihomo core failed to start!
    goto :fail
)

if /i not "%~1"=="--no-proxy" (
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f >nul 2>&1
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:7890" /f >nul 2>&1
)

echo Done.
exit /b 0

:fail
pause
exit /b 1
