@echo off
set "PATH=C:\Program Files\RedHat\Podman;%PATH%"
echo [1/2] pulling base image
podman pull docker.io/trycua/xfce-cua@sha256:274eb636f5cf3fc58f705916ee72b7a701270b3877369d08533a385c5325be9b
if errorlevel 1 goto :fail
echo [2/2] building managed image
podman build --force-rm -t localhost/openmausbot/cua-local-vm:driver-0.37.0-v8 "e:\projecte\OpenMausBot\.vm-ctx2"
if errorlevel 1 goto :fail
echo BUILD-OK
exit /b 0
:fail
echo BUILD-FAILED
exit /b 1
