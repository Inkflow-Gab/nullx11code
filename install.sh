#!/bin/sh
# nullx11code installer — works on Linux, macOS, Termux (Android).
# Usage: curl -fsSL https://raw.githubusercontent.com/Inkflow-Gab/nullx11code/main/install.sh | sh
set -eu

REPO="Inkflow-Gab/nullx11code"
REF="${NULLX11_REF:-main}"
GREEN=""; RED=""; DIM=""; OFF=""
if [ -t 1 ]; then GREEN="\033[32m"; RED="\033[31m"; DIM="\033[2m"; OFF="\033[0m"; fi

say() { printf "%b\n" "$1"; }
fail() { printf "%b" "${RED}error:${OFF} $1\n" >&2; exit 1; }

say "${DIM}→ detecting node …${OFF}"

if ! command -v node >/dev/null 2>&1; then
  fail "node not found. Install Node.js ≥ 18 first:
  • Termux (Android): pkg install nodejs-lts
  • Debian/Ubuntu:    sudo apt install nodejs npm
  • macOS:            brew install node
  • Windows:          https://nodejs.org"
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "node $(node -v) is too old — need ≥ 18"
fi
say "${DIM}→ node $(node -v) ✓${OFF}"

if ! command -v npm >/dev/null 2>&1; then
  fail "npm not found — install npm (pkg install npm / apt install npm)"
fi

say "${DIM}→ fetching nullx11code ($REF, OpenCode runtime + legacy CLI)${OFF}"
TARBALL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF"
# allow tag refs via NULLX11_REF
case "$REF" in
  main|master) ;;
  *) TARBALL="https://codeload.github.com/$REPO/tar.gz/refs/tags/$REF" ;;
esac

TMP="${TMPDIR:-/tmp}/nullx11-install-$$"
cleanup() { rm -rf "$TMP"; rm -f "$TMP.tar.gz"; }
trap cleanup EXIT

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$TARBALL" -o "$TMP.tar.gz" || fail "download failed"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP.tar.gz" "$TARBALL" || fail "download failed"
else
  fail "need curl or wget"
fi

say "${DIM}→ installing globally …${OFF}"
# npm accepts a tarball path directly
if npm install -g "$TMP.tar.gz" >/dev/null 2>&1; then
  :
else
  # Use a persistent user prefix, including native runtime dependencies.
  # Never link into $TMP: the EXIT trap removes it after installation.
  say "${DIM}  global install blocked → installing into ~/.local${OFF}"
  npm install -g --prefix "$HOME/.local" "$TMP.tar.gz" || fail "user install failed"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) say "${DIM}  add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"${OFF}" ;;
  esac
fi

if command -v nullx11code >/dev/null 2>&1; then
  BIN="$(command -v nullx11code)"
  say "${GREEN}✓ nullx11code installed → $BIN${OFF}"
else
  if [ -x "$HOME/.local/bin/nullx11code" ]; then
    say "${GREEN}✓ installed → $HOME/.local/bin/nullx11code${OFF}"
    say "${DIM}  add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"${OFF}"
    exit 0
  fi
  say "${RED}✗ install finished but 'nullx11code' not on PATH${OFF}"
  say "${DIM}  try: npm bin -g   (see where npm put it)${OFF}"
  exit 1
fi

say ""
say "  ${GREEN}next steps${OFF}"
say "  ${DIM}1.${OFF} add a free key:   echo 'NVIDIA_API_KEY=nvapi-…' >> .env"
say "  ${DIM}2.${OFF} start chatting:   nullx11code"
say "  ${DIM}3.${OFF} web UI:           nullx11code serve"
say "  ${DIM}4.${OFF} check setup:      nullx11code doctor"
say ""
say "${DIM}free keys: build.nvidia.com · console.groq.com · cloud.cerebras.ai · openrouter.ai · aistudio.google.com${OFF}"
