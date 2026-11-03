#!/usr/bin/env bash
# Snapshot the MTG Tracker database, as Gains, LifeOS and Meals do.
#
# Copied with sqlite3 .backup rather than cp: it takes a consistent snapshot
# while the app is still writing. A snapshot is skipped when nothing has
# changed since the last one; .last-run is touched either way, so the app's
# backup check can tell "skipped" from "did not run".
#
#   scripts/backup.sh            snapshot if changed, prune
#   scripts/backup.sh --verify   also integrity-check the newest snapshot
#   scripts/backup.sh --force    snapshot even if unchanged
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${MTG_DB_PATH:-$ROOT/data/mtg.db}"
DEST="${MTG_BACKUP_DIR:-$HOME/backups/mtg}"
KEEP="${MTG_BACKUP_KEEP:-30}"

VERIFY=0; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --verify) VERIFY=1 ;;
    --force)  FORCE=1 ;;
  esac
done

[ -f "$DB" ] || { echo "no database at $DB" >&2; exit 1; }
mkdir -p "$DEST"

if command -v sha256sum >/dev/null; then hash() { sha256sum | cut -d' ' -f1; }; else hash() { shasum -a 256 | cut -d' ' -f1; }; fi

# Hash the logical contents, not the file: SQLite rewrites pages for reasons
# that do not change what is stored.
CURRENT=$(sqlite3 "$DB" ".dump" | hash)
MARKER="$DEST/.last-hash"

if [ "$FORCE" -eq 0 ] && [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$CURRENT" ]; then
  echo "database unchanged since last snapshot - skipping"
else
  OUT="$DEST/mtg_$(date +%Y%m%d_%H%M%S).db"
  sqlite3 "$DB" ".backup '$OUT'"
  gzip -f "$OUT"
  echo "$CURRENT" > "$MARKER"
  echo "backed up -> $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
fi
touch "$DEST/.last-run"

# Only the nightly snapshots are pruned; the named ones taken before deploys stay.
old=$(ls -1t "$DEST"/mtg_*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
if [ -n "$old" ]; then
  echo "$old" | xargs rm -f
  echo "pruned $(echo "$old" | wc -l | tr -d ' ') beyond the newest $KEEP"
fi

if [ "$VERIFY" -eq 1 ]; then
  NEWEST=$(ls -1t "$DEST"/mtg_*.db.gz 2>/dev/null | head -1)
  [ -z "$NEWEST" ] && { echo "verify: nothing to check" >&2; exit 1; }
  TMP=$(mktemp)
  gunzip -c "$NEWEST" > "$TMP"
  INTEGRITY=$(sqlite3 "$TMP" "PRAGMA integrity_check" 2>/dev/null || echo FAIL)
  PROFILES=$(sqlite3 "$TMP" "SELECT COUNT(*) FROM profiles" 2>/dev/null || echo FAIL)
  LISTS=$(sqlite3 "$TMP" "SELECT COUNT(*) FROM lists" 2>/dev/null || echo FAIL)
  rm -f "$TMP"
  echo "verify: $(basename "$NEWEST") integrity=$INTEGRITY profiles=$PROFILES lists=$LISTS"
  [ "$INTEGRITY" = "ok" ] || exit 1
fi
