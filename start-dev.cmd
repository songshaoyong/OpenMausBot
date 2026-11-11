@echo off
rem Starts the two dev processes if their ports are free. Safe to run repeatedly.
cd /d "%~dp0"
set "NODE_OPTIONS="

netstat -ano | findstr /r /c:":8799 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "omb-server" /min cmd /c "node --experimental-strip-types server/dev-server.ts > .devsrv.log 2>&1"
  echo started server on 8799
) else (
  echo server already listening on 8799
)

netstat -ano | findstr /r /c:":5199 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "omb-web" /min cmd /c "node node_modules\vite\bin\vite.js > .devweb.log 2>&1"
  echo started web on 5199
) else (
  echo web already listening on 5199
)

ping -n 4 127.0.0.1 >nul
start "" http://127.0.0.1:5199/
