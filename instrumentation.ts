/**
 * Runs once when the server starts: begins the app's own timers (checks,
 * the nightly card refresh, the weekly clean-up). MTG_SCHEDULER=off skips them.
 */

export async function register() {
  // Decks that exist when the Plan and Tags redesign ships are reset to a fresh import once (lib/deck-reset.ts), before anything else runs.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // A deploy's "updating" file is over once the app starts (or the machine rebooted mid-deploy).
    try { (await import('./lib/updating')).clearUpdating(); } catch { /* nothing to clear */ }
    try { (await import('./lib/categories')).startCategories(); } catch (e) { console.error('[categories] start failed', e); }
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MTG_SCHEDULER !== 'off') {
    const { startScheduler, weekly } = await import('./lib/scheduler');
    const { cleanUp } = await import('./lib/cleanup');
    const { startCardRefresh } = await import('./lib/card-store');
    const { getSetting } = await import('./lib/db');
    // Card data once a week, early on Sunday (the owner's call, 2026-11-13: card text changes rarely; new cards come with
    // set releases, and Settings has Refresh now for those days).
    weekly('cards', async () => { startCardRefresh(); });
    weekly('clean up', async () => { cleanUp(); });
    startScheduler();
    // A server that has never refreshed its card data does so soon after starting.
    if (!getSetting('cards.refreshedAt')) setTimeout(() => startCardRefresh(), 2 * 60_000).unref?.();
  }
}
