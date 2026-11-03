/**
 * Runs once when the server starts: begins the app's own timers (checks,
 * the nightly card refresh). MTG_SCHEDULER=off skips them.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MTG_SCHEDULER !== 'off') {
    const { nightly, startScheduler } = await import('./lib/scheduler');
    const { startCardRefresh } = await import('./lib/card-store');
    const { getSetting } = await import('./lib/db');
    nightly('cards', async () => { startCardRefresh(); });
    startScheduler();
    // A server that has never refreshed its card data does so soon after starting.
    if (!getSetting('cards.refreshedAt')) setTimeout(() => startCardRefresh(), 2 * 60_000).unref?.();
  }
}
