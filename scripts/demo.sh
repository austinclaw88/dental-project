#!/usr/bin/env bash
# NightShift end-to-end demo: seed the practice, start every service, run the
# nightly batch for tomorrow, and leave the dashboard up.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgres://nightshift:nightshift@127.0.0.1:5432/nightshift}"
export ODSIM_DATABASE_URL="${ODSIM_DATABASE_URL:-postgres://nightshift:nightshift@127.0.0.1:5432/odsim}"
export API_PORT="${API_PORT:-4000}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
export PORTAL_PORT="${PORTAL_PORT:-4300}"
export PORTAL_URL="${PORTAL_URL:-http://127.0.0.1:4300}"
export CONNECTOR_TOKEN="${CONNECTOR_TOKEN:-dev-connector-token}"
export ARTIFACTS_DIR="${ARTIFACTS_DIR:-./var/artifacts}"
export EXTRACTOR="${EXTRACTOR:-heuristic}"
export DISABLE_CRON=1
export NEXT_PUBLIC_API_URL="$API_BASE_URL"

mkdir -p var/log "$ARTIFACTS_DIR"

echo "==> migrating cloud + practice databases"
npm run -s migrate
npm run -s -w @nightshift/od-sim migrate
echo "==> seeding OpenDental simulator (12 patients, appointments tomorrow)"
npm run -s -w @nightshift/od-sim seed

echo "==> starting mock payer portal :$PORTAL_PORT"
(npm run -s -w @nightshift/mock-portal dev >var/log/portal.log 2>&1) &
echo "==> starting cloud API :$API_PORT"
(npm run -s -w @nightshift/api dev >var/log/api.log 2>&1) &
echo "==> starting connector"
(npm run -s -w @nightshift/connector dev >var/log/connector.log 2>&1) &

for i in $(seq 1 30); do
  curl -sf "$API_BASE_URL/api/practices" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$API_BASE_URL/api/practices" >/dev/null || { echo "API failed to start — see var/log/api.log"; exit 1; }
curl -sf "$PORTAL_URL/mock-delta/login" >/dev/null || { echo "portal failed to start — see var/log/portal.log"; exit 1; }

echo "==> waiting for connector first sync"
PRACTICE_ID="11111111-1111-1111-1111-111111111111"
for i in $(seq 1 30); do
  COUNT=$(curl -sf "$API_BASE_URL/api/practices" | grep -c "$PRACTICE_ID" || true)
  [ "$COUNT" -ge 1 ] && break
  sleep 1
done

# "tomorrow" must match the seed's definition: practice-local (America/Chicago)
TOMORROW=$(TZ=America/Chicago date -d "+1 day" +%F 2>/dev/null || TZ=America/Chicago date -v+1d +%F)
echo "==> running nightly batch for $TOMORROW"
curl -sf -X POST "$API_BASE_URL/api/batch/run" \
  -H 'content-type: application/json' \
  -d "{\"practiceId\":\"$PRACTICE_ID\",\"date\":\"$TOMORROW\"}" && echo

echo "==> starting dashboard :3000"
(npm run -s -w @nightshift/dashboard dev >var/log/dashboard.log 2>&1) &

echo
echo "NightShift is up:"
echo "  Dashboard:    http://127.0.0.1:3000        (morning queue for $TOMORROW)"
echo "  API:          $API_BASE_URL"
echo "  Mock portal:  $PORTAL_URL/mock-delta/login  (office@cedarpark.example / verify123!)"
echo "  Logs:         var/log/*.log"
echo
echo "Watch verifications flow: portal scraping (Playwright) -> extraction -> QA -> writeback to od-sim."
wait
