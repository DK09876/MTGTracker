/**
 * Runs once when the server starts: begins the app's own timers (checks,
 * the nightly card refresh, the weekly clean-up). MTG_SCHEDULER=off skips them.
 */

export async function register() {
  // Decks that exist when categories ship keep what they had (lib/categories.ts): migrate before anything else runs.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try { (await import('./lib/categories')).startCategories(); } catch (e) { console.error('[categories] start failed', e); }
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MTG_SCHEDULER !== 'off') {
    const { nightly, startScheduler, weekly } = await import('./lib/scheduler');
    const { cleanUp } = await import('./lib/cleanup');
    const { startCardRefresh } = await import('./lib/card-store');
    const { getSetting } = await import('./lib/db');
    nightly('cards', async () => { startCardRefresh(); });
    weekly('clean up', async () => { cleanUp(); });
    startScheduler();
    // A server that has never refreshed its card data does so soon after starting.
    if (!getSetting('cards.refreshedAt')) setTimeout(() => startCardRefresh(), 2 * 60_000).unref?.();
  }
}
