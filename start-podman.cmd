@echo off
rem Keeps the Podman machine (which hosts a bot's private desktop) up without a window.
set "PATH=C:\Program Files\RedHat\Podman;%PATH%"
set "STATE="
for /f "delims=" %%s in ('podman machine inspect podman-machine-default --format "{{.State}}" 2^>nul') do set "STATE=%%s"
if /i "%STATE%"=="running" exit /b 0
podman machine start >nul 2>&1
exit /b 0
