import json, collections
import sys
truth = json.load(open('truth.json')); ours = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'ours.json'))
RAMP = {'ramp','rock','dork','land-ramp','ritual'}; DRAW = {'draw','engine','cantrip','wheel'}
REMOVAL = {'removal','wipe'}; WIN = {'wincon','extra-turn','extra-combat','overrun','drain','mill'}
MAP = {
  'Ramp': RAMP, 'Mana Boost': RAMP, 'Critter Ramp': RAMP,
  'Draw': DRAW, 'Removal': REMOVAL, 'Disruption': REMOVAL | {'counter','stax','gy-hate'},
  'Stax': {'stax'}, 'Protection': {'protection'}, 'Tutor': {'tutor'}, 'Recursion': {'recursion'},
  'Extra Combat': {'extra-combat'}, 'Mill': {'mill'}, 'Sac Outlet': {'sac-outlet'}, 'Drain': {'drain'},
  'The Gun': 'WIN', 'Endgame Plans': 'WIN', 'End Em': 'WIN', 'Finisher': 'WIN',
}
total = collections.Counter(); hit = collections.Counter(); report = []
for name, t in truth.items():
    o = ours[name]
    roles_of = collections.defaultdict(set)
    for r in o['roles'] or []:
        for c in r['cards']: roles_of[c].add(r['id'])
    route_cards = {c for r in (o['wincons'] or {}).get('routes', []) for c in r['cards']}
    report.append(f"\n## {name}  (win guess: {', '.join(r['label'] + ' [' + r['strength'] + ']' for r in (o['wincons'] or {}).get('routes', [])) or 'none'})")
    deck_hit = deck_tot = 0
    for cat, want in MAP.items():
        cards = [c for c, cs in t['categories'].items() if cat in cs]
        if not cards: continue
        got, miss = [], []
        for c in cards:
            mine = roles_of.get(c, set())
            ok = (c in route_cards or bool(mine & WIN)) if want == 'WIN' else bool(mine & want)
            (got if ok else miss).append(c)
            if ok and want == 'WIN': pass
        key = 'Win/finisher' if want == 'WIN' else ('Ramp' if want is RAMP else 'Draw' if want is DRAW else cat)
        total[key] += len(cards); hit[key] += len(got); deck_tot += len(cards); deck_hit += len(got)
        missed = '; '.join(f"{c} [{', '.join(sorted(roles_of.get(c, set()))) or 'no roles'}]" for c in miss)
        report.append(f"- {cat}: {len(got)}/{len(cards)}" + (f"  — missed: {missed}" if miss else ''))
    report.append(f"  deck agreement: {deck_hit}/{deck_tot} = {deck_hit/deck_tot:.0%}")
print('# Recall by category, all four decks')
for k in sorted(total, key=lambda k: -total[k]): print(f"{k:16} {hit[k]:3}/{total[k]:<3} {hit[k]/total[k]:.0%}")
print(f"{'OVERALL':16} {sum(hit.values()):3}/{sum(total.values()):<3} {sum(hit.values())/sum(total.values()):.0%}")
print('\n'.join(report))
