#!/usr/bin/env python3
"""Pass 134 (Task ID 179) — read-only census analysis of revo_roundHistory.
Window start #602 (index 601): everything after Pass 131's n=601 frontier."""
import json, datetime

for p in ('history','errors','keys','sig','panel'):
    json.load(open(f'/home/z/my-project/scripts/data/pass134_{p}.json'))

d = json.load(open('/home/z/my-project/scripts/data/pass134_history.json'))
h = json.loads(d['data']['result'])
N = len(h)
W = 637  # index 637 => round #638
print(f"TOTAL n={N} (pass131 ended 601; persistence {'OK' if N > 601 else 'NO GROWTH'})")
PANEL = json.load(open('/home/z/my-project/scripts/data/pass134_panel.json'))
ptext = PANEL['data']['result']
print(f"PANEL: OFF={'SHADOW OFF' in ptext}, NoVal={'No validation started' in ptext}")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

latest_age = (datetime.datetime.now().timestamp()*1000 - h[-1]['time'])/1000
print(f"latest #{gid(N-1)} at {ts(h[-1])} ({latest_age:.0f}s fresh)")

print(f"\n== NEW ROUNDS #602-#{gid(N-1)} ==")
for i in range(W, N):
    r = h[i]
    ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
    rec = 'RECAL' if r.get('recalibrated') else ''
    print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")

print("\nTOP-PICK CHASE SCAN (#602+):")
from collections import Counter
seq = [(gid(i), top(r), r['actualResult']['name'], r['hit'], r.get('confidence')) for i, r in enumerate(h) if i >= W]
chase = Counter(t for _, t, a, hit, c in seq if t != a)
print("  top-pick tallies (top != actual):", dict(chase.most_common()))

gaps = [((h[i]['time']-h[i-1]['time'])/1000, gid(i-1), gid(i)) for i in range(1, N)]
tail = [(g,a,b) for g,a,b in gaps if b >= 602]
if tail:
    print(f"\nFEED window: avg {sum(g for g,_,_ in tail)/len(tail):.1f}s, max {max(tail)[0]:.0f}s; minors>100s in-window: {sum(1 for g,_,_ in tail if g>100)}")
    big = [(g,a,b) for g,a,b in tail if g > 100]
    if big: print("  window >100s gaps:", big)
era = sorted([g for g,_,_ in gaps if g > 100], reverse=True)
print(f"era >100s count: {len(era)}, max {era[0]:.0f}s (era record 1823s@#277)")

hits = sum(1 for r in h if r['hit'])
norm = [(i,r) for i,r in enumerate(h) if r['actualResult']['name'] in ('1','2','5','10')]
nh = sum(1 for i,r in norm if r['hit'])
bonus = [(i,r) for i,r in enumerate(h) if r['actualResult']['name'] not in ('1','2','5','10')]
bh = sum(1 for i,r in bonus if r['hit'])
recal = sum(1 for r in h if r.get('recalibrated'))
print(f"\nCENSUS n={N}: baseline {hits}/{N} = {hits/N*100:.1f}% | normals {nh}/{len(norm)} = {nh/len(norm)*100:.1f}% | bonus {bh}/{len(bonus)} = {bh/len(bonus)*100:.1f}% | theo {len(norm)}/{N} = {len(norm)/N*100:.1f}% | recal {recal}/{N} = {recal/N*100:.1f}%")
w2 = h[202:]; w2h = sum(1 for r in w2 if r['hit'])
w1h = sum(1 for r in h[:200] if r['hit'])
print(f"second-200 (203-{N}): {w2h}/{len(w2)} = {w2h/len(w2)*100:.1f}% vs 63.0% -> {w2h/len(w2)*100-w1h/200*100:+.1f}pp")
t30 = h[-30:]; t30h = sum(1 for r in t30 if r['hit'])
print(f"tail-30: {t30h}/30 = {t30h/30*100:.1f}%")
win = h[W:]; winh = sum(1 for r in win if r['hit'])
print(f"window rate (#602+): {winh}/{len(win)} = {winh/len(win)*100:.1f}%")

print("\nSEGMENTS:")
seg = {}
for i, r in enumerate(h):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']: s['h'] += 1; s['last_hit'] = gid(i)
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {N-s['last_any']:>3}  (last hit #{s['last_hit']})")

print("\nTRAILING RUNS:")
for name in seg:
    run = 0; kind = None
    for r in reversed(h):
        if r['actualResult']['name'] == name:
            k = 'H' if r['hit'] else 'M'
            if kind is None: kind = k; run = 1
            elif k == kind: run += 1
            else: break
    if run > 1: print(f"  {name}: {kind}-run {run} active")

runs = []; cur = 0; start = None
for i, r in enumerate(h):
    if r['actualResult']['name'] == '1':
        if r['hit']:
            if cur == 0: start = gid(i)
            cur += 1
        else:
            if cur >= 12: runs.append((start, cur))
            cur = 0
if cur >= 12: runs.append((start, cur))
print("\nERA '1' RUNS >=12:", [(s,c) for s,c in runs])

rw = [gid(i) for i,r in enumerate(h) if r.get('recalibrated') and gid(i) >= 638]
exw = [gid(i) for i,r in enumerate(h) if i>=W and r['hit'] and top(r)==r['actualResult']['name']]
print(f"\nrecal in-window ({len(rw)}): {rw}")
print(f"exact-tops in-window ({len(exw)}): {exw}")
print(f"conf seq #602+: {[(gid(i), h[i]['confidence']) for i in range(W,N)]}")

for tgt in ('5','10'):
    occ = [gid(i) for i,r in enumerate(h) if r['actualResult']['name'] == tgt]
    last = occ[-1] if occ else None
    print(f"'{tgt}' last occurrence #{last}, quiet {N-last if last else 'NA'}")

s2 = seg.get('2', {'n':0,'h':0})
print(f"'2' census: {s2['h']}/{s2['n']} = {s2['h']/s2['n']*100:.1f}%" if s2['n'] else "'2' absent")
s1 = seg.get('1', {'n':0,'h':0})
print(f"'1' census: {s1['h']}/{s1['n']} = {s1['h']/s1['n']*100:.1f}%")
sp = seg.get('PACHINKO', {'n':0,'h':0})
print(f"PACHINKO census: {sp['h']}/{sp['n']} = {sp['h']/sp['n']*100:.1f}%" if sp['n'] else "PACHINKO absent")
sc = seg.get('COIN FLIP', {'n':0,'h':0})
print(f"COIN FLIP census: {sc['h']}/{sc['n']} = {sc['h']/sc['n']*100:.1f}%" if sc['n'] else "COIN FLIP absent")

for tgt in ('PACHINKO','COIN FLIP','CASH HUNT','CRAZY TIME'):
    wr = [(gid(i), top(r), r['hit'], r.get('confidence')) for i,r in enumerate(h) if i>=W and r['actualResult']['name']==tgt]
    if wr: print(f"{tgt} in-window: {wr}")

E = json.load(open('/home/z/my-project/scripts/data/pass134_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text','')]
print(f"\nERRORS: total {len(errs)}, loadCritical-bearing {len(lc)}")
KEYS = json.load(open('/home/z/my-project/scripts/data/pass134_keys.json'))
print(f"KEYS: {KEYS['data']['result']}")
SIGRAW = json.load(open('/home/z/my-project/scripts/data/pass134_sig.json'))
try:
    sig = json.loads(SIGRAW['data']['result'])
    print(f"SIGNALS: updated {datetime.datetime.fromtimestamp(sig[0]['time']/1000).strftime('%H:%M:%S')}, top={sig[0]['game']['name']} conf={sig[0]['confidence']}, ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")
