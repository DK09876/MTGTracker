#!/usr/bin/env bash
# Deploy MTG Tracker with seconds of downtime, not minutes (handoff 9, Part B).
#
# Run it inside tmux (`tmux new -s deploy`): a dropped SSH session mid-deploy
# must not leave the app stopped. Even so, once the service is stopped, any
# way out of this script (an error, Ctrl-C, a hang-up) starts a release again:
# the old one, unless the new one was checked and is running.
#
# The slow work happens while the old version keeps serving: the new version
# is checked out and built (`npm run build`, which also copies the scanner's
# files) in its own folder under releases/. Then:
#   1. the app is told a deploy is under way (the "updating" file beside the
#      database, which says when it ends at the latest): the pages grey out
#      the buttons that start new work and the server starts no new job;
#   2. it waits for running jobs to finish, at most --wait seconds (the owner's
#      call, 2026-11-13: 3 minutes, then deploy anyway; a job still running
#      then shows as interrupted);
#   3. the service stops and a verified snapshot is taken (inside the stop:
#      the app locks the database with a "mtg.db.lock" folder, which the
#      sqlite3 tool does not see), named for the release and never pruned;
#   4. "current" points at the new release and the service starts;
#   5. it checks the new build answers, from the expected database (not a
#      fresh empty one), with its profiles, and serves the scanner's files.
#      If any of that fails, "current" goes back to the old release and that
#      starts again.
#
# Layout (set up once, see scripts/DEPLOY.md):
#   $ROOT/shared/    mtg.db, cards.db, rules/, .env, outages.log, and "updating" during a deploy
#   $ROOT/releases/  one folder per commit (git worktrees of $REPO)
#   $ROOT/current -> releases/<commit>    the service runs from here
#
#   scripts/deploy.sh                      deploy origin/main
#   scripts/deploy.sh --ref <commit>       deploy that commit (a rollback is a deploy of the old one)
#   scripts/deploy.sh --wait 60            wait at most 60 s for running jobs
#   scripts/deploy.sh --build-only         build the release and stop there
#
# Environment (defaults are the Pi's): MTG_ROOT ($HOME/mtg), MTG_REPO ($HOME/development/MTGTracker),
# MTG_PORT (3001), MTG_STOP_CMD / MTG_START_CMD (sudo systemctl stop|start mtg), MTG_BACKUP_DIR.
# Two releases are kept: the current one and the one before.
set -euo pipefail

ROOT="${MTG_ROOT:-$HOME/mtg}"
REPO="${MTG_REPO:-$HOME/development/MTGTracker}"
PORT="${MTG_PORT:-3001}"
STOP_CMD="${MTG_STOP_CMD:-sudo systemctl stop mtg}"
START_CMD="${MTG_START_CMD:-sudo systemctl start mtg}"
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
BASE="http://127.0.0.1:$PORT"
STATUS="$BASE/api/status"

say() { echo "[deploy $(date +%H:%M:%S)] $*"; }
now() { node -e 'process.stdout.write(String(Date.now()))'; }
status() { curl -s -m 3 "$STATUS" 2>/dev/null || true; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
# A folder's real path (a relative or trailing-slash link reads the same), or nothing.
real() { if [ -e "$1" ]; then (cd "$1" && pwd -P); fi; }
# The id /api/status gives for a database path: a hash of its real path (lib/updating.ts databaseId).
dbid() { node -e 'const fs=require("fs");let p=process.argv[1];try{p=fs.realpathSync(p)}catch{};process.stdout.write(require("crypto").createHash("sha1").update(p).digest("hex").slice(0,16))' "$1"; }

[ -d "$SHARED" ] || { echo "no $SHARED: set up the layout first (scripts/DEPLOY.md)" >&2; exit 1; }
[ -f "$SHARED/mtg.db" ] || { echo "no database at $SHARED/mtg.db" >&2; exit 1; }
mkdir -p "$RELEASES"
if [ -t 0 ] && [ -z "${TMUX:-}" ] && [ -z "${STY:-}" ]; then
  say "not inside tmux or screen: a dropped connection would end this script. Ctrl-C now to start it in tmux; going on in 5 s"
  sleep 5
fi

# --- 1. build the new version beside the running one ------------------------------------------
git -C "$REPO" fetch --quiet origin
SHA=$(git -C "$REPO" rev-parse --short=12 "$REF^{commit}")
NEW="$RELEASES/$SHA"
OLD=$(real "$CURRENT")
if [ -n "$OLD" ] && [ "$OLD" = "$(real "$NEW")" ]; then say "$SHA is already current"; exit 0; fi

if [ -f "$NEW/.next/BUILD_ID" ] && [ "$(cat "$NEW/.next/BUILD_ID")" = "$SHA" ] && [ -f "$NEW/public/tesseract/worker.min.js" ]; then
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
  # `npm run build` runs prebuild too (scripts/copy-tesseract.cjs: the scanner's files, not in git). The build never
  # touches the live database: it gets a throwaway one, and no timers.
  SCRATCH=$(mktemp -d)
  ( cd "$NEW" && MTG_BUILD_ID="$SHA" MTG_SCHEDULER=off MTG_DB_PATH="$SCRATCH/build.db" MTG_CARDS_DB_PATH="$SCRATCH/cards.db" npm run build >"$NEW/build.log" 2>&1 ) \
    || { rm -rf "$SCRATCH"; say "build failed, nothing changed: see $NEW/build.log"; exit 1; }
  rm -rf "$SCRATCH"
  [ -f "$NEW/public/tesseract/worker.min.js" ] || { say "the build has no scanner files (public/tesseract): nothing changed"; exit 1; }
  say "built in $(( ($(now) - T0) / 1000 )) s"
fi
# A release with its own data/mtg.db would mean the service doesn't set MTG_DB_PATH: it would open that file, not ours.
if [ -e "$NEW/data/mtg.db" ]; then say "$NEW/data/mtg.db exists: a release must not hold a database (check MTG_DB_PATH in the service). Nothing changed"; exit 1; fi
if [ "$BUILD_ONLY" -eq 1 ]; then say "built only; current is still ${OLD:-none}"; exit 0; fi

# --- the way out, whatever happens: nothing left stopped ------------------------------------
STOPPED=""
UP=""
start_release() {
  local strict="${2:-1}"
  ln -sfn "$1" "$CURRENT"
  rm -f "$FLAG"
  eval "$START_CMD"
  # Up when the status answers with this release's build, from the expected database with profiles in it, and the
  # scanner's files are served (60 s at most).
  local want expect b got n
  want=$(basename "$1"); expect=$(dbid "$SHARED/mtg.db")
  for _ in $(seq 1 120); do
    b=$(status)
    if [ "$(printf '%s' "$b" | field build)" = "$want" ]; then
      # A build from before these checks says neither; only a build that says them can fail them.
      got=$(printf '%s' "$b" | field db); n=$(printf '%s' "$b" | field profiles)
      if [ -n "$got" ] && [ "$got" != "$expect" ]; then say "the app opened another database, not $SHARED/mtg.db"; return 1; fi
      if [ -n "$n" ] && ! [ "$n" -gt 0 ] 2>/dev/null; then say "the database it opened has no profiles"; return 1; fi
      # Going back, the old release may predate the scanner check: it only has to answer from the right database.
      if [ "$strict" = 1 ]; then curl -fs -m 5 -o /dev/null "$BASE/tesseract/worker.min.js" || { say "the scanner's files aren't served"; return 1; }; fi
      return 0
    fi
    sleep 0.5
  done
  say "no answer from the new build within 60 s"
  return 1
}
leave() {
  local code=$?
  # Getting the app back must finish: a second hang-up (the session dropping) or Ctrl-C can't stop it now.
  trap - EXIT
  trap '' INT TERM HUP
  set +e
  rm -f "$FLAG"
  if [ -n "$STOPPED" ] && [ -z "$UP" ]; then
    say "stopped part-way: starting ${OLD:+the old release }again"
    eval "$STOP_CMD" >/dev/null 2>&1
    if [ -n "$OLD" ] && start_release "$OLD" 0; then say "back on $(basename "$OLD")"
    elif [ -z "$OLD" ] && eval "$START_CMD"; then say "started what current points at"
    else say "THE OLD RELEASE DIDN'T PASS ITS CHECKS EITHER: the service itself is wrong (sudo systemctl status mtg; check MTG_DB_PATH). It may be down or on the wrong database"; fi
    [ "$code" -eq 0 ] && code=1
  fi
  exit "$code"
}
trap leave EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# --- 2. tell the app, and wait for running jobs --------------------------------------------------
# The file says when the deploy started and when it ends at the latest, so a killed script can't hold the app.
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $(node -e 'process.stdout.write(new Date(Date.now()+(Number(process.argv[1])+600)*1000).toISOString())' "$WAIT")" > "$FLAG"
say "told the app a deploy is under way: no new jobs start"
DEADLINE=$(( $(date +%s) + WAIT ))
while :; do
  RUNNING=$(status | field running)
  if [ -z "$RUNNING" ]; then say "the app isn't answering; going on"; break; fi
  if [ "$RUNNING" = "0" ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then say "$RUNNING job(s) still running after ${WAIT} s: deploying anyway, they will show as interrupted"; break; fi
  say "waiting for $RUNNING running job(s)"
  sleep 3
done

# --- 3. stop, back up ---------------------------------------------------------------------
T_STOP=$(now)
say "stopping the service"
STOPPED=1
eval "$STOP_CMD"
# The app's own lock is a folder; one left by a stop mid-write would make the next start report "busy".
if [ -d "$SHARED/mtg.db.lock" ]; then say "removing a lock the stopped app left: $SHARED/mtg.db.lock"; rmdir "$SHARED/mtg.db.lock" 2>/dev/null || rm -rf "$SHARED/mtg.db.lock"; fi

say "backing up"
# Named for the release and never pruned; every verify line must be ok (a wrong or empty database fails).
MTG_DB_PATH="$SHARED/mtg.db" bash "$NEW/scripts/backup.sh" --tag "predeploy-$SHA" --verify || { say "the backup failed: nothing changed"; exit 1; }

# --- 4 and 5. swap in, start, check ------------------------------------------------------------
say "starting $SHA"
if ! start_release "$NEW"; then say "$SHA didn't pass its checks: going back"; exit 1; fi
UP=1
say "up on $SHA: down for $(( ($(now) - T_STOP) / 1000 )) s (stop to first good answer)"

# --- keep this release and the one before (for going back); remove the rest ------------------------
KEEP_NEW=$(real "$NEW")
for old in "$RELEASES"/*; do
  [ -d "$old" ] || continue
  r=$(real "$old")
  if [ "$r" = "$KEEP_NEW" ] || [ "$r" = "$OLD" ]; then continue; fi
  say "removing the old release $(basename "$old")"
  git -C "$REPO" worktree remove --force "$old" 2>/dev/null || rm -rf "$old"
done
git -C "$REPO" worktree prune
