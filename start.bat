@echo off
setlocal
cd /d "%~dp0"
title FX Leverage Front

where node >nul 2>nul
if errorlevel 1 goto nonode

netstat -ano | findstr /R /C:":8787 .*LISTENING" >nul 2>nul
if not errorlevel 1 goto running

if exist node_modules goto build
echo [1/3] npm install ...
call npm install
if errorlevel 1 goto fail

:build
if exist dist\index.html goto run
echo [2/3] npm run build ...
call npm run build
if errorlevel 1 goto fail

:run
echo [3/3] Starting server: http://127.0.0.1:8787  (close this window to stop)
start "" "http://127.0.0.1:8787"
call npm start
echo.
echo Server stopped.
pause
exit /b 0

:running
echo Server is already running on port 8787. Opening browser...
start "" "http://127.0.0.1:8787"
ping -n 3 127.0.0.1 >nul
exit /b 0

:nonode
echo [x] Node.js not found. Please install Node.js (verified on v26.13): https://nodejs.org/
pause
exit /b 1

:fail
echo [x] Failed. See the messages above.
pause
exit /b 1
