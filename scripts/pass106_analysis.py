#!/usr/bin/env python3
"""Pass 106 (Task ID 151) read-only analysis of rounds 190-202 + 200-round milestone comparison."""
import json

rows = json.load(open('/home/z/my-project/scripts/data/pass106_history.json'))
n = len(rows)
PREV_N = 189
print(f"total rows: {n} — 200-ROUND MILESTONE CROSSED")

BONUS = {'CASH HUNT', 'PACHINKO', 'CRAZY TIME', 'COIN FLIP'}
def outcome(r): return r['actualResult']['name']
def hit(r): return r['hit']
def top(r): return r['prediction'][0]['game']['name'] if r.get('prediction') else '?'

print("\n--- new rounds detail (190-202) ---")
for i in range(PREV_N, n):
    r = rows[i]
    o = outcome(r)
    tag = 'B' if o in BONUS else 'n'
    print(f"#{i+1}: {o:11s}({tag}) hit={'H' if hit(r) else 'M'} top={top(r):11s} conf={r.get('confidence')} recal={r.get('recalibrated')}")

# Census all + first-200 window (milestone like-for-like)
def stats(sel, label):
    h = sum(1 for r in sel if hit(r))
    nm = [r for r in sel if outcome(r) not in BONUS]
    bn = [r for r in sel if outcome(r) in BONUS]
    hn = sum(1 for r in nm if hit(r)); hb = sum(1 for r in bn if hit(r))
    theo_vals = {'1','2','5','10'}
    theo = [r for r in sel if outcome(r) in theo_vals]
    ht = sum(1 for r in theo if hit(r))
    print(f"{label}: n={len(sel)} baseline {h}/{len(sel)} = {h/len(sel):.1%} | normals {hn}/{len(nm)} = {hn/len(nm):.1%} | bonus {hb}/{len(bn)} = {hb/len(bn):.1%} | theo[1,2,5,10] {ht}/{len(theo)} = {ht/len(theo):.1%}")
    return h, len(sel)

h_all, n_all = stats(rows, f"ALL n={n_all if False else n}      ")
h200, _ = stats(rows[:200], "FIRST-200       ")
post = rows[PREV_N:]
hp = sum(1 for r in post if hit(r))
print(f"block 190-202: {hp}/{len(post)} = {hp/len(post):.1%}")

# Longest hit/miss runs in first 200
def runs(sel):
    best_h = cur_h = best_m = cur_m = 0
    for r in sel:
        if hit(r):
            cur_h += 1; cur_m = 0
        else:
            cur_m += 1; cur_h = 0
        best_h = max(best_h, cur_h); best_m = max(best_m, cur_m)
    return best_h, best_m
bh, bm = runs(rows[:200])
print(f"first-200 longest runs: HIT {bh}, MISS {bm}")

for name in ['1','2','5','10','CASH HUNT','PACHINKO','CRAZY TIME','COIN FLIP']:
    s2 = [r for r in rows if outcome(r) == name]
    if s2:
        hs = sum(1 for r in s2 if hit(r))
        last_idx = max(i+1 for i,r in enumerate(rows) if outcome(r)==name)
        print(f"{name:12s}: {hs}/{len(s2)} = {hs/len(s2):.1%}  last_idx={last_idx}")

ones_m = [i+1 for i,r in enumerate(rows) if outcome(r)=='1' and not hit(r)]
print(f"\n'1'-miss indices: {ones_m}")
fives = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='5'][-6:]
print(f"'5' recent: {fives}")
pach = [(i+1,'H' if hit(r) else 'M') for i,r in enumerate(rows) if outcome(r)=='PACHINKO']
print(f"PACHINKO: {pach}")
print(f"tail-15: {''.join('H' if hit(r) else 'M' for r in rows[-15:])}")
rec = [i+1 for i,r in enumerate(rows) if r.get('recalibrated')]
print(f"recal: {len(rec)}/{n} = {len(rec)/n:.1%}, recent: {rec[-8:]}")
