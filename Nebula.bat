@echo off
rem Start Nebula Launcher from the source folder (dev mode without installer)
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies, please wait...
  call npm install
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
