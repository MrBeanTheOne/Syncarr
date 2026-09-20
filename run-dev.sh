#!/usr/bin/env bash
# Launch Syncarr in dev mode (the same thing `npm start` does, but with a
# friendly "did you forget to npm install?" guard for the script runners).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

exec npm start
