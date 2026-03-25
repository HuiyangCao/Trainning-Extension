#!/bin/bash
set -e
cd "$(dirname "$0")"

# ---------- 系统检测 ----------

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
    PKG_MANAGER="brew"
elif [ -f /etc/debian_version ]; then
    PKG_MANAGER="apt"
elif [ -f /etc/redhat-release ]; then
    PKG_MANAGER="yum"
elif [ -f /etc/arch-release ]; then
    PKG_MANAGER="pacman"
else
    PKG_MANAGER=""
fi

pkg_install() {
    echo "Installing $1..."
    case "$PKG_MANAGER" in
        brew)    brew install "$1" ;;
        apt)     sudo apt update -qq && sudo apt install -y "$1" ;;
        yum)     sudo yum install -y "$1" ;;
        pacman)  sudo pacman -S --noconfirm "$1" ;;
        *)       echo "Error: Cannot auto-install $1. Please install it manually." && exit 1 ;;
    esac
}

# ---------- 依赖检查与安装 ----------

# Node.js & npm
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
    case "$PKG_MANAGER" in
        brew)    pkg_install node ;;
        apt)     sudo apt update -qq && sudo apt install -y nodejs npm ;;
        yum)     sudo yum install -y nodejs npm ;;
        pacman)  sudo pacman -S --noconfirm nodejs npm ;;
        *)       echo "Error: Node.js/npm not found. Install from https://nodejs.org/" && exit 1 ;;
    esac
fi

# vsce
if ! command -v vsce &>/dev/null; then
    echo "Installing vsce..."
    npm install -g @vscode/vsce
fi

# npm dependencies
if [ ! -d node_modules ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Python (for icon generation)
if ! command -v python3 &>/dev/null; then
    echo "Warning: python3 not found, skipping icon generation."
else
    python3 gen_icon.py
fi

# ---------- 构建与打包 ----------

npm run compile
VERSION=$(node -p "require('./package.json').version")
PUBLISHER=$(node -p "require('./package.json').publisher")
VSIX="copy-with-ref-${VERSION}.vsix"
vsce package --no-dependencies

# ---------- 安装到编辑器 ----------

install_ext() {
    local cmd="$1"
    local name="$2"
    "$cmd" --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    if "$cmd" --install-extension "$VSIX" 2>/dev/null; then
        echo "Installed to ${name}."
        return 0
    else
        echo "Warning: ${name} installation failed, skip."
        return 1
    fi
}

installed=""

if command -v code &>/dev/null; then
    install_ext code "VS Code" && installed="${installed} VS Code"
fi

if command -v cursor &>/dev/null; then
    install_ext cursor "Cursor" && installed="${installed} Cursor"
fi

if [ -z "$installed" ]; then
    echo "Warning: Neither 'code' nor 'cursor' CLI found. VSIX built at: $VSIX"
    echo "Manually install: code --install-extension $VSIX"
else
    echo "Done. Reload${installed} window(s) to take effect."
fi
