#!/usr/bin/env python3
"""Pass 103 (Task ID 148) read-only analysis of rounds 149-161 + census updates."""
import json

rows = json.load(open('/home/z/my-project/scripts/data/pass103_history.json'))
n = len(rows)
PREV_N = 148  # canonical n at pass 102
print(f"total rows: {n} (state probe showed {n-1}; one arrived mid-probe)")

BONUS = {'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP'}
def outcome(r): return r['actualResult']['name']
def hit(r): return r['hit']
def top(r): return r['prediction'][0]['game']['name'] if r.get('prediction') else '?'

print("\n--- new rounds detail ---")
for i in range(PREV_N, n):
    r = rows[i]
    o = outcome(r)
    tag = 'BONUS' if o in BONUS else 'norm'
    preds = [p['game']['name'] for p in (r.get('prediction') or [])]
    print(f"#{i+1}: outcome={o} ({tag}) hit={hit(r)} top={top(r)} conf={r.get('confidence')} recal={r.get('recalibrated')} preds={preds}")

# Feed liveness
times = [r['time'] for r in rows]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
new_gaps = [(times[i+1]-times[i])/1000 for i in range(PREV_N, len(times)-1)]
print(f"\n--- feed --- all-era max {max(gaps):.0f}s avg {sum(gaps)/len(gaps):.1f}s | new gaps: {[f'{g:.0f}' for g in new_gaps]}")

# Census
def census(rng):
    sel = rows[rng[0]:rng[1]]
    return sum(1 for r in sel if hit(r)), len(sel)
h_all = sum(1 for r in rows if hit(r))
normals = [r for r in rows if outcome(r) not in BONUS]
bonuses = [r for r in rows if outcome(r) in BONUS]
hn = sum(1 for r in normals if hit(r)); hb = sum(1 for r in bonuses if hit(r))
print(f"\n--- census n={n}: baseline {h_all}/{n} = {h_all/n:.1%} | normals {hn}/{len(normals)} = {hn/len(normals):.1%} | bonus {hb}/{len(bonuses)} = {hb/len(bonuses):.1%}")
hb2, nb2 = census((PREV_N, n))
print(f"block 149-{n}: {hb2}/{nb2} = {hb2/nb2:.1%}")

for name in ['1','2','5','10','CASH HUNT','PACHINKO','CRAZY TIME','COIN FLIP']:
    sel = [r for r in rows if outcome(r) == name]
    if sel:
        hs = sum(1 for r in sel if hit(r))
        recent = ' '.join('H' if hit(r) else 'M' for r in sel[-12:])
        last_idx = max(i+1 for i,r in enumerate(rows) if outcome(r)==name)
        print(f"{name:12s}: {hs}/{len(sel)} = {hs/len(sel):.1%}  last12: {recent}  last_idx={last_idx}")

ones_m = [i+1 for i,r in enumerate(rows) if outcome(r)=='1' and not hit(r)]
print(f"\n'1'-miss indices: {ones_m}")
five_m = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='5']
pach = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='PACHINKO']
print(f"'5' timeline: {five_m}")
print(f"PACHINKO timeline: {pach}")
print(f"tail-25: {''.join('H' if hit(r) else 'M' for r in rows[-25:])}")
rec = [i+1 for i,r in enumerate(rows) if r.get('recalibrated')]
print(f"recal total: {len(rec)}/{n} = {len(rec)/n:.1%}, recent: {rec[-8:]}")
