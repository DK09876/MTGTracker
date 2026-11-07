/**
 * What sets copies of one printing apart besides the finish: the language
 * it is printed in, its condition, a proxy standing in for it, and a few
 * marks (altered, signed, misprint). Stored as one short key per copy -
 * '' for a plain English near-mint copy - so two Japanese Shocks in a box
 * are one row and an English one another. Shared by server and browser.
 */

export interface Variant {
  /** Scryfall's language code: en, ja, fr, ph (Phyrexian)... */
  language: string;
  /** NM, LP, MP, HP, DMG - or '' when no one said. */
  condition: string;
  proxy: boolean;
  altered: boolean;
  signed: boolean;
  misprint: boolean;
}

export const PLAIN: Variant = { language: 'en', condition: '', proxy: false, altered: false, signed: false, misprint: false };

const FLAGS = ['proxy', 'altered', 'signed', 'misprint'] as const;

/** Near mint is the default: it does not need saying. */
const plainCondition = (c: string) => !c || /^(nm|near mint|m|mint)$/i.test(c);

export function variantKey(v: Partial<Variant>): string {
  const parts: string[] = [];
  const language = (v.language ?? 'en').trim().toLowerCase();
  if (language && language !== 'en') parts.push(`lang:${language}`);
  const condition = (v.condition ?? '').trim().toUpperCase();
  if (!plainCondition(condition)) parts.push(`cond:${condition}`);
  for (const f of FLAGS) if (v[f]) parts.push(f);
  return parts.join(',');
}

export function parseVariant(key: string): Variant {
  const out: Variant = { ...PLAIN };
  for (const part of key.split(',').filter(Boolean)) {
    if (part.startsWith('lang:')) out.language = part.slice(5);
    else if (part.startsWith('cond:')) out.condition = part.slice(5);
    else if ((FLAGS as readonly string[]).includes(part)) out[part as (typeof FLAGS)[number]] = true;
  }
  return out;
}

export const isProxy = (key: string) => key.split(',').includes('proxy');

const LANGUAGES: Record<string, string> = {
  ja: 'Japanese', fr: 'French', de: 'German', it: 'Italian', es: 'Spanish', pt: 'Portuguese', ru: 'Russian',
  ko: 'Korean', zhs: 'Chinese (simplified)', zht: 'Chinese (traditional)', ph: 'Phyrexian', he: 'Hebrew', la: 'Latin', grc: 'Ancient Greek', ar: 'Arabic', sa: 'Sanskrit',
};

/** Short badges for a copy: "JA", "LP", "Proxy", "Signed". Empty for a plain copy. */
export function variantBadges(key: string): Array<{ text: string; title: string }> {
  const v = parseVariant(key);
  const out: Array<{ text: string; title: string }> = [];
  if (v.proxy) out.push({ text: 'Proxy', title: 'A proxy: stands in for the card, not counted in the value' });
  if (v.language !== 'en') out.push({ text: v.language.toUpperCase(), title: LANGUAGES[v.language] ?? v.language });
  if (v.condition) out.push({ text: v.condition, title: `Condition: ${v.condition}` });
  if (v.altered) out.push({ text: 'Altered', title: 'Altered art' });
  if (v.signed) out.push({ text: 'Signed', title: 'Signed' });
  if (v.misprint) out.push({ text: 'Misprint', title: 'Misprint' });
  return out;
}
