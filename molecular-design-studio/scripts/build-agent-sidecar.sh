#!/bin/sh
set -eu

# A-REL-002: build the Python agent server as a self-contained PyInstaller
# onefile binary for the CURRENT platform. The Rust host (agent_service.rs)
# locates it as `agent-server` on macOS/Linux and `agent-server.exe` on
# Windows — this script emits the right name so tauri.conf.json resources can
# bundle it unchanged.
#
# Run from anywhere; invoked by `npm run build:agent-sidecar` (which tauri's
# beforeBuildCommand runs before `vite build`).

PROJECT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SERVER_SCRIPT="$PROJECT_DIR/../server.py"
BUILD_ROOT="$PROJECT_DIR/.packaging/agent-sidecar"
VENV_DIR="$BUILD_ROOT/venv"
OUTPUT_DIR="$PROJECT_DIR/src-tauri/binaries"
PYINSTALLER_VERSION="6.21.0"
CERTIFI_VERSION="2026.6.17"
PYTHON_BIN=${MDS_PACKAGING_PYTHON:-python3}

# --- Platform detection -------------------------------------------------------
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  Darwin)              PLATFORM="macos" ;;
  Linux)               PLATFORM="linux" ;;
  *) echo "Unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac

case "$PLATFORM" in
  windows) BIN_NAME="agent-server.exe"; VENV_PY="$VENV_DIR/Scripts/python.exe" ;;
  *)       BIN_NAME="agent-server";     VENV_PY="$VENV_DIR/bin/python" ;;
esac

if [ ! -f "$SERVER_SCRIPT" ]; then
  echo "Agent server source not found: $SERVER_SCRIPT" >&2
  exit 1
fi

if [ ! -x "$VENV_PY" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if ! "$VENV_PY" -c "import PyInstaller, certifi; from importlib.metadata import version; raise SystemExit(PyInstaller.__version__ != '$PYINSTALLER_VERSION' or version('certifi') != '$CERTIFI_VERSION')" 2>/dev/null; then
  "$VENV_PY" -m pip install --disable-pip-version-check \
    "pyinstaller==$PYINSTALLER_VERSION" \
    "certifi==$CERTIFI_VERSION"
fi

rm -rf "$BUILD_ROOT/work" "$BUILD_ROOT/dist" "$BUILD_ROOT/spec"
mkdir -p "$BUILD_ROOT/work" "$BUILD_ROOT/dist" "$BUILD_ROOT/spec" "$OUTPUT_DIR"

# --name agent-server: PyInstaller appends the platform extension itself, so
# dist/ contains agent-server (posix) or agent-server.exe (windows).
#
# Optional MDS_SIDECAR_TARGET_ARCH overrides PyInstaller's default
# architecture detection. The universal macOS sidecar recipe (one fat
# binary for arm64 + x86_64, see docs/RELEASING.md) sets it to
# `universal2` — requires a universal2 system Python (Apple CLT Python is).
#
# NOTE: a word-split string (not an array) is deliberate: the script runs
# under macOS system bash 3.2 where `set -u` + empty-array expansion
# aborts with "unbound variable". Values are controlled, so splitting is safe.
TARGET_ARCH_ARGS=""
if [ -n "${MDS_SIDECAR_TARGET_ARCH:-}" ]; then
  TARGET_ARCH_ARGS="--target-architecture $MDS_SIDECAR_TARGET_ARCH"
fi
"$VENV_PY" -m PyInstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name agent-server \
  --distpath "$BUILD_ROOT/dist" \
  --workpath "$BUILD_ROOT/work" \
  --specpath "$BUILD_ROOT/spec" \
  $TARGET_ARCH_ARGS \
  "$SERVER_SCRIPT"

cp "$BUILD_ROOT/dist/$BIN_NAME" "$OUTPUT_DIR/$BIN_NAME"
chmod 755 "$OUTPUT_DIR/$BIN_NAME"

echo "Built Agent sidecar ($PLATFORM): $OUTPUT_DIR/$BIN_NAME"
