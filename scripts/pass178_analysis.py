#!/usr/bin/env python3
"""Pass 178 (Task ID 223) — read-only census analysis of revo_roundHistory.
Window start #1238 (index 1237): the resumption burst after STALL #13 closed at 1,257.8s (era #9, 2.2s short of #8).
Headline watches: stall #13 rank confirmation; '2' H-run 7 -> 8+ era-list entry; '1' H-run 6 -> 7+; post-stall burst rate; errors 12/8/4 (loadCritical 8!); @75 -> 76+ break."""
import json, datetime

BASE = '/home/z/my-project/scripts/data/'
_d = json.load(open(BASE + 'pass178_history.json'))
H = json.loads(_d['data']['result']) if isinstance(_d.get('data'), dict) and 'result' in _d['data'] else _d
N = len(H)
W = 1237  # index 1237 => round #1238
FRONT = 1237  # pass177 frontier
print(f"TOTAL n={N} (pass177 frozen at {FRONT}; persistence {'OK +' + str(N-FRONT) if N > FRONT else 'STILL FROZEN'})")
ptext = open(BASE + 'pass178_panel.txt').read()
print(f"PANEL: OFF={'SHADOW OFF' in ptext or 'No validation' in ptext}, NoVal idx={ptext.find('No validation')}")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

latest_age = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
print(f"latest #{gid(N-1)} at {ts(H[-1])} UTC ({latest_age:.0f}s fresh at analysis)")

print(f"\n== NEW ROUNDS #1238-#{gid(N-1)} ==")
for i in range(W, N):
    r = H[i]
    ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
    rec = 'RECAL' if r.get('recalibrated') else ''
    print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")

# ---- STALL #13 closure + era rank ----
gaps = [((H[i]['time']-H[i-1]['time'])/1000, gid(i-1), gid(i)) for i in range(1, N)]
tail = [(g,a,b) for g,a,b in gaps if b >= 1238]
stallc = [(g,a,b) for g,a,b in tail if g > 400]
clean = [(g,a,b) for g,a,b in tail if g <= 400]
if stallc:
    for g,a,b in stallc:
        rank = len([x for x,_,_ in gaps if x > g]) + 1
        verdict = f"era #{rank} closed gap" if rank <= 8 else f"era #{rank}, outside top-8"
        rec = " (NEW ERA RECORD)" if g > 2635 else ""
        print(f"\nSTALL #13 CLOSED: {g:.1f}s (#{a}->#{b}, landed {ts(H[b-1])} UTC / 21:21:09 local) — {verdict}{rec}")
        print(f"  missed #8 by {1260-g:.1f}s (needed >1,260); displaced 1,237 from #9")
era = sorted([(g,a,b) for g,a,b in gaps if g > 100], reverse=True)[:10]
nmin = len([g for g,_,_ in gaps if g>100])
print(f"era >100s count: {nmin} (was 48; {'49TH+ MINOR' if nmin>=49 else 'no new minor'}), top-10: {[(round(g),f'#{a}->#{b}') for g,a,b in era]}")
if clean:
    print(f"FEED window (excl stall): avg {sum(g for g,_,_ in clean)/len(clean):.1f}s, max {max(clean)[0]:.0f}s; minors>100s in-window excl stall: {sum(1 for g,_,_ in clean if g>100)}")
open_gap = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
print(f"OPEN GAP at analysis: {open_gap:.0f}s (#{gid(N-1)} -> pending)")

# ---- census ----
hits = sum(1 for r in H if r['hit'])
norm = [(i,r) for i,r in enumerate(H) if r['actualResult']['name'] in ('1','2','5','10')]
nh = sum(1 for i,r in norm if r['hit'])
bonus = [(i,r) for i,r in enumerate(H) if r['actualResult']['name'] not in ('1','2','5','10')]
bh = sum(1 for i,r in bonus if r['hit'])
recal = sum(1 for r in H if r.get('recalibrated'))
print(f"\nCENSUS n={N}: baseline {hits}/{N} = {hits/N*100:.1f}% | normals {nh}/{len(norm)} = {nh/len(norm)*100:.1f}% | bonus {bh}/{len(bonus)} = {bh/len(bonus)*100:.1f}% | theo {len(norm)}/{N} = {len(norm)/N*100:.1f}% | recal {recal}/{N} = {recal/N*100:.1f}%")
w2 = H[202:]; w2h = sum(1 for r in w2 if r['hit'])
w1h = sum(1 for r in H[:200] if r['hit'])
print(f"second-200 (203-{N}): {w2h}/{len(w2)} = {w2h/len(w2)*100:.1f}% vs 63.0% -> {w2h/len(w2)*100-w1h/200*100:+.1f}pp")
t30 = H[-30:]; t30h = sum(1 for r in t30 if r['hit'])
print(f"tail-30: {t30h}/30 = {t30h/30*100:.1f}%")
win = H[W:]; winh = sum(1 for r in win if r['hit'])
if win:
    print(f"window rate (#1238+): {winh}/{len(win)} = {winh/len(win)*100:.1f}% (baseline {hits/N*100:.1f}%)")
else:
    print("window rate (#1238+): EMPTY")

# ---- segments ----
print("\nSEGMENTS:")
seg = {}
for i, r in enumerate(H):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']: s['h'] += 1; s['last_hit'] = gid(i)
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {N-s['last_any']:>3}  (last hit #{s['last_hit']})")

# ---- trailing runs ----
print("\nTRAILING RUNS:")
for name in seg:
    run = 0; kind = None
    for r in reversed(H):
        if r['actualResult']['name'] == name:
            k = 'H' if r['hit'] else 'M'
            if kind is None: kind = k; run = 1
            elif k == kind: run += 1
            else: break
    if run > 1: print(f"  {name}: {kind}-run {run} active")

# ---- trailing TOP arcs ----
print("\nTRAILING TOP-ARCS:")
tops = [top(r) for r in H]
for name in sorted(set(tops)):
    arc = 0
    for t in reversed(tops):
        if t == name: arc += 1
        else: break
    if arc >= 2: print(f"  {name}: top-arc {arc}")

# ---- era runs ----
runs = []; cur = 0; start = None
for i, r in enumerate(H):
    if r['actualResult']['name'] == '1':
        if r['hit']:
            if cur == 0: start = gid(i)
            cur += 1
        else:
            if cur >= 10: runs.append((start, cur))
            cur = 0
if cur >= 10: runs.append((start, cur))
print("\nERA '1' RUNS >=10:", [(s,c) for s,c in runs])

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
print("ERA '2' RUNS >=8:", [(s,c) for s,c in runs2], "(1171,9) next target; all-time (921,22)")

# ---- window detail ----
rw = [gid(i) for i,r in enumerate(H) if r.get('recalibrated') and gid(i) >= 1238]
exw = [(gid(i), top(r), r['actualResult']['name'], r.get('confidence')) for i,r in enumerate(H) if i>=W and r['hit'] and top(r)==r['actualResult']['name']]
era_ex = sum(1 for i,r in enumerate(H) if r['hit'] and top(r) == r['actualResult']['name'])
print(f"\nrecal in-window ({len(rw)}): {rw}")
print(f"exact-tops in-window ({len(exw)}): {exw}")
print(f"ERA EXACTS: {era_ex}/{N} = {era_ex/N*100:.1f}% (was 246 @ 19.9%)")
print(f"conf seq #1238+: {[(gid(i), H[i]['confidence']) for i in range(W,N)]}")
conf_floor = min(r.get('confidence',100) for r in H)
conf_max = max(r.get('confidence',0) for r in H)
c75 = sum(1 for r in H if r.get('confidence')==75)
c76 = sum(1 for r in H if r.get('confidence')>=76)
print(f"era conf floor: {conf_floor} | era conf ceiling: {conf_max} | @75 prints: {c75} | >=76 prints: {c76}")

for tgt in ('2','1','10','5','CASH HUNT','CRAZY TIME','COIN FLIP','PACHINKO'):
    wr = [(gid(i), top(r), r['hit'], r.get('confidence')) for i,r in enumerate(H) if i>=W and r['actualResult']['name']==tgt]
    if wr: print(f"{tgt} in-window: {wr}")

# ---- errors ----
E = json.load(open(BASE + 'pass178_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text','')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text','')]
print(f"\nERRORS: total {len(errs)}, loadCritical-bearing {len(lc)}, uncaught-promise family {len(fam)}")
try:
    E0 = json.load(open(BASE + 'pass177_errors.json'))
    t0 = sorted(e.get('text','') for e in E0['data']['errors'])
    t1 = sorted(e.get('text','') for e in errs)
    from collections import Counter
    d_add = list((Counter(t1) - Counter(t0)).elements())
    d_rem = list((Counter(t0) - Counter(t1)).elements())
    print(f"ERROR DIFF vs pass177: +{len(d_add)} -{len(d_rem)}")
    for a in d_add: print(f"  NEW: {a[:160]}")
except Exception as e:
    print(f"error-diff skipped: {e}")

KEYS = json.load(open(BASE + 'pass178_keys.json'))
_kr = KEYS['data']['result'] if isinstance(KEYS.get('data'), dict) and 'result' in KEYS['data'] else str(KEYS)
print(f"KEYS: {_kr}")
try:
    sig = json.loads(json.load(open(BASE + 'pass178_sig.json'))['data']['result'])
    st = datetime.datetime.fromtimestamp(sig[0]['time']/1000).strftime('%H:%M:%S')
    print(f"SIGNALS: updated {st} UTC, top={sig[0]['game']['name']} conf={sig[0]['confidence']}, ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")
