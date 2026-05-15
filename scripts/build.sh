#!/bin/bash

set -euo pipefail

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

PASS=0
FAIL=0

pass() { echo -e "${GREEN}[PASS]${RESET}" "$1"; PASS=$(( PASS + 1 )); }
fail() { echo -e "${RED}[FAIL]${RESET}" "$1"; FAIL=$(( FAIL + 1 )); }
info() { echo -e "${YELLOW}[INFO]${RESET}" "$1"; }

VALIDATE_SCRIPT_PATH=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validate.sh
if [ -f "$VALIDATE_SCRIPT_PATH" ]; then
    info "Running validation script before build..."
    bash "$VALIDATE_SCRIPT_PATH"
else
    echo "Validation script not found at $VALIDATE_SCRIPT_PATH. Aborting build."
    exit 1
fi


info "Building Docker compose..."
NO_CACHE="${1:-}"
BUILD_ARGS=()
[[ "$NO_CACHE" == "--no-cache" ]] && BUILD_ARGS+=(--no-cache)
docker compose build ${BUILD_ARGS[@]} || { fail "Docker Compose build failed"; exit 1; }
