#!/bin/bash
# Smoke test — hits every API endpoint and asserts expected HTTP status codes.
# Usage: ./scripts/smoke-test.sh [BASE_URL]
# Default BASE_URL: http://localhost:4000

set -euo pipefail

BASE_URL="${1:-http://localhost:4000}"
PASS=0
FAIL=0

# ── Colours ────────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

# ── Helpers ────────────────────────────────────────────────────────────────────
pass() { echo -e "${GREEN}[PASS]${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}[FAIL]${RESET} $1"; FAIL=$((FAIL + 1)); }
info() { echo -e "${YELLOW}[INFO]${RESET} $1"; }

assert_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if [[ "$actual" == "$expected" ]]; then
    pass "$label — got $actual"
  else
    fail "$label — expected $expected, got $actual"
  fi
}

http_status() {
  # $@ = curl args (no -s/-o/-w needed — we add them here)
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

# ── Test user creds (unique per run to avoid conflicts) ────────────────────────
TIMESTAMP=$(date +%s)
TEST_USER="smoketest_${TIMESTAMP}"
TEST_PASS="SmokePass123!"

echo ""
echo "========================================"
echo "  Athena Smoke Test"
echo "  Target: $BASE_URL"
echo "========================================"
echo ""

# ── 1. Health ─────────────────────────────────────────────────────────────────
info "1. Health check"
STATUS=$(http_status "$BASE_URL/health")
assert_status "GET /health" "200" "$STATUS"

# ── 2. Register ───────────────────────────────────────────────────────────────
info "2. Register new user"
REGISTER_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")
REGISTER_STATUS=$(echo "$REGISTER_RESPONSE" | tail -1)
assert_status "POST /api/register" "200" "$REGISTER_STATUS"

# ── 3. Login ──────────────────────────────────────────────────────────────────
info "3. Login"
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"$TEST_PASS\"}")
LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | head -1)
assert_status "POST /api/login" "200" "$LOGIN_STATUS"

# Extract JWT token
TOKEN=$(echo "$LOGIN_BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$TOKEN" ]]; then
  fail "Could not extract JWT token — aborting remaining tests"
  echo ""
  echo "========================================"
  echo "  Results: ${PASS} passed, ${FAIL} failed"
  echo "========================================"
  exit 1
fi
info "JWT token acquired"

# ── 4. Login with wrong password ───────────────────────────────────────────────
info "4. Login with wrong password (expect 401)"
STATUS=$(http_status -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$TEST_USER\",\"password\":\"wrongpassword\"}")
assert_status "POST /api/login (bad password)" "401" "$STATUS"

# ── 5. Get notes (authenticated) ───────────────────────────────────────────────
info "5. Get notes"
STATUS=$(http_status "$BASE_URL/api/notes" \
  -H "Authorization: Bearer $TOKEN")
assert_status "GET /api/notes" "200" "$STATUS"

# ── 6. Get notes without token ────────────────────────────────────────────────
info "6. Get notes without token (expect 401)"
STATUS=$(http_status "$BASE_URL/api/notes")
assert_status "GET /api/notes (no token)" "401" "$STATUS"

# ── 7. Create a note ──────────────────────────────────────────────────────────
info "7. Create note"
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$BASE_URL/api/notes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Smoke Test Note","content":"Created by smoke-test.sh"}')
CREATE_STATUS=$(echo "$CREATE_RESPONSE" | tail -1)
CREATE_BODY=$(echo "$CREATE_RESPONSE" | head -1)
assert_status "POST /api/notes" "200" "$CREATE_STATUS"

# Extract note ID
NOTE_ID=$(echo "$CREATE_BODY" | grep -o '"_id":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$NOTE_ID" ]]; then
  fail "Could not extract note ID — skipping delete test"
else
  info "Note created with ID: $NOTE_ID"

  # ── 8. Delete the note ──────────────────────────────────────────────────────
  info "8. Delete note"
  STATUS=$(http_status -X DELETE "$BASE_URL/api/notes/$NOTE_ID" \
    -H "Authorization: Bearer $TOKEN")
  assert_status "DELETE /api/notes/:id" "200" "$STATUS"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "========================================"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
