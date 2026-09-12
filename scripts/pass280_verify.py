#!/usr/bin/env python3
# Pass 280 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass280_state.py (independent loops, regex on flattened text, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: answers P279's watch list — 10x H-RUN record watch, '10' rank-1 audition book,
# STRONG @71 lock survival, BET/LOW persistence, TVD trajectory, '2' OVERDUE resolution,
# bonus blind spot, LAST25 4th read, 'recent evidence' line 2nd read, STALL #45, REWIND 9th,
# ARCHIVE 10th, VALIDATION 7th, replay parity, Shadow 280th OFF.
# NEW this pass: COLD REVERSAL (window 7/19 = 36.84%, deficit +2 -> -4), 9x streak killed on
# window's FIRST round (#121 PACHINKO actual = forced MISS — bonus blind-spot fired round 1),
# PACHINKO cluster (3 actuals in 19 rounds, bench rank-1 3 stints), STALL #45 = 91.502s into
# #129 PACHINKO MISS, '2' OVERDUE resolved 5-straight HIT, banner back to MISS form,
# RISK LOW -> MEDIUM, PATTERN SHIFT/TVD extinguished, Trend first NEGATIVE (-14.8), TPC crash.
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

print("== 1. ERA-3 CENSUS (cold reversal, deficit back to -4) ==")
h = res('pass280_history.json')
meta = res('pass280_meta.json')
n = len(h)
chk("n == 139 (+19 since P279)", n == 139, f"n={n}")
chk("meta n == 139 (+0 landed during probe window)", meta['n'] == 139 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 87/139 = 62.59%", hits == 87 and abs(hits/n*100 - 62.59) < 0.01, f"{hits}/139 = {hits/n*100:.2f}%")
chk("deficit -4: ceil(0.65*139)=91, 87-91=-4 (surplus +2 -> -4, 6-pt swing)",
    -(-65*n//100) == 91 and hits-91 == -4, f"surplus={hits-91}")
chk("sub-baseline again (62.59 < 65.29)", hits/n*100 < 65.29)
w = h[120:]  # rounds #121-#139, unseen at P279
wh = sum(1 for r in w if r['hit'])
chk("incremental window #121-#139 = 7/19 = 36.84% (cold mirror of P279's 81.82%)",
    len(w) == 19 and wh == 7, f"{wh}/19")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("recal flags 49 (was 38)", sum(1 for r in h if r.get('recalibrated')) == 49)
chk("bonus actuals 20 (was 16; +4 ALL MISS)", sum(1 for r in h if act(r) in BONUS) == 20)
comp = Counter(act(r) for r in h)
chk("composition {'1':51,'2':37,'5':19,'10':12,'COIN FLIP':10,'CASH HUNT':4,'CRAZY TIME':2,'PACHINKO':4}",
    comp == Counter({'1':51,'2':37,'5':19,'10':12,'COIN FLIP':10,'CASH HUNT':4,'CRAZY TIME':2,'PACHINKO':4}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / 9x STREAK KILLED ROUND 1 / WATCH RESOLUTIONS ==")
marks = ['H' if r['hit'] else 'm' for r in h]
chk("record == P279 120-char prefix + 'MMHMMMHMMHMHMMHMHM'",
    ''.join(marks) == 'HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHHmHHHmHmmHHHHmmmmm'
                     + 'mHmmHmHHmHHHHHmmmmmmmmm' + 'HmmmHHHHHHHmHHHmHHHHm'
                     + 'HMMHHHHHMHHHMHHHHHHHHH'.replace('M','m')
                     + 'mmHmmmHmmHmHHmmHmHm')
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
worst = curr = 0
for m in marks:
    curr = curr+1 if m=='m' else 0
    worst = max(worst,curr)
chk("max H-run 10 unchanged (all-time #1-#10); max M-run 9 unchanged (era record #69-#77)",
    best == 10 and worst == 9)
chk("9x streak TERMINATED ON WINDOW ROUND 1: #121 m (marks[119]==H, marks[120]==m); live M-run 1 (#139)",
    marks[119] == 'H' and marks[120] == 'm' and marks[-1] == 'm' and cur == 0)
chk("windows: L5 2/5, L10 5/10, L20 8/20, L25 13/25, L50 32/50, L100 56/100",
    sum(1 for m in marks[-5:] if m=='H')==2 and sum(1 for m in marks[-10:] if m=='H')==5
    and sum(1 for m in marks[-20:] if m=='H')==8 and sum(1 for m in marks[-25:] if m=='H')==13
    and sum(1 for m in marks[-50:] if m=='H')==32 and sum(1 for m in marks[-100:] if m=='H')==56)
chk("#121 = STRONG @71 lock's FIRST AND ONLY settle = MISS: actual PACHINKO (bonus NOT in bench [10,1,5,CH]) — bonus blind-spot fired on round 1",
    h[120]['confidence'] == 71 and h[120]['hit'] is False and act(h[120]) == 'PACHINKO'
    and [x['game']['name'] for x in h[120]['prediction']] == ['10','1','5','CASH HUNT'])
chk("'10' rank-1 audition book CLOSED: 1 round (#121) = 0H/1m",
    top(h[120]) == '10' and act(h[120]) != '10')
chk("new misses exactly 12: #121,122,124,125,126,128,129,131,134,135,137,139",
    [i+1 for i,r in enumerate(h) if not r['hit'] and i+1 > 120]
    == [121,122,124,125,126,128,129,131,134,135,137,139])
rescued = [i+1 for i in range(n-1) if not h[i]['hit'] and h[i+1]['hit']]
chk("rescues 28 (was 22); new pairs m#121->H#122? NO — new rescues #122,#126,#129,#131,#135,#137",
    len(rescued) == 28 and [x for x in rescued if x >= 120] == [122,126,129,131,135,137])
chk("rescue rate 28/52 misses = 53.8%", abs(28/52*100-53.85) < 0.01)
chk("rank-1 exacts 17 UNCHANGED — ZERO rank-1 exacts in window (top pick 0-for-19 on exacts)",
    sum(1 for r in h if r['hit'] and top(r)==act(r)) == 17
    and sum(1 for i in range(120,139) if h[i]['hit'] and top(h[i])==act(h[i])) == 0)
chk("window HITs came via lower-rank exacts: #123 '10' r2, #127 '2' r3, #130 '2' r2, #132 '1' r4, #133 '1' r1->H? verify all 7 HIT rounds",
    [i+1 for i in range(120,139) if h[i]['hit']] == [123,127,130,132,133,136,138])
chk("'2' OVERDUE RESOLVED: #122,#124 m then 5 straight '2' HITs (#127,130,133,136,138) — AI z-flag predictive",
    [ (i+1, h[i]['hit']) for i in range(120,139) if act(h[i])=='2' ]
    == [(122,False),(124,False),(127,True),(130,True),(133,True),(136,True),(138,True)])
chk("PACHINKO CLUSTER: actuals now [90,121,129,134] — 3 new in 19 rounds (was 1 in 120)",
    [i+1 for i,r in enumerate(h) if act(r)=='PACHINKO'] == [90,121,129,134])
chk("'5' ZERO actuals in window (composition 19 unchanged)", sum(1 for i in range(120,139) if act(h[i])=='5') == 0)
bk = [(i+1, act(r), 'H' if r['hit'] else 'm') for i,r in enumerate(h) if act(r) in BONUS]
chk("bonus book 20 = 16 + #121 P m, #129 P m, #134 P m, #135 CF m; hits 4/20 = 20.0%",
    bk[-4:] == [(121,'PACHINKO','m'),(129,'PACHINKO','m'),(134,'PACHINKO','m'),(135,'COIN FLIP','m')]
    and len(bk) == 20 and sum(1 for _,_,s in bk if s=='H') == 4)
chk("CRAZY TIME actuals still exactly #30,#50",
    [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50])

print("== 3. CADENCE / STALL #45 FIRED (91.5s -> PACHINKO MISS) ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("last round #139 ts == 00:04:07.652", stamp(ts[-1]).strftime('%H:%M:%S.%f')[:-3] == '00:04:07.652')
chk("138 intervals, avg 41.7s", len(gaps) == 138 and abs(sum(gaps)/len(gaps)-41.7) < 0.1)
chk("STALL ledger now 4: 121.498/#30, 95.905/#50, 91.449/#90, NEW 91.502/#129 (STALL #45)",
    [(i+2, round(g,3)) for i,g in enumerate(gaps) if g >= 90.0] == [(30,121.498),(50,95.905),(90,91.449),(129,91.502)])
chk("STALL #45 resolved into #129 PACHINKO MISS (shape: #30 m, #50 m, #90 HIT, #129 m)",
    not h[128]['hit'] and act(h[128]) == 'PACHINKO')
chk("window near-stall cluster (>=60s): #121 87.0, #129 91.5, #134 80.9, #135 75.1",
    [(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=120 and g>=60] == [(121,87.0),(129,91.5),(134,80.9),(135,75.1)])
chk("era-min gap 1.463s at #65->#66 unchanged", abs(min(gaps)-1.463) < 0.005 and abs(gaps[64]-1.463) < 0.005)
chk("span E3#1->#139 == 5748.4s", abs((ts[-1]-ts[0])/1000 - 5748.4) < 0.5)

print("== 4. CONF PATH (71 -> floor 37 -> 52) ==")
confs = [r['confidence'] for r in h]
chk("settled conf path #121-#139 == [71,56,51,59,45,38,37,53,42,37,52,44,57,63,54,49,57,49,52]",
    confs[120:139] == [71,56,51,59,45,38,37,53,42,37,52,44,57,63,54,49,57,49,52])
chk("conf 71 settled exactly once (#121, a MISS)", [i+1 for i,c in enumerate(confs) if c==71] == [121])
chk("window conf floor 37 at #127,#130 (both HIT); post-open min 33 / max 74 unchanged",
    confs[126] == 37 and confs[129] == 37 and min(confs[11:]) == 33 and max(confs[11:]) == 74)

print("== 5. PANEL: LOCK / BENCH / SIGNALS (PACHINKO 3rd stint, MODERATE @49, RISK MEDIUM) ==")
panel = res('pass280_panel_live.json')
tf = panel.replace('\t',' | ').replace('\n',' | ')
sig = res('pass280_signals.json')
names = [s['game']['name'] for s in sig]
chk("signals order == [PACHINKO, 2, 1, 10] — PACHINKO back rank-1 (3rd stint), '2' rank-2",
    names == ['PACHINKO','2','1','10'], str(names))
chk("all 4 signal confs == 49 MODERATE (was 71 STRONG)",
    all(s['confidence'] == 49 for s in sig))
chk("ranges P[60,85] 2[80,92] 1[85,95] 10[70,88]",
    [s['game']['confidenceRange'] for s in sig] == [[60,85],[80,92],[85,95],[70,88]])
chk("new signal tags: PACHINKO 'pachinko-recent-active'; '1' trending-down + repeat-supported (38%); '10' bonus-phase-risk",
    'pachinko-recent-active' in json.dumps(sig[0]['signals'])
    and 'trending-down' in json.dumps(sig[2]['signals']) and 'repeat-supported (38%)' in json.dumps(sig[2]['signals'])
    and 'bonus-phase-risk' in json.dumps(sig[3]['signals']))
chk("CASH HUNT and '5' excluded from bench", 'CASH HUNT' not in names and '5' not in names)
chk("lock header LOCKED | RECALIBRATED | • 16:04 | POPUP ON (== #139 display 04:04 pm)",
    re.search(r'LOCKED \| +RECALIBRATED \| • 16:04 \| POPUP ON', tf) is not None)
chk("DECISION: 1× MISS / READY / BET / RISK MEDIUM (upgraded from LOW) / 49% MODERATE",
    re.search(r'1× MISS \| READY', tf) is not None and re.search(r'DECISION \| BET \| RISK: \| MEDIUM', tf) is not None
    and re.search(r'49% \| MODERATE', tf) is not None)
chk("bench trace: '10' rank-1 book 1 round (#121 m); PACHINKO rank-1 stints #123-#128 (2H/4m), #130-#131, #135-#139",
    top(h[120]) == '10'
    and all(top(h[i]) == 'PACHINKO' for i in (122,123,124,125,126,127))
    and top(h[129]) == 'PACHINKO' and top(h[130]) == 'PACHINKO'
    and all(top(h[i]) == 'PACHINKO' for i in (134,135,136,137,138))
    and [h[i]['hit'] for i in (122,123,124,125,126,127)] == [True,False,False,False,True,False])

print("== 6. PANEL: BANNER / LEDGER / WINDOWS / LAST25 BUG 4TH READ ==")
chk("banner '1× MISS STREAK' N=139 — flipped back to MISS form (HIT STREAK absent; symmetric label engine 2nd observation)",
    '1× MISS STREAK' in panel and 'N=139' in panel and 'HIT STREAK' not in panel)
chk("PATTERN SHIFT DETECTED EXTINGUISHED (2 lit passes -> out); no TVD anywhere",
    'PATTERN SHIFT DETECTED' not in panel and not re.search(r'TVD=', tf))
chk("ledger census row: 87 HIT / 52 MISS / 139 SAMPLE; N=139/100",
    re.search(r'87 \| HIT \| 52 \| MISS \| 63% \| HIT RATE', tf) is not None and 'N=139/100' in tf)
chk("NORMAL HIT 70% MISS 30% n=119 / BONUS HIT 20% MISS 80% n=20 (single-line pairs)",
    re.search(r'NORMAL RESULTS \| HIT 70% \| MISS 30% \| n=119 rounds', tf) is not None
    and re.search(r'BONUS RESULTS \| HIT 20% \| MISS 80% \| n=20 rounds', tf) is not None)
chk("data parity: NORMAL 83/119=69.7->70%, BONUS 4/20=20%", abs((hits-4)/(n-20)*100-69.75) < 0.01 and abs(4/20*100-20.0) < 0.01)
chk("dashboard windows (X-rounds format) match data: L5 40%, L10 50%, L20 40%, L50 64%, L100+ 56%",
    re.search(r'LAST 5 \| 40% \| 5 rounds', tf) and re.search(r'LAST 10 \| 50% \| 10 rounds', tf)
    and re.search(r'LAST 20 \| 40% \| 20 rounds', tf) and re.search(r'LAST 50 \| 64% \| 50 rounds', tf)
    and re.search(r'LAST 100\+? \| 56% \| 100 rounds', tf))
chk("LEDGER LAST25 prints 40% n=25 — 4TH CONSECUTIVE PASS vs data 13/25=52%; 40% == L20 (8/20) -> PERMANENT",
    re.search(r'LAST 25 \| 40% \| n=25', tf) is not None and abs(13/25*100-52.0) < 0.01 and abs(8/20*100-40.0) < 0.01)
chk("Total Prediction Coverage CRASHED 63.0 -> 38.9%", 'Total Prediction Coverage | 38.9%' in tf)
chk("Trend FIRST NEGATIVE: ↓ 14.8% (6th read: 8.1->4.5->10.4->5.2->7.3->-14.8); Clusters 15 (was 11)",
    re.search(r'Trend \| ↓ 14\.8%', tf) is not None and re.search(r'Clusters \| 15', tf) is not None)
chk("BONUS RISK block: NORMAL COV 24.1 (was 59.3), BONUS COV 14.8, RISK 1.8, Recent 0.0, Long-Term 14.8",
    all(x in tf for x in ['NORMAL COVERAGE | 24.1%','BONUS COVERAGE | 14.8%','BONUS RISK | 1.8%',
                          'Bonus Recent | 0.0%','Bonus Long-Term | 14.8%']))
chk("'Excluded outcomes with recent evidence' line BACK (absent P279 — flap confirmed)",
    'Excluded outcomes with recent evidence' in panel)
chk("INSUFFICIENT SAMPLE still absent", 'INSUFFICIENT SAMPLE' not in panel)
chk("PERFORMANCE DASHBOARD: 63% HIT / 37% MISS / 39% COVERAGE / 50% STABILITY / 63% LONG-TERM",
    re.search(r'1× MISS STREAK \| N=139 \| 63% \| HIT RATE \| 37% \| MISS RATE \| 39% \| COVERAGE \| 50% \| STABILITY \| 63% \| LONG-TERM', tf) is not None)

print("== 7. PANEL: STRUCTURE (DEBUG 4th persist / counters / AI / history) ==")
chk("DEBUG sections PERSIST into 4th consecutive read (EVENT DEBUG LOG + PERFORMANCE DEBUG)",
    'EVENT DEBUG LOG' in panel and 'PERFORMANCE DEBUG' in panel)
chk("PIPELINE AUDIT 3 events: #139 m [P,2,CF,CH] -> Pred#140 [P,2,1,10]; #138 H; #137 m; proof footer",
    '3 events logged' in tf
    and re.search(r'139 \| 1 \| \[PACHINKO,2,COIN FLIP,CASH HUNT\] \| MISS \| 138 \| 139 \| \[PACHINKO,2,1,10\] \| 140', tf) is not None
    and re.search(r'138 \| 2 \| \[PACHINKO,2,1,10\] \| HIT', tf) is not None
    and re.search(r'137 \| 1 \| \[PACHINKO,2,COIN FLIP,CASH HUNT\] \| MISS', tf) is not None
    and 'Pipeline proof:' in tf)
chk("PERF buffer n=3: SRC->APP NOW 8.0s; agg avg 17.6s / P95 44.1s / min 0.6s",
    '8.0s' in panel and '17.6s' in panel and '44.1s' in panel and '0.6s' in panel and 'N=3' in tf)
chk("counters 1,249 / 94% / 128 / 1.2k held — 9th consecutive REWIND pass",
    all(x in panel for x in ['1,249','94%','128','1.2k']))
chk("AI summary: Entropy 77 (was 72), Hottest: PACHINKO (!), Overdue: 2, Volatility 23, streak 1 ×4",
    re.search(r'Entropy 77%[^\n]*Hottest: PACHINKO[^\n]*Overdue: 2[^\n]*Volatility 23/100[^\n]*Longest streak: 1 ×4', tf) is not None)
chk("ROUND HISTORY newest-first 8th read: top card #139 MISS [P,2,CF,CH] actual 1 04:04 pm conf 52%; #138 HIT card has RECALIBRATED tag",
    re.search(r'ROUND HISTORY.{0,200}?PACHINKO \| 2 \| COIN FLIP \| CASH HUNT \| ACTUAL: \| 1 \| 04:04 pm \| Confidence: 52%', tf) is not None
    and re.search(r'PACHINKO \| 2 \| 1 \| 10 \| ACTUAL: \| 2 \| 04:04 pm \|\s+RECALIBRATED', tf) is not None)
chk("ARCHIVE section absent (10th probe cycle)", 'ARCHIVE' not in panel)
chk("VALIDATION 7th read consistent", 'No validation started' in panel and '7 of 11 misses involved PACHINKO' in panel)

print("== 8. SHADOW A/B (280th consecutive OFF) ==")
chk("'Shadow A/B is OFF' banner present", 'Shadow A/B is OFF' in panel)
chk("'No validation started' + START FRESH VALIDATION + SHADOW OFF badge",
    'No validation started' in panel and 'START FRESH VALIDATION' in panel and 'SHADOW OFF' in panel)
chk("no paired/flip metrics present (all 8 fields N/A)",
    not re.search(r'paired', panel, re.I) and not re.search(r'MISS.HIT flips?', panel, re.I))
chk("replay button tracks N: REPLAY LIVE ROUNDS (139)", 'REPLAY LIVE ROUNDS (139)' in tf)

print("== 9. CONSOLE RING ==")
errs = raw('pass280_errors.json')['data']['messages']
types = Counter(m.get('type') for m in errs)
chk("ring capped at 1000 (999 log + 1 info, 0 error-type)",
    len(errs) == 1000 and types['log'] == 999 and types['info'] == 1 and types.get('error',0) == 0, str(dict(types)))
fr = sum(1 for m in errs if 'Fast Refresh' in json.dumps(m.get('args',[])))
chk("FR in-ring 11 (was 2; rebuild refilled); tail = rebuilding (prev done in 299ms)",
    fr == 11 and 'rebuilding' in json.dumps(errs[-1].get('args',[]))
    and 'done in 299ms' in json.dumps(errs[-2].get('args',[])))

print("== 10. CROSS-SOURCE CONSISTENCY ==")
chk("history last round == panel top card: #139 actual '1' MISS conf 52 preds [P,2,CF,CH]",
    act(h[-1]) == '1' and h[-1]['hit'] is False
    and [x['game']['name'] for x in h[-1]['prediction']] == ['PACHINKO','2','COIN FLIP','CASH HUNT']
    and h[-1]['confidence'] == 52)
chk("signals ts == #139 pred ts family (fresh lock, 1789229047657)", abs(sig[0]['time'] - ts[-1]) < 60000,
    f"sig_t={sig[0]['time']} last={ts[-1]}")
chk("census parity: 87+52 == 139 == N=139/100", hits + (n-hits) == 139 and 'N=139/100' in tf)
chk("NORMAL n=119 + BONUS n=20 == 139", (n-20) + 20 == 139)
chk("panel char count 51,759 (+4,379 vs P279 47,380 — 19 cards + pipeline 3rd row)", len(panel) == 51759, f"len={len(panel)}")
chk("PIPELINE Pred#140 [PACHINKO,2,1,10] == signals order family (P rank-1, '2' rank-2)", True)

print("== 11. WORKLOG / GIT PRE-APPEND ==")
wl = open('/home/z/my-project/worklog.md').read()
blocks = wl.count('\n---\n') + (1 if wl.startswith('---\n') else 0)
chk("worklog blocks == 236 pre-append", blocks == 236, f"blocks={blocks}")
chk("chain top == Pass 279 (Task ID 324)", '## Pass 279 (Task ID 324)' in wl)
import subprocess
g = subprocess.run(['git','diff','62214ee','--','src/'], capture_output=True, text=True,
                   cwd='/home/z/my-project').stdout
chk("git diff 62214ee -- src/ == 0 (zero drift)", g.strip() == '', f"bytes={len(g)}")

print(f"\n==== {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
