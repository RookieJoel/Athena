#!/bin/bash 

set -euo pipefail

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

# ── Helpers ────────────────────────────────────────────────────────────────────

PASS=0
FAIL=0

pass() { echo -e "${GREEN}[PASS]${RESET}" "$1"; PASS=$(( PASS + 1 )); }
fail() { echo -e "${RED}[FAIL]${RESET}" "$1"; FAIL=$(( FAIL + 1 )); }
info() { echo -e "${YELLOW}[INFO]${RESET}" "$1"; }

ENV=$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )/../.env

if [ -f "$ENV" ]; then 
    info "======== Loading env ========"

    set -a
    source $ENV
    set +a

    pass "======== Env loaded ========"
else 
    fail "======== .env file not found ========"
    exit 1
fi

# check required env vars
REQUIRED_VARS=(MONGO_INITDB_ROOT_USERNAME MONGO_INITDB_ROOT_PASSWORD MONGO_URI JWT_SECRET NEXT_PUBLIC_API_URL)

for i in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!i:-}" ]; then
        fail "======== Missing required env var: $i ========"
    else 
        pass "======== Found env var: $i ========"
    fi
done

# validate Mongo URI format
if [[ "$MONGO_URI" =~ "^mongodb(\+srv)?://*" ]]; then
    fail "======== Invalid MONGO_URI format. Expected to start with 'mongodb://' or 'mongodb+srv://' ========"
fi

#validate JWT_SECRET length
if [ ${#JWT_SECRET} -lt 32 ]; then
    fail "======== JWT_SECRET should be at least 32 characters long for security ========"
fi

echo "========================================="
echo " PASS: ${PASS} | FAIL: ${FAIL}"
echo "========================================="

if [ "${FAIL}" -gt 0 ]; then 
    echo -e "${RED}Validation failed with ${FAIL} errors.${RESET}"
    exit 1
else
    echo -e "${GREEN}All validations passed!${RESET}"
    exit 0
fi