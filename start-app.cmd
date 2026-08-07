@echo off
REM LifeLens Startup Script
REM Auto-detects Electron from node_modules or global install

cd /d "%~dp0"

REM Clear ELECTRON_RUN_AS_NODE (forces Electron into Node mode)
set ELECTRON_RUN_AS_NODE=

echo [LifeLens] Starting...

REM Option 1: Use npm start (recommended after npm install)
if exist "node_modules\.bin\electron.cmd" (
    echo [LifeLens] Using local Electron...
    call npx electron main.js
    goto :end
)

REM Option 2: Use global electron
where electron >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [LifeLens] Using global Electron...
    electron main.js
    goto :end
)

REM Fallback: prompt user to install
echo [ERROR] Electron not found.
echo.
echo Please run: npm install
echo Or install globally: npm install -g electron
echo.
pause
:end
