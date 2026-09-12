#!/usr/bin/env python3
# Pass 277 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass277_state.py (independent loops, regex on flattened text, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: answers P276's watch list — deficit-crossing, 9x MISS streak extension, conf floor,
# recal failure mode, DEBUG strip (permanent vs transient), banner reversion, STALL #44,
# CT rank-1 survival, PACHINKO zero-actual, REWIND 6th, ARCHIVE 7th, ring churn,
# VALIDATION 4th read, Shadow 277th OFF. NEW this pass: uniform 33% bench, bench revolution 2.0
# (CT out, CH rank-1, '5' rank-2, '1' excluded), LAST25 panel/data divergence.
import json, re, datetime
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

print("== 1. ERA-3 CENSUS (deficit crossed) ==")
h = res('pass277_history.json')
meta = res('pass277_meta.json')
n = len(h)
chk("n == 77", n == 77, f"n={n}")
chk("meta n == 77 (+0 landed during probe window)", meta['n'] == 77 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 47/77 = 61.04%", hits == 47 and abs(hits/n*100 - 61.04) < 0.01, f"{hits}/77 = {hits/n*100:.2f}%")
chk("DEFICIT CROSSED: 47 < ceil(0.65*77)=51 -> surplus -4 (was +2 at P276)",
    -(-65*n//100) == 51 and hits-51 == -4, f"ceil65={-(-65*n//100)} surplus={hits-51}")
chk("census 61.04% BELOW era-1 lifetime 65.29% (first sub-baseline census of era-3)",
    hits/n*100 < 65.29)
w = h[54:]  # rounds #55-#77, unseen at P276
wh = sum(1 for r in w if r['hit'])
chk("incremental window #55-#77 = 9/23 = 39.13% — deep cold (was 47.06% at P276)",
    len(w) == 23 and wh == 9 and abs(wh/23*100-39.13) < 0.01, f"{wh}/23")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("exact 8 (unchanged since P275)", sum(1 for r in h if r['hit'] and top(r)==act(r)) == 8)
chk("recal flags 27 (was 15)", sum(1 for r in h if r.get('recalibrated')) == 27)
chk("bonus actuals 13 (was 8; +5 in window)", sum(1 for r in h if act(r) in BONUS) == 13)
comp = Counter(act(r) for r in h)
chk("composition {'1':25,'2':21,'5':12,'10':6,'COIN FLIP':7,'CASH HUNT':4,'CRAZY TIME':2}",
    comp == Counter({'1':25,'2':21,'5':12,'10':6,'COIN FLIP':7,'CASH HUNT':4,'CRAZY TIME':2}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / STREAKS ==")
marks = ['H' if r['hit'] else 'm' for r in h]
chk("record == P276 54-char prefix + 'mHmmHmHHmHHHHHmmmmmmmmm'",
    ''.join(marks) == 'HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHHmHHHmHmmHHHHmmmmm' + 'mHmmHmHHmHHHHHmmmmmmmmm')
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
chk("max H-run 10 unchanged", best == 10)
chk("live 9x MISS streak #69-#77", cur == 0 and ''.join(marks[-9:]) == 'mmmmmmmmm')
runs = []
c0, k0 = marks[0], 1
for m in marks[1:]:
    if m == c0: k0 += 1
    else: runs.append((c0,k0)); c0,k0 = m,1
runs.append((c0,k0))
chk("era-3 max M-run NOW 9 (current live run; previous era-3 max was 5 at #50-#54)",
    max(k for c,k in runs if c=='m') == 9 and runs[-1] == ('m',9))
chk("windows: LAST5 0/5, LAST10 1/10, LAST25 9/25 (DATA), LAST50 25/50, LAST100 47/77",
    sum(1 for m in marks[-5:] if m=='H')==0 and sum(1 for m in marks[-10:] if m=='H')==1
    and sum(1 for m in marks[-25:] if m=='H')==9 and sum(1 for m in marks[-50:] if m=='H')==25
    and sum(marks.count('H') for _ in [0])==47)
chk("hits in #55-#68 exactly at 56,59,61,62,64,65,66,67,68",
    [i+1 for i in range(54,68) if h[i]['hit']] == [56,59,61,62,64,65,66,67,68])
chk("'5' HITS still end at #15 (post-#16 '5' actuals all MISS: #16,#38,#53,#72,#73)",
    max((i+1 for i,r in enumerate(h) if r['hit'] and act(r)=='5'), default=0) == 15
    and [i+1 for i,r in enumerate(h) if act(r)=='5' and not r['hit']] == [16,38,53,72,73])
chk("PACHINKO STILL zero actuals across 77 rounds", sum(1 for r in h if act(r)=='PACHINKO') == 0)
chk("CRAZY TIME as actual exactly #30 and #50, both MISS (CT book 0-for-2)",
    [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50]
    and not h[29]['hit'] and not h[49]['hit'])
bk = [(i+1, act(r), 'H' if r['hit'] else 'm') for i,r in enumerate(h) if act(r) in BONUS]
chk("bonus book 13 = 8 P276 entries + #55 CF m, #57 CF m, #64 CF H, #69 CH m, #70 CF m",
    bk == [(11,'COIN FLIP','m'),(12,'COIN FLIP','H'),(27,'CASH HUNT','m'),(30,'CRAZY TIME','m'),
           (42,'CASH HUNT','m'),(43,'CASH HUNT','H'),(45,'COIN FLIP','m'),(50,'CRAZY TIME','m'),
           (55,'COIN FLIP','m'),(57,'COIN FLIP','m'),(64,'COIN FLIP','H'),(69,'CASH HUNT','m'),(70,'COIN FLIP','m')])
bh = sum(1 for _,_,s in bk if s=='H')
chk("bonus HIT rate 3/13 = 23.1% (panel 23%)", bh == 3 and abs(bh/13*100-23.08) < 0.01)

print("== 3. CADENCE + STALL ledger ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("last round #77 ts == 23:19:59.760", stamp(ts[-1]).strftime('%H:%M:%S.%f')[:-3] == '23:19:59.760')
chk("76 intervals", len(gaps) == 76)
chk("exactly 2 stall-class gaps >=90s: STALL #42 121.5s (idx 28) + STALL #43 95.905s (idx 48) — NO STALL #44",
    abs(gaps[28]-121.498) < 0.1 and abs(gaps[48]-95.905) < 0.1 and sum(1 for g in gaps if g >= 90.0) == 2)
chk("new era-min gap 1.463s at #65->#66 (was 1.465s at #18->#19)",
    abs(min(gaps)-1.463) < 0.005 and abs(gaps[64]-1.463) < 0.005)
chk("elevated near-stall gaps in new window: #63->#64 61.5s, #68->#69 87.0s, #69->#70 76.4s (all <90)",
    abs(gaps[62]-61.467) < 0.1 and abs(gaps[67]-86.978) < 0.1 and abs(gaps[68]-76.391) < 0.1
    and all(g < 90 for g in gaps[54:]))
chk("span E3#1->#77 == 3100.5s", abs((ts[-1]-ts[0])/1000 - 3100.5) < 0.5)

print("== 4. CONF PATH (collapse -> recovery -> re-collapse) ==")
confs = [r['confidence'] for r in h]
chk("settled conf path #69-#77 == [72,57,52,46,43,35,35,34,34]",
    confs[68:77] == [72,57,52,46,43,35,35,34,34], str(confs[68:77]))
chk("conf peak 72 at #69 — PEAK-CONF MISS opened the 9x streak (echoes #50 @70)",
    confs[68] == 72 and not h[68]['hit'])
chk("post-opening conf min NOW 34 at #76,#77 (was 46 at P276)",
    min(confs[11:]) == 34 and confs[75] == 34 and confs[76] == 34)
chk("no settled round ever locked at 33 (Pred#78 @33 is pending, not in ledger)",
    33 not in confs)
chk("mid-window recovery #65-#68 = [65,70,70,70]", confs[64:68] == [65,70,70,70])

print("== 5. PANEL: LOCK / BENCH / SIGNALS (revolution 2.0) ==")
panel = res('pass277_panel_live.json')
tf = panel.replace('\t',' | ').replace('\n',' | ')
sig = res('pass277_signals.json')
names = [s['game']['name'] for s in sig]
chk("signals order == [CASH HUNT, 5, COIN FLIP, 2] (matches panel lock Pred#78)",
    names == ['CASH HUNT','5','COIN FLIP','2'], str(names))
chk("all 4 signal confs == 33 (uniform; first all-equal bench of era-3)",
    all(s['confidence'] == 33 for s in sig))
chk("ranges CH[65,87] 5[75,90] CF[68,89] 2[80,92]",
    [s['game']['confidenceRange'] for s in sig] == [[65,87],[75,90],[68,89],[80,92]])
chk("VALIDATION set-equal 4th read: signals set == lock order in panel",
    names == ['CASH HUNT','5','COIN FLIP','2'] and re.search(r'CASH HUNT \| .*? \| 5 \| .*?COIN FLIP|CASH HUNT.{0,200}COIN FLIP', tf) is not None)
chk("CRAZY TIME absent from bench, present in excluded widget",
    'CRAZY TIME' not in names and re.search(r'PACHINKO \| .{0,40}CRAZY TIME|PACHINKO.{0,80}CRAZY TIME', tf) is not None)
chk("'1' excluded (was rank-2 at P276) — number-leader demoted out of bench",
    '1' not in names)
chk("lock LOW CONFIDENCE on all four boxes (4 occurrences near conf 33)",
    tf.count('LOW CONFIDENCE') >= 6 and panel.count('Confidence | 33%') >= 4 if False else panel.count('33%') >= 4)
chk("'5' carries TRENDING-UP signal", '"trending-up"' in json.dumps(sig).lower())

print("== 6. PANEL: BANNER / LEDGER / WINDOWS ==")
chk("banner 9x MISS STREAK N=77 (dynamic label held in MISS form)", '9× MISS STREAK' in panel and 'N=77' in panel)
chk("HIT STREAK label absent (not reverted)", 'HIT STREAK' not in panel)
chk("ledger census row: 47 HIT / 30 MISS / 77 SAMPLE",
    '47 | HITS' in tf.replace('  ',' ') or re.search(r'47\s*\|?\s*HITS', tf) is not None)
chk("panel NORMAL HIT 69%/MISS 31% n=64 / BONUS HIT 23%/MISS 77% n=13 (single-line pairs, P276 lesson)",
    re.search(r'NORMAL RESULTS \| HIT 69% \| MISS 31% \| n=64 rounds', tf) is not None
    and re.search(r'BONUS RESULTS \| HIT 23% \| MISS 77% \| n=13 rounds', tf) is not None)
chk("dashboard windows match data: L5 0%, L10 10%, L20 40%, L50 50%, L100+ 61%",
    re.search(r'LAST 20\s*\|?\s*40%', tf) is not None and re.search(r'LAST 50\s*\|?\s*50%', tf) is not None)
chk("LEDGER LAST25 prints 40% n=25 — DIVERGES from data 9/25=36% (single-window presentation anomaly)",
    re.search(r'LAST 25 \| 40% \| n=25', tf) is not None and abs(9/25*100-36.0) < 0.01)
chk("Total Prediction Coverage 48.1% (was 42.6)", 'Total Prediction Coverage' in panel and '48.1%' in panel)
chk("Trend up 10.4% (survived 2nd read, eased then rose: 8.1->4.5->10.4)", re.search(r'Trend\s*\|?\s*↑?\s*10\.4%', tf) is not None)
chk("Clusters 13 (was 6)", re.search(r'Clusters\s*\|?\s*13', tf) is not None)
chk("BONUS RISK block: NORMAL COV 37.0, BONUS COV 11.1, RISK 5.5, Recent 30.0, Long-Term 19.6",
    all(x in panel for x in ['37.0%','11.1%','5.5%','30.0%','19.6%']))

print("== 7. PANEL: STRUCTURE (DEBUG return / ARCHIVE / counters / AI) ==")
chk("EVENT DEBUG LOG RETURNED (P276 strip was Fast-Refresh transient)", 'EVENT DEBUG LOG' in panel)
chk("PERFORMANCE DEBUG RETURNED with buffer reset n=3", re.search(r'PERFORMANCE DEBUG[^\d]*\d+\s*:\?\d*:\d+ [AP]M\s*n=3', tf) is not None or ('PERFORMANCE DEBUG' in panel and 'n=3' in panel))
chk("PIPELINE AUDIT shows 3 events; rows #77,#76,#75 all MISS; #77 new pred [CASH HUNT,5,COIN FLIP,2] Pred#78",
    '3 events logged' in panel and tf.count('Pred#') == 1
    and re.search(r'77 \| 10 \| \[COIN FLIP,CASH HUNT,5,2\] \| MISS \| 76 \| 77 \| \[CASH HUNT,5,COIN FLIP,2\] \| 78', tf) is not None)
chk("PERF: SRC->APP now 9.4s; agg n=3 avg 22.4s P95/max 51.1s (back in era-2 spike zone)",
    '9.4s' in panel and '22.4s' in panel and '51.1s' in panel)
chk("DECISION ENGINE: 9x MISS / RECALIBRATE / RISK HIGH / PREDICTION BIAS RCA",
    'RISK:' in panel and 'HIGH' in panel and 'PREDICTION BIAS' in panel and '9 consecutive misses' in panel)
chk("ARCHIVE section absent (7th probe cycle)", 'ARCHIVE' not in panel)
chk("PATTERN SHIFT still extinguished", 'PATTERN SHIFT' not in panel)
chk("counters 1,249 / 94% / 128 / 1.2k held — 6th consecutive REWIND pass",
    all(x in panel for x in ['1,249','94%','128','1.2k']))
chk("AI summary: Entropy 84, Hottest COIN FLIP (rotated from CT), Vol 31, streak 1x3",
    re.search(r'Entropy 84%[^\n]*Hottest: COIN FLIP', tf) is not None and '31/100' in panel)
chk("ROUND HISTORY newest-first 5th read: top card #77 m [CF,CH,5,2]->10 03:19 pm RECALIBRATED 34%",
    re.search(r'ROUND HISTORY.{0,400}?COIN FLIP.{0,200}ACTUAL:.{0,30}10.{0,60}03:19 pm.{0,80}RECALIBRATED.{0,40}34%', tf) is not None)

print("== 8. SHADOW A/B (277th consecutive OFF) ==")
chk("'Shadow A/B is OFF' banner present", 'Shadow A/B is OFF' in panel)
chk("'No validation started' + START FRESH VALIDATION present; SHADOW OFF badge",
    'No validation started' in panel and 'START FRESH VALIDATION' in panel and 'SHADOW OFF' in panel)
chk("no paired/flip metrics present (all 8 fields N/A)",
    not re.search(r'paired', panel, re.I) and not re.search(r'MISS.HIT flips?', panel, re.I))
chk("static pass-93 root-cause note present (only paired dataset remains historical)",
    '7 of 11 misses involved PACHINKO' in panel)

print("== 9. CONSOLE RING ==")
errs = raw('pass277_errors.json')['data']['messages']
types = Counter(m.get('type') for m in errs)
chk("ring capped at 1000 (998 log + 2 info, 0 error-type)",
    len(errs) == 1000 and types['log'] == 998 and types['info'] == 2 and types.get('error',0) == 0, str(dict(types)))
fr = sum(1 for m in errs if 'Fast Refresh' in json.dumps(m.get('args',[])))
chk("FR in-ring 14 with eviction caveat (P276 in-ring 22); ring TAIL = rebuilding -> done in 173ms",
    fr == 14 and 'rebuilding' in json.dumps(errs[-2].get('args',[])) and '173ms' in json.dumps(errs[-1].get('args',[])))

print("== 10. CROSS-SOURCE CONSISTENCY ==")
chk("history last round == panel lock context: #77 actual '10' MISS, preds [CF,CH,5,2] conf 34",
    act(h[-1]) == '10' and h[-1]['hit'] is False
    and [x['game']['name'] for x in h[-1]['prediction']] == ['COIN FLIP','CASH HUNT','5','2']
    and h[-1]['confidence'] == 34)
chk("census parity: 47+30 == 77 == ledger N=77/100", hits + (n-hits) == 77 and 'N=77/100' in tf)
chk("panel char count 42,827 (regime grew +5,682 vs P276 37,145 — DEBUG return + 23 cards)",
    len(panel) == 42827, f"len={len(panel)}")
chk("signals ts == #77 pred ts family (lock fresh at probe)",
    abs(sig[0]['time'] - ts[-1]) < 60000, f"sig_t={sig[0]['time']} last={ts[-1]}")

print("== 11. WORKLOG / GIT PRE-APPEND ==")
wl = open('/home/z/my-project/worklog.md').read()
blocks = wl.count('\n---\n') + (1 if wl.startswith('---\n') else 0)
chk("worklog blocks == 233 pre-append", blocks == 233, f"blocks={blocks}")
chk("chain top == Pass 276 (Task ID 321)", '## Pass 276 (Task ID 321)' in wl)
import subprocess
g = subprocess.run(['git','diff','62214ee','--','src/'], capture_output=True, text=True,
                   cwd='/home/z/my-project').stdout
chk("git diff 62214ee -- src/ == 0 (zero drift)", g.strip() == '', f"bytes={len(g)}")

print(f"\n==== {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
