@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

title llmgw Gateway

:: ── Config ─────────────────────────────────────────────────
set "CDP_PORT=9222"
set "SERVER_PORT=8080"
set "CHROME_DATA=%USERPROFILE%\.llmgw\chrome-data"

echo.
echo  ================================================
echo    llmgw - OpenAI-compatible Gateway
echo    Zero Token Cost via Browser-Driven LLMs
echo  ================================================
echo.

:: ── Parse args ─────────────────────────────────────────────
set "MODE=production"
set "SKIP_CHROME=0"
set "OPEN_BROWSER=0"

:parse_args
if "%~1"=="" goto :args_done
if "%~1"=="--dev" (
    set "MODE=dev"
    shift & goto :parse_args
)
if "%~1"=="--no-chrome" (
    set "SKIP_CHROME=1"
    shift & goto :parse_args
)
if "%~1"=="--open" (
    set "OPEN_BROWSER=1"
    shift & goto :parse_args
)
if "%~1"=="--help" (
    echo  Usage: start.bat [options]
    echo.
    echo  Options:
    echo    --dev         Start in dev mode (tsx watch, auto-reload)
    echo    --no-chrome   Skip Chrome launch (use existing browser)
    echo    --open        Open http://localhost:%SERVER_PORT% after start
    echo    --help        Show this help
    echo.
    exit /b 0
)
shift & goto :parse_args
:args_done

if "%MODE%"=="dev" (
    echo  Mode: DEV (auto-reload)
) else (
    echo  Mode: PRODUCTION
)
echo.

:: ── Check Node.js ──────────────────────────────────────────
echo  [1/8] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found.
    echo  Download: https://nodejs.org/ ^(requires v22+^)
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo  Node.js %NODE_VER%

:: ── cd to project root ────────────────────────────────────
cd /d "%~dp0"

:: ── Install dependencies ──────────────────────────────────
echo.
echo  [2/8] Checking dependencies...
if not exist "node_modules" (
    echo  Installing...
    call npm install 2>&1
    if errorlevel 1 (
        echo  [ERROR] npm install failed.
        pause & exit /b 1
    )
    echo  Done.
) else (
    echo  node_modules OK.
)

:: ── Build ──────────────────────────────────────────────────
echo.
echo  [3/8] Checking build...
if not exist "dist" (
    echo  Building...
    call npm run build 2>&1
    if errorlevel 1 (
        echo  [ERROR] Build failed.
        pause & exit /b 1
    )
    echo  Done.
) else (
    echo  dist/ OK.
)

:: ── Check ports ────────────────────────────────────────────
echo.
echo  [4/8] Checking ports...

netstat -an | findstr ":%SERVER_PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo  [WARN] Port %SERVER_PORT% already in use.
    echo  Another llmgw instance may be running.
    set /p "KILL=Kill it? (y/N): "
    if /i "!KILL!"=="y" (
        for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%SERVER_PORT% " ^| findstr "LISTENING"') do (
            taskkill /pid %%p /f >nul 2>&1
        )
        timeout /t 1 /nobreak >nul
        echo  Killed.
    ) else (
        echo  [ERROR] Cannot start on occupied port.
        pause & exit /b 1
    )
) else (
    echo  Port %SERVER_PORT% free.
)

:: ── Find Chrome ────────────────────────────────────────────
echo.
echo  [5/8] Finding browser...
set "CHROME_PATH="

:: Chrome
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

:: Edge fallback
if not defined CHROME_PATH if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
)

if defined CHROME_PATH (
    echo  Found: !CHROME_PATH!
) else (
    echo  [WARN] Chrome/Edge not found.
    echo  Web providers require a browser with --remote-debugging-port=%CDP_PORT%.
)

:: ── Launch Chrome ──────────────────────────────────────────
echo.
echo  [6/8] Browser setup...

if "%SKIP_CHROME%"=="1" (
    echo  Skipped (--no-chrome).
    goto :start_server
)

if not defined CHROME_PATH (
    echo  No browser found, skipping.
    goto :start_server
)

:: Check if CDP port already has a browser
netstat -an | findstr ":%CDP_PORT% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo  Browser already running on CDP port %CDP_PORT%.
    goto :start_server
)

:: Kill stale debug Chrome instances
taskkill /f /im chrome.exe /fi "WINDOWTITLE eq *llmgw*" >nul 2>&1
timeout /t 1 /nobreak >nul

:: Launch
if not exist "%CHROME_DATA%" mkdir "%CHROME_DATA%"
start "llmgw-browser" "!CHROME_PATH!" ^
    --remote-debugging-port=%CDP_PORT% ^
    --user-data-dir="%CHROME_DATA%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --remote-allow-origins=* ^
    --disable-gpu ^
    --disable-dev-shm-usage

echo  Chrome launched (CDP port %CDP_PORT%).

:: Wait for CDP to be ready
echo  Waiting for CDP...
set "CDP_READY=0"
for /l %%i in (1,1,10) do (
    curl -s http://localhost:%CDP_PORT%/json/version >nul 2>&1
    if not errorlevel 1 (
        set "CDP_READY=1"
        goto :cdp_done
    )
    timeout /t 1 /nobreak >nul
)
:cdp_done
if "%CDP_READY%"=="1" (
    echo  CDP ready.
) else (
    echo  [WARN] CDP not responding. Web providers may not work.
)

:: ── Start server ───────────────────────────────────────────
:start_server
echo.
echo  [7/8] Starting server...
echo.
echo  ================================================
echo    llmgw running at http://localhost:%SERVER_PORT%
echo  ================================================
echo.
echo  Endpoints:
echo    POST /v1/chat/completions   OpenAI-compatible
echo    GET  /v1/models             List models
echo    GET  /health                Health check
echo.

if "%OPEN_BROWSER%"=="1" (
    echo  [8/8] Opening browser...
    start http://localhost:%SERVER_PORT%/health
) else (
    echo  [8/8] Ready.
)

echo  Ctrl+C to stop.
echo.

if "%MODE%"=="dev" (
    call npx tsx watch src/server.ts
) else (
    call node dist/server.mjs
)

:: ── Cleanup ────────────────────────────────────────────────
echo.
echo  [*] Server stopped.

:: Optionally close debug Chrome
if "%SKIP_CHROME%"=="0" if defined CHROME_PATH (
    set /p "CLOSE=Close debug browser? (y/N): "
    if /i "!CLOSE!"=="y" (
        taskkill /f /im chrome.exe /fi "WINDOWTITLE eq llmgw-browser*" >nul 2>&1
        echo  Browser closed.
    )
)

pause
