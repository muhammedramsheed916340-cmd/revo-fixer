#!/usr/bin/env python3
"""Pass 147 (Task ID 192) — read-only census analysis of revo_roundHistory.
Zero-growth pass: n frozen at 795 (pass 146 frontier). Headline: stall #6 forming —
open-gap measurement, era table position, record trajectory; app-alive/feed-silent check."""
import json, datetime

H = json.load(open('/home/z/my-project/scripts/data/pass147_history.json'))
N = len(H)
W = 795  # index 795 => round #796 (window empty this pass)
print(f"TOTAL n={N} (pass146 ended 795; persistence {'OK (held)' if N >= 795 else 'REGRESSED'})")
ptext = open('/home/z/my-project/scripts/data/pass147_panel.txt').read()
print(f"PANEL: OFF={'SHADOW OFF' in ptext}, NoVal idx={ptext.find('No validation')}, chars={len(ptext)} (pass146: 141377)")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

now_ms = datetime.datetime.now().timestamp()*1000
latest_age = (now_ms - H[-1]['time'])/1000
print(f"latest #{gid(N-1)} at {ts(H[-1])} — OPEN GAP {latest_age:.0f}s and growing")

gaps = [((H[i]['time']-H[i-1]['time'])/1000, gid(i-1), gid(i)) for i in range(1, N)]
era = sorted([(g,a,b) for g,a,b in gaps if g > 100], reverse=True)
print(f"era >100s count: {len(era)} (closed entries; the open gap not yet among them)")
top6 = era[:6]
print("era top-6:", [(round(g), f"#{a}->#{b}") for g,a,b in top6])
# rank projection for the open gap
closed_vals = [g for g,_,_ in era] + [float('inf')]
rank = sum(1 for g in closed_vals if g > latest_age) + 1
print(f"OPEN GAP {latest_age:.0f}s would rank #{rank} all-time (behind {sorted([g for g in closed_vals if g > latest_age], reverse=True)[:3]})")
t2456 = H[-1]['time'] + 2456*1000
print(f"record 2,456s breached at {datetime.datetime.fromtimestamp(t2456/1000).strftime('%H:%M:%S')} local if silence holds")
for mark in (1047, 1136):
    t = H[-1]['time'] + mark*1000
    print(f"  era-rank-{6 if mark==1047 else 5} mark {mark}s crossed at {datetime.datetime.fromtimestamp(t/1000).strftime('%H:%M:%S')} local")

hits = sum(1 for r in H if r['hit'])
norm = [(i,r) for i,r in enumerate(H) if r['actualResult']['name'] in ('1','2','5','10')]
nh = sum(1 for i,r in norm if r['hit'])
bonus = [(i,r) for i,r in enumerate(H) if r['actualResult']['name'] not in ('1','2','5','10')]
bh = sum(1 for i,r in bonus if r['hit'])
recal = sum(1 for r in H if r.get('recalibrated'))
print(f"\nCENSUS FROZEN n={N}: baseline {hits}/{N} = {hits/N*100:.1f}% | normals {nh}/{len(norm)} = {nh/len(norm)*100:.1f}% | bonus {bh}/{len(bonus)} = {bh/len(bonus)*100:.1f}% | theo {len(norm)}/{N} = {len(norm)/N*100:.1f}% | recal {recal}/{N} = {recal/N*100:.1f}%")
w2 = H[202:]; w2h = sum(1 for r in w2 if r['hit'])
w1h = sum(1 for r in H[:200] if r['hit'])
print(f"second-200 (203-{N}): {w2h}/{len(w2)} = {w2h/len(w2)*100:.1f}% vs 63.0% -> {w2h/len(w2)*100-w1h/200*100:+.1f}pp")
t30 = H[-30:]; t30h = sum(1 for r in t30 if r['hit'])
print(f"tail-30: {t30h}/30 = {t30h/30*100:.1f}%")
win = H[W:]
if win:
    winh = sum(1 for r in win if r['hit'])
    print(f"window rate (#796+): {winh}/{len(win)} = {winh/len(win)*100:.1f}%")
else:
    print("window rate (#796+): EMPTY — zero new rounds since pass 146")

print("\nSEGMENTS (frozen):")
seg = {}
for i, r in enumerate(H):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']: s['h'] += 1; s['last_hit'] = gid(i)
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {N-s['last_any']:>3}  (last hit #{s['last_hit']})")

print("\nTRAILING RUNS (frozen):")
for name in seg:
    run = 0; kind = None
    for r in reversed(H):
        if r['actualResult']['name'] == name:
            k = 'H' if r['hit'] else 'M'
            if kind is None: kind = k; run = 1
            elif k == kind: run += 1
            else: break
    if run > 1: print(f"  {name}: {kind}-run {run} active")

E = json.load(open('/home/z/my-project/scripts/data/pass147_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text','')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text','')]
print(f"\nERRORS: total {len(errs)}, loadCritical-bearing {len(lc)}, uncaught-promise family {len(fam)}")
KEYS = json.load(open('/home/z/my-project/scripts/data/pass147_keys.json'))
print(f"KEYS: {KEYS['data']['result']}")
try:
    sig = json.load(open('/home/z/my-project/scripts/data/pass147_sig.json'))
    age = (now_ms - sig[0]['time'])/1000
    print(f"SIGNALS: updated {datetime.datetime.fromtimestamp(sig[0]['time']/1000).strftime('%H:%M:%S')} ({age:.0f}s fresh), top={sig[0]['game']['name']} conf={sig[0]['confidence']}, ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")
