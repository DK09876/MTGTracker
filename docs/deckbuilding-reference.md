# MTG Tracker Deck-Building Reference

31 October 2026. Copied from the shared doc at https://claude.ai/artifact/Qy5JxVAnr4gojbFhvTxEm6; update both together.

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
4. **Building around the commander:** V2 builds every clause around it. V4, V8 and V15 warn against "linchpin" commanders. V3 and V15 suggest "counterweight" commanders that cover the deck's weakness.
5. **Synergy:** V2 and V5 maximise it; V13 and V14 favour cohesion and indirect synergy.

For the app: show the counts as ranges with their sources, never as pass or fail, and let the deck's plan move them.

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
9. **Classify the commander's role** (enabler, payoff, amplifier, counterweight, linchpin) and back up in the 99 any role only the commander provides (V3, V15).
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

Other sources:

- Frank Karsten, [How Many Sources Do You Need to Consistently Cast Your Spells? A 2022 Update](https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/)
- Frank Karsten, [How Many Lands Do You Need in Your Deck? An Updated Analysis](https://web.archive.org/web/20230315090726/https://strategy.channelfireball.com/all-strategy/home/how-many-lands-do-you-need-in-your-deck-an-updated-analysis/) (archived)
- Frank Karsten, [What's an Optimal Mana Curve and Land/Ramp Count for Commander?](https://web.archive.org/web/20230315090726/https://strategy.channelfireball.com/all-strategy/home/whats-an-optimal-mana-curve-and-land-ramp-count-for-commander/) (archived)
- [Salubrious Snail manabase tool](https://www.salubrioussnail.com/manabase-tool)
- [Scryfall tagger tags](https://scryfall.com/docs/tagger-tags) and [Scryfall API](https://scryfall.com/docs/api)
- [Commander Spellbook](https://commanderspellbook.com/), [EDHREC](https://edhrec.com/), [Gatherer](https://gatherer.wizards.com/), [Archidekt](https://archidekt.com/)
