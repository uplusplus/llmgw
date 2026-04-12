#!/bin/bash
# zero-token — 一键安装脚本
# 用法: curl -fsSL <url>/install.sh | bash
# 或:   bash install.sh

set -e

# ── 配置 ─────────────────────────────────────────────────────
REPO_URL="https://github.com/uplusplus/zero-token.git"
INSTALL_DIR="/opt/zero-token"
SERVICE_NAME="zero-token"
MIN_NODE_VER=22
SERVER_PORT="${SERVER_PORT:-8080}"

# ── 颜色 ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✘${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

echo ""
echo -e "${BOLD}┌─────────────────────────────────────┐${NC}"
echo -e "${BOLD}│       zero-token  安装程序          │${NC}"
echo -e "${BOLD}└─────────────────────────────────────┘${NC}"
echo ""

# ── Root 检查 ─────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  # Try sudo
  if command -v sudo &>/dev/null; then
    warn "需要 root 权限，使用 sudo 重新执行..."
    exec sudo "$0" "$@"
  else
    die "请以 root 身份运行此脚本"
  fi
fi

# ── 1. 检测 & 安装 Node.js ──────────────────────────────────
install_nodejs() {
  info "安装 Node.js ${MIN_NODE_VER}.x ..."

  if command -v apt-get &>/dev/null; then
    # Debian / Ubuntu
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg 2>/dev/null
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${MIN_NODE_VER}.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs
  elif command -v dnf &>/dev/null; then
    # RHEL / Fedora / CentOS
    dnf install -y "https://rpm.nodesource.com/pub_${MIN_NODE_VER}.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm" 2>/dev/null || true
    dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    yum install -y "https://rpm.nodesource.com/pub_${MIN_NODE_VER}.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm" 2>/dev/null || true
    yum install -y nodejs
  elif command -v brew &>/dev/null; then
    brew install node
  elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm nodejs npm
  else
    die "无法自动安装 Node.js，请手动安装 Node.js >= ${MIN_NODE_VER}: https://nodejs.org/"
  fi
}

check_node() {
  if command -v node &>/dev/null; then
    local major
    major=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$major" -ge "$MIN_NODE_VER" ]; then
      ok "Node.js $(node -v)"
      return 0
    fi
    warn "Node.js $(node -v) 版本过低，需要 >= ${MIN_NODE_VER}"
  fi
  install_nodejs
  command -v node &>/dev/null || die "Node.js 安装失败"
  ok "Node.js $(node -v)"
}

check_node

# ── 2. 安装 Chromium（Web 类 Provider 需要）───────────────────
if command -v apt-get &>/dev/null; then
  if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null && ! command -v google-chrome &>/dev/null; then
    info "安装 Chromium ..."
    apt-get install -y -qq chromium 2>/dev/null || apt-get install -y -qq chromium-browser 2>/dev/null || warn "Chromium 安装失败，Web 类 Provider 需要手动安装 Chrome"
    ok "Chromium 就绪"
  else
    ok "Chrome/Chromium 已安装"
  fi
fi

# ── 3. 克隆 & 安装 ──────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  info "更新已有安装 ..."
  cd "$INSTALL_DIR"
  if [ -d ".git" ]; then
    GIT_SSL_BACKEND=openssl git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 pull --ff-only 2>/dev/null || warn "拉取更新失败，保留当前版本"
  fi
else
  info "下载 zero-token ..."
  GIT_SSL_BACKEND=openssl git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 \
    clone --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>/dev/null \
    || {
      # Fallback: zip download via proxy
      warn "git clone 失败，使用镜像下载 ..."
      mkdir -p "$INSTALL_DIR"
      curl -fsSL --connect-timeout 15 --max-time 120 \
        "https://gh-proxy.com/${REPO_URL%.git}/archive/refs/heads/main.zip" \
        -o /tmp/zero-token.zip
      unzip -o /tmp/zero-token.zip -d /tmp/zt-extract
      mv /tmp/zt-extract/zero-token-main/* /tmp/zt-extract/zero-token-main/.* "$INSTALL_DIR/" 2>/dev/null || true
      rm -rf /tmp/zero-token.zip /tmp/zt-extract
    }
  cd "$INSTALL_DIR"
fi

info "安装依赖 ..."
npm ci 2>/dev/null || npm install
ok "依赖安装完成"

info "构建项目 ..."
npx tsdown
ok "构建完成"

# 清理 devDependencies，减小体积
npm prune --production 2>/dev/null || true

# ── 4. 默认配置 ──────────────────────────────────────────────
if [ ! -f "config.yaml" ]; then
  cp config.yaml.example config.yaml 2>/dev/null || true
fi

# ── 5. 注册 Chrome Debug 系统服务 ────────────────────────────
info "配置 Chrome Debug 模式 ..."

CHROME_DATA_DIR="/var/lib/zero-token/chrome-data"
CHROME_SERVICE="zero-token-chrome"
CDP_PORT="${CDP_PORT:-9222}"

# 检测 Chrome 路径
detect_chrome() {
  local linux_paths=(
    "/opt/google/chrome/google-chrome"
    "/usr/bin/google-chrome"
    "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium"
    "/usr/bin/chromium-browser"
    "/snap/bin/chromium"
  )
  for p in "${linux_paths[@]}"; do
    [ -f "$p" ] && echo "$p" && return
  done
  for cmd in google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$cmd" >/dev/null 2>&1 && echo "$(command -v "$cmd")" && return
  done
  echo ""
}

CHROME_PATH=$(detect_chrome)

if [ -z "$CHROME_PATH" ]; then
  warn "未找到 Chrome/Chromium，Web 类 Provider 不可用"
  warn "稍后可手动安装并启动: chrome --remote-debugging-port=$CDP_PORT"
else
  ok "Chrome: $CHROME_PATH"

  mkdir -p "$CHROME_DATA_DIR"

  cat > "/etc/systemd/system/${CHROME_SERVICE}.service" <<EOF
[Unit]
Description=Chrome Debug Mode for zero-token
After=network-online.target

[Service]
Type=simple
ExecStart=${CHROME_PATH} \\
  --remote-debugging-port=${CDP_PORT} \\
  --user-data-dir=${CHROME_DATA_DIR} \\
  --no-first-run \\
  --no-default-browser-check \\
  --disable-background-networking \\
  --disable-sync \\
  --disable-translate \\
  --remote-allow-origins=* \\
  --headless \\
  --no-sandbox \\
  --disable-gpu \\
  --disable-dev-shm-usage
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$CHROME_SERVICE"
  systemctl restart "$CHROME_SERVICE"
  ok "Chrome Debug 服务已启动 (CDP port: $CDP_PORT)"
fi

# ── 6. 注册 zero-token 主服务 ────────────────────────────────
info "注册 zero-token 主服务 ..."

AFTER_DEPS="network-online.target"
if [ -n "$CHROME_PATH" ]; then
  AFTER_DEPS="${AFTER_DEPS} ${CHROME_SERVICE}.service"
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=zero-token — OpenAI-compatible gateway
After=${AFTER_DEPS}
Wants=network-online.target

[Service]
Type=simple
ExecStart=$(which node) ${INSTALL_DIR}/dist/server.mjs
WorkingDirectory=${INSTALL_DIR}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=SERVER_PORT=${SERVER_PORT}

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR} ${CHROME_DATA_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# 等待启动
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "服务已启动"
else
  warn "服务启动异常，查看日志: journalctl -u $SERVICE_NAME -n 50"
fi

# ── 完成 ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}┌─────────────────────────────────────┐${NC}"
echo -e "${GREEN}${BOLD}│         安装完成！                  │${NC}"
echo -e "${GREEN}${BOLD}└─────────────────────────────────────┘${NC}"
echo ""
echo -e "  ${BOLD}服务地址${NC}   http://localhost:${SERVER_PORT}"
echo -e "  ${BOLD}配置文件${NC}   ${INSTALL_DIR}/config.yaml"
echo -e "  ${BOLD}服务管理${NC}"
echo -e "    启动:  systemctl start ${SERVICE_NAME}"
echo -e "    停止:  systemctl stop ${SERVICE_NAME}"
echo -e "    重启:  systemctl restart ${SERVICE_NAME}"
echo -e "    日志:  journalctl -u ${SERVICE_NAME} -f"
if [ -n "$CHROME_PATH" ]; then
echo -e "  ${BOLD}Chrome 调试${NC}"
echo -e "    状态:  systemctl status ${CHROME_SERVICE}"
echo -e "    重启:  systemctl restart ${CHROME_SERVICE}"
echo -e "    CDP:   http://localhost:${CDP_PORT}/json/version"
fi
echo -e "  ${BOLD}卸载${NC}"
echo -e "    systemctl disable ${SERVICE_NAME} ${CHROME_SERVICE}"
echo -e "    rm -rf ${INSTALL_DIR} /etc/systemd/system/${SERVICE_NAME}.service /etc/systemd/system/${CHROME_SERVICE}.service ${CHROME_DATA_DIR}"
echo ""
echo -e "  ${BOLD}快速测试${NC}"
echo -e "    curl http://localhost:${SERVER_PORT}/health"
echo ""
