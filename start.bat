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
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WindowStyle Hidden"

rem Wait until the console actually answers on 7891 (up to ~15s) instead of
rem assuming a fixed sleep was enough.
set /a tries=0
:waitconsole
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7891/api/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto :consoleup
set /a tries+=1
if %tries% lss 15 (
    timeout /t 1 /nobreak >nul
    goto :waitconsole
)
echo [ERROR] web console did not come up on port 7891!
goto :fail

:consoleup
if not exist "data\config.yaml" (
    echo [ERROR] data\config.yaml was not generated!
    goto :fail
)

rem Let the console spawn the core via POST /api/start so the PID is recorded
rem in data\core.pid; stop.bat and /api/stop then target exactly that process.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:7891/api/start' -Headers @{ 'X-Console-Request' = '1' } -TimeoutSec 15 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] core start request failed!
    goto :fail
)

rem Give the core a moment, then confirm it is reachable via the console.
timeout /t 3 /nobreak >nul
powershell -NoProfile -Command "try { $s = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:7891/api/status' -TimeoutSec 5; if ($s.running) { exit 0 } } catch { }; exit 1" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] mihomo core failed to start!
    goto :fail
)

if /i not "%~1"=="--no-proxy" (
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f >nul 2>&1
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:7892" /f >nul 2>&1
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.*;10.*;192.168.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>" /f >nul 2>&1
)

echo Done.
exit /b 0

:fail
pause
exit /b 1
