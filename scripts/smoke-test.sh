#!/usr/bin/env bash
# Smoke-test for the live backend. Run after every Railway deploy to
# confirm nothing broke. Exits 0 on pass, 1 on any failure so you can
# wire it into CI if you want.
#
# Usage:
#   ./scripts/smoke-test.sh                                      # hits prod
#   BACKEND_URL=http://localhost:3001 ./scripts/smoke-test.sh    # hits local
#
# What it checks:
#   - /health returns 200 with expected JSON
#   - Representative routes return 401 unauth (proves they're registered)
#   - Security headers are present (CSP, HSTS, X-Frame-Options)
#   - Rate-limit headers are present
#
# What it does NOT check (needs a real Clerk session):
#   - End-to-end auth'd data flow
#   - Writes that would mutate prod data
#
# If any check fails, the script prints the offending response and exits 1.

set -eo pipefail

BACKEND_URL="${BACKEND_URL:-https://fnsai-backend-production.up.railway.app}"

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf "  \033[32m✓\033[0m %-55s %s\n" "$name" "$actual"
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m %-55s got %s, expected %s\n" "$name" "$actual" "$expected"
    fail=$((fail+1))
  fi
}

# Routes are "registered + auth-guarded" if they return 401 (our own
# middleware) OR 302 (Clerk's redirect-style requireAuth). Both prove the
# route mounted; only 404 means actually missing.
check_guarded() {
  local name="$1" actual="$2"
  if [ "$actual" = "401" ] || [ "$actual" = "302" ]; then
    printf "  \033[32m✓\033[0m %-55s %s\n" "$name" "$actual"
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m %-55s got %s, expected 401/302\n" "$name" "$actual"
    fail=$((fail+1))
  fi
}

header_check() {
  local name="$1" header="$2" expected_match="$3" headers_file="$4"
  local val
  val=$(grep -i "^${header}:" "$headers_file" | head -1 | tr -d '\r')
  if [ -n "$val" ] && echo "$val" | grep -qi "$expected_match"; then
    printf "  \033[32m✓\033[0m %-55s %s\n" "$name" "$(echo "$val" | cut -c1-80)"
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m %-55s missing or wrong: %s\n" "$name" "$val"
    fail=$((fail+1))
  fi
}

echo "Smoke-testing $BACKEND_URL"
echo ""

# ── 1. Health ────────────────────────────────────────────────
echo "1. Health:"
HEALTH_CODE=$(curl -s -o /tmp/st_health.json -w "%{http_code}" "$BACKEND_URL/health")
check "GET /health"                        "200" "$HEALTH_CODE"
if [ "$HEALTH_CODE" = "200" ]; then
  grep -q "\"status\":\"ok\"" /tmp/st_health.json \
    && { printf "  \033[32m✓\033[0m %-55s\n" "response.status == ok"; pass=$((pass+1)); } \
    || { printf "  \033[31m✗\033[0m %-55s\n" "response missing status:ok"; fail=$((fail+1)); }
fi
echo ""

# ── 2. Route registration (unauth → 401 means route exists + is guarded) ──
echo "2. Route registration (expect 401 unauth = route exists, guard works):"
for path in \
  "/api/v1/jobs" \
  "/api/v1/submissions" \
  "/api/v1/tasks" \
  "/api/v1/pipeline-stages" \
  "/api/v1/search?q=test" \
  "/api/v1/ats-reports/overview" \
  "/api/v1/reports/standard/metrics" \
  "/api/v1/integrations/status" \
  "/api/v1/notification-prefs/me" \
  "/api/v1/error-log" \
  "/api/v1/candidates" \
  "/api/v1/staff" \
  "/api/v1/placements" \
  "/api/v1/compliance/policies" \
  "/api/v1/users" ; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL$path")
  check_guarded "$path" "$code"
done
echo ""

# ── 3. Security headers (from /health since it's public) ─────
echo "3. Security headers (from /health):"
curl -sI "$BACKEND_URL/health" > /tmp/st_headers.txt
header_check "Content-Security-Policy"    "content-security-policy" "default-src" /tmp/st_headers.txt
header_check "Strict-Transport-Security"  "strict-transport-security" "max-age" /tmp/st_headers.txt
header_check "X-Frame-Options"            "x-frame-options" "sameorigin\\|deny" /tmp/st_headers.txt
header_check "X-Content-Type-Options"     "x-content-type-options" "nosniff" /tmp/st_headers.txt
header_check "Referrer-Policy"            "referrer-policy" "strict-origin" /tmp/st_headers.txt
header_check "RateLimit"                  "ratelimit:" "limit=" /tmp/st_headers.txt
echo ""

# ── 4. Rate-limit behavior (does the AI limiter actually fire?) ──
echo "4. Rate limit sanity (should NOT rate-limit 5 rapid /health calls):"
all200=true
for i in 1 2 3 4 5; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/health")
  [ "$c" != "200" ] && all200=false
done
if [ "$all200" = "true" ]; then
  printf "  \033[32m✓\033[0m %-55s all 200\n" "5x /health"
  pass=$((pass+1))
else
  printf "  \033[31m✗\033[0m %-55s some non-200 responses\n" "5x /health"
  fail=$((fail+1))
fi
echo ""

# ── Summary ──────────────────────────────────────────────────
total=$((pass+fail))
echo "───────────────────────────────────────────────────────────────"
if [ $fail -eq 0 ]; then
  printf "\033[32m✓ All %d checks passed.\033[0m\n" "$total"
  exit 0
else
  printf "\033[31m✗ %d of %d checks failed.\033[0m\n" "$fail" "$total"
  exit 1
fi
