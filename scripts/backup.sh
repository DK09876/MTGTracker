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
#   scripts/backup.sh --tag NAME a named snapshot (a deploy's), always taken, never pruned;
#                                with --verify, that file is the one checked
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${MTG_DB_PATH:-$ROOT/data/mtg.db}"
DEST="${MTG_BACKUP_DIR:-$HOME/backups/mtg}"
KEEP="${MTG_BACKUP_KEEP:-30}"

VERIFY=0; FORCE=0; TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --verify) VERIFY=1 ;;
    --force)  FORCE=1 ;;
    --tag)    TAG="$2"; FORCE=1; shift ;;
  esac
  shift
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
  # A named snapshot doesn't match the nightly pattern (mtg_*), so the pruning below never takes it.
  if [ -n "$TAG" ]; then OUT="$DEST/${TAG}_$(date +%Y%m%d_%H%M%S).db"; else OUT="$DEST/mtg_$(date +%Y%m%d_%H%M%S).db"; fi
  sqlite3 "$DB" ".backup '$OUT'"
  gzip -f "$OUT"
  echo "$CURRENT" > "$MARKER"
  echo "backed up -> $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
fi
touch "$DEST/.last-run"

# A deploy's snapshots (predeploy-*) keep the newest five; other named ones (the one-time move's) stay.
old_pre=$(ls -1t "$DEST"/predeploy-*.db.gz 2>/dev/null | tail -n +6 || true)
[ -n "$old_pre" ] && echo "$old_pre" | xargs rm -f
# The nightly snapshots are pruned to the newest $KEEP.
old=$(ls -1t "$DEST"/mtg_*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
if [ -n "$old" ]; then
  echo "$old" | xargs rm -f
  echo "pruned $(echo "$old" | wc -l | tr -d ' ') beyond the newest $KEEP"
fi

if [ "$VERIFY" -eq 1 ]; then
  if [ -n "$TAG" ]; then NEWEST="$OUT.gz"; else NEWEST=$(ls -1t "$DEST"/mtg_*.db.gz 2>/dev/null | head -1); fi
  [ -z "$NEWEST" ] && { echo "verify: nothing to check" >&2; exit 1; }
  TMP=$(mktemp)
  gunzip -c "$NEWEST" > "$TMP"
  INTEGRITY=$(sqlite3 "$TMP" "PRAGMA integrity_check" 2>/dev/null || echo FAIL)
  PROFILES=$(sqlite3 "$TMP" "SELECT COUNT(*) FROM profiles" 2>/dev/null || echo FAIL)
  LISTS=$(sqlite3 "$TMP" "SELECT COUNT(*) FROM lists" 2>/dev/null || echo FAIL)
  rm -f "$TMP"
  echo "verify: $(basename "$NEWEST") integrity=$INTEGRITY profiles=$PROFILES lists=$LISTS"
  [ "$INTEGRITY" = "ok" ] || exit 1
  # A wrong or empty database fails too: the counts must be numbers, with at least one profile.
  case "$PROFILES" in ''|*[!0-9]*) exit 1 ;; esac
  case "$LISTS" in ''|*[!0-9]*) exit 1 ;; esac
  [ "$PROFILES" -gt 0 ] || exit 1
fi
