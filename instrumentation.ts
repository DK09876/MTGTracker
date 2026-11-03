/**
 * Runs once when the server starts: begins the app's own timers (checks,
 * nightly work). MTG_SCHEDULER=off skips them.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MTG_SCHEDULER !== 'off') {
    const { startScheduler } = await import('./lib/scheduler');
    startScheduler();
  }
}
