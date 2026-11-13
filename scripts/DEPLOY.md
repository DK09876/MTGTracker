# Deploying MTG Tracker on the Pi

`scripts/deploy.sh` builds the new version beside the running one, then stops the
service only for the swap: a few seconds down instead of about four minutes. This file
is the one-time setup it needs, and how to go back. **Nothing here has been run on the
Pi yet.** The owner decides when, and every step that changes the Pi is theirs to
approve.

## What changes on the Pi (one time)

Today the app runs from `~/development/MTGTracker`, with the database, the card data and
`.env` inside that folder (`data/`, `.env`). `npm ci` and `next build` in that folder
break the running app, so the new version has to be built somewhere else. After the
change:

```
~/mtg/shared/      mtg.db, cards.db, rules/, .env, outages.log   (data that outlives a release)
~/mtg/releases/    one folder per deployed commit (git worktrees of ~/development/MTGTracker)
~/mtg/current  ->  releases/<commit>                            (the service and the timers run from here)
```

`~/development/MTGTracker` stays as the git repository the releases are checked out
from. Nothing is served from it any more.

## 0. Read first (nothing changes)

Before anything moves, look, and note what you find:

```sh
systemctl cat mtg                                  # the user, WorkingDirectory, Environment, EnvironmentFile, ExecStart
systemctl cat mtg-backup.service mtg-backup.timer  # what the nightly backup runs, and from where
systemctl cat mtg-watch.service mtg-watch.timer    # what the outage watch runs, and where it writes
systemctl list-timers 'mtg*'
sudo -n systemctl status mtg >/dev/null && echo "sudo works without a password"
env -i HOME=$HOME PATH=/usr/bin:/bin bash -lc 'command -v node sqlite3 tmux; cp --help | grep -q -- "-l" && echo cp-al-ok'
df -h ~                                           # room for a second release (~600 MB) and its build
ls -la ~/development/MTGTracker/data/              # no mtg.db-journal, -wal or -shm should be there
grep -o '^[A-Z_]*=' ~/development/MTGTracker/.env  # which settings .env holds (names only)
```

If `node` isn't on that plain PATH, the deploy script needs it: run it with
`PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH`. If `sudo systemctl` asks for a
password, the script stops at that step; set it up or run the start and stop by hand.

## The service

Compare the unit you read in step 0 with this, and keep anything it has that this
doesn't (the user, extra environment, the restart policy):

```ini
[Service]
User=admin
WorkingDirectory=/home/admin/mtg/current
Environment=PATH=/home/admin/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=MTG_DB_PATH=/home/admin/mtg/shared/mtg.db
Environment=MTG_CARDS_DB_PATH=/home/admin/mtg/shared/cards.db
EnvironmentFile=/home/admin/mtg/shared/.env
ExecStart=/home/admin/mtg/current/node_modules/.bin/next start -p 3001 -H 127.0.0.1
Restart=on-failure
```

`MTG_DB_PATH` must be set: without it the app would open a new empty database inside the
release. The deploy script refuses to go on when a release holds `data/mtg.db`, and
checks after every start that the app opened `shared/mtg.db` and that it has profiles.
`WorkingDirectory` follows the `current` link each time the service starts, so a deploy
only moves the link. The rules files follow the database (`rules/` beside
`MTG_DB_PATH`). The backups stay in `~/backups/mtg`.

The nightly backup and the outage watch move too: the repo's `deploy/mtg-backup.service`
and `deploy/mtg-watch.service` now run from `~/mtg/current` with the database and the
outage log in `~/mtg/shared`. Compare them with what step 0 showed before installing.

## One-time steps

Run as `admin` inside tmux (`tmux new -s deploy`), with node on the PATH
(`export PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH`).

1. Keep what runs now:
   ```sh
   git -C ~/development/MTGTracker rev-parse --short=12 HEAD
   mkdir -p ~/mtg-before && for u in mtg mtg-backup mtg-watch; do systemctl cat $u.service > ~/mtg-before/$u.service; done
   ```
2. Build the first release while the old app keeps serving:
   ```sh
   mkdir -p ~/mtg/shared ~/mtg/releases
   cp ~/development/MTGTracker/.env ~/mtg/shared/.env
   touch ~/mtg/shared/mtg.db                # a placeholder for the script's check; replaced in step 4
   git -C ~/development/MTGTracker fetch origin
   git -C ~/development/MTGTracker show origin/main:scripts/deploy.sh > ~/deploy-once.sh
   bash ~/deploy-once.sh --build-only
   ```
3. Stop the app and the timers, cleanly: `sudo systemctl stop mtg-backup.timer mtg-watch.timer mtg`,
   then check nothing is left: `ls ~/development/MTGTracker/data/` shows no `mtg.db.lock`
   folder, and `systemctl is-active mtg` says `inactive`.
4. Move the data, every file of the database together, and check it before anything starts:
   ```sh
   rm ~/mtg/shared/mtg.db
   cd ~/development/MTGTracker/data
   mv mtg.db* cards.db* ~/mtg/shared/       # mtg.db and any -journal, -wal or -shm with it
   [ -d rules ] && mv rules ~/mtg/shared/
   [ -f outages.log ] && mv outages.log ~/mtg/shared/
   ls -la                                   # anything left here? look at it before going on
   sqlite3 ~/mtg/shared/mtg.db "PRAGMA integrity_check; SELECT COUNT(*) FROM profiles;"   # ok, and a number above 0
   MTG_DB_PATH=~/mtg/shared/mtg.db bash ~/mtg/releases/<the commit>/scripts/backup.sh --tag move --verify
   ```
5. Point the service and the timers at the new layout: `sudo systemctl edit --full mtg`
   (the lines above), then
   `sudo cp ~/mtg/releases/<the commit>/deploy/mtg-backup.service ~/mtg/releases/<the commit>/deploy/mtg-watch.service /etc/systemd/system/`
   and `sudo systemctl daemon-reload`.
6. `ln -sfn ~/mtg/releases/<the commit> ~/mtg/current`, then `sudo systemctl start mtg`.
7. Check: `curl -s http://127.0.0.1:3001/api/status` shows the commit and `"profiles"` above
   0; `curl -sI http://127.0.0.1:3001/tesseract/worker.min.js` is 200; the app opens on
   the tailnet address. Then `sudo systemctl start mtg-backup.timer mtg-watch.timer`.

From then on a deploy is `bash ~/mtg/current/scripts/deploy.sh` (or with `--ref <commit>`),
inside tmux.

## Going back from the one-time change

If step 6 or 7 fails:

```sh
sudo systemctl stop mtg mtg-backup.timer mtg-watch.timer
mv ~/mtg/shared/mtg.db* ~/mtg/shared/cards.db* ~/development/MTGTracker/data/
[ -d ~/mtg/shared/rules ] && mv ~/mtg/shared/rules ~/development/MTGTracker/data/
[ -f ~/mtg/shared/outages.log ] && mv ~/mtg/shared/outages.log ~/development/MTGTracker/data/
for u in mtg mtg-backup mtg-watch; do sudo cp ~/mtg-before/$u.service /etc/systemd/system/$u.service; done   # the units as they were
sudo systemctl daemon-reload && sudo systemctl start mtg mtg-backup.timer mtg-watch.timer
```

`systemctl cat` prints a comment line first with the unit's path; check the copies are
plain unit files before putting them back. The old folder was never changed apart from
its `data/` files moving out, so it runs as before.

## Going back after a deploy

The script goes back by itself when the new version doesn't pass its checks within 60
seconds, and on any way out after the service stopped (an error, Ctrl-C, a dropped
session): it starts the release that was running. To go back by hand later:
`bash ~/mtg/current/scripts/deploy.sh --ref <earlier commit>`. The release before is
kept, so it isn't built again. A database change the new version made isn't undone:
restore the snapshot the deploy took (`~/backups/mtg/predeploy-<commit>_*.db.gz`) with the
service stopped.

## A job running at deploy time

The script writes `~/mtg/shared/updating`, with when it started and when it ends at the
latest (the wait plus ten minutes). From then on no new background job starts, and open
pages grey out the buttons that would start one and say the app is updating. It waits
for running jobs for up to 3 minutes (`--wait` changes it), then deploys anyway. A job
still running then shows as interrupted, as it does today. The file is removed when the
new version starts or the script ends for any reason; if the script was killed, the app
ignores the file once its end has passed, and removes it when it next starts.

## Not checked

- What the tailnet address answers while the service is stopped. The page treats a
  failed request, and a 502, 503 or 504 without the app's own header, as "can't reach
  the app", and as "updating" when the server said so in the last ten minutes.
- The nightly backup's safety while the app writes. The app locks the database with a
  `mtg.db.lock` folder (node-sqlite3-wasm), and the `sqlite3` tool doesn't see that
  lock. The deploy's snapshot is taken with the service stopped; the nightly one runs
  while the app is up, so a write during it could give an inconsistent snapshot.
  `--verify` checks the newest one.
