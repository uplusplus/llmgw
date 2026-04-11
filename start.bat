@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

title llmgw Gateway

:: ── Config ──────────────────────────────────────────────────
set "CDP_PORT=9222"
set "SERVER_PORT=8080"
set "CHROME_DATA=%USERPROFILE%\.llmgw\chrome-data"

:: ── Header ─────────────────────────────────────────────────
echo.
echo  ================================================
echo    llmgw — Windows Launcher
echo  ================================================
echo.

:: ── Check Node.js ──────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo  Download: https://nodejs.org/ (requires v22+)
    pause
    exit /b 1
)

:: Check Node version >= 22
for /f "tokens=1 delims=v" %%a in ('node -v') do set "NODE_VER=%%a"
for /f "tokens=1 delims=." %%a in ("%NODE_VER%") do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% LSS 22 (
    echo  [ERROR] Node.js v22+ required, found v%NODE_VER%
    pause
    exit /b 1
)
echo  [OK] Node.js %NODE_VER%

:: ── Check npm ──────────────────────────────────────────────
where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] npm not found. It should come with Node.js.
    pause
    exit /b 1
)

:: ── cd to project root ────────────────────────────────────
cd /d "%~dp0"
echo  [OK] Project: %CD%

:: ── Install dependencies ──────────────────────────────────
if not exist "node_modules" (
    echo  [*] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed
) else (
    echo  [OK] Dependencies ready
)

:: ── Build ──────────────────────────────────────────────────
if not exist "dist\server.mjs" (
    echo  [*] Building...
    call npm run build
    if errorlevel 1 (
        echo  [ERROR] Build failed.
        pause
        exit /b 1
    )
    echo  [OK] Build complete
) else (
    echo  [OK] Build exists
)

:: ── Find Chrome ────────────────────────────────────────────
set "CHROME_PATH="

:: Common Chrome paths on Windows
set "PATHS=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "PATHS=!PATHS!;%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "PATHS=!PATHS!;%LocalAppData%\Google\Chrome\Application\chrome.exe"
set "PATHS=!PATHS!;%ProgramFiles%\Chromium\Application\chrome.exe"

for %%p in (%PATHS%) do (
    if exist "%%p" (
        set "CHROME_PATH=%%p"
        goto :chrome_found
    )
)

:: Try to find via registry
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr REG_SZ') do (
    if exist "%%b" set "CHROME_PATH=%%b"
)

:chrome_found
if defined CHROME_PATH (
    echo  [OK] Chrome: %CHROME_PATH%
) else (
    echo  [WARN] Chrome not found. Web providers won't work.
    echo         Install Chrome or set CHROME_PATH manually.
)

:: ── Kill existing debug Chrome ─────────────────────────────
echo.
echo  [*] Cleaning up old debug Chrome...
taskkill /f /fi "COMMANDLINE eq *remote-debugging-port=%CDP_PORT%*" >nul 2>&1
timeout /t 1 /nobreak >nul

:: ── Start Chrome (debug mode) ──────────────────────────────
if defined CHROME_PATH (
    if not exist "%CHROME_DATA%" mkdir "%CHROME_DATA%"
    echo  [*] Starting Chrome (CDP port %CDP_PORT%)...
    start "" "%CHROME_PATH%" ^
        --remote-debugging-port=%CDP_PORT% ^
        --user-data-dir="%CHROME_DATA%" ^
        --no-first-run ^
        --no-default-browser-check ^
        --disable-background-networking ^
        --disable-sync ^
        --disable-translate ^
        --remote-allow-origins=*

    :: Wait for CDP ready
    echo  [*] Waiting for Chrome CDP...
    for /l %%i in (1,1,15) do (
        curl -sf http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
        if not errorlevel 1 (
            echo  [OK] Chrome CDP ready
            goto :chrome_ready
        )
        timeout /t 1 /nobreak >nul
        echo|set /p="."
    )
    echo.
    echo  [WARN] Chrome CDP not responding. Continuing anyway...
)

:chrome_ready

:: ── Start server ───────────────────────────────────────────
echo.
echo  ================================================
echo    Starting llmgw on http://localhost:%SERVER_PORT%
echo  ================================================
echo.
echo  Endpoints:
echo    POST /v1/chat/completions
echo    GET  /v1/models
echo    GET  /health
echo.
echo  Press Ctrl+C to stop.
echo.

call npm start

:: ── Cleanup on exit ────────────────────────────────────────
echo.
echo  [*] Shutting down...
if defined CHROME_PATH (
    taskkill /f /fi "COMMANDLINE eq *remote-debugging-port=%CDP_PORT%*" >nul 2>&1
)
echo  [OK] Done.
pause
