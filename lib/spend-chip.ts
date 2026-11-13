/** The header's budget chip (components/AiSpend.tsx), worked out. Pure. */

export interface ChipSpend { today: number; profileToday: number; caps: { daily: number; perProfile: number } }

/** The cap that runs out first for this profile, and what has been spent against it. */
export function tightest(spend: ChipSpend): { spent: number; cap: number; whose: 'yours' | 'everyone' } {
  const mine = spend.caps.perProfile - spend.profileToday;
  const app = spend.caps.daily - spend.today;
  return app < mine ? { spent: spend.today, cap: spend.caps.daily, whose: 'everyone' } : { spent: spend.profileToday, cap: spend.caps.perProfile, whose: 'yours' };
}

/** Its colour: quiet below 80% of the cap, amber from 80%, red once used up. */
export function chipTone(spent: number, cap: number): 'quiet' | 'amber' | 'red' {
  const share = spent / Math.max(cap, 0.01);
  return share >= 1 ? 'red' : share >= 0.8 ? 'amber' : 'quiet';
}
