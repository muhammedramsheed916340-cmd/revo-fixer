#!/usr/bin/env python3
"""Pass 176 (Task ID 221) — read-only census analysis of revo_roundHistory.
Window start #1218 (index 1217): everything after Pass 175's n=1217 frontier ('1' H-run 15 sealed; CASH HUNT H-run 3; stall #12 closed 952.2s; errors 10/7/3 frozen 20 loads).
Headline watches: CASH HUNT H-run 3 -> 4+; COIN FLIP fixation own-actual break; recal 3-streak; 49th minor / stall #13; 75 x12 -> 76+; ERROR LAYER MOVEMENT (11/7/4 pre-read)."""
import json, datetime

BASE = '/home/z/my-project/scripts/data/'
_d = json.load(open(BASE + 'pass176_history.json'))
H = json.loads(_d['data']['result']) if isinstance(_d.get('data'), dict) and 'result' in _d['data'] else _d
N = len(H)
W = 1217  # index 1217 => round #1218
FRONT = 1217  # pass175 frontier
print(f"TOTAL n={N} (pass175 ended {FRONT}; persistence {'OK +' + str(N-FRONT) if N > FRONT else 'NO GROWTH'})")
ptext = open(BASE + 'pass176_panel.txt').read()
print(f"PANEL: OFF={'SHADOW OFF' in ptext or 'No validation' in ptext}, NoVal idx={ptext.find('No validation')}")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

latest_age = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
print(f"latest #{gid(N-1)} at {ts(H[-1])} UTC ({latest_age:.0f}s fresh at analysis)")

print(f"\n== NEW ROUNDS #1218-#{gid(N-1)} ==")
for i in range(W, N):
    r = H[i]
    ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
    rec = 'RECAL' if r.get('recalibrated') else ''
    print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")

# ---- gaps / minors / stall ----
gaps = [((H[i]['time']-H[i-1]['time'])/1000, gid(i-1), gid(i)) for i in range(1, N)]
tail = [(g,a,b) for g,a,b in gaps if b >= 1218]
stallc = [(g,a,b) for g,a,b in tail if g > 400]
clean = [(g,a,b) for g,a,b in tail if g <= 400]
if stallc:
    for g,a,b in stallc:
        rank = len([x for x,_,_ in gaps if x > g]) + 1
        verdict = f"era #{rank} closed gap" if rank <= 8 else "outside top-8"
        rec = " (NEW ERA RECORD)" if g > 2635 else ""
        print(f"\nSTALL-CLASS GAP CLOSED: {g:.1f}s (#{a}->#{b}, landed {ts(H[b-1])} UTC) — {verdict}{rec}")
era = sorted([(g,a,b) for g,a,b in gaps if g > 100], reverse=True)[:8]
nmin = len([g for g,_,_ in gaps if g>100])
print(f"era >100s count: {nmin} (was 48; {'49TH+ MINOR' if nmin>=49 else 'no new minor'}), top-8: {[(round(g),f'#{a}->#{b}') for g,a,b in era]}")
if clean:
    print(f"FEED window (excl stall-class): avg {sum(g for g,_,_ in clean)/len(clean):.1f}s, max {max(clean)[0]:.0f}s; minors>100s in-window excl stall: {sum(1 for g,_,_ in clean if g>100)}")
open_gap = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
print(f"OPEN GAP at analysis: {open_gap:.0f}s (#{gid(N-1)} -> pending) — stall #13 watch if >400s")

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
    print(f"window rate (#1218+): {winh}/{len(win)} = {winh/len(win)*100:.1f}% (baseline {hits/N*100:.1f}%)")
else:
    print("window rate (#1218+): EMPTY — zero new rounds since #1217")

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
print("\nTRAILING TOP-ARCS (consecutive same-top rounds ending at latest):")
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
print("ERA '2' RUNS >=8:", [(s,c) for s,c in runs2])

arc10 = []; c10 = 0; st10 = None
for i, r in enumerate(H):
    if r['actualResult']['name'] == '10':
        if r['hit']:
            if c10 == 0: st10 = gid(i)
            c10 += 1
        else:
            if c10 >= 6: arc10.append((st10, c10))
            c10 = 0
if c10 >= 6: arc10.append((st10, c10))
print(f"'10' ERA HIT-ARCS >=6: {arc10} (era record 10)")

# ---- window detail ----
rw = [gid(i) for i,r in enumerate(H) if r.get('recalibrated') and gid(i) >= 1218]
exw = [(gid(i), top(r), r['actualResult']['name'], r.get('confidence')) for i,r in enumerate(H) if i>=W and r['hit'] and top(r)==r['actualResult']['name']]
era_ex = sum(1 for i,r in enumerate(H) if r['hit'] and top(r) == r['actualResult']['name'])
print(f"\nrecal in-window ({len(rw)}): {rw}")
print(f"exact-tops in-window ({len(exw)}): {exw}")
print(f"ERA EXACTS: {era_ex}/{N} = {era_ex/N*100:.1f}% (was 242 @ 19.9%)")
print(f"conf seq #1218+: {[(gid(i), H[i]['confidence']) for i in range(W,N)]}")
conf_floor = min(r.get('confidence',100) for r in H)
conf_max = max(r.get('confidence',0) for r in H)
c75 = sum(1 for r in H if r.get('confidence')==75)
c76 = sum(1 for r in H if r.get('confidence')>=76)
print(f"era conf floor: {conf_floor} | era conf ceiling: {conf_max} | @75 prints: {c75} | >=76 prints: {c76}")

s1 = seg.get('1', {'n':0,'h':0})
s2 = seg.get('2', {'n':0,'h':0})
s5 = seg.get('5', {'n':0,'h':0})
s10 = seg.get('10', {'n':0,'h':0})
sp = seg.get('PACHINKO', {'n':0,'h':0})
sc = seg.get('COIN FLIP', {'n':0,'h':0})
sh = seg.get('CASH HUNT', {'n':0,'h':0})
scz = seg.get('CRAZY TIME', {'n':0,'h':0})
print(f"'1' census: {s1['h']}/{s1['n']} = {s1['h']/s1['n']*100:.1f}%")
print(f"'2' census: {s2['h']}/{s2['n']} = {s2['h']/s2['n']*100:.1f}%")
print(f"'5' census: {s5['h']}/{s5['n']} = {s5['h']/s5['n']*100:.1f}%")
print(f"'10' census: {s10['h']}/{s10['n']} = {s10['h']/s10['n']*100:.1f}%")
print(f"CASH HUNT census: {sh['h']}/{sh['n']} = {sh['h']/sh['n']*100:.1f}%")
print(f"CRAZY TIME census: {scz['h']}/{scz['n']} = {scz['h']/scz['n']*100:.1f}%")
print(f"PACHINKO census: {sp['h']}/{sp['n']} = {sp['h']/sp['n']*100:.1f}%")
print(f"COIN FLIP census: {sc['h']}/{sc['n']} = {sc['h']/sc['n']*100:.1f}%")

for tgt in ('CASH HUNT','COIN FLIP','CRAZY TIME','5','10','2','1','PACHINKO'):
    wr = [(gid(i), top(r), r['hit'], r.get('confidence')) for i,r in enumerate(H) if i>=W and r['actualResult']['name']==tgt]
    if wr: print(f"{tgt} in-window: {wr}")

# ---- errors with diff vs pass 175 ----
E = json.load(open(BASE + 'pass176_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text','')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text','')]
print(f"\nERRORS: total {len(errs)}, loadCritical-bearing {len(lc)}, uncaught-promise family {len(fam)}")
try:
    E0 = json.load(open(BASE + 'pass175_errors.json'))
    errs0 = E0['data']['errors']
    t0 = sorted(e.get('text','') for e in errs0)
    t1 = sorted(e.get('text','') for e in errs)
    from collections import Counter
    c0, c1 = Counter(t0), Counter(t1)
    added = list((c1 - c0).elements())
    removed = list((c0 - c1).elements())
    print(f"ERROR DIFF vs pass175: +{added} -{removed}")
except Exception as e:
    print(f"error-diff skipped: {e}")

KEYS = json.load(open(BASE + 'pass176_keys.json'))
_kr = KEYS['data']['result'] if isinstance(KEYS.get('data'), dict) and 'result' in KEYS['data'] else str(KEYS)
print(f"KEYS: {_kr}")
try:
    sig = json.loads(json.load(open(BASE + 'pass176_sig.json'))['data']['result'])
    st = datetime.datetime.fromtimestamp(sig[0]['time']/1000).strftime('%H:%M:%S')
    print(f"SIGNALS: updated {st} UTC, top={sig[0]['game']['name']} conf={sig[0]['confidence']}, ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")
