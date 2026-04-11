@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
title llmgw Gateway

:: -- Paths --
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
set "CDP_PORT=9222"
set "SERVER_PORT=8080"
set "CHROME_DATA=%USERPROFILE%\.llmgw\chrome-data"
set "LOG_FILE=%SCRIPT_DIR%logs\llmgw.log"

:: ================================================
::  Main Menu
:: ================================================
:MENU
cls
echo.
echo  ================================================
echo    llmgw - OpenAI Compatible Gateway
echo    Zero Token Cost via Browser LLMs
echo  ================================================
echo.
echo    [1] One-Click Start
echo    [2] Start Chrome Debug Mode
echo    [3] Open Login Pages
echo    [4] Auth Onboard Wizard
echo    [5] Start Gateway Service
echo    [6] Stop Gateway Service
echo    [7] Restart Gateway Service
echo    [8] Show Status
echo    [9] Install and Build
echo    [0] Clean Rebuild
echo    [Q] Quit
echo.
set "choice="
set /p "choice=Select [1-9 / 0 / Q]: "
if "%choice%"=="1" goto :ONE_CLICK
if "%choice%"=="2" goto :START_CHROME
if "%choice%"=="3" goto :OPEN_LOGINS
if "%choice%"=="4" goto :ONBOARD
if "%choice%"=="5" goto :START_GATEWAY
if "%choice%"=="6" goto :STOP_GATEWAY
if "%choice%"=="7" goto :RESTART_GATEWAY
if "%choice%"=="8" goto :STATUS
if "%choice%"=="9" goto :BUILD
if "%choice%"=="0" goto :CLEAN_BUILD
if /i "%choice%"=="Q" goto :EOF
goto :MENU

:: ================================================
::  [1] One-Click Start
:: ================================================
:ONE_CLICK
call :CHECK_NODE
if errorlevel 1 goto :MENU
call :CHECK_AND_BUILD
if errorlevel 1 goto :MENU
call :START_CHROME_CORE
echo.
call :OPEN_LOGINS_CORE
echo.
echo  Login pages opened in debug Chrome.
echo  Log in to the platforms you want to use.
echo.
echo  IMPORTANT: Do NOT close the Chrome window!
echo  After logging in, press any key to continue...
pause >nul

:: Re-verify Chrome is still running before onboard
echo.
curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Chrome debug lost. Please restart with option [2].
    pause
    goto :MENU
)
echo  Chrome debug confirmed running.
call :ONBOARD_CORE
echo.
echo  Press any key to start gateway...
pause >nul
call :START_GATEWAY_CORE
goto :MENU

:: ================================================
::  [2] Start Chrome Debug Mode
:: ================================================
:START_CHROME
call :START_CHROME_CORE
echo.
pause
goto :MENU

:START_CHROME_CORE
echo.
echo  [Chrome] Detecting browser...

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
if not defined CHROME_PATH if exist "%ProgramFiles%\Chromium\Application\chrome.exe" (
    set "CHROME_PATH=%ProgramFiles%\Chromium\Application\chrome.exe"
)
if not defined CHROME_PATH if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
    echo  [WARN] Chrome not found, using Edge.
)
if not defined CHROME_PATH if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "CHROME_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
    echo  [WARN] Chrome not found, using Edge.
)

if not defined CHROME_PATH (
    echo  [ERROR] Chrome/Chromium/Edge not found.
    echo  Install Chrome: https://www.google.com/chrome/
    pause
    exit /b 1
)

echo  Browser: !CHROME_PATH!
echo  Data dir: %CHROME_DATA%
echo.

echo  [Chrome] Killing old debug instances...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%CDP_PORT% " ^| findstr "LISTENING" 2^>nul') do (
    echo  Killing PID %%p...
    taskkill /PID %%p /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)

if not exist "%CHROME_DATA%" mkdir "%CHROME_DATA%"
echo  [Chrome] Starting debug mode on port %CDP_PORT%...
start "llmgw-browser" "!CHROME_PATH!" ^
    --remote-debugging-port=%CDP_PORT% ^
    --user-data-dir="%CHROME_DATA%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --remote-allow-origins=* ^
    --disable-gpu ^
    --disable-dev-shm-usage

echo  Waiting for Chrome...
set "CDP_OK=0"
for /l %%i in (1,1,15) do (
    curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
    if !errorlevel!==0 (
        set "CDP_OK=1"
        goto :chrome_ready
    )
    echo  . | set /p "=."
    timeout /t 1 /nobreak >nul
)

:chrome_ready
echo.
if "!CDP_OK!"=="1" (
    echo  [OK] Chrome debug mode started.
    echo  CDP port: http://127.0.0.1:%CDP_PORT%
) else (
    echo  [WARN] Chrome may not be fully ready yet.
)
exit /b 0

:: ================================================
::  [3] Open Login Pages
:: ================================================
:OPEN_LOGINS
call :OPEN_LOGINS_CORE
echo.
pause
goto :MENU

:OPEN_LOGINS_CORE
echo.
echo  [Login] Opening platform login pages...

:: Use detected Chrome path if available, otherwise fall back to default browser
if not defined CHROME_PATH (
    echo  [WARN] Chrome path not set, opening with default browser.
    set "LOGIN_CMD=start "" """
    goto :open_urls_default
)

:: Verify debug Chrome is running
curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Chrome debug not running, opening with default browser.
    set "LOGIN_CMD=start "" """
    goto :open_urls_default
)

:: Open URLs via debug Chrome instance
echo  Opening via debug Chrome ^(CDP port %CDP_PORT%^)...
for %%u in (
    "https://chat.deepseek.com/"
    "https://claude.ai/new"
    "https://chatgpt.com"
    "https://www.kimi.com"
    "https://www.doubao.com/chat/"
    "https://chat.qwen.ai"
    "https://gemini.google.com/app"
    "https://grok.com"
    "https://chatglm.cn"
    "https://chat.z.ai/"
) do (
    "!CHROME_PATH!" --remote-debugging-port=%CDP_PORT% --user-data-dir="%CHROME_DATA%" %%u >nul 2>&1
    timeout /t 1 /nobreak >nul
)
goto :open_urls_done

:open_urls_default
for %%u in (
    "https://chat.deepseek.com/"
    "https://claude.ai/new"
    "https://chatgpt.com"
    "https://www.kimi.com"
    "https://www.doubao.com/chat/"
    "https://chat.qwen.ai"
    "https://gemini.google.com/app"
    "https://grok.com"
    "https://chatglm.cn"
    "https://chat.z.ai/"
) do (
    start "" %%u
    timeout /t 1 /nobreak >nul
)

:open_urls_done
echo  [OK] 10 login pages opened.
exit /b 0

:: ================================================
::  [4] Auth Onboard Wizard
:: ================================================
:ONBOARD
call :CHECK_NODE
if errorlevel 1 goto :MENU
:ONBOARD_CORE
echo.
echo  [Onboard] Checking Chrome connection...
curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Chrome debug not running on port %CDP_PORT%.
    echo  Start Chrome first with option [2].
    pause
    goto :MENU
)

echo  Chrome connected.
echo.
echo  [Onboard] Running auth wizard...
echo.

where python3 >nul 2>&1
if errorlevel 1 (
    where python >nul 2>&1
    if errorlevel 1 (
        echo  [WARN] Python not found. Onboard needs Python 3.
        echo  Install: https://www.python.org/downloads/
        echo.
        echo  Manual auth steps:
        echo  1. Open Chrome DevTools (F12) - Application - Cookies
        echo  2. Copy cookie string
        echo  3. Paste into config.yaml providers.auth
        pause
        goto :MENU
    )
)

if exist "%SCRIPT_DIR%scripts\onboard.sh" (
    bash "%SCRIPT_DIR%scripts\onboard.sh"
) else (
    echo  [WARN] scripts\onboard.sh not found.
    echo.
    echo  Manual auth steps:
    echo  1. Log in to each platform in Chrome
    echo  2. F12 - Application - Cookies
    echo  3. Copy cookie string to config.yaml
    echo.
    echo  config.yaml example:
    echo    providers:
    echo      - id: deepseek-web
    echo        enabled: true
    echo        auth:
    echo          cookie: "your_cookie_here"
)
echo.
pause
goto :MENU

:: ================================================
::  [5] Start Gateway Service
:: ================================================
:START_GATEWAY
call :CHECK_NODE
if errorlevel 1 goto :MENU
call :CHECK_AND_BUILD
if errorlevel 1 goto :MENU
:START_GATEWAY_CORE
echo.
echo  [Gateway] Starting service...

call :STOP_GATEWAY_CORE >nul 2>&1

if not exist "%SCRIPT_DIR%logs" mkdir "%SCRIPT_DIR%logs"

echo  Config: %SCRIPT_DIR%config.yaml
echo  Log: %LOG_FILE%
echo  Port: %SERVER_PORT%
echo.

start /b "llmgw-gateway" node "%SCRIPT_DIR%dist\server.mjs" > "%LOG_FILE%" 2>&1

echo  [Gateway] Waiting for ready...
set "GW_OK=0"
for /l %%i in (1,1,30) do (
    curl -s -o nul --connect-timeout 1 http://127.0.0.1:%SERVER_PORT%/health >nul 2>&1
    if !errorlevel!==0 (
        set "GW_OK=1"
        echo.
        echo  [OK] Gateway ready ^(#%%i seconds^).
        goto :gw_ready
    )
    echo  . | set /p "=."
    timeout /t 1 /nobreak >nul
)

:gw_ready
echo.
if "!GW_OK!"=="1" (
    echo  [OK] llmgw Gateway started.
    echo.
    echo  Endpoints:
    echo    POST http://127.0.0.1:%SERVER_PORT%/v1/chat/completions
    echo    GET  http://127.0.0.1:%SERVER_PORT%/v1/models
    echo    GET  http://127.0.0.1:%SERVER_PORT%/health
    echo.
    echo  Opening health check...
    start "" "http://127.0.0.1:%SERVER_PORT%/health"
) else (
    echo  [WARN] Gateway not ready in 30s.
    echo  Check log: %LOG_FILE%
    echo  Try: http://127.0.0.1:%SERVER_PORT%/health
)
echo.
pause
goto :MENU

:: ================================================
::  [6] Stop Gateway Service
:: ================================================
:STOP_GATEWAY
call :STOP_GATEWAY_CORE
echo.
pause
goto :MENU

:STOP_GATEWAY_CORE
echo.
echo  [Gateway] Stopping service...

set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%SERVER_PORT% " ^| findstr "LISTENING" 2^>nul') do (
    echo  Stopping process on port %SERVER_PORT% ^(PID: %%p^)...
    taskkill /PID %%p /F >nul 2>&1
    set "FOUND=1"
    timeout /t 1 /nobreak >nul
)

taskkill /FI "WINDOWTITLE eq llmgw-gateway*" /F >nul 2>&1

if "!FOUND!"=="1" (
    echo  [OK] Gateway stopped.
) else (
    echo  Gateway was not running.
)
exit /b 0

:: ================================================
::  [7] Restart Gateway Service
:: ================================================
:RESTART_GATEWAY
call :CHECK_NODE
if errorlevel 1 goto :MENU
call :STOP_GATEWAY_CORE
timeout /t 2 /nobreak >nul
goto :START_GATEWAY_CORE

:: ================================================
::  [8] Show Status
:: ================================================
:STATUS
echo.
echo  ================================================
echo   llmgw Status
echo  ================================================
echo.

where node >nul 2>&1
if !errorlevel!==0 (
    for /f "tokens=*" %%v in ('node --version 2^>nul') do echo   Node.js:  %%v
) else (
    echo   [X] Node.js: Not installed
)

where npm >nul 2>&1
if !errorlevel!==0 (
    for /f "tokens=*" %%v in ('npm --version 2^>nul') do echo   npm:      %%v
) else (
    echo   [!] npm: Not installed
)

curl -s -o nul --connect-timeout 1 http://127.0.0.1:%CDP_PORT%/json/version >nul 2>&1
if !errorlevel!==0 (
    echo   [OK] Chrome: CDP running on port %CDP_PORT%
) else (
    echo   [!] Chrome: Not running
)

curl -s -o nul --connect-timeout 1 http://127.0.0.1:%SERVER_PORT%/health >nul 2>&1
if !errorlevel!==0 (
    echo   [OK] Gateway: Running on port %SERVER_PORT%
    echo   Health:   http://127.0.0.1:%SERVER_PORT%/health
    for /f "tokens=*" %%m in ('curl -s http://127.0.0.1:%SERVER_PORT%/v1/models 2^>nul ^| node -e "try{const d=JSON.parse(require^('fs^').readFileSync^(0,'utf8^'));const ms=^(d.data||[]^).map^(m=>m.id^);console.log^(ms.length?ms.join^(', '^):'none'^)}catch{console.log^('parse error'^)}" 2^>nul') do (
        echo   Models:   %%m
    )
) else (
    echo   [!] Gateway: Not running
)

if exist "%SCRIPT_DIR%config.yaml" (
    echo   [OK] Config:  config.yaml exists
) else (
    echo   [!] Config:  config.yaml missing
)

if exist "%SCRIPT_DIR%dist" (
    echo   [OK] Build:   dist/ exists
) else (
    echo   [!] Build:   not built
)

if exist "%SCRIPT_DIR%node_modules" (
    echo   [OK] Deps:    node_modules exists
) else (
    echo   [!] Deps:    not installed
)

echo.
pause
goto :MENU

:: ================================================
::  [9] Install and Build
:: ================================================
:BUILD
call :CHECK_NODE
if errorlevel 1 goto :MENU
echo.

echo  [Build] Installing dependencies...
call npm install
if errorlevel 1 (
    echo  [ERROR] npm install failed.
    pause
    goto :MENU
)
echo  [OK] Dependencies installed.
echo.

echo  [Build] Compiling...
call npm run build
if errorlevel 1 (
    echo  [ERROR] npm run build failed.
    pause
    goto :MENU
)
echo  [OK] Build complete.
echo.
pause
goto :MENU

:: ================================================
::  [0] Clean Rebuild
:: ================================================
:CLEAN_BUILD
call :CHECK_NODE
if errorlevel 1 goto :MENU
echo.

call :STOP_GATEWAY_CORE >nul 2>&1

echo  [Clean] Removing old build...
if exist "%SCRIPT_DIR%dist" rmdir /s /q "%SCRIPT_DIR%dist"
if exist "%SCRIPT_DIR%node_modules" rmdir /s /q "%SCRIPT_DIR%node_modules"
echo  [OK] dist/ and node_modules/ removed.
echo.

goto :BUILD

:: ================================================
::  Utility Functions
:: ================================================
:CHECK_NODE
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo  [ERROR] Node.js not found.
    echo  Install Node.js 22+: https://nodejs.org
    echo.
    pause
    exit /b 1
)
exit /b 0

:CHECK_AND_BUILD
if not exist "%SCRIPT_DIR%dist" (
    echo.
    echo  [WARN] Project not built ^(dist/ missing^).
    echo  Building now...
    echo.
    call :BUILD
    if not exist "%SCRIPT_DIR%dist" (
        echo  [ERROR] Build failed, cannot start.
        pause
        exit /b 1
    )
)
exit /b 0
