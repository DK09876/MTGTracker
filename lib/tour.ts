/**
 * The guided tour's sample: a hidden profile, "Sample", holding a deck with
 * tags, a brief and a saved read, a deck chat, a rules answer, past
 * searches and a small collection - so every step of the tour shows real
 * results. Seeded the first time someone starts a tour.
 *
 * The sample is read only and never spends AI: changes are refused for it
 * (profile-route.ts) and it has no model (ai.ts appModel). It is left out of
 * the profile lists and People. Server only.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { addLocation, addToCollection } from './collection';
import { addProfile, cardsInList, createList, database, deleteList, listLists, createTag, getList, getSetting, knownProfile, saveRecentSearch, setCardTag, setSetting, setTagBrief, startRulesThread } from './db';
import { saveChat, newChat } from './deck-chat';
import { importInto } from './import-into';
import { setPublic, setStyle } from './profile-style';
import { addRead, setSaved } from './reads';
import type { Turn } from './rules/answer';
import { findCardNamed } from './scryfall';
import { tagKey, TAG_COLORS } from './tags';

export const TOUR_PROFILE = 'tour';
const DECK_KEY = 'tour.deck';
const VERSION_KEY = 'tour.version';
// Bumped whenever the sample changes, so a server reseeds it.
const TOUR_VERSION = '2';

const DECKLIST = `
1 Archmage Emeritus
1 Archmage of Runes
1 Ashling, Flame Dancer
1 Electro, Assaulting Battery
1 Harmonic Prodigy
1 Hullbreaker Horror
1 Longshot, Rebel Bowman
1 Sedgemoor Witch
1 Storm-Kiln Artist
1 Stormcatch Mentor
1 Third Path Iconoclast
1 Young Pyromancer
1 Veyran, Voice of Duality
1 Torrential Gearhulk
1 An Offer You Can't Refuse
1 Big Score
1 Brainstorm
1 Chaos Warp
1 Consider
1 Desperate Ritual
1 Dig Through Time
1 Electrodominance
1 Frantic Search
1 Invoke Calamity
1 Lightning Bolt
1 Narset's Reversal
1 Opt
1 Past in Flames
1 Redirect Lightning
1 Reiterate
1 Remand
1 Seething Song
1 Snap
1 Turnabout
1 Unexpected Windfall
1 Wash Away
1 Force of Will
1 Blasphemous Act
1 Comet Storm
1 Empty the Warrens
1 Thrill of Possibility
1 Stubborn Denial
1 Sheoldred's Edict
1 Soul Shatter
1 Untimely Malfunction
1 Withering Torment
1 Waterlogged Teachings
1 Fell the Profane
1 Demand Answers
1 Confounding Riddle
1 Spellskite
1 Pinnacle Monk
1 Electrostatic Field
1 High Fae Trickster
1 Resonating Lute
1 Force of Despair
1 Cast into the Fire
1 Mysterious Stranger
1 Kaya's Ghostform
1 Brainsurge
1 Arcane Signet
1 Dimir Signet
1 Izzet Signet
1 Sol Ring
1 Swiftfoot Boots
1 Talisman of Creativity
1 Talisman of Dominance
1 Phyrexian Arena
1 Propaganda
1 Command Tower
1 Steam Vents
1 Sulfur Falls
1 Shivan Reef
1 Drowned Catacomb
1 Sulfurous Springs
1 Underground River
1 Fabled Passage
1 Mystic Sanctuary
1 Frostboil Snarl
1 Cascade Bluffs
1 Sunken Hollow
1 Rogue's Passage
8 Island
5 Mountain
4 Swamp
`;

const BRIEF = 'Grixis spellslinger. Win with one big storm turn: rituals and cheap spells make Treasure off Storm-Kiln Artist, Past in Flames replays the graveyard, and Longshot or Comet Storm finishes the table. Hullbreaker Horror is the backup lock. Keep interaction cheap: counters and 1-2 mana removal. Cantrips are glue, not card draw.';

const TAGS: Array<{ name: string; description: string; kind: 'wincon' | 'engine' | 'payoff' | 'enabler'; cards: string[] }> = [
  { name: 'Storm fuel', kind: 'enabler', description: 'Rituals and 0-1 mana spells that grow the storm turn.', cards: ['Desperate Ritual', 'Seething Song', 'Frantic Search', 'Snap', 'Opt', 'Consider', 'Brainstorm', 'Reiterate'] },
  { name: 'Spell payoffs', kind: 'payoff', description: 'Creatures that trigger on casting instants and sorceries.', cards: ['Storm-Kiln Artist', 'Archmage Emeritus', 'Veyran, Voice of Duality', 'Third Path Iconoclast', 'Young Pyromancer', 'Harmonic Prodigy'] },
  { name: 'Card engines', kind: 'engine', description: 'Keeps cards flowing every turn.', cards: ['Phyrexian Arena', 'Archmage Emeritus', 'Stormcatch Mentor'] },
  { name: 'The kill', kind: 'wincon', description: 'What ends the game after the storm turn.', cards: ['Longshot, Rebel Bowman', 'Comet Storm', 'Hullbreaker Horror', 'Empty the Warrens'] },
];

export const isTour = (profileId: string | null | undefined) => profileId === TOUR_PROFILE;

let seeding: Promise<string> | null = null;

/** The sample deck's id, seeding the sample the first time. */
export function ensureTour(): Promise<string> {
  const existing = getSetting(DECK_KEY);
  if (existing && getList(existing, TOUR_PROFILE) && getSetting(VERSION_KEY) === TOUR_VERSION) return Promise.resolve(existing);
  seeding ??= seed().finally(() => { seeding = null; });
  return seeding;
}

/** Everything the sample profile holds, so it can be seeded afresh. */
function wipe(): void {
  for (const list of listLists(TOUR_PROFILE)) deleteList(list.id);
  const d = database();
  for (const table of ['rules_threads', 'recent_searches', 'collection_cards', 'collection_locations']) {
    d.run(`DELETE FROM ${table} WHERE profileId = ?`, [TOUR_PROFILE]);
  }
  for (const table of ['deck_reads', 'deck_chats']) {
    if (d.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [table])) d.run(`DELETE FROM ${table} WHERE profileId = ?`, [TOUR_PROFILE]);
  }
}

async function seed(): Promise<string> {
  if (!knownProfile(TOUR_PROFILE)) addProfile(TOUR_PROFILE, 'Sample');
  wipe();
  const azula = await findCardNamed('Fire Lord Azula');
  if (!azula) throw new Error('Scryfall did not find the sample commander');
  const deck = createList(TOUR_PROFILE, 'Azula Storm (sample)', '', { kind: 'deck', commander: azula });
  await importInto(deck, DECKLIST);
  const cards = cardsInList(deck.id);
  const byName = new Map(cards.map((c) => [c.card.name, c.card]));

  setTagBrief(deck.id, BRIEF);
  TAGS.forEach((t, i) => {
    const tag = createTag(deck.id, { name: t.name, description: t.description, color: TAG_COLORS[i], kind: t.kind, status: 'accepted', origin: 'manual' });
    for (const name of t.cards) {
      const card = byName.get(name);
      if (card) setCardTag(deck.id, tagKey(card), tag.id, true);
    }
  });

  const read = addRead({
    listId: deck.id, profileId: TOUR_PROFILE, mode: 'build', model: 'claude-opus-5-5',
    winConditions: [
      { how: 'One big storm turn: rituals and cantrips make Treasure off Storm-Kiln Artist, then Past in Flames replays the graveyard into Longshot or Comet Storm.', cards: ['Storm-Kiln Artist', 'Past in Flames', 'Seething Song', 'Longshot, Rebel Bowman', 'Comet Storm'] },
      { how: 'Bounce lock: Hullbreaker Horror turns every cheap spell into a bounce and wins long games.', cards: ['Hullbreaker Horror', 'Snap', 'Opt', 'Consider'] },
    ],
    missing: 'A second finisher that does not need combat: Aetherflux Reservoir or Grapeshot would close the storm turn more reliably.',
    brief: BRIEF,
    cards: cards.filter((c) => c.board === 'main').map((c) => c.card.name),
  });
  setSaved(deck.id, read.id, true);

  const reservoir = await findCardNamed('Aetherflux Reservoir').catch(() => null);
  const chat = newChat(deck.id, TOUR_PROFILE, 'What finisher should I add, ideally one I own?');
  chat.messages.push(
    { role: 'user', text: 'The storm turn fizzles if nobody dies. What finisher should I add, ideally one I own?', at: new Date().toISOString() },
    {
      role: 'assistant', at: new Date().toISOString(), model: 'claude-sonnet-5-5',
      lookups: ['Looked at your collection', 'Cards for finishers'],
      text: 'Aetherflux Reservoir fits best: every spell in the storm turn gains life, and at 51 it shoots someone for 50, so it finishes even when Longshot is answered. To stay at 100, cut Thrill of Possibility - it does the least on a storm turn.',
      changes: [
        { kind: 'add', name: 'Aetherflux Reservoir', why: 'Turns the storm turn into lethal without combat.', cardId: reservoir?.id ?? null, held: 'yours, Box 1', price: reservoir?.prices?.usd ?? null },
        { kind: 'cut', name: 'Thrill of Possibility', why: 'The weakest card on a storm turn.', cardId: byName.get('Thrill of Possibility')?.id ?? null, held: null, price: null },
      ],
    },
  );
  saveChat(chat);

  const turn = JSON.parse(readFileSync(join(process.cwd(), 'lib/fixtures/tour-rules.json'), 'utf8')) as Turn;
  startRulesThread(TOUR_PROFILE, turn);

  saveRecentSearch(TOUR_PROFILE, 'cheap green ramp for Omnath', {
    kind: 'query', query: 'otag:ramp id<=rg -t:land usd<2', commander: 'Omnath, Locus of Rage',
    explanation: 'Ramp in Omnath\'s colours under $2, lands left out.',
  });
  saveRecentSearch(TOUR_PROFILE, 'counterspells that cost 2 or less', {
    kind: 'query', query: 'otag:counterspell cmc<=2', explanation: 'Counterspells with mana value 2 or less.',
  });

  addLocation(TOUR_PROFILE, 'Box 1');
  for (const name of ['Sol Ring', 'Arcane Signet', 'Lightning Bolt', 'Brainstorm', 'Swiftfoot Boots']) {
    const card = byName.get(name);
    if (card) addToCollection(TOUR_PROFILE, card, 1, 'nonfoil', 'Box 1');
  }
  if (reservoir) addToCollection(TOUR_PROFILE, reservoir, 1, 'nonfoil', 'Box 1');

  setStyle(TOUR_PROFILE, {
    theme: 'commander', motion: true, featuredDeck: deck.id,
    commander: { id: azula.id, name: azula.name, identity: azula.color_identity ?? [], art: azula.image_uris?.art_crop ?? azula.card_faces?.[0]?.image_uris?.art_crop ?? null },
  });
  setPublic(deck.id, true);
  setSetting(DECK_KEY, deck.id);
  setSetting(VERSION_KEY, TOUR_VERSION);
  return deck.id;
}
