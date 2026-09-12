#!/usr/bin/env python3
"""Pass 120 (Task ID 165) — read-only census analysis of revo_roundHistory (n=432)."""
import json, datetime

d = json.load(open('/home/z/my-project/scripts/data/pass120_history.json'))
h = json.loads(d['data']['result'])
N = len(h)
print(f"TOTAL n={N}")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

# 1. NEW ROUNDS #412-#432
print(f"\n== NEW ROUNDS #412-#{gid(N-1)} ==")
for i in range(411, N):
    r = h[i]
    ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
    rec = 'RECAL' if r.get('recalibrated') else ''
    print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")

# 2. FEED GAPS
print("\n== FEED GAPS (window #412+, >100s) ==")
gaps = [((h[i]['time']-h[i-1]['time'])/1000, gid(i-1), gid(i)) for i in range(1, N)]
recent = [(g,a,b) for g,a,b in gaps if b >= 412 and g > 100]
for g,a,b in sorted(recent, reverse=True)[:6]:
    print(f"  gap {g:.0f}s  #{a}->{b}")
tail = [(g,a,b) for g,a,b in gaps if b >= 412]
if tail:
    print(f"  window: avg {sum(g for g,_,_ in tail)/len(tail):.1f}s, max {max(tail)[0]:.0f}s")
era = sorted([g for g,_,_ in gaps if g > 100], reverse=True)
print(f"  era >100s count: {len(era)}, max {era[0]:.0f}s")

# 3. CENSUS
hits = sum(1 for r in h if r['hit'])
norm = [(i,r) for i,r in enumerate(h) if r['actualResult']['name'] in ('1','2','5','10')]
nh = sum(1 for i,r in norm if r['hit'])
bonus = [(i,r) for i,r in enumerate(h) if r['actualResult']['name'] not in ('1','2','5','10')]
bh = sum(1 for i,r in bonus if r['hit'])
recal = sum(1 for r in h if r.get('recalibrated'))
print(f"\n== CENSUS n={N} ==")
print(f"baseline {hits}/{N} = {hits/N*100:.1f}% | normals {nh}/{len(norm)} = {nh/len(norm)*100:.1f}% | bonus {bh}/{len(bonus)} = {bh/len(bonus)*100:.1f}% | theo {len(norm)}/{N} = {len(norm)/N*100:.1f}% | recal {recal}/{N} = {recal/N*100:.1f}%")
w2 = h[202:]; w2h = sum(1 for r in w2 if r['hit'])
w1h = sum(1 for r in h[:200] if r['hit'])
print(f"second-200 (203-{N}): {w2h}/{len(w2)} = {w2h/len(w2)*100:.1f}% vs first-200 {w1h/200*100:.1f}% -> {w2h/len(w2)*100-w1h/200*100:+.1f}pp")
t30 = h[-30:]; t30h = sum(1 for r in t30 if r['hit'])
print(f"tail-30: {t30h}/30 = {t30h/30*100:.1f}%")

# 4. SEGMENTS
print("\n== SEGMENTS ==")
seg = {}
for i, r in enumerate(h):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']: s['h'] += 1; s['last_hit'] = gid(i)
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    q = N - s['last_any']
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {q:>3}  (last hit #{s['last_hit']})")

# 5. TRAILING RUNS per segment
print("\n== TRAILING RUNS ==")
for name in seg:
    run = 0; kind = None
    for r in reversed(h):
        if r['actualResult']['name'] == name:
            k = 'H' if r['hit'] else 'M'
            if kind is None: kind = k; run = 1
            elif k == kind: run += 1
            else: break
    if run > 1: print(f"  {name}: {kind}-run {run} active")

# 6. era '1' runs (skip semantics, >=12)
print("\n== ERA '1' RUNS >=12 ==")
runs = []; cur = 0; start = None
for i, r in enumerate(h):
    if r['actualResult']['name'] == '1':
        if r['hit']:
            if cur == 0: start = gid(i)
            cur += 1
        else:
            if cur >= 12: runs.append((start, gid(i-1), cur))
            cur = 0
if cur >= 12: runs.append((start, gid(N-1), cur))
for s,e,c in runs: print(f"  #{s}->#{e} len {c}", '(ACTIVE)' if e==N else '')

# 7. '5'/'10' texture
for nm in ('5','10'):
    ss = [(i,r) for i,r in enumerate(h) if r['actualResult']['name']==nm]
    sh = sum(1 for i,r in ss if r['hit'])
    miss_run = 0
    for i,r in reversed(ss):
        if not r['hit']: miss_run += 1
        else: break
    print(f"\n'{nm}': {sh}/{len(ss)} = {sh/len(ss)*100:.1f}%  trailing miss-run {miss_run}  last10={''.join('H' if r['hit'] else 'M' for i,r in ss[-10:])}")

# 8. BONUS tail-12
print("\n== BONUS TAIL-12 ==")
for i,r in [(i,r) for i,r in bonus][-12:]:
    ex = 'EXACT-top' if r['hit'] and top(r)==r['actualResult']['name'] else ''
    print(f"  #{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} {'HIT' if r['hit'] else 'miss'} {ex}")

# 9. recal in-window + exact-top count in window
rw = [gid(i) for i,r in enumerate(h) if r.get('recalibrated') and gid(i) >= 412]
exw = [gid(i) for i,r in enumerate(h) if i>=411 and r['hit'] and top(r)==r['actualResult']['name']]
print(f"\nrecal in-window: {rw}")
print(f"exact-tops in-window ({len(exw)}): {exw}")
print(f"conf seq #412+: {[(gid(i), h[i]['confidence']) for i in range(411,N)]}")
