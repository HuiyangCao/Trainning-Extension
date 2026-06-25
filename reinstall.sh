#!/bin/bash
set -e
cd "$(dirname "$0")"

USER_CONFIG_DIR="$HOME/.config/trainning_extension"
JETBRAINS_FLAG_FILE="$USER_CONFIG_DIR/jetbrains_mode_enabled"

echo ""
read -r -p "启用 JetBrains 界面偏好（主题/字体/UI；快捷键始终保留）? [Y/n] " jetbrains_choice
case "$jetbrains_choice" in
    [nN]) JETBRAINS_MODE_ENABLED=0 ;;
    *)    JETBRAINS_MODE_ENABLED=1 ;;
esac
mkdir -p "$USER_CONFIG_DIR"
echo "$JETBRAINS_MODE_ENABLED" > "$JETBRAINS_FLAG_FILE"

npm run compile
NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
PUBLISHER=$(node -p "require('./package.json').publisher")
VSIX="${NAME}-${VERSION}.vsix"
OLD_VSIX="copy-with-ref-${VERSION}.vsix"
if [ -f "$OLD_VSIX" ]; then rm -f "$OLD_VSIX"; fi
npx --no-install vsce package --no-dependencies

# Resolve an editor CLI: prefer PATH, then fall back to macOS .app bundle paths.
resolve_editor_cli() {
    local cmd="$1"; shift
    if command -v "$cmd" &>/dev/null; then
        command -v "$cmd"
        return 0
    fi
    local candidate
    for candidate in "$@"; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

CODE_CLI=$(resolve_editor_cli code \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code") || true

CURSOR_CLI=$(resolve_editor_cli cursor \
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
    "$HOME/Applications/Cursor.app/Contents/Resources/app/bin/cursor") || true

if [ -n "$CODE_CLI" ]; then
    "$CODE_CLI" --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    "$CODE_CLI" --uninstall-extension "${PUBLISHER}.${NAME}" 2>/dev/null || true
    "$CODE_CLI" --install-extension "$VSIX"
fi

if [ -n "$CURSOR_CLI" ]; then
    "$CURSOR_CLI" --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    "$CURSOR_CLI" --uninstall-extension "${PUBLISHER}.${NAME}" 2>/dev/null || true
    "$CURSOR_CLI" --install-extension "$VSIX" 2>/dev/null || true
fi

if [ -z "$CODE_CLI" ] && [ -z "$CURSOR_CLI" ]; then
    echo "⚠️  未找到 code / cursor 命令，已打包但未安装：$VSIX"
    echo "   手动安装：在编辑器中执行 'Extensions: Install from VSIX...' 选择该文件。"
fi

echo "Done. Reload window to take effect."
