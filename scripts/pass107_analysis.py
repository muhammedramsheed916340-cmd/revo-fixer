#!/usr/bin/env python3
"""Pass 107 (Task ID 152) read-only analysis of rounds 203-223."""
import json, datetime

rows = json.load(open('/home/z/my-project/scripts/data/pass107_history.json'))
n = len(rows)
PREV_N = 202
print(f"total rows: {n}")

BONUS = {'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP'}
def outcome(r): return r['actualResult']['name']
def hit(r): return r['hit']
def top(r): return r['prediction'][0]['game']['name'] if r.get('prediction') else '?'

print("\n--- new rounds detail (203-223) ---")
for i in range(PREV_N, n):
    r = rows[i]
    o = outcome(r)
    tag = 'B' if o in BONUS else 'n'
    print(f"#{i+1}: {o:11s}({tag}) hit={'H' if hit(r) else 'M'} top={top(r):11s} conf={r.get('confidence')} recal={r.get('recalibrated')}")

times = [r['time'] for r in rows]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
new_gaps = [(times[i+1]-times[i])/1000 for i in range(PREV_N, len(times)-1)]
big = [(i+1, f'{g:.0f}s') for i,g in enumerate(gaps) if g > 100]
fmt = lambda ms: datetime.datetime.fromtimestamp(ms/1000, datetime.timezone(datetime.timedelta(hours=8))).strftime('%H:%M:%S')
print(f"\n--- feed --- all-era max {max(gaps):.0f}s | new-window avg {sum(new_gaps)/len(new_gaps):.1f}s max {max(new_gaps):.0f}s | gaps>100s: {big}")
print(f"#203 at {fmt(times[202])}, #{n} at {fmt(times[n-1])}")

h_all = sum(1 for r in rows if hit(r))
normals = [r for r in rows if outcome(r) not in BONUS]
bonuses = [r for r in rows if outcome(r) in BONUS]
hn = sum(1 for r in normals if hit(r)); hb = sum(1 for r in bonuses if hit(r))
theo = sum(1 for r in rows if outcome(r) in {'1','2','5','10'})
print(f"\n--- census n={n}: baseline {h_all}/{n} = {h_all/n:.1%} | normals {hn}/{len(normals)} = {hn/len(normals):.1%} | bonus {hb}/{len(bonuses)} = {hb/len(bonuses):.1%} | theo freq {theo}/{n} = {theo/n:.1%}")
sel = rows[PREV_N:]
hs = sum(1 for r in sel if hit(r))
print(f"block 203-{n}: {hs}/{len(sel)} = {hs/len(sel):.1%}")

for name in ['1','2','5','10','CASH HUNT','PACHINKO','CRAZY TIME','COIN FLIP']:
    s2 = [r for r in rows if outcome(r) == name]
    if s2:
        h2 = sum(1 for r in s2 if hit(r))
        last_idx = max(i+1 for i,r in enumerate(rows) if outcome(r)==name)
        print(f"{name:12s}: {h2}/{len(s2)} = {h2/len(s2):.1%}  last_idx={last_idx}")

ones_m = [i+1 for i,r in enumerate(rows) if outcome(r)=='1' and not hit(r)]
print(f"\n'1'-miss indices: {ones_m}")
pach = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='PACHINKO']
print(f"PACHINKO: {pach}")
coin = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='COIN FLIP']
print(f"COIN FLIP: {coin}")
print(f"tail-25: {''.join('H' if hit(r) else 'M' for r in rows[-25:])}")
rec = [i+1 for i,r in enumerate(rows) if r.get('recalibrated')]
print(f"recal: {len(rec)}/{n} = {len(rec)/n:.1%}, recent: {rec[-10:]}")
