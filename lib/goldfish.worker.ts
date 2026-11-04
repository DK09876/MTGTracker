/// <reference lib="webworker" />
/**
 * Runs the goldfish and the best-hand search off the main thread, so the
 * page keeps scrolling while thousands of games are played.
 */

import { bestHand, goldfish, type GoldfishSettings, type SimCard } from './goldfish';

export type GoldfishJob =
  | { kind: 'goldfish'; deck: SimCard[]; commander: SimCard | null; seed: number; settings: GoldfishSettings }
  | { kind: 'best'; deck: SimCard[]; commander: SimCard | null; seed: number; settings: GoldfishSettings };

self.onmessage = (e: MessageEvent<GoldfishJob>) => {
  const job = e.data;
  try {
    const result = job.kind === 'goldfish'
      ? goldfish(job.deck, job.commander, job.settings.games, job.seed, job.settings.turns, job.settings)
      : bestHand(job.deck, job.commander, { seed: job.seed, settings: job.settings });
    self.postMessage({ ok: true, kind: job.kind, result });
  } catch (err) {
    self.postMessage({ ok: false, kind: job.kind, error: err instanceof Error ? err.message : 'The simulation failed' });
  }
};
