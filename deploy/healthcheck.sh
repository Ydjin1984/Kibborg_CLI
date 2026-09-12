#!/usr/bin/env bash
# Health probe for a running `kibborg serve`.
#
# The probe answers only from loopback, so it is meant to run on the host (or
# inside the container) rather than across the network: it proves the process is
# listening and the routes are registered, not that an operator can reach it.
#
# Usage: healthcheck.sh [http://127.0.0.1:7317]
set -euo pipefail

ORIGIN="${1:-http://127.0.0.1:7317}"
TIMEOUT="${KIBBORG_HEALTH_TIMEOUT:-5}"

if ! command -v curl >/dev/null 2>&1; then
  echo "healthcheck: curl is required" >&2
  exit 3
fi

BODY="$(curl --silent --show-error --max-time "$TIMEOUT" --fail "$ORIGIN/healthz" 2>&1)" || {
  echo "healthcheck: $ORIGIN/healthz did not answer: $BODY" >&2
  exit 1
}

case "$BODY" in
  '{"ok":true'*) ;;
  *) echo "healthcheck: unexpected body: $BODY" >&2; exit 1 ;;
esac

# The API route answers without a token with 401 (token configured, none sent) or
# 403 (wrong token); a loopback-only deployment without a token answers 200. Any
# other status means the fence is not in place.
STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time "$TIMEOUT" "$ORIGIN/api/session.list")"
case "$STATUS" in
  401|403) ;;
  200) echo "healthcheck: warning — /api answers without a token; expected only on a loopback-only deployment" >&2 ;;
  *)
    echo "healthcheck: /api answered $STATUS without a token; expected 401, 403, or 200" >&2
    exit 1
    ;;
esac

echo "ok: $BODY (api answers $STATUS without a token)"
