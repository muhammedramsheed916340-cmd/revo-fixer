#!/usr/bin/env python3
"""Pass 177 (Task ID 222) — read-only census analysis of revo_roundHistory.
STALL #13 LIVE: no growth since #1237 (13:00:11 UTC); open gap 1117s+ at read. Empty-window guard active (P163 lesson).
Headline watches: stall #13 age/rank trajectory; '2' H-run 7 survival; signals four-way @75 resolution ('1'->'2' top flip); errors re-freeze at 11/7/4."""
import json, datetime

BASE = '/home/z/my-project/scripts/data/'
_d = json.load(open(BASE + 'pass177_history.json'))
H = json.loads(_d['data']['result']) if isinstance(_d.get('data'), dict) and 'result' in _d['data'] else _d
N = len(H)
W = 1237  # index 1237 => round #1238 (expected EMPTY)
FRONT = 1237  # pass176 frontier
print(f"TOTAL n={N} (pass176 ended {FRONT}; persistence {'OK +' + str(N-FRONT) if N > FRONT else 'FROZEN — NO GROWTH (stall #13)'})")
ptext = open(BASE + 'pass177_panel.txt').read()
print(f"PANEL: OFF={'SHADOW OFF' in ptext or 'No validation' in ptext}, NoVal idx={ptext.find('No validation')}")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

# ---- STALL #13 tracking ----
open_gap = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
print(f"\n== STALL #13 LIVE ==")
print(f"last round #{gid(N-1)} at {ts(H[-1])} UTC; OPEN GAP at analysis: {open_gap:.0f}s")
print(f"opened 21:00:11 local (13:00:11 UTC); 271s open at P176 analysis; 1117s open at this pass read")
# rank projection if closed now
gaps_all = sorted([(H[i]['time']-H[i-1]['time'])/1000 for i in range(1, N)], reverse=True)
proj_rank = len([g for g in gaps_all if g > open_gap]) + 1
verdict = f"era #{proj_rank}" if proj_rank <= 8 else "outside top-8 (needs >1,260s for #8; >1,237s for #9)"
rec = " WOULD BE NEW ERA RECORD" if open_gap > 2635 else ""
print(f"if closed NOW: {verdict}{rec}")
print(f"era ladder: {[(round(g)) for g in gaps_all[:10]]}")
print(f"post-burst pattern: 4th straight stall after a burst window (#10 after P162, #11 after P170, #12 after P173's +28, #13 after P176's 85.0% hottest-of-hour)")
print(f"next-tick projection: if still open at 21:32:44 tick, gap >= {open_gap + 895:.0f}s -> closure then = {'ERA #3 (beats 1,823)' if open_gap + 895 > 1823 else 'top-8'} territory")

# ---- window (expected empty) ----
win = H[W:]
if win:
    print(f"\n== NEW ROUNDS #1238-#{gid(N-1)} ==")
    for i in range(W, N):
        r = H[i]
        ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
        rec = 'RECAL' if r.get('recalibrated') else ''
        print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")
else:
    print(f"\nWINDOW #1238+: EMPTY — zero new rounds since #{FRONT} (feed frozen; guard held, no division on empty window)")

# ---- gaps summary (era-wide, for minor count) ----
nmin = len([g for g in gaps_all if g > 100])
print(f"era >100s count: {nmin} (was 48; {'49TH+ MINOR' if nmin >= 49 else 'no new minor — frozen feed'})")

# ---- census (frozen-state confirmation) ----
hits = sum(1 for r in H if r['hit'])
norm = [(i,r) for i,r in enumerate(H) if r['actualResult']['name'] in ('1','2','5','10')]
nh = sum(1 for i,r in norm if r['hit'])
bonus = [(i,r) for i,r in enumerate(H) if r['actualResult']['name'] not in ('1','2','5','10')]
bh = sum(1 for i,r in bonus if r['hit'])
recal = sum(1 for r in H if r.get('recalibrated'))
print(f"\nCENSUS n={N} (frozen): baseline {hits}/{N} = {hits/N*100:.1f}% | normals {nh}/{len(norm)} = {nh/len(norm)*100:.1f}% | bonus {bh}/{len(bonus)} = {bh/len(bonus)*100:.1f}% | theo {len(norm)}/{N} = {len(norm)/N*100:.1f}% | recal {recal}/{N} = {recal/N*100:.1f}%")
w2 = H[202:]; w2h = sum(1 for r in w2 if r['hit'])
w1h = sum(1 for r in H[:200] if r['hit'])
print(f"second-200 (203-{N}): {w2h}/{len(w2)} = {w2h/len(w2)*100:.1f}% vs 63.0% -> {w2h/len(w2)*100-w1h/200*100:+.1f}pp")
t30 = H[-30:]; t30h = sum(1 for r in t30 if r['hit'])
print(f"tail-30: {t30h}/30 = {t30h/30*100:.1f}%")

# ---- segments (frozen) ----
print("\nSEGMENTS (frozen):")
seg = {}
for i, r in enumerate(H):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']: s['h'] += 1; s['last_hit'] = gid(i)
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {N-s['last_any']:>3}  (last hit #{s['last_hit']})")

# ---- trailing runs (all carry over) ----
print("\nTRAILING RUNS (carry over under freeze):")
for name in seg:
    run = 0; kind = None
    for r in reversed(H):
        if r['actualResult']['name'] == name:
            k = 'H' if r['hit'] else 'M'
            if kind is None: kind = k; run = 1
            elif k == kind: run += 1
            else: break
    if run > 1: print(f"  {name}: {kind}-run {run} active")

print("\nTRAILING TOP-ARCS:")
tops = [top(r) for r in H]
for name in sorted(set(tops)):
    arc = 0
    for t in reversed(tops):
        if t == name: arc += 1
        else: break
    if arc >= 2: print(f"  {name}: top-arc {arc}")

# ---- era runs ----
runs2 = []; cur2 = 0; start2 = None
for i, r in enumerate(H):
    if r['actualResult']['name'] == '2':
        if r['hit']:
            if cur2 == 0: start2 = gid(i)
            cur2 += 1
        else:
            if cur2 >= 8: runs2.append((start2, cur2))
            cur2 = 0
if cur2 >= 8: runs2.append((start2, cur2))
print(f"\nERA '2' RUNS >=8: {[(s,c) for s,c in runs2]} — trailing H-run 7 (start #1220) still below list; survival watch")
era_ex = sum(1 for i,r in enumerate(H) if r['hit'] and top(r) == r['actualResult']['name'])
conf_floor = min(r.get('confidence',100) for r in H)
conf_max = max(r.get('confidence',0) for r in H)
c75 = sum(1 for r in H if r.get('confidence')==75)
c76 = sum(1 for r in H if r.get('confidence')>=76)
print(f"ERA EXACTS: {era_ex}/{N} = {era_ex/N*100:.1f}% | conf floor {conf_floor} / ceiling {conf_max} | @75 prints: {c75} | >=76: {c76}")

# ---- errors + signals ----
E = json.load(open(BASE + 'pass177_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text','')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text','')]
print(f"\nERRORS: total {len(errs)}, loadCritical-bearing {len(lc)}, uncaught-promise family {len(fam)}")
try:
    E0 = json.load(open(BASE + 'pass176_errors.json'))
    t0 = sorted(e.get('text','') for e in E0['data']['errors'])
    t1 = sorted(e.get('text','') for e in errs)
    from collections import Counter
    d_add = list((Counter(t1) - Counter(t0)).elements())
    d_rem = list((Counter(t0) - Counter(t1)).elements())
    print(f"ERROR DIFF vs pass176: +{d_add} -{d_rem} ({'RE-FREEZE at 11/7/4' if not d_add and not d_rem else 'MOVEMENT'})")
except Exception as e:
    print(f"error-diff skipped: {e}")

KEYS = json.load(open(BASE + 'pass177_keys.json'))
_kr = KEYS['data']['result'] if isinstance(KEYS.get('data'), dict) and 'result' in KEYS['data'] else str(KEYS)
print(f"KEYS: {_kr}")
try:
    sig = json.loads(json.load(open(BASE + 'pass177_sig.json'))['data']['result'])
    st = datetime.datetime.fromtimestamp(sig[0]['time']/1000).strftime('%H:%M:%S')
    print(f"SIGNALS: updated {st} UTC (RECOMPUTING under freeze — page alive), top={sig[0]['game']['name']} conf={sig[0]['confidence']}, ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
    print(f"  P176 top was '1' @75 — top flip watch: {'FLIPPED to ' + sig[0]['game']['name'] if sig[0]['game']['name'] != '1' else 'unchanged'}")
except Exception as e:
    print(f"SIGNALS parse: {e}")
