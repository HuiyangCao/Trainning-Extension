#!/bin/bash
set -e
cd "$(dirname "$0")"

npm run compile
VERSION=$(node -p "require('./package.json').version")
PUBLISHER=$(node -p "require('./package.json').publisher")
VSIX="copy-with-ref-${VERSION}.vsix"
vsce package --no-dependencies

if command -v code &>/dev/null; then
    code --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    code --install-extension "$VSIX"
fi

if command -v cursor &>/dev/null; then
    cursor --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    cursor --install-extension "$VSIX" 2>/dev/null || true
fi

echo "Done. Reload window to take effect."
