#!/usr/bin/env bash
# Renders web/public/og-image.svg to og-image.png (1200x630) with the headless Chromium that the browser tests use.
# Needs `pnpm exec playwright install chromium` once (PLAYWRIGHT_BROWSERS_PATH as in CLAUDE.md, if you use one).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC="$HERE/../public"
BIN="$(ls -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium_headless_shell-*/chrome-linux*/headless_shell 2>/dev/null | head -n 1)"
[ -n "$BIN" ] || { echo "headless_shell not found: install Chromium with pnpm exec playwright install chromium" >&2; exit 1; }
"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --screenshot="$PUBLIC/og-image.png" "file://$PUBLIC/og-image.svg" >/dev/null 2>&1
echo "wrote $PUBLIC/og-image.png"
