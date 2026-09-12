#!/usr/bin/env python3
"""Pass 171 (Task ID 216) — read-only census analysis of revo_roundHistory.
Window start #1146 (index 1145): everything after Pass 170's n=1145 frontier (stall #11 live at 722s open gap).
Headline watches: STALL #11 close-timing (722s open at P170 re-probe; ladder 1,237/1,260/1,421/1,538/1,607/1,823/2,456/2,635); 75-plateau ×4 retest/break; '1' run (1124,12) → 13+; 80-LINE (79.9%); '2' H-run 5 → 6+; exact 20.0% line; PACHINKO signals-top validation."""
import json, datetime

_d = json.load(open('/home/z/my-project/scripts/data/pass171_history.json'))
H = json.loads(_d['data']['result']) if isinstance(_d.get('data'), dict) and 'result' in _d['data'] else _d
N = len(H)
W = 1145  # index 1145 => round #1146
print(f"TOTAL n={N} (pass170 ended 1145; persistence {'OK +' + str(N-1145) if N > 1145 else 'NO GROWTH'})")
ptext = open('/home/z/my-project/scripts/data/pass171_panel.txt').read()
print(f"PANEL: OFF={'SHADOW OFF' in ptext or 'No validation' in ptext}, NoVal idx={ptext.find('No validation')}")

def gid(i): return i + 1
def top(r):
    p = r.get('prediction') or [{}]
    return (p[0].get('game') or {}).get('name', '?')
def ts(r):
    return datetime.datetime.fromtimestamp(r['time']/1000).strftime('%H:%M:%S')

latest_age = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
print(f"latest #{gid(N-1)} at {ts(H[-1])} ({latest_age:.0f}s fresh)")

print(f"\n== NEW ROUNDS #1146-#{gid(N-1)} ==")
for i in range(W, N):
    r = H[i]
    ex = 'EXACT-top' if r.get('hit') and top(r) == r['actualResult']['name'] else ''
    rec = 'RECAL' if r.get('recalibrated') else ''
    print(f"#{gid(i):3d} {ts(r)} top={top(r):<10s} conf={r.get('confidence'):>3} actual={r['actualResult']['name']:<10s} hit={str(r['hit']):<5s} {ex} {rec}")

gaps = [((H[i]['time']-H[i-1]['time'])/1000, gid(i-1), gid(i)) for i in range(1, N)]
tail = [(g,a,b) for g,a,b in gaps if b >= 1146]
stall7 = [(g,a,b) for g,a,b in tail if g > 400]
clean = [(g,a,b) for g,a,b in tail if g <= 400]
if stall7:
    for g,a,b in stall7:
        rank = len([x for x,_,_ in gaps if x > g]) + 1
        verdict = f"era #{rank} closed gap" if rank <= 8 else "outside top-8"
        rec = " (NEW ERA RECORD)" if g > 2635 else ""
        print(f"\nSTALL-CLASS GAP CLOSED: {g:.1f}s (# {a}->{b}) — {verdict}{rec}")
era = sorted([(g,a,b) for g,a,b in gaps if g > 100], reverse=True)[:8]
nmin = len([g for g,_,_ in gaps if g>100])
print(f"era >100s count: {nmin} (was 43; {'44TH MINOR = the stall itself' if nmin==44 else 'check'}), top-8: {[(round(g),f'#{a}->#{b}') for g,a,b in era]}")
if clean:
    print(f"FEED window (excl stall): avg {sum(g for g,_,_ in clean)/len(clean):.1f}s, max {max(clean)[0]:.0f}s; minors>100s excl stall: {sum(1 for g,_,_ in clean if g>100)}")
burst = [r for r in H[W:]]
if burst and stall7:
    t0 = stall7[0][0]
    span = (H[-1]['time'] - H[W-1+1-1]['time'])/1000
    print(f"post-stall burst: {len(burst)} rounds; first gap after stall close: ", end='')
    post = [(g,a,b) for g,a,b in tail if a == stall7[0][2]]
    print(f"{post[0][0]:.0f}s (# {post[0][1]}->{post[0][2]})" if post else "n/a")

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
    print(f"window rate (#1146+): {winh}/{len(win)} = {winh/len(win)*100:.1f}%")
else:
    print("window rate (#1146+): EMPTY — stall #11 possibly STILL OPEN")
    open_gap = (datetime.datetime.now().timestamp()*1000 - H[-1]['time'])/1000
    print(f"OPEN GAP at probe: {open_gap:.0f}s (#1145 -> pending)")

print("\nSEGMENTS:")
seg = {}
for i, r in enumerate(H):
    name = r['actualResult']['name']
    s = seg.setdefault(name, {'n':0,'h':0,'last_hit':None,'last_any':None})
    s['n'] += 1; s['last_any'] = gid(i)
    if r['hit']: s['h'] += 1; s['last_hit'] = gid(i)
for name, s in sorted(seg.items(), key=lambda kv: -kv[1]['n']):
    print(f"  {name:<12s} {s['h']:>3}/{s['n']:>3} = {s['h']/s['n']*100:5.1f}%  quiet {N-s['last_any']:>3}  (last hit #{s['last_hit']})")

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

rw = [gid(i) for i,r in enumerate(H) if r.get('recalibrated') and gid(i) >= 1146]
exw = [(gid(i), top(r), r['actualResult']['name'], r.get('confidence')) for i,r in enumerate(H) if i>=W and r['hit'] and top(r)==r['actualResult']['name']]
print(f"\nrecal in-window ({len(rw)}): {rw}")
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
print(f"exact-tops in-window ({len(exw)}): {exw}")
print(f"conf seq #1146+: {[(gid(i), H[i]['confidence']) for i in range(W,N)]}")
conf_floor = min(r.get('confidence',100) for r in H)
conf_max = max(r.get('confidence',0) for r in H)
print(f"era conf floor: {conf_floor} | era conf ceiling: {conf_max}")

s2 = seg.get('2', {'n':0,'h':0})
print(f"'2' census: {s2['h']}/{s2['n']} = {s2['h']/s2['n']*100:.1f}%" if s2['n'] else "'2' absent")
s1 = seg.get('1', {'n':0,'h':0})
print(f"'1' census: {s1['h']}/{s1['n']} = {s1['h']/s1['n']*100:.1f}%")
sp = seg.get('PACHINKO', {'n':0,'h':0})
print(f"PACHINKO census: {sp['h']}/{sp['n']} = {sp['h']/sp['n']*100:.1f}%" if sp['n'] else "PACHINKO absent")
sc = seg.get('COIN FLIP', {'n':0,'h':0})
print(f"COIN FLIP census: {sc['h']}/{sc['n']} = {sc['h']/sc['n']*100:.1f}%" if sc['n'] else "COIN FLIP absent")

for tgt in ('PACHINKO','COIN FLIP','CASH HUNT','CRAZY TIME','5','10'):
    wr = [(gid(i), top(r), r['hit'], r.get('confidence')) for i,r in enumerate(H) if i>=W and r['actualResult']['name']==tgt]
    if wr: print(f"{tgt} in-window: {wr}")

E = json.load(open('/home/z/my-project/scripts/data/pass171_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text','')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text','')]
print(f"\nERRORS: total {len(errs)}, loadCritical-bearing {len(lc)}, uncaught-promise family {len(fam)}")
KEYS = json.load(open('/home/z/my-project/scripts/data/pass171_keys.json'))
_kr = KEYS['data']['result'] if isinstance(KEYS.get('data'), dict) and 'result' in KEYS['data'] else str(KEYS)
print(f"KEYS: {_kr}")
try:
    sig = json.loads(json.load(open('/home/z/my-project/scripts/data/pass171_sig.json'))['data']['result'])
    st = datetime.datetime.fromtimestamp(sig[0]['time']/1000).strftime('%H:%M:%S')
    print(f"SIGNALS: updated {st}, top={sig[0]['game']['name']} conf={sig[0]['confidence']}, ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")
