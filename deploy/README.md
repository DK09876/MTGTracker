# Pi timers

Installed once on the Pi (they are not part of `npm run build`):

    sudo cp deploy/mtg-*.service deploy/mtg-*.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now mtg-backup.timer mtg-watch.timer

- `mtg-backup` snapshots ~/mtg/shared/mtg.db to ~/backups/mtg nightly at 3:50
  (scripts/backup.sh, kept 30, integrity-checked). The app's backup check
  in Settings reads that folder.
- `mtg-watch` pings the app every 5 minutes and writes to ~/mtg/shared/outages.log
  when it does not answer; the app logs those as errors when it is back.

Both run from ~/mtg/current, the release layout in scripts/DEPLOY.md; the
units before that layout pointed at ~/development/MTGTracker.

The app's own timers (checks every 15 minutes, the weekly card refresh) run
inside the server - see lib/scheduler.ts.
