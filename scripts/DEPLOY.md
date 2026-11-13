# Deploying MTG Tracker on the Pi

`scripts/deploy.sh` builds the new version beside the running one, then stops the
service only for the swap: a few seconds down instead of about four minutes. This
file is the one-time setup it needs, and how to go back. **Nothing here has been run
on the Pi yet.** The owner decides when.

## What changes on the Pi (one time)

Today the app runs from `~/development/MTGTracker`, with the database, the card data
and `.env` inside that folder (`data/`, `.env`). `npm ci` and `next build` in that
folder break the running app, so the new version has to be built somewhere else.
After the change:

```
~/mtg/shared/      mtg.db, cards.db, rules/, .env   (data that outlives a release)
~/mtg/releases/    one folder per deployed commit (git worktrees of ~/development/MTGTracker)
~/mtg/current  ->  releases/<commit>                 (the service runs from here)
```

`~/development/MTGTracker` stays as the git repository the releases are checked out
from. Nothing is served from it any more.

## The service

The unit file was not read during the build (the handoff said to ask first). Before
replacing it, compare it with this and keep anything it has that this doesn't
(the user, extra environment, restart policy):

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

`WorkingDirectory` follows the `current` link each time the service starts, so a
deploy only moves the link. The rules files follow the database (`lib/rules/sources.ts`
keeps them in `rules/` beside `MTG_DB_PATH`). The backups stay in `~/backups/mtg`.

## One-time steps

Run as `admin`, with node on the PATH (`export PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH`).

1. Note what runs now: `git -C ~/development/MTGTracker rev-parse --short=12 HEAD`, and
   `systemctl cat mtg > ~/mtg.service.before`.
2. Build the first release while the old app keeps serving. This needs the layout
   folders first:
   ```sh
   mkdir -p ~/mtg/shared ~/mtg/releases
   cp ~/development/MTGTracker/.env ~/mtg/shared/.env
   # deploy.sh wants a database to exist; a placeholder is replaced in step 4.
   touch ~/mtg/shared/mtg.db
   # The running folder's checkout predates deploy.sh: take the script from main without touching that folder.
   git -C ~/development/MTGTracker fetch origin
   git -C ~/development/MTGTracker show origin/main:scripts/deploy.sh > ~/deploy-once.sh
   bash ~/deploy-once.sh --build-only
   ```
3. Stop the app: `sudo systemctl stop mtg`.
4. Move the data and take the backup:
   ```sh
   rm ~/mtg/shared/mtg.db
   mv ~/development/MTGTracker/data/mtg.db ~/development/MTGTracker/data/cards.db ~/mtg/shared/
   [ -d ~/development/MTGTracker/data/rules ] && mv ~/development/MTGTracker/data/rules ~/mtg/shared/
   rmdir ~/development/MTGTracker/data/mtg.db.lock 2>/dev/null || true
   MTG_DB_PATH=~/mtg/shared/mtg.db bash ~/mtg/releases/<the commit>/scripts/backup.sh --force --verify
   ```
   Anything else left in `data/` (other files written there over time) should be
   looked at before going on.
5. Point the service at the new layout: `sudo systemctl edit --full mtg`, set the
   lines above, then `sudo systemctl daemon-reload`.
6. `ln -sfn ~/mtg/releases/<the commit> ~/mtg/current`, then `sudo systemctl start mtg`.
7. Check: `curl -s http://127.0.0.1:3001/api/status` shows the commit, and the app
   opens on the tailnet address.

From then on a deploy is `bash ~/mtg/current/scripts/deploy.sh` (or with
`--ref <commit>`).

## Going back from the one-time change

If step 6 or 7 fails:

```sh
sudo systemctl stop mtg
mv ~/mtg/shared/mtg.db ~/mtg/shared/cards.db ~/development/MTGTracker/data/
[ -d ~/mtg/shared/rules ] && mv ~/mtg/shared/rules ~/development/MTGTracker/data/
sudo cp ~/mtg.service.before /etc/systemd/system/mtg.service   # the unit as it was (check the path systemctl cat printed)
sudo systemctl daemon-reload && sudo systemctl start mtg
```

The old folder was never changed apart from its `data/` files moving out, so it runs
as before.

## Going back after a deploy

The script goes back by itself when the new version doesn't answer within 60 seconds.
To go back by hand later: `bash ~/mtg/current/scripts/deploy.sh --ref <earlier commit>`.
The release before is kept, so it isn't built again. A database change the new
version made isn't undone: restore the backup the deploy took (`~/backups/mtg`, the
newest `mtg_*.db.gz` from before the deploy) with the service stopped.

## A job running at deploy time

The script writes `~/mtg/shared/updating`. From then on no new background job starts,
and open pages grey out the buttons that would start one and say the app is updating.
It waits for running jobs for up to 3 minutes (`--wait` changes it), then deploys
anyway. A job still running then shows as interrupted, as it does today. The file is
removed when the new version starts, or when the script stops for any reason.

## Not checked

- What the tailnet address answers while the service is stopped. The page treats a
  failed request, and a 502, 503 or 504 without the app's own header, as "updating".
- The backup's safety while the app writes. The app locks the database with a
  `mtg.db.lock` folder (node-sqlite3-wasm), and the `sqlite3` tool doesn't see that lock.
  The deploy's backup is taken with the service stopped. The nightly one runs while the
  app is up, so a write during it could give an inconsistent snapshot.
  `--verify` checks the newest one.
