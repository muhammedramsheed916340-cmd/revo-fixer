#!/usr/bin/env python3
"""Pass 116 (Task ID 161) read-only analysis of rounds 338-355."""
import json, datetime

rows = json.load(open('/home/z/my-project/scripts/data/pass116_history.json'))
n = len(rows)
PREV_N = 337
print(f"total rows: {n}")

BONUS = {'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP'}
def outcome(r): return r['actualResult']['name']
def hit(r): return r['hit']
def top(r): return r['prediction'][0]['game']['name'] if r.get('prediction') else '?'
fmt = lambda ms: datetime.datetime.fromtimestamp(ms/1000, datetime.timezone(datetime.timedelta(hours=8))).strftime('%H:%M:%S')

print("\n--- new rounds detail (338-355) ---")
for i in range(PREV_N, n):
    r = rows[i]
    o = outcome(r)
    tag = 'B' if o in BONUS else 'n'
    exact = ' EXACT' if top(r) == o else ''
    print(f"#{i+1}: {o:11s}({tag}) hit={'H' if hit(r) else 'M'} top={top(r):11s}{exact} conf={r.get('confidence')} recal={r.get('recalibrated')}")

times = [r['time'] for r in rows]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
new_gaps = [(i+2, f'{g:.0f}s') for i,g in enumerate(gaps) if g > 100 and i+1 >= PREV_N]
win_g = [(times[i+1]-times[i])/1000 for i in range(PREV_N, len(times)-1)]
print(f"\n--- feed --- all-era max {max(gaps):.0f}s | new-window avg {sum(win_g)/len(win_g):.1f}s max {max(win_g):.0f}s | gaps>100s new: {new_gaps}")
print(f"#{n} at {fmt(times[n-1])}")

h_all = sum(1 for r in rows if hit(r))
normals = [r for r in rows if outcome(r) not in BONUS]
bonuses = [r for r in rows if outcome(r) in BONUS]
hn = sum(1 for r in normals if hit(r)); hb = sum(1 for r in bonuses if hit(r))
theo = sum(1 for r in rows if outcome(r) in {'1','2','5','10'})
print(f"\n--- census n={n}: baseline {h_all}/{n} = {h_all/n:.1%} | normals {hn}/{len(normals)} = {hn/len(normals):.1%} | bonus {hb}/{len(bonuses)} = {hb/len(bonuses):.1%} | theo freq {theo}/{n} = {theo/n:.1%}")
sel = rows[PREV_N:]
hs = sum(1 for r in sel if hit(r))
print(f"block 338-{n}: {hs}/{len(sel)} = {hs/len(sel):.1%}")
w2 = rows[202:]
h2 = sum(1 for r in w2 if r['hit'])
print(f"second-200 window (203-{n}): {h2}/{len(w2)} = {h2/len(w2):.1%} vs first-200 63.0%")

print("\n--- segments ---")
for name in ['1','2','5','10','CASH HUNT','PACHINKO','CRAZY TIME','COIN FLIP']:
    s2 = [r for r in rows if outcome(r) == name]
    if s2:
        h2n = sum(1 for r in s2 if hit(r))
        last_idx = max(i+1 for i,r in enumerate(rows) if outcome(r)==name)
        recent = ' '.join('H' if hit(r) else 'M' for r in s2[-10:])
        print(f"{name:12s}: {h2n}/{len(s2)} = {h2n/len(s2):.1%}  last10: {recent}  last_idx={last_idx}")

one_seq = ['H' if hit(r) else 'M' for r in rows if outcome(r)=='1']
run = 0
for hres in reversed(one_seq):
    if hres == 'H': run += 1
    else: break
print(f"\n'1' trailing hit-run: {run} (era max 18)")
two_seq = ['H' if hit(r) else 'M' for r in rows if outcome(r)=='2']
run2 = 0
for hres in reversed(two_seq):
    if hres == 'H': run2 += 1
    else: break
print(f"'2' trailing hit-run: {run2}")
ones_m = [i+1 for i,r in enumerate(rows) if outcome(r)=='1' and not hit(r)]
print(f"'1'-miss indices ({len(ones_m)}): {ones_m}")
for nm in ['COIN FLIP','PACHINKO','CRAZY TIME','5']:
    lst = max((i+1 for i,r in enumerate(rows) if outcome(r)==nm), default=0)
    print(f"drought {nm}: {n-lst} (last #{lst})")
print(f"tail-30: {''.join('H' if hit(r) else 'M' for r in rows[-30:])}")
rec = [i+1 for i,r in enumerate(rows) if r.get('recalibrated')]
print(f"recal: {len(rec)}/{n} = {len(rec)/n:.1%}, recent: {rec[-10:]}")
