#!/usr/bin/env bash
# Deterministic end-to-end integration check.
# Resets both databases, starts portal+api+connector fresh (PIDs recorded),
# runs the nightly batch for tomorrow, waits for it to settle, and asserts
# the SEED-UNIVERSE scenario matrix. Exit 0 = the MVP works end to end.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgres://nightshift:nightshift@127.0.0.1:5432/nightshift}"
export ODSIM_DATABASE_URL="${ODSIM_DATABASE_URL:-postgres://nightshift:nightshift@127.0.0.1:5432/odsim}"
export API_PORT=4000 API_BASE_URL=http://127.0.0.1:4000
export PORTAL_PORT=4300 PORTAL_URL=http://127.0.0.1:4300
export CONNECTOR_TOKEN=dev-connector-token
export ARTIFACTS_DIR=./var/artifacts
export EXTRACTOR="${EXTRACTOR:-heuristic}"
export DISABLE_CRON=1
PRACTICE=11111111-1111-1111-1111-111111111111
PGURI="$DATABASE_URL"

mkdir -p var/log var/run var/artifacts
sql() { psql "$PGURI" -Atc "$1"; }

echo "==> stopping any previous services"
for f in var/run/*.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
  rm -f "$f"
done
# best-effort catch for strays from manual runs (connector/api/portal run as tsx)
pkill -f "tsx watch src/main.ts" 2>/dev/null || true
pkill -f "tsx src/main.ts" 2>/dev/null || true
sleep 2

echo "==> resetting databases"
sql 'drop schema public cascade; create schema public;' >/dev/null
npm run -s migrate >/dev/null
npm run -s -w @nightshift/od-sim migrate >/dev/null
npm run -s -w @nightshift/od-sim seed >/dev/null

start() { # name, workspace
  npm run -s -w "$2" dev >"var/log/$1.log" 2>&1 &
  echo $! >"var/run/$1.pid"
}
echo "==> starting portal, api, connector"
start portal @nightshift/mock-portal
start api @nightshift/api
sleep 1
start connector @nightshift/connector

deadline=$((SECONDS + 60))
until curl -sf "$API_BASE_URL/api/practices" >/dev/null 2>&1; do
  [ $SECONDS -gt $deadline ] && { echo "FAIL: api did not start"; tail -20 var/log/api.log; exit 1; }
  sleep 1
done
curl -sf "$PORTAL_URL/mock-delta/login" >/dev/null || { echo "FAIL: portal did not start"; exit 1; }

echo "==> waiting for full connector sync (12 patients / coverages / appointments)"
deadline=$((SECONDS + 90))
until [ "$(sql 'select least((select count(*) from patient_link),(select count(*) from coverage),(select count(*) from appointment))')" = "12" ]; do
  [ $SECONDS -gt $deadline ] && { echo "FAIL: sync incomplete"; tail -10 var/log/connector.log; exit 1; }
  sleep 2
done

TOMORROW=$(date -d "+1 day" +%F)
echo "==> running nightly batch for $TOMORROW"
PLANNED=$(curl -sf -X POST "$API_BASE_URL/api/batch/run" -H 'content-type: application/json' \
  -d "{\"practiceId\":\"$PRACTICE\",\"date\":\"$TOMORROW\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["planned"])')
[ "$PLANNED" = "12" ] || { echo "FAIL: planned $PLANNED, expected 12"; exit 1; }

echo "==> waiting for batch to settle"
deadline=$((SECONDS + 300))
until [ "$(sql "select count(*) from verification where superseded_by is null and status not in ('DONE','EXCEPTION','FAILED','HUMAN_REVIEW')")" = "0" ]; do
  [ $SECONDS -gt $deadline ] && { echo "FAIL: batch did not settle"; exit 1; }
  sleep 3
done

echo "==> asserting scenario matrix"
python3 - "$API_BASE_URL" "$PRACTICE" "$TOMORROW" <<'PY'
import json, sys, urllib.request
api, practice, date = sys.argv[1:4]
items = json.load(urllib.request.urlopen(f"{api}/api/practices/{practice}/day/{date}/verifications"))["items"]
by = {i["patientName"]: i for i in items}
def excs(n): return {e["type"] for e in by[n]["exceptions"] if not e.get("resolvedAt")}
failures = []
def expect(cond, msg):
    if not cond: failures.append(msg)

expect(len(items) == 12, f"expected 12 rows, got {len(items)}")
expect(by["Alice Nguyen"]["displayStatus"] == "verified", "Alice should be verified (clean portal path)")
expect(by["Priya Shah"]["displayStatus"] == "verified", "Priya should be verified")
expect(by["Owen Brooks"]["displayStatus"] == "verified", "Owen should be verified")
expect("frequency_conflict" in excs("Marcus Webb"), "Marcus should flag frequency_conflict")
expect("waiting_period_conflict" in excs("Elena Rossi"), "Elena should flag waiting_period_conflict")
expect(by["James Porter"]["displayStatus"] == "attention" and "coverage_terminated" in excs("James Porter"),
       "James should be attention/coverage_terminated")
expect(by["Luis Romero"]["displayStatus"] == "verified", "Luis should be verified via voice path")
expect(by["Grace Liu"]["displayStatus"] == "in_progress", "Grace should be parked in human review")
for n in ("Tom Okafor", "Hana Kim", "Dev Patel"):
    expect(by[n]["status"] == "DONE", f"{n} (MetLife sparse) should reach DONE")
expect("deductible_unmet_high_value" in excs("Sofia Marino"), "Sofia should flag deductible_unmet_high_value")

# review-completion flow: finish Grace's review and confirm she verifies
tasks = json.load(urllib.request.urlopen(f"{api}/api/review-tasks?status=open"))["tasks"]
grace = [t for t in tasks if t.get("patientName") == "Grace Liu"]
expect(len(grace) == 1, f"expected exactly 1 open review task for Grace, got {len(grace)}")
if grace:
    body = json.dumps({"reviewer": "e2e-check", "fields": {
        "planStatus.active": True, "annualMaximum.total": 1800, "annualMaximum.used": 0,
        "annualMaximum.remaining": 1800, "deductible.individual": 100, "deductible.individualMet": 0,
        "categoryCoverage.preventive": 100, "categoryCoverage.basic": 80,
        "categoryCoverage.major": 50, "categoryCoverage.ortho": 0, "missingToothClause": True,
    }}).encode()
    req = urllib.request.Request(f"{api}/api/review-tasks/{grace[0]['id']}/complete", data=body,
                                 headers={"content-type": "application/json"})
    urllib.request.urlopen(req)
    import time
    for _ in range(30):
        items2 = json.load(urllib.request.urlopen(f"{api}/api/practices/{practice}/day/{date}/verifications"))["items"]
        g = [i for i in items2 if i["patientName"] == "Grace Liu"][0]
        if g["status"] == "DONE": break
        time.sleep(2)
    expect(g["status"] == "DONE", f"Grace should be DONE after review completion, is {g['status']}")

if failures:
    print("SCENARIO FAILURES:"); [print("  -", f) for f in failures]; sys.exit(1)
print("scenario matrix: all assertions passed")
PY

echo "==> waiting for writebacks to be applied by the connector"
deadline=$((SECONDS + 60))
until [ "$(sql "select count(*) from writeback where status='pending'")" = "0" ]; do
  [ $SECONDS -gt $deadline ] && { echo "FAIL: writebacks not applied"; exit 1; }
  sleep 3
done
FAILED_WB=$(sql "select count(*) from writeback where status='failed'")
[ "$FAILED_WB" = "0" ] || { echo "FAIL: $FAILED_WB writebacks failed"; sql "select target,error from writeback where status='failed' limit 5"; exit 1; }

echo "==> asserting OpenDental writeback landed (od-sim)"
psql "$ODSIM_DATABASE_URL" -Atc "
  select 'insverify_verified', count(*) from od_insverify where date_last_verified is not null
  union all select 'nightshift_benefit_rows', count(*) from od_benefit where entry_source='nightshift'
  union all select 'human_benefit_rows_untouched', count(*) from od_benefit where entry_source='human'
  union all select 'plan_notes', count(*) from od_insplan where plan_note <> ''
  union all select 'commlogs', count(*) from od_commlog
  union all select 'documents', count(*) from od_document;"
VERIFIED=$(psql "$ODSIM_DATABASE_URL" -Atc "select count(*) from od_insverify where date_last_verified is not null")
[ "$VERIFIED" -ge 9 ] || { echo "FAIL: expected >=9 verified insverify rows, got $VERIFIED"; exit 1; }

echo
echo "E2E CHECK PASSED — services left running (var/run/*.pid, logs in var/log/)."
echo "Dashboard: NEXT_PUBLIC_API_URL=$API_BASE_URL npm run dev:dashboard  → http://127.0.0.1:3000"
