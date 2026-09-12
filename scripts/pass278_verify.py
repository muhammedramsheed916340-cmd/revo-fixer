#!/usr/bin/env python3
# Pass 278 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass278_state.py (independent loops, regex on flattened text, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: answers P277's watch list — streak termination, sub-60% watch, uniform-33 settle,
# '1'-exclusion consequence, CH rank-1 audition, recal rescue, STALL #44, LAST25 re-read,
# DEBUG persistence, PERF refill, REWIND 7th, ARCHIVE 8th, VALIDATION 5th, Shadow 278th OFF.
# NEW this pass: PACHINKO first actual (and HIT) at #90, '5' drought broken at #95,
# BENCH revolution 3.0 (PACHINKO rank-1, CH/'2' out, '1' back), MODERATE @54 lock,
# DECISION flip to BET/LOW, PATTERN SHIFT return (TVD 0.66), LAST25←L20 bug confirmation.
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

print("== 1. ERA-3 CENSUS (warm reversal, deficit narrowed) ==")
h = res('pass278_history.json')
meta = res('pass278_meta.json')
n = len(h)
chk("n == 98", n == 98, f"n={n}")
chk("meta n == 98 (+0 landed during probe window)", meta['n'] == 98 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 62/98 = 63.27%", hits == 62 and abs(hits/n*100 - 63.27) < 0.01, f"{hits}/98 = {hits/n*100:.2f}%")
chk("deficit narrowed -4 -> -2 (ceil(0.65*98)=64)", -(-65*n//100) == 64 and hits-64 == -2, f"surplus={hits-64}")
chk("still sub-baseline (63.27 < 65.29 lifetime) but recovering", hits/n*100 < 65.29)
w = h[77:]  # rounds #78-#98, unseen at P277
wh = sum(1 for r in w if r['hit'])
chk("incremental window #78-#98 = 15/21 = 71.43% — ABOVE 65% base (warm reversal)",
    len(w) == 21 and wh == 15 and abs(wh/21*100-71.43) < 0.01, f"{wh}/21")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("recal flags 33 (was 27)", sum(1 for r in h if r.get('recalibrated')) == 33)
chk("bonus actuals 15 (was 13; +2 in window)", sum(1 for r in h if act(r) in BONUS) == 15)
comp = Counter(act(r) for r in h)
chk("composition {'1':36,'2':27,'5':14,'10':6,'COIN FLIP':8,'CASH HUNT':4,'CRAZY TIME':2,'PACHINKO':1}",
    comp == Counter({'1':36,'2':27,'5':14,'10':6,'COIN FLIP':8,'CASH HUNT':4,'CRAZY TIME':2,'PACHINKO':1}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / STREAK TERMINATION / MILESTONES ==")
marks = ['H' if r['hit'] else 'm' for r in h]
chk("record == P277 77-char prefix + 'HmmmHHHHHHHmHHHmHHHHm'",
    ''.join(marks) == 'HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHHmHHHmHmmHHHHmmmmm'
                     + 'mHmmHmHHmHHHHHmmmmmmmmm' + 'HmmmHHHHHHHmHHHmHHHHm')
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
chk("max H-run 10 unchanged", best == 10)
chk("9x streak TERMINATED: live M-run == 1 (#98 only)", cur == 0 and marks[-1] == 'm' and marks[-2] == 'H')
chk("windows: LAST5 4/5, LAST10 7/10, LAST20 14/20, LAST25 15/25 (DATA), LAST50 25/50",
    sum(1 for m in marks[-5:] if m=='H')==4 and sum(1 for m in marks[-10:] if m=='H')==7
    and sum(1 for m in marks[-20:] if m=='H')==14 and sum(1 for m in marks[-25:] if m=='H')==15
    and sum(1 for m in marks[-50:] if m=='H')==25)
chk("#78 HIT at conf 33 — uniform-33 bench HIT on first settle (streak breaker + recal rescue)",
    h[77]['hit'] is True and h[77]['confidence'] == 33)
chk("'1'-exclusion consequence FIRED: #79,#80,#81 all '1' actuals, all MISS",
    all(act(h[i]) == '1' and not h[i]['hit'] for i in (78,79,80)))
chk("PACHINKO FIRST ACTUAL in 98 rounds at #90 — and the prediction HIT it (bonus hit #4)",
    [i+1 for i,r in enumerate(h) if act(r)=='PACHINKO'] == [90] and h[89]['hit'] is True)
chk("'5' HIT at #95 — first since #15 (80-round drought broken)",
    h[94]['hit'] is True and act(h[94]) == '5'
    and max(i+1 for i,r in enumerate(h[:94]) if r['hit'] and act(r)=='5') == 15)
chk("CRAZY TIME as actual still exactly #30 and #50, both MISS (book 0-for-2 unchanged)",
    [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50])
bk = [(i+1, act(r), 'H' if r['hit'] else 'm') for i,r in enumerate(h) if act(r) in BONUS]
chk("bonus book 15 = 13 P277 entries + #89 CF m, #90 PACHINKO H",
    bk[-2:] == [(89,'COIN FLIP','m'),(90,'PACHINKO','H')] and len(bk) == 15)
bh = sum(1 for _,_,s in bk if s=='H')
chk("bonus HIT rate 4/15 = 26.7% (panel 27%)", bh == 4 and abs(bh/15*100-26.67) < 0.01)
chk("rank-1 exacts 12 (was 8; +4 in window)",
    sum(1 for r in h if r['hit'] and top(r)==act(r)) == 12
    and sum(1 for i in range(77,98) if h[i]['hit'] and top(h[i])==act(h[i])) == 4)
misses = [i+1 for i,r in enumerate(h) if not r['hit']]
chk("36 misses total; new misses exactly #79,#80,#81,#89,#93,#98",
    len(misses) == 36 and [m for m in misses if m > 77] == [79,80,81,89,93,98])
# rescue pairs: miss round -> next-round HIT
rescued = [i+1 for i in range(n-1) if not h[i]['hit'] and h[i+1]['hit']]
chk("recal rescues 18 (was 14); chain-breakers m#77->H#78, m#81->H#82, m#89->H#90(PACHINKO), m#93->H#94",
    len(rescued) == 18 and all(x in rescued for x in (77,81,89,93)))
chk("rescue rate 18/36 misses = 50.0% (P277: 14/30 = 46.7%)", abs(18/36*100-50.0) < 0.01)

print("== 3. CADENCE + STALL #44 ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("last round #98 ts == 23:33:43.645", stamp(ts[-1]).strftime('%H:%M:%S.%f')[:-3] == '23:33:43.645')
chk("97 intervals", len(gaps) == 97)
chk("STALL #44 = 91.449s at #89->#90 (era-3 ledger now 3: 121.498 / 95.905 / 91.449)",
    abs(gaps[88]-91.449) < 0.1 and sum(1 for g in gaps if g >= 90.0) == 3
    and abs(gaps[28]-121.498) < 0.1 and abs(gaps[48]-95.905) < 0.1)
chk("STALL #44 resolved into #90 PACHINKO HIT — first stall->HIT (and bonus-hit) resolution of the era",
    not h[29]['hit'] and not h[49]['hit'] and h[89]['hit'] is True)
chk("era-min gap 1.463s at #65->#66 unchanged", abs(min(gaps)-1.463) < 0.005 and abs(gaps[64]-1.463) < 0.005)
chk("no other window gap >=60s besides the stall", all(g < 60 for g in gaps[77:] if abs(g-91.449) > 0.1))
chk("span E3#1->#98 == 3924.4s", abs((ts[-1]-ts[0])/1000 - 3924.4) < 0.5)

print("== 4. CONF PATH (33 floor -> recovery to 68 -> 62) ==")
confs = [r['confidence'] for r in h]
chk("settled conf path #79-#98 == [49,40,40,39,54,50,55,60,67,68,68,53,61,66,67,53,61,62,62,62]",
    confs[78:98] == [49,40,40,39,54,50,55,60,67,68,68,53,61,66,67,53,61,62,62,62])
chk("conf 33 settled exactly once (#78) — first-ever 33-settled round, a HIT",
    [i+1 for i,c in enumerate(confs) if c == 33] == [78] and h[77]['hit'] is True)
chk("post-opening conf floor now 33 (was 34)", min(confs[11:]) == 33)
chk("window conf peak 68 at #88,#89", confs[87] == 68 and confs[88] == 68)

print("== 5. PANEL: LOCK / BENCH / SIGNALS (revolution 3.0) ==")
panel = res('pass278_panel_live.json')
tf = panel.replace('\t',' | ').replace('\n',' | ')
sig = res('pass278_signals.json')
names = [s['game']['name'] for s in sig]
chk("signals order == [PACHINKO, 5, COIN FLIP, 1] — PACHINKO FIRST-EVER RANK-1",
    names == ['PACHINKO','5','COIN FLIP','1'], str(names))
chk("all 4 signal confs == 54 MODERATE (uniform; recovered from 33 LOW)",
    all(s['confidence'] == 54 for s in sig))
chk("ranges PACHINKO[60,85] 5[75,90] CF[68,89] 1[85,95]",
    [s['game']['confidenceRange'] for s in sig] == [[60,85],[75,90],[68,89],[85,95]])
chk("VALIDATION set-equal 5th read: signals set == panel lock order",
    names == ['PACHINKO','5','COIN FLIP','1']
    and re.search(r'PACHINKO \| 5 \| 1 \| COIN FLIP', tf) is not None)
chk("CASH HUNT and '2' excluded (CH demoted from rank-1 in one pass)",
    'CASH HUNT' not in names and '2' not in names)
chk("'1' RETURNED to bench at rank-4 (was excluded at P277)", names[3] == '1')
chk("lock boxes all MODERATE @54; lock RECALIBRATED • 15:34",
    tf.count('MODERATE') >= 5 and re.search(r'RECALIBRATED \| • 15:34|RECALIBRATED.{0,10}15:34', tf) is not None)
chk("DECISION ENGINE: 1x MISS / READY / BET / RISK LOW / MODERATE (flipped from RECALIBRATE/HIGH)",
    re.search(r'1× MISS \| READY', tf) is not None and re.search(r'DECISION \| BET \| RISK: \| LOW', tf) is not None)
chk("RCA type == PATTERN SHIFT (was PREDICTION BIAS)", re.search(r'RCA \| PATTERN SHIFT', tf) is not None)

print("== 6. PANEL: BANNER / LEDGER / WINDOWS ==")
chk("banner 1x MISS STREAK N=98 (dynamic label persists in MISS form at 1x)", '1× MISS STREAK' in panel and 'N=98' in panel)
chk("HIT STREAK label absent", 'HIT STREAK' not in panel)
chk("PATTERN SHIFT DETECTED RETURNED with TVD=0.66 > 0.60 (was extinguished 2 passes)",
    'PATTERN SHIFT DETECTED' in panel and 'TVD=0.66' in panel)
chk("ledger census row: 62 HIT / 36 MISS / 98 SAMPLE",
    re.search(r'62\s*\|?\s*HITS', tf) is not None and re.search(r'36\s*\|?\s*MISSES', tf) is not None)
chk("panel NORMAL HIT 70%/MISS 30% n=83 / BONUS HIT 27%/MISS 73% n=15 (single-line pairs)",
    re.search(r'NORMAL RESULTS \| HIT 70% \| MISS 30% \| n=83 rounds', tf) is not None
    and re.search(r'BONUS RESULTS \| HIT 27% \| MISS 73% \| n=15 rounds', tf) is not None)
chk("data parity: NORMAL 58/83=69.9->70%, BONUS 4/15=26.7->27%",
    abs((hits-bh)/(n-15)*100-69.88) < 0.01 and abs(bh/15*100-26.67) < 0.01)
chk("dashboard windows match data: L5 80%, L10 70%, L20 70%, L50 50%, L100+ 63%",
    re.search(r'LAST 5 \| 80% \| 5 rounds', tf) and re.search(r'LAST 20 \| 70% \| 20 rounds', tf)
    and re.search(r'LAST 50 \| 50% \| 50 rounds', tf) and re.search(r'LAST 100\+? \| 63% \| 98 rounds', tf))
chk("LEDGER LAST25 prints 70% n=25 — 2ND CONSECUTIVE PASS diverging from data 15/25=60%; 70% == L20 value -> LAST25<-L20 rendering bug CONFIRMED",
    re.search(r'LAST 25 \| 70% \| n=25', tf) is not None and abs(15/25*100-60.0) < 0.01)
chk("Total Prediction Coverage 63.0% (was 48.1)", 'Total Prediction Coverage | 63.0%' in tf)
chk("Trend up 5.2% (4th read: 8.1->4.5->10.4->5.2); Clusters 14 (was 13)",
    re.search(r'Trend \| ↑ 5\.2%', tf) is not None and re.search(r'Clusters \| 14', tf) is not None)
chk("BONUS RISK block: NORMAL COV 51.8 (was 37.0), BONUS COV 11.1, RISK 5.5, Recent 20.0, Long-Term 14.8",
    all(x in tf for x in ['NORMAL COVERAGE | 51.8%','BONUS COVERAGE | 11.1%','BONUS RISK | 5.5%','Bonus Recent | 20.0%','Bonus Long-Term | 14.8%']))
chk("excluded-outcome evidence line present (2 outcomes with recent evidence)",
    'Excluded outcomes with recent evidence: 2' in panel)
chk("INSUFFICIENT SAMPLE notice: 98/100", 'INSUFFICIENT SAMPLE: 98/100' in panel)

print("== 7. PANEL: STRUCTURE (DEBUG persist / counters / AI / history) ==")
chk("DEBUG sections PERSIST into 2nd consecutive read (EVENT DEBUG LOG + PERFORMANCE DEBUG)",
    'EVENT DEBUG LOG' in panel and 'PERFORMANCE DEBUG' in panel)
chk("PIPELINE AUDIT: 2 events logged; row #98 MISS old pred [PACHINKO,5,1,CF] -> new pred [PACHINKO,5,CF,1] Pred#99; row #97 HIT",
    '2 events logged' in tf
    and re.search(r'98 \| 2 \| \[PACHINKO,5,1,COIN FLIP\] \| MISS \| 97 \| 98 \| \[PACHINKO,5,COIN FLIP,1\] \| 99', tf) is not None
    and re.search(r'97 \| 1 \| \[PACHINKO,5,1,COIN FLIP\] \| HIT', tf) is not None)
chk("PERF buffer n=2: SRC->APP NOW 7.7s; agg avg 25.1s / P95 42.6s / max 42.6s / min 7.7s (P277 51.1s did NOT reproduce, n=2 caveat)",
    '7.7s' in panel and '25.1s' in panel and '42.6s' in panel and 'N=2' in tf)
chk("counters 1,249 / 94% / 128 / 1.2k held — 7th consecutive REWIND pass",
    all(x in panel for x in ['1,249','94%','128','1.2k']))
chk("AI summary: Entropy 72 (was 84), Volatility 44 (was 31), streak 2x3; 'Hottest' field ABSENT again (flap)",
    re.search(r'Entropy 72%[^\n]*Volatility 44/100[^\n]*Longest streak: 2 ×3', tf) is not None and 'Hottest' not in tf)
chk("ROUND HISTORY newest-first 6th read: top card #98 MISS pred [PACHINKO,5,1,CF] actual '2' 03:33 pm conf 62",
    re.search(r'ROUND HISTORY.{0,200}?PACHINKO \| 5 \| 1 \| COIN FLIP \| ACTUAL: \| 2 \| 03:33 pm \| Confidence: 62%', tf) is not None)
chk("ARCHIVE section absent (8th probe cycle)", 'ARCHIVE' not in panel)

print("== 8. SHADOW A/B (278th consecutive OFF) ==")
chk("'Shadow A/B is OFF' banner present", 'Shadow A/B is OFF' in panel)
chk("'No validation started' + START FRESH VALIDATION present; SHADOW OFF badge",
    'No validation started' in panel and 'START FRESH VALIDATION' in panel and 'SHADOW OFF' in panel)
chk("no paired/flip metrics present (all 8 fields N/A)",
    not re.search(r'paired', panel, re.I) and not re.search(r'MISS.HIT flips?', panel, re.I))
chk("static pass-93 root-cause note present", '7 of 11 misses involved PACHINKO' in panel)

print("== 9. CONSOLE RING ==")
errs = raw('pass278_errors.json')['data']['messages']
types = Counter(m.get('type') for m in errs)
chk("ring capped at 1000 (999 log + 1 info React-DevTools hint, 0 error-type)",
    len(errs) == 1000 and types['log'] == 999 and types['info'] == 1 and types.get('error',0) == 0, str(dict(types)))
fr = sum(1 for m in errs if 'Fast Refresh' in json.dumps(m.get('args',[])))
chk("FR in-ring 15 (eviction caveat); ring TAIL = rebuilding (fresh rebuild at probe)",
    fr == 15 and 'rebuilding' in json.dumps(errs[-1].get('args',[])))

print("== 10. CROSS-SOURCE CONSISTENCY ==")
chk("history last round == panel lock context: #98 actual '2' MISS conf 62, preds [PACHINKO,5,1,CF]",
    act(h[-1]) == '2' and h[-1]['hit'] is False
    and [x['game']['name'] for x in h[-1]['prediction']] == ['PACHINKO','5','1','COIN FLIP']
    and h[-1]['confidence'] == 62)
chk("EVENT DEBUG new pred #99 == signals order (PACHINKO,5,CF,1)", True)  # covered in section 5+7 regexes
chk("census parity: 62+36 == 98 == ledger N=98/100", hits + (n-hits) == 98 and 'N=98/100' in tf)
chk("panel char count 45,743 (+2,916 vs P277 42,827 — 21 cards + PATTERN SHIFT section)",
    len(panel) == 45743, f"len={len(panel)}")
chk("signals ts == #98 pred ts family (lock fresh at probe)",
    abs(sig[0]['time'] - ts[-1]) < 60000, f"sig_t={sig[0]['time']} last={ts[-1]}")

print("== 11. WORKLOG / GIT PRE-APPEND ==")
wl = open('/home/z/my-project/worklog.md').read()
blocks = wl.count('\n---\n') + (1 if wl.startswith('---\n') else 0)
chk("worklog blocks == 234 pre-append", blocks == 234, f"blocks={blocks}")
chk("chain top == Pass 277 (Task ID 322)", '## Pass 277 (Task ID 322)' in wl)
import subprocess
g = subprocess.run(['git','diff','62214ee','--','src/'], capture_output=True, text=True,
                   cwd='/home/z/my-project').stdout
chk("git diff 62214ee -- src/ == 0 (zero drift)", g.strip() == '', f"bytes={len(g)}")

print(f"\n==== {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
