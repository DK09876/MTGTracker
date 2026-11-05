# MTG Tracker Deck-Building Reference

31 October 2026, revised 2 November 2026. This file is the source of truth; it began as the shared doc at https://claude.ai/artifact/Qy5JxVAnr4gojbFhvTxEm6, which is no longer kept in step.

## Summary

This is the shared reference for how MTG Tracker categorizes cards, judges a deck and builds its mana base. It distils a 19-video deck-building playlist, Frank Karsten's mana maths, Salubrious Snail's manabase tool and the data sources the app can use, then tests the approach on four popular decks.

What it draws on:

- **The playlist:** all 19 videos of the "EDH deck building" YouTube playlist, transcribed and read in full: Trinket Mage, Deck Driver, Salubrious Snail, Aegis Gaming, Unpopular MTG, 3/3 Elk and Arcane Broadcast. Video 17's captions stop 90 seconds early, and video 10 ends in an uncaptioned Patreon clip.
- **Mana maths:** Salubrious Snail's manabase tool, read from its own source code, and Frank Karsten's 2022 Commander articles it builds on.
- **Data:** Scryfall's community tags, Commander Spellbook, EDHREC and Gatherer, each checked through its real responses. The two Moxfield lists (stax cards, free spells) could not be fetched: Moxfield blocks automated access, so they need a manual export.
- **A test:** four of Archidekt's most-viewed Commander decks with primers, whose authors sorted every card into categories, used as an answer key.

The headline: about three quarters of a deck can be categorized from Scryfall data alone, at no cost and the same every time. Win conditions, protection and stax need more data or a deck-specific read.

## Card categories

A card's function is the same in every deck, so it comes from data. Its job in this deck is a separate, deck-specific layer. One card often fills several categories, and the videos treat that as a strength, not a counting problem. "V" numbers refer to the playlist videos listed under Sources.

| Category | What counts | Edge cases | Scryfall tag used by the app |
| --- | --- | --- | --- |
| Lands | Colour sources and land drops (V10, V12) | MDFCs, utility lands and creature-lands count as lands and fill other roles too | type line |
| Ramp | Any extra mana: rocks, dorks, land ramp, treasure, cost reducers (V5, V11) | Count only ramp that fits the curve (V1). Cheap ramp is worth more (V10). A ramping commander fills a slot (V1, V3) | `ramp`, split into `mana-rock`, `mana-dork`, `land-ramp`, `ritual`, `cost-reducer` |
| Card draw | Cards that leave you with more cards in hand (V1) | **Cantrips only replace themselves and are not draw** (V1). Selection and impulse draw sit in Deck Driver's "cards" pillar (V5). Monarch counts (V9) | `card-advantage` minus `cantrip`; `draw-engine` for repeatable draw |
| Card selection | Cantrips, looting, filtering | Fuel for spell decks; not counted as draw | `cantrip` |
| Tutors | Find a combo piece or toolbox card (V7, V13, V17) | Land-fetchers are tagged as tutors but count as ramp | `tutor` minus `ramp` |
| Targeted removal | Flexible one-for-one answers (V1) | Counterspells are "the best spot removal" but timing-bound (V7, V19). Theft is removal plus finisher (V7). Fight spells count in green (V7) | `spot-removal`; `counterspell` kept separate |
| Board wipes | Catch-up when behind (V1) | More if the deck has few creatures (V1); never about 10, even in control (V7) | `board-wipe` |
| Stax | Slows the whole table: rule-setting pieces, taxes, mana denial | V7 treats it as its own style and leaves it out of control. Scryfall has **no stax tag**; the friend's curated list is better | union of `cost-increaser`, `rule-of-law`, `tax-attack`, `prevent-cast`, `prevent-activation`, `skip-untap-step`, `cast-tax`, `mass-land-denial` |
| Protection | Keeps the commander or plan alive: boots, indestructible, protection spells (V4) | Need scales with how much the deck relies on its commander (V4, V8). "Protect my combo turn" pieces (Silence, Grand Abolisher) are tagged as stax | `protection` |
| Recursion | Returns cards from the graveyard | Repeatable recursive removal is worth more than one removal slot (V7, V13) | `recursion` |
| Win conditions | Combo, scaling threats, army-in-a-can, mana sinks, theft, commander damage, drain (V6, V7) | **Must not all need the commander** (V4). Incremental mill is weak (V19) | `win-condition` (alternate wins), plus Spellbook combo results and the finishers below |
| Finishers | Extra turns, extra combats, overruns, anthems, drain, mill | Judged by deck shape, not one card | `extra-turn`, `extra-combat`, `overrun`, `anthem`, `drain-life`, `mill` |
| Game-plan pieces | Cards that advance this deck's plan (V5, V11) | Effect density (overlap with the plan) is separate from synergy (V6). Watch for win-more and commander-only cards (V4, V8, V15) | deck-specific, from the brief |
| Engines | Repeatable advantage, often the commander (V7) | Early engines are the priority removal targets (V7) | `draw-engine`, `repeatable-token-generator`, `sac-outlet` |

Cards that count twice are the best value (V5, V11): Growth Spiral is mana and draw, Monument to Endurance is mana, draw and plan, and theft is removal and a finisher.

## Recommended counts

Counts are starting points, not rules. The template that gives them immediately calls them "probably wrong for your deck" (V1), and the counts deliberately add up to more than 100 because cards fill several roles (V5).

| Category | Trinket Mage template (V1) | Deck Driver (V5, V11) | Others |
| --- | --- | --- | --- |
| Lands | 37, fine for average mana value 3.2–4.2 | 34–35 with 20+ mana sources | Karsten and Salubrious Snail: 37 minimum, up to 42; more when the commander is expensive and draws (V12) |
| Ramp | 10, or whatever lands the commander on curve | 20+ "mana" (V5), 16–20 (V11) | Depends on the commander's role (V1, V3) |
| Card draw | 10 real draw, no cantrips | about 30 (V5), 16–20 (V11) | Add more draw first; most decks lack it (V16). Control wants lots (V7) |
| Interaction | 10 spot removal, 2 wipes | 20–25 interaction | Fewer if the commander is removal (V1); wipes never about 10 (V7) |
| Game plan | 30 flex | 30+ | Quantity decks 30–36, quality decks 15–20 (V9) |
| Protection | not in the template | not separate | Scales with reliance on the commander (V4) |

Where they disagree:

1. **Templates at all:** V6 does not believe in them; V1 gives one and disclaims it.
2. **Land count:** Deck Driver goes as low as 34–35 with heavy ramp. Salubrious Snail says most people run too few (V12).
3. **Draw:** from 10 (V1) to about 30 (V5), depending on whether selection counts.

For the app: show the counts as ranges with their sources, never as pass or fail, and let the deck's plan move them.

## Ways to build

Much of what the videos say about commanders and synergy describes different styles of building, not rival positions. A builder picks and combines them.

**Commander styles.** The videos describe what a commander does for its deck in several overlapping ways:

- **Linchpin, counterweight, amplifier, payoff or specific role** (V15).
- **Enabler or payoff** (V3), and **counterweight commanders** that cover the 99's weakness rather than pay off its theme (V3, V15).
- **Anchor or buttress** (V6).
- **Building around every clause** of the commander's text (V2) suits commanders whose text is the plan.

One tension is real and stays as a risk check: V4 argues the deck should still work with the commander shuffled into the 99, the opposite of V2's approach. How much that matters depends on the style. A deck built tightly around a linchpin commander is the case V4 and V15 warn about (feast or famine, weak without it); a counterweight commander carries little of that risk. For the app: classify the commander's style first, then judge the deck's dependence on it in that light.

**Ways to make a deck stronger.** These are complementary tools, and a good deck can use all of them:

- **Synergy density:** cards that combine for more than their sum, found by reading the commander clause by clause (V2) and maximising overlap between roles and the plan (V5).
- **Cohesion:** cards that pull in the same direction even without interacting directly (V13).
- **Indirect synergy:** cards that reach the theme's goal as a by-product, such as Manifest Dread for self-mill (V14).

The creators do push back on each other a little (V13: "reject synergy, embrace cohesion"; V14 calls the synergy obsession limiting), but in practice the ideas fit together. For the app: show these as separate dimensions of a deck, not one score with a winner.

**Brewing angles: what makes a deck unusual (V20).** The rest of this file is about making a deck work. V20 is about making it different from the rest of the table, and it names seven angles. Each one says something about how the app should read a deck that breaks the usual patterns:

| Angle | What it is | What it means for the app |
| --- | --- | --- |
| Unpopular commander | A commander few people build (EDHREC rank in the thousands). | EDHREC averages and "played in N decks" are thin or empty. Fall back on Scryfall data and the deck's own cards, and don't call a card wrong for being rare in other lists. |
| Breaking the colour pie | A colour doing what it usually doesn't: mono-blue sea-monster stompy, mono-red control, flash outside blue. | Style detection must read the cards, not assume a style from the colours. The usual counts may not fit (a mono-red control deck wants more draw and interaction than a red deck usually runs). |
| Theme deck | A restriction that isn't a creature type: every creature wears a hat, only 1-mana spells, only 7-drops. Not bracket 1 by default; it can still be consistent. | The owner's restriction belongs in the brief. Suggestions and the cut list must keep to it, and lower card quality from a smaller pool is expected, not a fault. |
| Rube Goldberg combo | A win that needs four to six permanents working together (energy decks, for example). Cards are often mana-inefficient on their own. | The pieces should be marked as protected (wincon or engine) so the cut list doesn't trim them for being slow or weak alone. Expect more draw and tutors, and protection for the board. |
| Popular commander built "wrong" | A well-known commander pointed at a different plan: Edgar Markov that never attacks, Vivi with only enchantments as non-creature spells. | The plan in the brief wins over what the commander's text suggests. Style detection should offer the commander's usual style, but the owner's choice must drive targets and cuts. |
| Mechanic deck | Built around one keyword or action: vigilance, flash, sacrifice through mobilize. The more niche, the more distinctive. | Treat the mechanic as the deck's key theme package (a tag), and judge cards on whether they carry it. |
| Secret commander | The real build-around is in the 99: a card that can't be a commander, or a legend whose colours are too narrow. The command zone card mostly supplies colours. cEDH examples: in a Gaea's Cradle deck the real commander is Gaea's Cradle; in a "slop" deck it is Rhystic Study. | The deck's engine isn't the commander. The plan should allow naming a key card from the 99 that's never cut and that draw and tutors aim for. Commander-dependence checks (V4, V15) don't apply in the usual way. |

For the app overall: all seven come down to the owner's plan overriding the defaults. The brief and the plan's style choice are where these angles go. Tuning and the cut list should follow the plan, not the averages, and a stated restriction should never be cut against.

## Mana base

Use Frank Karsten's published maths to recommend lands and colour sources; Salubrious Snail's tool then checks the result. Karsten's land formula for Commander (MDFCs counted partly) is:

```
lands = 31.42 + 3.13 × (average MV of spells) − 0.28 × (cheap draw and ramp spells)
```

"Cheap" means mana value 2 or less. A deck with average MV 3 and 10 cheap draw/ramp spells gets 38 lands. His rule of thumb is to start at 42 lands plus Sol Ring, cut one land per 2–3 extra rocks, 3–4 cheap cantrips or 3–4 dorks, and never go below 37.

**Colour sources needed in a 99-card deck with 41 lands**, to cast a spell on curve about 90% of the time once you have hit your land drops ([Karsten 2022](https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/)):

| Coloured pips | MV 1 | MV 2 | MV 3 | MV 4 | MV 5 | MV 6 |
| --- | --- | --- | --- | --- | --- | --- |
| One (C) | 19 | 19 | 18 | 16 | 15 | 14 |
| Two (CC) | | 30 | 28 | 26 | 23 | 22 |
| Three (CCC) | | | 36 | 33 | 30 | 28 |
| Four (CCCC) | | | | 39 | 36 | |

Adjustments, all from Karsten:

- **Gold cards:** check each colour, then add 1 to every requirement.
- **Hybrid:** sources of either colour count.
- **Fetches:** a full source of each colour they can fetch; about two-thirds of a source in a 3+ colour deck.
- **MDFC lands:** 0.8 of a source (1.0 if mythic); 0.38 of a land for the land count (0.74 if mythic).
- **Rocks:** 0.75 of a source for spells of MV 3+. **Dorks:** 0.5 for MV 2+. **Two-mana land ramp:** 0.75 for MV 3+. **Three-mana ramp:** 0.5 for MV 5+. **Treasure:** 0.25 for MV 3+.
- **Taplands:** count for turn 1 only if they enter untapped.

**Salubrious Snail's tool** ([manabase tool](https://www.salubrioussnail.com/manabase-tool), video V10) checks an existing manabase rather than recommending one:

- **Input:** a decklist and the commander, weighted 10–50x.
- **Output:** "cast rate" (the chance each spell is castable on curve) and "average delay" in turns, plus the same numbers with one extra Wastes or one extra basic of each colour.
- **Reading it:** 90% cast rate or a 0.3 delay is strong; 80% or 0.6 needs work. If the extra Wastes helps a lot, the deck needs more lands rather than better fixing.
- **How it works:** the maths runs in the browser on Karsten's mulligan rules. Rocks count 0.75 and dorks 0.5, weighted by the chance they are cast on time. It does not count draw spells.
- **Limits:** no licence, no terms, no public API, and no way to pre-fill a decklist by link. Do not copy its code or call its API without asking its author.

**What the app should do:**

- Replace the fixed 35–38 land target with Karsten's formula, kept at 37 or more.
- For each colour, show sources needed, sources the deck has (weighted as above) and the card that sets the requirement.
- Add a "copy decklist and open Salubrious Snail" button for the full simulation.
- Today's on-curve odds skip mulligans, rocks and dorks, so they read about 7–10 points below Karsten's. Either switch to his conditional method or compare source counts against the table.

## Win conditions and game plan

A plan is a target board state, when it happens and how it wins (V16); a theme or a mechanic alone is not a plan, and the deck must still have a way to win without its commander (V4, V8).

How to read a deck's plan:

1. **Read the commander clause by clause** for what it rewards: attacking, card types, ETBs, counters (V2, V6).
2. **Let the kind of value point to the win** (V6): attack or life-loss value wins on life totals; self-growth or protection on the commander means Voltron; "buttress" commanders slot in a combo or alternate win.
3. **Classify the commander's role:** enabler or payoff (V3), anchor or buttress (V6), or linchpin, counterweight, amplifier or payoff (V15). Back up in the 99 any role only the commander provides.
4. **Separate theme from win condition** (V8), and flag feast-or-famine decks where the theme is the only win.
5. **Archetype is a stat spread:** most decks are midrange. Control uses removal offensively with heavy removal and draw plus a finisher. One combo in a deck does not make a combo deck (V7).
6. **Quantity or quality:** 30–36 redundant on-plan cards plus an outlet, or 15–20 strong pieces (V9).

**Without AI**, the app guesses the win routes from three kinds of evidence, strongest first:

- **Combos** Commander Spellbook finds in the deck whose result ends the game: win the game, each opponent loses, infinite damage, drain or mill.
- **Finisher cards** by Scryfall tag: alternate wins, extra turns, extra combats, overruns, drain.
- **Deck shape:** 18+ creatures with 3+ anthems or overruns means combat; 8+ equipment and auras means commander damage; 6+ mill cards means mill.

It names each route with its cards, or says plainly that there is no clear way to win.

**With AI**, "Draft with AI" on a deck's Tags tab starts from how the deck wins, lists each route with its cards, names what is missing (for example "needs one or two real storm payoffs") and writes the brief that guides tagging.

## Evaluating, tuning and cutting cards

Favour cards that fill two or more of mana, draw, interaction and game plan, and change about three cards at a time against one repeated failure (V5, V11, V18).

- **Overlap score:** swap single-role cards for multi-role ones, such as Rampant Growth for Growth Spiral (V5, V11).
- **Commander-dependence test:** is the card weak without the commander? Would the deck work with the commander shuffled into the 99? (V4, V15)
- **Win-more check:** cards that only matter when you are already winning cost you the "veggies" (V8).
- **Curve fit:** cut cards that miss the turn plan, and the slot the commander already fills; lower the curve when average MV is high (V1, V11).
- **Payoff cost:** prefer cheap, broadly useful payoffs; expensive amplifiers narrow the on-ramp (V16).
- **Castability:** a card you want on curve but cannot reliably cast in your colour split is a cut candidate (V10).
- **Counterweight cards:** niche hate earns a slot if it is modal, an MDFC or land, on-synergy, or the deck has tutors (V13).
- **Lands are not the cut:** never cut lands to keep pet cards (V12).
- **When a deck isn't working,** add draw and filtering first, then lands if short (V16).
- **Testing:** goldfish or play 10 games and log failures; ignore Sol Ring hands; judge consistent speed, not peak speed (V1, V6).
- **Theme decks:** build the functional list first, then swap the weakest cards for theme cards (V6).

### Cutting to 100

From a second playlist, [MTG Deck cuts](https://www.youtube.com/playlist?list=PLH0UXIPYmReU) (three videos, transcripts supplied by the user on 3 November 2026). The app's cut workbench follows this (`lib/cut-score.ts`).

- **The order (C3, Rebell Lily of Commander Template):** look first where the mana curve is overloaded - usually too many 3-6 drops, often pet cards. Then trim utility: interaction first (two to four single-target removal spells; keep a board wipe or two and flexible removal), then ramp if the commander is cheap or draw if it is expensive. Never cut lands to make room. Their baseline: 38 lands, 12 ramp, 12 draw, 8-12 interaction, leaving about 24 slots - three packages of eight - for the deck's own themes. Trimming two of each utility costs only about 6-7% on finding one by turn five.
- **Floor and ceiling (C1):** a card should be worth about a card. Ask how hard its best case is to reach and how bad its worst case is; slow cards that are often dead draws with little upside are the cuts. Judge in context: the same card is good in one deck and unplayable in another.
- **Keep cuts cost-neutral or cheaper (C1),** or the curve creeps up. If cuts are not one-for-one, check the ratios they leave.
- **Ratios follow the commander (C1):** a cheap commander with a low curve needs less mana; a late-game finisher commander does not need other costly finishers. A card doing the commander's job again is a weak slot.
- **Generic is fine away from the fun (C1):** staples like Night's Whisper keep a deck from running out of gas, but do not swap the synergy cards that are why you play the deck for generic ones.
- **Type A and Type B decks (C2):** Type A decks have a solid foundation, simple broad roles and one theme, so any reasonable card can fill a role and swaps are easy - cut on quality. Type B decks have dense, layered synergy (a combo plus a tribal storm count) or a narrow card pool (snow, slivers, curses), so their theme cards carry the deck and cutting them breaks it. Packages (cards fine alone, better together) are only a tiebreaker.
- **Pet cards (C3):** let the owner mark favourites that are never cut; that is why we play.
- **Method (C1, C3):** rebuilding a deck the other way round (additive vs subtractive) shows which cards get squeezed out; one-in-one-out does not solve not knowing which card is weakest; goldfishing at 100 cards is how to tell.

## Commander Template's Academy (read 2026-11-04)

Read in the owner's browser from commandertemplate.com/academy (How to Build Commander, Ramp, Card Draw, Removal, Engines, Multipliers, Operational Threshold). The app follows these ideas without naming the site on the page; the rules' explanations are in `lib/cut-rules.ts` and `components/DeckPlan.tsx`.

- **Base template:** 36 lands, 12 ramp, 10 card draw, 10 interaction, and about 32 theme cards in four packages of 8 ("8 by 8"). Eight cards in 99 give a 46% chance of one in the opening seven and 62% by turn 4 (11 cards seen, drawing every turn); 16 give 87%. 36 lands + 12 ramp = 48 sources, a 75% chance of three in the opening seven. → `lib/roles.ts` defaults, the Plan tab's theme packages, the `package-over`/`package-short` cut rules.
- **Operational threshold ("flip turn"):** the mana the deck needs before it stops setting up and starts executing - by default the commander's mana value, adjustable. Land, ramp and draw counts follow it; lower needs less ramp. → `flipTargets()` in `lib/deck-plan.ts` (ramp 12 at 4, one more per mana above; lands 36 at 4, one more per two mana), and Playtest's first goal.
- **Ramp:** acceleration and fixing. Two-mana rocks are the workhorses; three is the top end. Too much ramp with too few lands is "hot garbage". → `slowramp` rule (4+ mana ramp).
- **Card draw:** dig (Impulse), steady card advantage (Rhystic Study), refill (Windfall, 1-2 of these). Dig counts as draw → impulse draw counts again; the `impulse` rule (off by default) excludes it for decks that need that.
- **Removal:** stay proactive; single-target removal is poor value four-handed; prefer flexible and instant speed; 1-2 board wipes inside the 10. → wipes 1-2, `sorcery` rule.
- **Engines:** enablers (make the resource; cheap, self-sufficient, repeatable) at least 12; payoffs (turn it into a win) about 6, fewer than enablers; ~3 multipliers. → `enablers` and `payoffs` rules; payoffs no longer protected outright.
- **Multipliers:** about 3-4 per theme, reachable by turns 5-6; secondary to enablers.

## Power level, stax, salt and free spells

None of the videos define the brackets; the app's bracket floor comes from Wizards' rules and Commander Spellbook, and its stax and free-spell tags need the friend's curated lists.

- **Brackets:** Wizards' 1–5 scale. The app computes the lowest bracket a list can be from Game Changers (53 cards since the 9 February 2026 update), mass land denial, extra turns and two-card combos. The videos mention brackets only in passing (V2, V5, V11, V15).
- **Stax:** a piece that slows the whole table. Scryfall has no stax tag; the app approximates it from eight rule-setting tags, which caught 8 of 16 stax cards in the test. V7 treats stax as its own style; V16 notes that lockout and land destruction are "type-2 fun" some groups accept.
- **Combo locks:** Commander Spellbook's bracket estimate marks combos that lock a player or skip turns, a stax signal the app does not use yet.
- **Salt:** EDHREC publishes the top 100 saltiest cards (Stasis first, salt 3.05) and a salt score on each card's page; there is none on commander pages.
- **Free spells:** cards that cost no mana to cast. Scryfall has no single tag; `pitch-spell` (42 cards) and `potentially-free` (67) come closest. The friend's list is the better source.
- **Table manners:** real tables are "pretty chill with most things outside of hard stax or super fast combo"; removal and counterspells are not rude (V7). Feast-or-famine and linchpin commanders make bad games (V8, V15).

## Data sources

Scryfall and Commander Spellbook are the backbone: both are free, documented and allow app use. EDHREC is used knowingly against its terms on this private tool. Moxfield and Gatherer are link-only.

| Source | Useful data | How to get it | Terms | Use |
| --- | --- | --- | --- | --- |
| [Scryfall](https://scryfall.com/docs/api) | Card data; about 5,400 community tags (`otag:`) for what cards do; `game_changer`, `keywords`, `produced_mana`, `edhrec_rank` | Search API, batched `otag:X (card names)`; requests spaced, descriptive User-Agent | Free; asks for caching and a User-Agent | Use; cache roles per card for 30 days |
| [Commander Spellbook](https://commanderspellbook.com/) | Combos in a deck and one card away; combo results ("Win the game", "Infinite colored mana"); 156 card-level features ("Card that Tutors", "Boardwipe"); bracket estimate with lock and skip-turn flags | Public REST API | MIT-licensed backend, public API | Use; cache features weekly |
| [EDHREC](https://edhrec.com/) | Per-commander inclusion and synergy, 184 themes, curve, decks per bracket; top-100 salt list; "decks with this card" view | Commander JSON the app already reads; salt at `json.edhrec.com/pages/top/salt.json`; card filter is a link, `edhrec.com/commanders/<name>?f=in=<Card>` | Forbids automated access (section 3.1); used knowingly on this private app | Use once a day per commander; link the card filter |
| [Salubrious Snail](https://www.salubrioussnail.com/manabase-tool) | Cast rate and delay for an existing manabase; tapland impact | Browser tool only; no public API, no deep links | No licence, no terms | Link only; reimplement Karsten's maths |
| Moxfield lists ([stax](https://moxfield.com/decks/tLk6Un447kiBV0Tf8X0VBQ), [free spells](https://moxfield.com/decks/BEieV2xNVEigpXuHrOWKhg)) | Hand-curated stax and free-spell cards, better than any Scryfall tag | Manual export from each deck page (text or CSV) | API blocked to automated clients by Cloudflare and robots.txt | Import a manual export; refresh by hand |
| [Gatherer](https://gatherer.wizards.com/) | Official Oracle text and rulings | Website only, no API | Wizards' site | Link only; Scryfall already carries the rulings |
| [Archidekt](https://archidekt.com/) | Public decks with view counts, primers and the author's own card categories | Public API (`/api/decks/<id>/`); robots.txt allows it | Public data | Use for test decks and answer keys |

Tags that **do not exist** on Scryfall, so don't build on them: `stax`, `free-spell`, `token-generator`, `treasure-generator`, `finisher`, `wincon`, `alt-win`, `land-destruction`, `reanimation`, `card-draw`.

## Test: Scryfall-only tagging against four popular decks

Scryfall data alone agreed with the deck authors on 161 of 212 functionally categorized cards (76%), with no AI. It is strong on mana, cards and recursion, and weak on win conditions.

The answer key: four of Archidekt's most-viewed Commander decks with primers, where each author sorted every card into categories. Theme categories ("Beaters", "Potion Ingredients", "Counters") were left out. Recall is measured because most authors put each card in one category while Scryfall often gives several.

| Deck | Commander | Views | Style | Agreement |
| --- | --- | --- | --- | --- |
| [Praise the Sun, Fire the Gun](https://archidekt.com/decks/18520785) | Heliod, Sun-Crowned | 219,378 | Lifegain combo and stax | 47 / 71 (66%) |
| [Baby Lasagna](https://archidekt.com/decks/1585124) | Baba Lysaga, Night Witch | 283,420 | Sacrifice | 30 / 39 (77%) |
| [Knuck if you buck](https://archidekt.com/decks/25930423) | Knuckles the Echidna | 113,113 | Combat, extra combats | 37 / 51 (73%) |
| [The Unity](https://archidekt.com/decks/24364891) | The Master, Transcendent | 94,903 | Mill | 47 / 51 (92%) |

By category (the shared doc shows this as a chart):

| Category | Agreed | Rate |
| --- | --- | --- |
| Card draw | 22 / 22 | 100% |
| Mill | 14 / 14 | 100% |
| Extra combats | 6 / 6 | 100% |
| Sac outlets | 1 / 1 | 100% |
| Recursion | 12 / 13 | 92% |
| Ramp | 42 / 46 | 91% |
| Tutors | 8 / 9 | 89% |
| Disruption | 9 / 11 | 82% |
| Targeted removal | 24 / 32 | 75% |
| Protection | 13 / 26 | 50% |
| Stax | 8 / 16 | 50% |
| Win conditions and finishers | 2 / 15 | 13% |
| Drain | 0 / 1 | 0% |

What the misses show:

- **Win conditions:** the authors' finishers were mostly untagged cards. These were mass-steal spells (Insurrection, Mob Rule), sacrifice payoffs (Marionette Master, Zuran Orb) and Syr Konrad. The win guess read Baba Lysaga as commander damage because of ramp auras like Wild Growth; it is a sacrifice deck.
- **Protection depends on use:** Silence, Orim's Chant and Grand Abolisher protect the Heliod combo, but Scryfall tags them stax. Redirect spells have no protection tag.
- **Stax:** Aven Mindcensor and Authority of the Consuls have no tag at all; the curated list fixes this.
- **Counterspells:** the authors file them under removal; the app keeps them separate. This is a grouping choice, not an error.

The "cantrips are not draw" rule held: draw scored 100%. A deck's first tagging takes 33–47 seconds (27 role lookups); it is cached per card afterwards.

## Rules for the app's deck-analysis AI

The AI explains numbers the app computes; it never calculates them itself. These 15 rules come from the playlist, each with its source.

1. **Don't count cantrips as card draw.** Only cards that leave you with more cards count; track selection separately (V1, V10, V16).
2. **Tag every role a card fills** and report the overlap. Multi-role cards are high value; single-role generic cards are swap candidates (V5, V11).
3. **Treat counts as ranges tied to the commander and curve.** Flag deviations rather than calling them errors (V1, V5, V6, V11).
4. **Land count:** flag fewer than about 36 lands unless the deck has heavy cheap ramp or a cheap draw commander. Recommend more, up to 42, for an expensive drawing commander or a high curve (V1, V12).
5. **Colour sources:** flag a colour under about 20 sources if it has double-pip cards, or under about 15 at all. Demand Karsten's bar only for on-curve-critical cards: the commander, early ramp, pivotal drops (V12, V17).
6. **Check ramp against the commander's curve.** A cheap commander wants 1-MV dorks and untapped lands over 3–4 MV land ramp; ramp at the commander's own MV is redundant (V1, V3).
7. **Taplands:** flag them when the plan needs turn 1–3 plays; accept them in slow or colour-hungry decks (V1, V12, V17).
8. **Commander dependence:** estimate how many cards are weak without the commander, and check for draw, removal and win conditions that don't need it. High dependence needs more protection than Boots and Greaves (V4, V15).
9. **Classify the commander's style** (enabler, payoff, amplifier, counterweight, linchpin; see Ways to build) before judging dependence on it, and back up in the 99 any role only the commander provides (V3, V6, V15).
10. **State the plan as board state, timing and win route.** Flag decks with a theme but no way to win, and feast-or-famine decks where the theme is the only win (V6, V8, V16).
11. **Flag win-more cards and narrow, expensive payoffs.** Suggest lowering the curve when average MV is high (V8, V11, V16).
12. **When a deck isn't working, suggest more draw and filtering first,** then lands if short (V16).
13. **Removal quality:** prefer flexible removal. Count repeatable removal and pillow-fort statics as more than one piece. Warn against about 10 wipes or only one-for-one removal without heavy draw (V1, V7).
14. **Counterweight suggestions:** prefer modal cards, MDFCs and utility lands, or ones that fit an existing synergy (V13, V17).
15. **Tune incrementally:** about 3 targeted swaps that fix one observed failure, not a 20-card rebuild, unless the commander or plan itself is wrong (V18).

## Open items

- [ ] Export the two Moxfield lists (stax, free spells) by hand and import them as tags
- [ ] Detect finishers better: mass-steal spells, sacrifice and aristocrats payoffs, damage on death; ignore ramp and protection auras when guessing commander damage
- [ ] Widen protection with redirect and fog tags; show interaction as one group
- [ ] Use Commander Spellbook's card features and combo lock flags
- [ ] Add Karsten's land formula and per-colour source table to deck health; add the "open in Salubrious Snail" button
- [ ] Tag decks in the background on import (the first tagging takes 33–47 seconds)
- [ ] Re-score the four test decks after each change
- [ ] Label about 25 Azula Madness cards yourself, to score the AI's deck-specific layer
- [ ] Optional: ask Salubrious Snail for permission to use his tool's land data

The Scryfall-based tagging and the win guess are built on a local branch and tested on a local Test profile; they are not deployed yet.

## Sources

- Commander Template Academy, by Lily (founder): https://commandertemplate.com/academy - how-to-build-commander, ramp, card-draw, removal, engines, multipliers, operational-threshold.

The playlist: [EDH deck building](https://www.youtube.com/playlist?list=PLsvebAO5gV5nlWhcgjNf9UDPMad4DWQCa), 19 videos, transcribed on 31 October 2026.

| # | Video | Channel | Length |
| --- | --- | --- | --- |
| V1 | [The EDH Deck Building Template](https://www.youtube.com/watch?v=SLUV0TjK7LA) | The Trinket Mage | 12:34 |
| V2 | [How to Make 100% Synergy Commander Decks](https://www.youtube.com/watch?v=2RJ9WD3DzFA) | Deck Driver MTG | 16:41 |
| V3 | [The Strange Method for Building EDH Decks that I Can't Stop Using](https://www.youtube.com/watch?v=R8LqEt7k1-c) | Salubrious Snail | 13:18 |
| V4 | [Don't Build Around Your Commander](https://www.youtube.com/watch?v=FkrC5JymZOU) | The Trinket Mage | 7:02 |
| V5 | [How to Optimize Your Commander Decks and Maximize Synergy](https://www.youtube.com/watch?v=V1sbxOCfx8c) | Deck Driver MTG | 12:58 |
| V6 | [You don't know how to build Commander decks 2](https://www.youtube.com/watch?v=iYigplLiVts) | Aegis Gaming Official | 8:40 |
| V7 | [How to Build Control Decks in EDH](https://www.youtube.com/watch?v=f9NOcSIvOfc) | The Trinket Mage | 31:30 |
| V8 | [Why Your Deck Can't Do Its Thing](https://www.youtube.com/watch?v=Yh3pbMzPNWU) | The Trinket Mage | 12:48 |
| V9 | [This Deck Building Philosophy Makes Your Decks Unstoppable](https://www.youtube.com/watch?v=k_cTa3WKHhk) | Deck Driver MTG | 11:53 |
| V10 | [My Brother and I Built a Tool to Yell at You About Your Manabase](https://www.youtube.com/watch?v=YcSHb11AqL4) | Salubrious Snail | 27:13 |
| V11 | [5 Tips to Make Your Commander Deck Shine!](https://www.youtube.com/watch?v=AzY1FPvMdbw) | Deck Driver MTG | 9:58 |
| V12 | [Your Manabase Deserves Better](https://www.youtube.com/watch?v=DTAhqhi8LU0) | Salubrious Snail | 14:14 |
| V13 | [Play These Cards To Eliminate Your Deck's Weakness](https://www.youtube.com/watch?v=0vXFZFy-i4Q) | The Trinket Mage | 10:19 |
| V14 | [Why You Should Play More Indirect Synergies](https://www.youtube.com/watch?v=jw4URiKSUTo) | Unpopular MTG | 21:29 |
| V15 | [Commander's Biggest Trap](https://www.youtube.com/watch?v=vJmRe2gxb0c) | The Trinket Mage | 19:02 |
| V16 | [The Four Ways an EDH Deck Can Fail](https://www.youtube.com/watch?v=tsrgFKgkqkQ) | Salubrious Snail | 10:49 |
| V17 | [All Underplayed Utility Lands in Commander](https://www.youtube.com/watch?v=xy16QHJU-ls) | 3/3 Elk | 26:08 |
| V18 | [Change 3 Cards, Not 20](https://www.youtube.com/watch?v=7tvEAtqkDR0) | Arcane Broadcast | 0:52 |
| V19 | [Everyone Should Play Mono Blue Control](https://www.youtube.com/watch?v=VqTJWlEfBxo) | The Trinket Mage | 12:04 |
| V20 | [7 Unique Ways to Build Your Next Commander Deck](https://www.youtube.com/watch?v=oUzQmPljhyk) | Deck Driver MTG | added 4 November 2026, read in full |

The cutting playlist: [MTG Deck cuts](https://www.youtube.com/playlist?list=PLH0UXIPYmReU).

| # | Video | Channel | Length |
| --- | --- | --- | --- |
| C1 | [How to MERCILESSLY cut cards from your Commander deck!](https://www.youtube.com/watch?v=n2mgeEoifWA) | 3/3 Elk | 8:35 |
| C2 | [The Two Types of Commander Deck](https://www.youtube.com/watch?v=LfmO02zFvfI) | Salubrious Snail | 16:12 |
| C3 | [Forbidden Trick To Cutting Cards in Your Commander Deck](https://www.youtube.com/watch?v=IBdPiZOu9LI) | Rebell Lily (Commander Template) | 11:44 |

Other sources:

- Frank Karsten, [How Many Sources Do You Need to Consistently Cast Your Spells? A 2022 Update](https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/)
- Frank Karsten, [How Many Lands Do You Need in Your Deck? An Updated Analysis](https://web.archive.org/web/20230315090726/https://strategy.channelfireball.com/all-strategy/home/how-many-lands-do-you-need-in-your-deck-an-updated-analysis/) (archived)
- Frank Karsten, [What's an Optimal Mana Curve and Land/Ramp Count for Commander?](https://web.archive.org/web/20230315090726/https://strategy.channelfireball.com/all-strategy/home/whats-an-optimal-mana-curve-and-land-ramp-count-for-commander/) (archived)
- [Salubrious Snail manabase tool](https://www.salubrioussnail.com/manabase-tool)
- [Scryfall tagger tags](https://scryfall.com/docs/tagger-tags) and [Scryfall API](https://scryfall.com/docs/api)
- [Commander Spellbook](https://commanderspellbook.com/), [EDHREC](https://edhrec.com/), [Gatherer](https://gatherer.wizards.com/), [Archidekt](https://archidekt.com/)
