@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

title llmgw Gateway

echo.
echo  ================================================
echo    llmgw - Windows Launcher
echo  ================================================
echo.

:: ── Check Node.js ──────────────────────────────────────────
echo  [STEP 1] Checking Node.js...
node --version 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo  Download: https://nodejs.org/ (requires v22+)
    pause
    exit /b 1
)

:: ── Check npm ──────────────────────────────────────────────
echo  [STEP 2] Checking npm...
npm --version 2>&1
if errorlevel 1 (
    echo  [ERROR] npm not found.
    pause
    exit /b 1
)

:: ── cd to project root ────────────────────────────────────
echo  [STEP 3] Setting working directory...
cd /d "%~dp0"
echo  Dir: %CD%

:: ── Install dependencies ──────────────────────────────────
echo  [STEP 4] Checking node_modules...
if not exist "node_modules" (
    echo  Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause
        exit /b 1
    )
) else (
    echo  node_modules exists.
)

:: ── Build ──────────────────────────────────────────────────
echo  [STEP 5] Checking build...
if not exist "dist\server.mjs" (
    echo  Building...
    call npm run build
    if errorlevel 1 (
        echo  [ERROR] Build failed.
        pause
        exit /b 1
    )
) else (
    echo  dist\server.mjs exists.
)

:: ── Find Chrome ────────────────────────────────────────────
echo  [STEP 6] Finding Chrome...
set "CHROME_PATH="

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if defined CHROME_PATH (
    echo  Found: !CHROME_PATH!
) else (
    echo  Chrome not found. Web providers won't work.
)

:: ── Kill existing debug Chrome ─────────────────────────────
echo  [STEP 7] Cleaning old debug Chrome...
set "CDP_PORT=9222"
taskkill /f /fi "COMMANDLINE eq *remote-debugging-port=%CDP_PORT%*" >nul 2>&1
timeout /t 1 /nobreak >nul
echo  Done.

:: ── Start Chrome ───────────────────────────────────────────
if defined CHROME_PATH (
    echo  [STEP 8] Starting Chrome...
    if not exist "%USERPROFILE%\.llmgw\chrome-data" mkdir "%USERPROFILE%\.llmgw\chrome-data"
    start "" "!CHROME_PATH!" ^
        --remote-debugging-port=%CDP_PORT% ^
        --user-data-dir="%USERPROFILE%\.llmgw\chrome-data" ^
        --no-first-run ^
        --no-default-browser-check ^
        --remote-allow-origins=*
    echo  Chrome started.
) else (
    echo  [STEP 8] Skipping Chrome (not found^).
)

:: ── Start server ───────────────────────────────────────────
echo.
echo  ================================================
echo    Starting llmgw on http://localhost:8080
echo  ================================================
echo.
echo  Ctrl+C to stop.
echo.

call npm start

echo.
echo  [*] Server stopped.
pause
