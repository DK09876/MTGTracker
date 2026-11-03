#!/usr/bin/env bash
# Ping the app; if it does not answer, write a line to data/outages.log.
# The app turns new lines there into errors (and the banner) once it is
# back - it cannot report its own downtime while it is down.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${MTG_WATCH_URL:-http://127.0.0.1:3001/}"
LOG="${MTG_OUTAGE_LOG:-$ROOT/data/outages.log}"

if ! curl -fsS -o /dev/null --max-time 20 "$URL"; then
  echo "$(date -Iseconds) no answer from $URL; mtg.service: $(systemctl is-active mtg 2>/dev/null || echo unknown)" >> "$LOG"
fi
