@echo off
REM Enter script dir so relative path (main.js) works
cd /d "%~dp0"

REM Clear ELECTRON_RUN_AS_NODE (forces Electron into Node mode)
set ELECTRON_RUN_AS_NODE=

REM Wait for Ollama up to 60s (autostart may race with Ollama startup)
echo [start-app] Waiting for Ollama...
for /l %%i in (1,1,60) do (
    curl -s -o nul -m 1 http://127.0.0.1:11434/api/version >nul 2>&1 && goto ollama_ready
    timeout /t 1 /nobreak >nul
)
:ollama_ready
echo [start-app] Ollama ready

REM Prefer global electron, else electron-bin
where electron >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    electron main.js
) else if exist "d:\worklocation\electron-bin\electron.exe" (
    "d:\worklocation\electron-bin\electron.exe" main.js
) else (
    echo [ERROR] Electron not found. Run: npm install -g electron
    pause
)
