@echo off
rem Launches OpenMausBot for daily use: brings up the Podman machine that hosts
rem the private desktop, then the server (8799) and the web UI (5199).
rem Safe to run again while everything is already up.
setlocal
title OpenMausBot
set "PATH=C:\Program Files\RedHat\Podman;%PATH%"
cd /d "%~dp0"
set "NODE_OPTIONS="
rem Invite and pairing links need the address other devices reach this machine at.
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -like '192.168.*' } ^| Select-Object -First 1).IPAddress"') do set "LANIP=%%i"
if defined LANIP set "OMB_PUBLIC_URL=http://%LANIP%:5199"

echo [1/3] Podman desktop runtime...
for /f "delims=" %%s in ('podman machine inspect podman-machine-default --format "{{.State}}" 2^>nul') do set "STATE=%%s"
if /i "%STATE%"=="running" (
  echo       already running
) else (
  echo       starting...
  podman machine start
)

echo [2/3] Server on 8799...
netstat -ano | findstr /r /c:":8799 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "omb-server" /min cmd /c "node --experimental-strip-types server/dev-server.ts > .devsrv.log 2>&1"
  echo       started
) else (
  echo       already running
)

echo [3/3] Web UI on 5199...
netstat -ano | findstr /r /c:":5199 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "omb-web" /min cmd /c "node node_modules\vite\bin\vite.js > .devweb.log 2>&1"
  echo       started
) else (
  echo       already running
)

set /a tries=0
:wait
set /a tries+=1
curl.exe -s -o nul --max-time 3 http://127.0.0.1:5199/ && goto ready
if %tries% geq 30 goto giveup
ping -n 3 127.0.0.1 >nul
goto wait

:ready
echo.
echo Ready: http://127.0.0.1:5199
start "" http://127.0.0.1:5199/
ping -n 3 127.0.0.1 >nul
exit /b 0

:giveup
echo.
echo The web UI did not answer within 90 seconds. See .devweb.log and .devsrv.log.
pause
exit /b 1
