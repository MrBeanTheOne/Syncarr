#!/usr/bin/env bash
# Build a portable Syncarr installer for the current host OS.
# On Windows the .bat version of this script is preferred; on macOS and Linux
# the electron-builder will only produce that platform's target.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    echo "On Windows — use build-portable.bat instead."
    exit 1
    ;;
  Darwin)
    echo "Building macOS package (portable app directory)..."
    npm run pack:mac
    ;;
  Linux)
    echo "Building Linux package (AppImage + deb)..."
    npm run pack:linux
    ;;
  *)
    echo "Unsupported platform: $(uname -s)"
    exit 1
    ;;
esac
