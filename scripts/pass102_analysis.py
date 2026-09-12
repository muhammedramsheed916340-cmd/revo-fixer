#!/usr/bin/env python3
"""Pass 102 (Task ID 147) read-only analysis of rounds 143-148 + census updates."""
import json

rows = json.load(open('/home/z/my-project/scripts/data/pass102_history.json'))
n = len(rows)
print(f"total rows: {n}")

# Row-level detail for new rounds 143-148 (index 142..147)
BONUS = {'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP'}
def outcome(r): return r['actualResult']['name']
def hit(r): return r['hit']
def top(r): return r['prediction'][0]['game']['name'] if r.get('prediction') else '?'

print("\n--- rounds 143-148 detail ---")
for i in range(142, n):
    r = rows[i]
    o = outcome(r)
    tag = 'BONUS' if o in BONUS else 'norm'
    preds = [p['game']['name'] for p in (r.get('prediction') or [])]
    print(f"#{i+1}: outcome={o} ({tag}) hit={hit(r)} top={top(r)} preds={preds} conf={r.get('confidence')} recal={r.get('recalibrated')}")

# Feed liveness: inter-round gaps over the whole history and the new window
times = [r['time'] for r in rows]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
new_gaps = [(times[i+1]-times[i])/1000 for i in range(142, len(times)-1)]
print(f"\n--- feed --- all-era max gap {max(gaps):.0f}s, avg {sum(gaps)/len(gaps):.1f}s | new window gaps: {[f'{g:.0f}' for g in new_gaps]}")

# Census
def census(rng=None):
    sel = rows if rng is None else rows[rng[0]:rng[1]]
    h = sum(1 for r in sel if hit(r))
    return h, len(sel)

h_all, n_all = census()
normals = [r for r in rows if outcome(r) not in BONUS]
bonuses = [r for r in rows if outcome(r) in BONUS]
hn = sum(1 for r in normals if hit(r)); hb = sum(1 for r in bonuses if hit(r))
print(f"\n--- census n={n_all}: baseline {h_all}/{n_all} = {h_all/n_all:.1%} | normals {hn}/{len(normals)} = {hn/len(normals):.1%} | bonus {hb}/{len(bonuses)} = {hb/len(bonuses):.1%}")

# New block 143-148
hb2, nb2 = census((142, n))
print(f"block 143-148: {hb2}/{nb2} = {hb2/nb2:.1%}")

# Outcome-specific censuses
for name in ['1', '2', '5', '10', 'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP']:
    sel = [r for r in rows if outcome(r) == name]
    if sel:
        hs = sum(1 for r in sel if hit(r))
        idxs = [i+1 for i, r in enumerate(rows) if outcome(r) == name]
        recent = ' '.join('H' if hit(r) else 'M' for r in sel[-12:])
        print(f"{name:12s}: {hs}/{len(sel)} = {hs/len(sel):.1%}  last12: {recent}  last_idx={idxs[-1]}")

# '1' misses timeline (episode #4 watch)
ones_m = [i+1 for i, r in enumerate(rows) if outcome(r) == '1' and not hit(r)]
print(f"\n'1'-miss indices: {ones_m}")
fives = [(i+1, 'H' if hit(r) else 'M') for i, r in enumerate(rows) if outcome(r) == '5']
print(f"'5' timeline (all): {fives}")

# Current miss/hit run tail
tail = ''.join('H' if hit(r) else 'M' for r in rows[-20:])
print(f"tail-20: {tail}")
