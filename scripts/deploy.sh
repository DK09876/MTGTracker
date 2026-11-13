#!/usr/bin/env bash
# Deploy MTG Tracker with seconds of downtime, not minutes (handoff 9, Part B).
#
# The slow work happens while the old version keeps serving: the new version
# is checked out and built in its own folder under releases/. Then:
#   1. the app is told a deploy is under way (the "updating" file beside the
#      database): the pages grey out the buttons that start new work and the
#      server starts no new background job;
#   2. it waits for running jobs to finish, at most --wait seconds (the owner's
#      call, 2026-11-13: 3 minutes, then deploy anyway; a job still running
#      then shows as interrupted);
#   3. the service stops, a verified backup is taken (inside the stop: the app
#      locks the database with a "mtg.db.lock" folder, which the sqlite3 tool
#      does not see, so a snapshot of a database being written isn't safe);
#   4. "current" points at the new release and the service starts;
#   5. it checks the new build answers. If it doesn't, "current" goes back to
#      the old release and that starts again.
#
# Layout (set up once, see scripts/DEPLOY.md):
#   $ROOT/shared/    mtg.db, cards.db, rules/, .env, and "updating" during a deploy
#   $ROOT/releases/  one folder per commit (git worktrees of $REPO)
#   $ROOT/current -> releases/<commit>    the service runs from here
#
#   scripts/deploy.sh                      deploy origin/main
#   scripts/deploy.sh --ref <commit>       deploy that commit (a rollback is a deploy of the old one)
#   scripts/deploy.sh --wait 60            wait at most 60 s for running jobs
#   scripts/deploy.sh --build-only         build the release and stop there
#
# Environment (defaults are the Pi's): MTG_ROOT ($HOME/mtg), MTG_REPO ($HOME/development/MTGTracker),
# MTG_PORT (3001), MTG_STOP_CMD / MTG_START_CMD (sudo systemctl stop|start mtg), MTG_KEEP (2 releases: the current one and the one before, for going back).
set -euo pipefail

ROOT="${MTG_ROOT:-$HOME/mtg}"
REPO="${MTG_REPO:-$HOME/development/MTGTracker}"
PORT="${MTG_PORT:-3001}"
STOP_CMD="${MTG_STOP_CMD:-sudo systemctl stop mtg}"
START_CMD="${MTG_START_CMD:-sudo systemctl start mtg}"
KEEP="${MTG_KEEP:-2}"
REF="origin/main"
WAIT=180
BUILD_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --wait) WAIT="$2"; shift 2 ;;
    --build-only) BUILD_ONLY=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

SHARED="$ROOT/shared"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
FLAG="$SHARED/updating"
STATUS="http://127.0.0.1:$PORT/api/status"

say() { echo "[deploy $(date +%H:%M:%S)] $*"; }
now() { node -e 'process.stdout.write(String(Date.now()))'; }
status() { curl -s -m 3 "$STATUS" 2>/dev/null || true; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }

[ -d "$SHARED" ] || { echo "no $SHARED: set up the layout first (scripts/DEPLOY.md)" >&2; exit 1; }
[ -f "$SHARED/mtg.db" ] || { echo "no database at $SHARED/mtg.db" >&2; exit 1; }
mkdir -p "$RELEASES"

# --- 1. build the new version beside the running one ------------------------------------------
git -C "$REPO" fetch --quiet origin
SHA=$(git -C "$REPO" rev-parse --short=12 "$REF^{commit}")
NEW="$RELEASES/$SHA"
OLD=$(readlink "$CURRENT" 2>/dev/null || true)
if [ "$OLD" = "$NEW" ]; then say "$SHA is already current"; exit 0; fi

if [ -f "$NEW/.next/BUILD_ID" ] && [ "$(cat "$NEW/.next/BUILD_ID")" = "$SHA" ]; then
  say "release $SHA is already built"
else
  [ -d "$NEW" ] && { git -C "$REPO" worktree remove --force "$NEW" 2>/dev/null || rm -rf "$NEW"; }
  git -C "$REPO" worktree prune
  git -C "$REPO" worktree add --detach --quiet "$NEW" "$SHA"
  ln -sfn "$SHARED/.env" "$NEW/.env"
  say "building $SHA in $NEW (the app keeps serving)"
  T0=$(now)
  # Same lockfile as the running release: hard-link its packages (seconds, and no second copy on the card).
  if [ -n "$OLD" ] && [ -d "$OLD/node_modules" ] && cmp -s "$OLD/package-lock.json" "$NEW/package-lock.json" && cp -al "$OLD/node_modules" "$NEW/node_modules" 2>/dev/null; then
    say "packages unchanged: linked from $(basename "$OLD")"
  else
    rm -rf "$NEW/node_modules"
    ( cd "$NEW" && npm ci --no-audit --no-fund --loglevel=error )
  fi
  # The build never touches the live database: it gets a throwaway one, and no timers.
  SCRATCH=$(mktemp -d)
  ( cd "$NEW" && MTG_BUILD_ID="$SHA" MTG_SCHEDULER=off MTG_DB_PATH="$SCRATCH/build.db" MTG_CARDS_DB_PATH="$SCRATCH/cards.db" npx next build >"$NEW/build.log" 2>&1 ) \
    || { rm -rf "$SCRATCH"; say "build failed, nothing changed: see $NEW/build.log"; exit 1; }
  rm -rf "$SCRATCH"
  say "built in $(( ($(now) - T0) / 1000 )) s"
fi
[ "$BUILD_ONLY" -eq 1 ] && { say "built only; current is still ${OLD:-none}"; exit 0; }

# --- 2. tell the app, and wait for running jobs --------------------------------------------------
cleanup_flag() { rm -f "$FLAG"; }
trap cleanup_flag EXIT
date -u +%Y-%m-%dT%H:%M:%SZ > "$FLAG"
say "told the app a deploy is under way: no new jobs start"
DEADLINE=$(( $(date +%s) + WAIT ))
while :; do
  RUNNING=$(status | field running)
  [ -z "$RUNNING" ] && { say "the app isn't answering; going on"; break; }
  [ "$RUNNING" = "0" ] && break
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then say "$RUNNING job(s) still running after ${WAIT} s: deploying anyway, they will show as interrupted"; break; fi
  say "waiting for $RUNNING running job(s)"
  sleep 3
done

# --- 3. stop, back up ---------------------------------------------------------------------
STOPPED=$(now)
say "stopping the service"
eval "$STOP_CMD"
# The app's own lock is a folder; one left by a stop mid-write would make the next start report "busy".
if [ -d "$SHARED/mtg.db.lock" ]; then say "removing a lock the stopped app left: $SHARED/mtg.db.lock"; rmdir "$SHARED/mtg.db.lock"; fi

start_release() {
  ln -sfn "$1" "$CURRENT"
  rm -f "$FLAG"
  eval "$START_CMD"
  # Up when the status answers with this release's build (60 s at most).
  local want; want=$(basename "$1")
  for _ in $(seq 1 120); do
    [ "$(status | field build)" = "$want" ] && return 0
    sleep 0.5
  done
  return 1
}

rollback() {
  say "$1"
  if [ -n "$OLD" ] && [ -d "$OLD" ]; then
    eval "$STOP_CMD" || true
    if start_release "$OLD"; then say "back on $(basename "$OLD")"; else say "the old release didn't answer either: look at the service now"; fi
  else
    say "no earlier release to go back to"
  fi
  exit 1
}

say "backing up"
MTG_DB_PATH="$SHARED/mtg.db" bash "$NEW/scripts/backup.sh" --force --verify || rollback "the backup failed: starting the old release, nothing changed"

# --- 4 and 5. swap in, start, check ------------------------------------------------------------
say "starting $SHA"
start_release "$NEW" || rollback "$SHA didn't answer within 60 s: going back"
say "up on $SHA: down for $(( ($(now) - STOPPED) / 1000 )) s (stop to first answer)"

# --- keep the newest few releases -----------------------------------------------------------
for old in $(ls -1t "$RELEASES" | tail -n +$((KEEP + 1))); do
  [ "$RELEASES/$old" = "$NEW" ] || [ "$RELEASES/$old" = "$OLD" ] && continue
  git -C "$REPO" worktree remove --force "$RELEASES/$old" 2>/dev/null || rm -rf "${RELEASES:?}/$old"
done
git -C "$REPO" worktree prune
