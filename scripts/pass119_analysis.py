#!/usr/bin/env python3
"""Pass 119 (Task ID 164) — read-only census analysis of revo_roundHistory (n=411).
Standard structure: new rounds / feed gaps / census / second-200 / segments /
trailing runs / miss indices / droughts / tail-30 / recal. No writes to app state."""
import json, datetime
from collections import Counter

d = json.load(open('/home/z/my-project/scripts/data/pass119_history.json'))
h = json.loads(d['data']['result'])
N = len(h)
print(f"TOTAL n={N}")

def gid(i):
    # 1-based global round index used across the era
    return i + 1

def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')

def picks(r):
    return [( (p.get('game') or {}).get('name','?'), p.get('confidence') ) for p in (r.get('prediction') or [])]

def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

# ---------- 1. NEW ROUNDS DETAIL (#390-#411) ----------
print("\n== NEW ROUNDS #390-#%d ==" % gid(N-1))
for i in range(389, N):
    r = h[i]
    ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
    rec = 'RECAL' if r.get('recalibrated') else ''
    print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")

# ---------- 2. FEED GAPS (>100s minors) ----------
print("\n== FEED GAPS (rounds #380+, >100s) ==")
gaps = []
for i in range(1, N):
    g = (h[i]['time'] - h[i-1]['time'])/1000
    gaps.append((g, gid(i-1), gid(i)))
recent = [(g,a,b) for g,a,b in gaps if b >= 380 and g > 100]
for g,a,b in sorted(recent, reverse=True)[:8]:
    print(f"  gap {g:.0f}s  #{a} -> #{b}")
tail = [(g,a,b) for g,a,b in gaps if b >= 390]
if tail:
    avg = sum(g for g,_,_ in tail)/len(tail); mx = max(tail)
    print(f"  window #389-#{gid(N-1)}: avg {avg:.1f}s, max {mx[0]:.0f}s (#{mx[1]}->#{mx[2]})")

# ---------- 3. CENSUS ----------
hits = sum(1 for r in h if r['hit'])
base = hits/N*100
norm = [(i,r) for i,r in enumerate(h) if r['actualResult']['name'] in ('1','2','5','10')]
nh = sum(1 for i,r in norm if r['hit'])
bonus = [(i,r) for i,r in enumerate(h) if r['actualResult']['name'] not in ('1','2','5','10')]
bh = sum(1 for i,r in bonus if r['hit'])
recal = sum(1 for r in h if r.get('recalibrated'))
print(f"\n== CENSUS n={N} ==")
print(f"baseline {hits}/{N} = {base:.1f}% | normals {nh}/{len(norm)} = {nh/len(norm)*100:.1f}% | bonus {bh}/{len(bonus)} = {bh/len(bonus)*100:.1f}% | theo-freq {len(norm)}/{N} = {len(norm)/N*100:.1f}% | recal {recal}/{N} = {recal/N*100:.1f}%")

# second-200 window (203..N)
w2 = h[202:]
w2h = sum(1 for r in w2 if r['hit'])
w1 = h[:200]; w1h = sum(1 for r in w1 if r['hit'])
print(f"second-200 (203-{N}): {w2h}/{len(w2)} = {w2h/len(w2)*100:.1f}% vs first-200 {w1h/200*100:.1f}% -> diff {w2h/len(w2)*100-w1h/200*100:+.1f}pp")

# last-30 block
t30 = h[-30:]; t30h = sum(1 for r in t30 if r['hit'])
print(f"tail-30 block: {t30h}/30 = {t30h/30*100:.1f}%")

# ---------- 4. SEGMENT CENSUS + TRAILING RUNS ----------
print("\n== SEGMENTS ==")
seg = {}
for i, r in enumerate(h):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None,'hits':[]})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']:
        s['h'] += 1; s['last_hit'] = gid(i); s['hits'].append(gid(i))
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    q = s['last_any'] and (N - s['last_any'])
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {q:>3}  (last hit #{s['last_hit']})")

# trailing consecutive-hit run per segment (from the end)
print("\n== TRAILING RUNS (per segment, from tail) ==")
for name in seg:
    run = 0
    for r in reversed(h):
        if r['actualResult']['name'] == name:
            if r['hit']: run += 1
            else: break
    if run: print(f"  {name}: +{run} consecutive hits active")

# overall trailing
run = 0
for r in reversed(h):
    if r['hit']: run += 1
    else: break
print(f"  OVERALL trailing hit-run: {run}")

# ---------- 5. '1' RUN SCAN (era runs >=10) & recent windows ----------
print("\n== '1' HIT-RUN SCAN (runs >= 10 across era) ==")
runs = []; cur = 0; start = None
for i, r in enumerate(h):
    if r['actualResult']['name'] == '1' and r['hit']:
        if cur == 0: start = gid(i)
        cur += 1
    else:
        if cur >= 10: runs.append((start, gid(i-1), cur))
        cur = 0
if cur >= 10: runs.append((start, gid(N-1), cur))
for s,e,c in runs: print(f"  #{s} -> #{e}  len {c}")

# '2' era-high watch
two = [(i,r) for i,r in enumerate(h) if r['actualResult']['name']=='2']
th = sum(1 for i,r in two if r['hit'])
print(f"\n'2': {th}/{len(two)} = {th/len(two)*100:.1f}%")

# '5' and '10'
for nm in ('5','10'):
    s5 = [(i,r) for i,r in enumerate(h) if r['actualResult']['name']==nm]
    s5h = sum(1 for i,r in s5 if r['hit'])
    last10 = [ 'H' if r['hit'] else 'M' for i,r in s5[-10:] ]
    print(f"'{nm}': {s5h}/{len(s5)} = {s5h/len(s5)*100:.1f}%  last10={''.join(last10)}")

# ---------- 6. BONUS TIER + COIN FLIP ----------
print("\n== BONUS TIER TEXTURE (tail-20 bonus rounds) ==")
bt = [(i,r) for i,r in bonus][-20:]
for i,r in bt:
    ex = 'EXACT-top' if r['hit'] and top(r)==r['actualResult']['name'] else ''
    print(f"  #{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} {'HIT' if r['hit'] else 'miss'} {ex}")

# ---------- 7. MISS INDICES for '1' (tail) ----------
m1 = [gid(i) for i,r in enumerate(h) if r['actualResult']['name']=='1' and not r['hit']]
print(f"\n'1' miss indices (last 12): {m1[-12:]}")

# ---------- 8. RECAL WINDOW ----------
rw = [gid(i) for i,r in enumerate(h) if r.get('recalibrated') and gid(i) >= 390]
print(f"\nrecal in-window (#390+): {rw}")

# ---------- 9. EXACT-TOP HITS (tail) ----------
print("\n== EXACT-TOP HITS (#380+) ==")
for i,r in enumerate(h):
    if i >= 379 and r['hit'] and top(r) == r['actualResult']['name']:
        print(f"  #{gid(i):3d} top={top(r):<10s} conf={r.get('confidence')}")
