/**
 * The app's own timers: the self-checks every quarter hour, and nightly
 * work at about 3 AM. Started once per server process from instrumentation.ts;
 * MTG_SCHEDULER=off turns it off (tests, local checks). Server only.
 */

import { runChecks } from './checks';

const CHECK_MS = 15 * 60_000;
const FIRST_CHECK_MS = 60_000;
const NIGHTLY_HOUR = 3;

type Nightly = () => Promise<void>;
const state = ((globalThis as { __mtgScheduler?: { started: boolean; nightly: Map<string, Nightly>; lastNight: string } }).__mtgScheduler
  ??= { started: false, nightly: new Map(), lastNight: '' });

/** Work to run once a night, by name (so a reload does not add it twice). */
export function nightly(name: string, work: Nightly): void {
  state.nightly.set(name, work);
}

function check() {
  try {
    runChecks();
  } catch (error) {
    console.error('[scheduler] checks failed', error);
  }
}

async function maybeNightly(now = new Date()) {
  const night = now.toDateString();
  if (now.getHours() !== NIGHTLY_HOUR || state.lastNight === night) return;
  state.lastNight = night;
  for (const [name, work] of state.nightly) {
    try {
      await work();
    } catch (error) {
      console.error(`[scheduler] ${name} failed`, error);
    }
  }
}

export function startScheduler(): void {
  if (state.started) return;
  state.started = true;
  setTimeout(check, FIRST_CHECK_MS).unref?.();
  setInterval(check, CHECK_MS).unref?.();
  setInterval(() => { void maybeNightly(); }, 5 * 60_000).unref?.();
}
