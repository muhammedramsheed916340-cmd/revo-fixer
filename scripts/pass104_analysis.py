#!/usr/bin/env python3
"""Pass 104 (Task ID 149) read-only analysis of rounds 162-186 + census updates."""
import json

rows = json.load(open('/home/z/my-project/scripts/data/pass104_history.json'))
n = len(rows)
PREV_N = 161
print(f"total rows: {n}")

BONUS = {'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP'}
def outcome(r): return r['actualResult']['name']
def hit(r): return r['hit']
def top(r): return r['prediction'][0]['game']['name'] if r.get('prediction') else '?'

print("\n--- new rounds detail (162-186) ---")
for i in range(PREV_N, n):
    r = rows[i]
    o = outcome(r)
    tag = 'B' if o in BONUS else 'n'
    print(f"#{i+1}: {o:11s}({tag}) hit={'H' if hit(r) else 'M'} top={top(r):11s} conf={r.get('confidence')} recal={r.get('recalibrated')}")

# Feed liveness
times = [r['time'] for r in rows]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
new_gaps = [(times[i+1]-times[i])/1000 for i in range(PREV_N, len(times)-1)]
import datetime
fmt = lambda ms: datetime.datetime.fromtimestamp(ms/1000, datetime.timezone(datetime.timedelta(hours=8))).strftime('%H:%M:%S')
big = [(i+1, f'{g:.0f}s') for i,g in enumerate(gaps) if g > 100]
print(f"\n--- feed --- all-era max {max(gaps):.0f}s avg {sum(gaps)/len(gaps):.1f}s | new-window avg {sum(new_gaps)/len(new_gaps):.1f}s max {max(new_gaps):.0f}s")
print(f"gaps >100s all-era: {big}")
print(f"first new round #162 at {fmt(times[161])}, last #{n} at {fmt(times[n-1])}")

# Census
h_all = sum(1 for r in rows if hit(r))
normals = [r for r in rows if outcome(r) not in BONUS]
bonuses = [r for r in rows if outcome(r) in BONUS]
hn = sum(1 for r in normals if hit(r)); hb = sum(1 for r in bonuses if hit(r))
print(f"\n--- census n={n}: baseline {h_all}/{n} = {h_all/n:.1%} | normals {hn}/{len(normals)} = {hn/len(normals):.1%} | bonus {hb}/{len(bonuses)} = {hb/len(bonuses):.1%}")
sel = rows[PREV_N:]
hb2 = sum(1 for r in sel if hit(r))
print(f"block 162-{n}: {hb2}/{len(sel)} = {hb2/len(sel):.1%}")

for name in ['1','2','5','10','CASH HUNT','PACHINKO','CRAZY TIME','COIN FLIP']:
    s2 = [r for r in rows if outcome(r) == name]
    if s2:
        hs = sum(1 for r in s2 if hit(r))
        recent = ' '.join('H' if hit(r) else 'M' for r in s2[-12:])
        last_idx = max(i+1 for i,r in enumerate(rows) if outcome(r)==name)
        print(f"{name:12s}: {hs}/{len(s2)} = {hs/len(s2):.1%}  last12: {recent}  last_idx={last_idx}")

ones_m = [i+1 for i,r in enumerate(rows) if outcome(r)=='1' and not hit(r)]
print(f"\n'1'-miss indices: {ones_m}")
pach = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='PACHINKO']
five_m = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='5']
print(f"PACHINKO: {pach}")
print(f"'5' timeline: {five_m}")
print(f"tail-30: {''.join('H' if hit(r) else 'M' for r in rows[-30:])}")
tops10 = sum(1 for r in rows[152:] if top(r)=='10')
print(f"top='10' since #153: {tops10}/{len(rows)-152}")
rec = [i+1 for i,r in enumerate(rows) if r.get('recalibrated')]
print(f"recal: {len(rec)}/{n} = {len(rec)/n:.1%}, recent: {rec[-8:]}")
