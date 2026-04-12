#Requires -Version 5.1
<#
.SYNOPSIS
    zero-token Windows 一键安装脚本
.DESCRIPTION
    自动检测/安装 Node.js、克隆仓库、安装依赖、构建、注册 Windows 服务
.EXAMPLE
    irm https://raw.githubusercontent.com/uplusplus/zero-token/main/install.ps1 | iex
#>

# ── 配置 ─────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
$REPO_URL = "https://github.com/uplusplus/zero-token.git"
$INSTALL_DIR = "C:\zero-token"
$SERVICE_NAME = "zero-token"
$MIN_NODE_VER = 22
$SERVER_PORT = if ($env:SERVER_PORT) { $env:SERVER_PORT } else { "8080" }

# ── 颜色输出 ─────────────────────────────────────────────────
function Write-Info  { param($m) Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "[  OK] $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Write-Fail  { param($m) Write-Host "[FAIL] $m" -ForegroundColor Red }

# ── Admin 检查 ───────────────────────────────────────────────
function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Warn "需要管理员权限，正在重新启动..."
    $scriptPath = $PSCommandPath
    if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Path }
    if (-not $scriptPath) {
        # irm | iex 模式：下载脚本到临时文件再提权运行
        $scriptPath = "$env:TEMP\zero-token-install.ps1"
        $scriptUrl = "https://raw.githubusercontent.com/uplusplus/zero-token/main/install.ps1"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $scriptUrl -OutFile $scriptPath -UseBasicParsing
    }
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`""
    exit
}

Write-Host ""
Write-Host "┌─────────────────────────────────────┐" -ForegroundColor White
Write-Host "│       zero-token  Windows 安装      │" -ForegroundColor White
Write-Host "└─────────────────────────────────────┘" -ForegroundColor White
Write-Host ""

# ── 1. 检测 & 安装 Node.js ──────────────────────────────────
function Install-NodeJs {
    Write-Info "安装 Node.js ${MIN_NODE_VER}.x ..."

    # 优先 winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "使用 winget 安装..."
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    }
    # 其次 chocolatey
    elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "使用 chocolatey 安装..."
        choco install nodejs-lts -y
    }
    # 最后 msi 下载安装
    else {
        $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
        $msiUrl = "https://nodejs.org/dist/v22.15.0/node-v22.15.0-${arch}.msi"
        $msiPath = "$env:TEMP\nodejs-installer.msi"
        Write-Info "下载 Node.js 安装包..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        Write-Info "运行安装程序..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait
        Remove-Item $msiPath -Force

        # 刷新 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
}

function Check-Node {
    $nodeExe = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeExe) {
        $ver = (node -v) -replace 'v', ''
        $major = [int]($ver.Split('.')[0])
        if ($major -ge $MIN_NODE_VER) {
            Write-Ok "Node.js v${ver}"
            return
        }
        Write-Warn "Node.js v${ver} 版本过低"
    }
    Install-NodeJs

    # 再次检查
    $nodeExe = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeExe) {
        # 可能需要重启 shell 刷新 PATH，尝试常见路径
        $commonPaths = @(
            "$env:ProgramFiles\nodejs\node.exe",
            "${env:ProgramFiles(x86)}\nodejs\node.exe",
            "$env:APPDATA\npm\node.exe"
        )
        foreach ($p in $commonPaths) {
            if (Test-Path $p) {
                $env:Path += ";$(Split-Path $p)"
                break
            }
        }
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Fail "Node.js 安装失败，请手动安装: https://nodejs.org/"
        Read-Host "按 Enter 退出"
        exit 1
    }
    Write-Ok "Node.js $(node -v)"
}

Check-Node

# ── 2. 检测 npm ──────────────────────────────────────────────
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Fail "npm 未找到"
    Read-Host "按 Enter 退出"
    exit 1
}
Write-Ok "npm $(npm -v)"

# ── 3. 克隆仓库 ──────────────────────────────────────────────
if (Test-Path $INSTALL_DIR) {
    Write-Info "更新已有安装..."
    Set-Location $INSTALL_DIR
    if (Test-Path ".git") {
        try {
            if (Test-Path "config.yaml") { Copy-Item config.yaml config.yaml.bak }
            git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch origin main 2>$null
            git reset --hard origin/main 2>$null
            if (Test-Path "config.yaml.bak") { Move-Item config.yaml.bak config.yaml -Force }
            Write-Ok "已更新"
        } catch {
            Write-Warn "拉取更新失败，保留当前版本"
        }
    }
} else {
    Write-Info "下载 zero-token..."
    try {
        git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 clone --depth 1 $REPO_URL $INSTALL_DIR 2>$null
    } catch {
        Write-Warn "git clone 失败，使用镜像下载..."
        $zipUrl = "https://gh-proxy.com/https://github.com/uplusplus/zero-token/archive/refs/heads/main.zip"
        $zipPath = "$env:TEMP\zero-token.zip"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $env:TEMP -Force
        Move-Item "$env:TEMP\zero-token-main" $INSTALL_DIR
        Remove-Item $zipPath -Force
    }
    Set-Location $INSTALL_DIR
}

# ── 4. 安装依赖 & 构建 ──────────────────────────────────────
Write-Info "安装依赖..."
npm install 2>$null
Write-Ok "依赖安装完成"

Write-Info "构建项目..."
npx tsdown
Write-Ok "构建完成"

# ── 5. 创建启动脚本 ──────────────────────────────────────────
$startScript = @"
@echo off
cd /d "$INSTALL_DIR"
set SERVER_PORT=$SERVER_PORT
node dist/server.mjs
"@
$startScript | Out-File -FilePath "$INSTALL_DIR\run.bat" -Encoding ASCII

# ── 6. 注册 Windows 服务 ────────────────────────────────────
Write-Info "注册 Windows 服务..."

$nssmExe = "$INSTALL_DIR\nssm.exe"
$nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"

if (-not (Test-Path $nssmExe)) {
    Write-Info "下载 NSSM (服务管理工具)..."
    $nssmZip = "$env:TEMP\nssm.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing
    Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm" -Force
    $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
    Copy-Item "$env:TEMP\nssm\nssm-2.24\${arch}\nssm.exe" $nssmExe
    Remove-Item $nssmZip -Force
    Remove-Item "$env:TEMP\nssm" -Recurse -Force
}

# 停掉旧服务（如果存在）
& $nssmExe stop $SERVICE_NAME 2>$null
& $nssmExe remove $SERVICE_NAME confirm 2>$null

# 安装新服务
$nodePath = (Get-Command node).Source
& $nssmExe install $SERVICE_NAME $nodePath "$INSTALL_DIR\dist\server.mjs"
& $nssmExe set $SERVICE_NAME AppDirectory $INSTALL_DIR
& $nssmExe set $SERVICE_NAME DisplayName "zero-token"
& $nssmExe set $SERVICE_NAME Description "OpenAI-compatible gateway — zero API token cost"
& $nssmExe set $SERVICE_NAME Start SERVICE_AUTO_START
& $nssmExe set $SERVICE_NAME AppEnvironmentExtra "NODE_ENV=production" "SERVER_PORT=$SERVER_PORT"
& $nssmExe set $SERVICE_NAME AppRestartDelay 5000
& $nssmExe set $SERVICE_NAME AppStdout "$INSTALL_DIR\logs\service.log"
& $nssmExe set $SERVICE_NAME AppStderr "$INSTALL_DIR\logs\error.log"
& $nssmExe set $SERVICE_NAME AppRotateFiles 1
& $nssmExe set $SERVICE_NAME AppRotateBytes 10485760

# 创建日志目录
New-Item -ItemType Directory -Force -Path "$INSTALL_DIR\logs" | Out-Null

# 启动服务
& $nssmExe start $SERVICE_NAME

Start-Sleep -Seconds 2

$service = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Write-Ok "服务已启动"
} else {
    Write-Warn "服务启动中，请稍后检查"
}

# ── 完成 ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "┌─────────────────────────────────────┐" -ForegroundColor Green
Write-Host "│         安装完成！                  │" -ForegroundColor Green
Write-Host "└─────────────────────────────────────┘" -ForegroundColor Green
Write-Host ""
Write-Host "  服务地址    http://localhost:${SERVER_PORT}"
Write-Host "  配置文件    ${INSTALL_DIR}\config.yaml"
Write-Host "  服务管理"
Write-Host "    启动:     nssm start ${SERVICE_NAME}"
Write-Host "    停止:     nssm stop ${SERVICE_NAME}"
Write-Host "    重启:     nssm restart ${SERVICE_NAME}"
Write-Host "    卸载:     nssm remove ${SERVICE_NAME} confirm"
Write-Host ""
Write-Host "  快速测试" -ForegroundColor Cyan
Write-Host "    curl http://localhost:${SERVER_PORT}/health"
Write-Host ""

Read-Host "按 Enter 退出"
