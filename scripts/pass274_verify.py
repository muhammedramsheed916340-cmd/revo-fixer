#!/usr/bin/env python3
# Pass 274 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass274_state.py (regex where state used find, independent loops, cross-source
# cross-checks). Verify-before-write convention.
import json, re, datetime, subprocess
from collections import Counter

tz = datetime.timezone(datetime.timedelta(hours=8))
def stamp(ms): return datetime.datetime.fromtimestamp(ms/1000, tz)
P = []
def chk(name, cond, detail=""):
    P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

def raw(f): return json.load(open('scripts/data/'+f))
def res(f):
    d = raw(f)['data']['result']
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: pass
    return d

BONUS = {'COIN FLIP','PACHINKO','CRAZY TIME','CASH HUNT'}

print("== 1. ERA-3 CENSUS ==")
h = res('pass274_history.json')
meta = res('pass274_meta.json')
n = len(h)
chk("n == 17", n == 17, f"n={n}")
chk("meta n was 16 (+1 landed during probe)", meta['n'] == 16, f"meta.n={meta['n']}")
chk("meta ts == 22:38:25.013", stamp(meta['ts']).strftime('%H:%M:%S.%f')[:-3] == '22:38:25.013', stamp(meta['ts']).isoformat())
hits = sum(1 for r in h if r['hit'] is True)
chk("census 15/17 = 88.24%", hits == 15 and abs(hits/n*100 - 88.235) < 0.01, f"{hits}/17 = {hits/n*100:.2f}%")
chk("ceil(0.65*17)=12 -> surplus +3", -(-65*n//100) == 12 and hits-12 == 3)
chk("ceil(0.60*17)=11 -> surplus +4", -(-60*n//100) == 11 and hits-11 == 4)
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("exact 5 (top-1 == actual among hits)", sum(1 for r in h if r['hit'] and top(r)==act(r)) == 5)
chk("recal 2", sum(1 for r in h if r.get('recalibrated')) == 2)
chk("bonus actuals 2", sum(1 for r in h if act(r) in BONUS) == 2)
comp = Counter(act(r) for r in h)
chk("composition {'5':8,'1':4,'2':3,'COIN FLIP':2}", comp == Counter({'5':8,'1':4,'2':3,'COIN FLIP':2}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. OPENING H-RUN 10 + EXACT RUNS ==")
first10 = all(r['hit'] for r in h[:10])
chk("E3#1-#10 ten consecutive HIT to open the era", first10)
chk("E3#11 is the first MISS (COIN FLIP)", (not h[10]['hit']) and act(h[10]) == 'COIN FLIP')
ex456 = all(h[j]['hit'] and top(h[j])=='5' and act(h[j])=='5' for j in (3,4,5))
chk("E3#4-#6 three consecutive EXACT '5'", ex456)
chk("E3#10 + E3#15 exact '5'", top(h[9])=='5' and act(h[9])=='5' and top(h[14])=='5' and act(h[14])=='5')
live_run = 0
for r in reversed(h):
    if r['hit']: live_run += 1
    else: break
chk("live H-run == 1 (only #17 after #16 miss)", live_run == 1)

print("== 3. CADENCE ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285', stamp(ts[0]).isoformat())
chk("16 intervals, min 6.0s", len(gaps)==16 and abs(min(gaps)-6.0)<0.1, f"min={min(gaps):.1f}")
chk("max 61.4s (no stall-class >= 90s)", abs(max(gaps)-61.4)<0.1 and max(gaps) < 90.0, f"max={max(gaps):.1f}")
chk("avg 38.1s", abs(sum(gaps)/len(gaps)-38.1) < 0.15, f"avg={sum(gaps)/len(gaps):.1f}")
chk("min gap is #15->#16 (5.9s fast round)", gaps.index(min(gaps)) == 14, f"idx={gaps.index(min(gaps))}")

print("== 4. CONF PATH 24->40->55 ==")
confs = [r['confidence'] for r in h]
chk("conf path == [24]x5+[40]x5+[55]x7", confs == [24]*5+[40]*5+[55]*7, str(confs))
chk("conf monotone steps at #6 and #11 (never decreases)", confs == sorted(confs))

print("== 5. RECAL-ON-MISS MECHANISM ==")
chk("misses exactly at #11 and #16", [i+1 for i,r in enumerate(h) if not r['hit']] == [11,16])
chk("recal flags exactly at #12 and #17 (the round after each miss)", [i+1 for i,r in enumerate(h) if r.get('recalibrated')] == [12,17])
chk("#12 HIT on recal (COIN FLIP rank-2 rescue)", h[11]['hit'] and act(h[11])=='COIN FLIP' and 'COIN FLIP' in [p['game']['name'] for p in h[11]['prediction']])

print("== 6. SIGNALS / BENCH ==")
s = res('pass274_signals.json')
order = [x['game']['name'] for x in s]
chk("bench order [COIN FLIP, 1, PACHINKO, CASH HUNT]", order == ['COIN FLIP','1','PACHINKO','CASH HUNT'], str(order))
chk("uniform conf 55 across all 4", set(x['confidence'] for x in s) == {55})
chk("3 of 4 bench entries are bonus games", sum(1 for x in s if x['game'].get('isBonus')) == 3)
chk("rank labels strongest/second/third/fourth", [x['label'] for x in s] == ['strongest evidence','second strongest','third strongest','fourth strongest'])
chk("COIN FLIP range [68,89]", s[0]['game']['confidenceRange'] == [68,89])

print("== 7. PANEL ==")
t = res('pass274_panel_live.json')
chk("panel 32,799 chars (±2 tolerance)", abs(len(t)-32799) <= 2, str(len(t)))
chk("Shadow OFF banner PRESENT", 'Shadow A/B is OFF' in t)
missing = [k for k in ['paired rounds','MISS→HIT','HIT→MISS','MISS RCA'] if k in t]
chk("shadow metric labels ABSENT (paired/flip/RCA)", missing == [], str(missing))
m8 = re.search(r'REPLAY LIVE ROUNDS \((\d+)\)', t)
chk("REPLAY LIVE ROUNDS (17)", m8 and m8.group(1) == '17')
mv = re.search(r'VALIDATION CRITERIA \|? Next actual result must match one of \[([^\]]+)\]', t.replace('\n',' | '))
valset = set(x.strip() for x in mv.group(1).split(',')) if mv else set()
chk("VALIDATION set-equal to bench", valset == set(order), str(valset))
tf = t.replace('\n',' | ')
ml = re.search(r'N=(\d+)/100 \|? \d+ \|? TOTAL PREDICTIONS \|? (\d+) \|? HIT \|? (\d+) \|? MISS \|? (\d+)% \|? HIT RATE', tf)
chk("LEDGER N=17 15H 2M 88%", ml and (ml.group(1),ml.group(2),ml.group(3),ml.group(4))==('17','15','2','88'), ml.groups() if ml else 'no match')
chk("LAST 5 = 80%", re.search(r'LAST 5 \|? 80% \|? n=5', t.replace('\n',' | ')) is not None)
chk("LAST 10 = 80%", re.search(r'LAST 10 \|? 80% \|? n=10', t.replace('\n',' | ')) is not None)
chk("NORMAL 93% n=15 / BONUS 50% n=2", re.search(r'NORMAL RESULTS \|? 93% \|? n=15', t.replace('\n',' | ')) and re.search(r'BONUS RESULTS \|? 50% \|? n=2', t.replace('\n',' | ')))
chk("PATTERN SHIFT DETECTED lit (TVD=1.20 > 0.60)", 'PATTERN SHIFT DETECTED' in t and 'TVD=1.20 > 0.60' in t)
chk("MISS STREAK absent", 'MISS STREAK' not in t)
chk("ARCHIVE lazy section ABSENT (4th probe cycle)", 'ARCHIVE' not in t)
chk("banner N=17 88/12/74/68/88/12/55/80", re.search(r'HIT STREAK \|? N=17 \|? 88% \|? HIT RATE \|? 12% \|? MISS RATE \|? 74% \|? COVERAGE \|? 68% \|? STABILITY \|? 88% \|? LONG-TERM \|? 12% \|? EXCLUDED RATE \|? 55% \|? ADAPTIVE WT \|? 80% \|? RECENT', t.replace('\n',' | ')) is not None)
chk("Trend ↓ 10.6 / Clusters 4 / TPC 74.1", re.search(r'Trend \|? ↓ 10\.6% \|? Clusters \|? 4 \|? Total Prediction Coverage \|? 74\.1%', tf) is not None)
chk("BONUS RISK 63.0/11.1/5.5/0.0/10.6", re.search(r'NORMAL COVERAGE \|? 63\.0% \|? BONUS COVERAGE \|? 11\.1% \|? BONUS RISK \|? 5\.5% \|? Bonus Recent \|? 0\.0% \|? Bonus Long-Term \|? 10\.6%', t.replace('\n',' | ')) is not None)
chk("AI: 30 spins, entropy 70, hottest 5, overdue COIN FLIP, vol 36, streak 5x4", re.search(r'30 spins analyzed • Entropy 70% • Hottest: 5 • Overdue: COIN FLIP • Volatility 36/100 • Longest streak: 5 ×4', t) is not None)
chk("EVENT DEBUG 2 events", '2 events logged' in t)
chk("PERF DEBUG n=2, SRC→APP 2.2s, stale:0 dup:0", re.search(r'n=2 \|? SRC→APP \(NOW\) \|? 2\.2s', t.replace('\n',' | ')) is not None and 'stale:0 dup:0' in t)
chk("platform counters 1,249/94%/128/1.2k (REWIND held 3rd pass)", re.search(r'1,249 \|? TOTAL \|? 94% \|? ACCURACY \|? 128 \|? BONUS \|? 1\.2k \|? LIVE', t.replace('\n',' | ')) is not None)
chk("LOCKED • 14:38 MODERATE COIN FLIP", re.search(r'LOCKED \|? • 14:38', t.replace('\n',' | ')) is not None and 'MODERATE | COIN FLIP' in t.replace('\n',' | '))
ih = t.find('ROUND HISTORY')
topcard = t[ih:ih+400]
chk("ROUND HISTORY top card = #17 HIT pred [CF,1,2,PK] actual '1' 02:38 pm RECALIBRATED conf 55%", ('HIT' in topcard and 'ACTUAL: | 1 | 02:38 pm' in topcard.replace('\n',' | ') and 'RECALIBRATED' in topcard), topcard[:120].replace('\n',' | '))
# list-order cross-check: the LAST card (immediately before the 1,249 counters) must be E3#1
i17 = t.find('1,249')
lastcard = t[max(0,i17-400):i17]
chk("list bottom card = E3#1 (pred [10,5,1,2] actual '2' conf 24%) — newest-first order confirmed", ('10 | 5 | 1 | 2' in lastcard.replace('\n',' | ') or 'ACTUAL: | 2 | 02:28 pm' in lastcard.replace('\n',' | ')), lastcard[:120].replace('\n',' | '))

print("== 8. CONSOLE RING ==")
con = raw('pass274_errors.json').get('data', {})
msgs = con.get('messages', [])
types = Counter(m.get('type','?') for m in msgs)
fr = sum(1 for m in msgs if '[Fast Refresh]' in json.dumps(m.get('args',[])))
errs = sum(1 for m in msgs if m.get('type') in ('error','warning'))
chk("ring == 1000 messages (at cap)", len(msgs) == 1000, str(len(msgs)))
chk("999 log + 1 info, 0 error/warning", types.get('log')==999 and types.get('info')==1 and errs==0, str(dict(types)))
chk("[Fast Refresh] = 20 (recompile storm continues)", fr == 20, str(fr))

print("== 9. CROSS-CHECKS (event debug vs history) ==")
ev = re.search(r'17\s+\|?\s*1\s+\|?\s*\[COIN FLIP,1,2,PACHINKO\]\s+\|?\s*HIT\s+\|?\s*16\s+\|?\s*17\s+\|?\s*\[COIN FLIP,1,PACHINKO,CASH HUNT\]', t.replace('\n',' | '))
chk("EVENT DEBUG row #17 matches history (actual 1, HIT, 16->17, new pred)", ev is not None)
chk("history #17 pred [COIN FLIP,1,2,PACHINKO]", [p['game']['name'] for p in h[16]['prediction']] == ['COIN FLIP','1','2','PACHINKO'], str([p['game']['name'] for p in h[16]['prediction']]))
chk("history #11 pred contains PACHINKO+CASH HUNT (bonus entries were in play)", {'PACHINKO','CASH HUNT'} <= {p['game']['name'] for p in h[10]['prediction']})

print("== 10. GIT ZERO-DRIFT + CHAIN ==")
last_src = subprocess.run(['git','log','-1','--format=%H','--','src/'], capture_output=True, text=True).stdout.strip()
diff = subprocess.run(['git','diff',last_src,'--','src/'], capture_output=True, text=True).stdout
chk(f"git diff {last_src[:7]} -- src/ == 0", diff == '', f"({len(diff)} bytes)")
nblocks = subprocess.run(['rg','-c','^---$','worklog.md'], capture_output=True, text=True).stdout.strip()
chk("worklog blocks == 230 pre-append (chain top P273)", nblocks == '230', nblocks)
topline = subprocess.run(['rg','-n','^## Pass 273','worklog.md'], capture_output=True, text=True).stdout
chk("chain top block is Pass 273", topline.strip() != '')

print("== 11. INCIDENT EVIDENCE (probe files) ==")
import os
for f in ['pass274_open.json','pass274_meta.json','pass274_history.json','pass274_signals.json','pass274_panel_live.json','pass274_errors.json','pass274_page.json']:
    chk(f"{f} exists non-empty", os.path.getsize('scripts/data/'+f) > 100)
op = raw('pass274_open.json')['data']['lifecycle']
chk("open reused:true (era-3 browser alive, no relaunch)", op.get('reused') is True and op.get('launched') is False, str({k:op.get(k) for k in ('reused','launched')}))

print(f"\n==== VERIFY SUMMARY: {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
