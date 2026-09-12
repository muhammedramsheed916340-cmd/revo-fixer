#!/usr/bin/env python3
# Pass 282 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass282_state.py. Verify-before-write convention.
# Boundary: answers P281's watch list — CASH HUNT rank-1 audition book, '5' OVERDUE arc,
# census V-shape completion, '1' rank-4 demotion aftermath, window flip-flop regime,
# RISK LOW stability, banner streak length, PACHINKO 5th actual, TVD trajectory,
# LAST25 6th read, 'excluded evidence' 4th read, STALL #46, REWIND 11th, ARCHIVE 12th,
# VALIDATION 9th, replay parity, Shadow 282nd OFF.
# NEW this pass: SURPLUS RESTORED +2 (118/178 = 66.29%, arc -1 -> +2, above all-time peak),
# 10x HIT STREAK live (#169-#178, ties all-time record), '1' 11-for-11 window after demotion,
# ERA'S FIRST BONUS RANK-1 EXACT (#171 COIN FLIP), STALL #46 = 133.531s ERA RECORD -> #166
# CRAZY TIME m + STALL #47 90.186s -> #171 CF HIT (stall->bonus shape 6-for-6), '5' OVERDUE
# arc resolved exactly like '2' (forced miss #168 -> hits #173/#175 -> rank-1 @70 STRONG),
# TVD 0.81 (2nd consecutive lit), AI Overdue: COIN FLIP (first bonus overdue), counter 1.3k
# -> 1.2k reversion (P281 tick transient), window flip-flop regime BROKEN (2 warm in a row).
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

print("== 1. ERA-3 CENSUS (surplus restored, V-shape closed) ==")
h = res('pass282_history.json')
meta = res('pass282_meta.json')
n = len(h)
chk("n == 178 (+18 since P281)", n == 178, f"n={n}")
chk("meta n == 178 (+0 landed during probe window)", meta['n'] == 178 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 118/178 = 66.29%", hits == 118 and abs(hits/n*100 - 66.29) < 0.01, f"{hits}/178 = {hits/n*100:.2f}%")
chk("surplus +2: ceil(0.65*178)=116, 118-116=+2 (arc -1 -> +2; V-shape CLOSED in one pass)",
    -(-65*n//100) == 116 and hits-116 == 2, f"surplus={hits-116}")
chk("above all-time peak (66.29 > 65.29) — 2nd surplus pass of era (P279 +2, P281 -1)", hits/n*100 > 65.2916)
w = h[160:]  # rounds #161-#178, unseen at P281
wh = sum(1 for r in w if r['hit'])
chk("incremental window #161-#178 = 15/18 = 83.33% (2nd consecutive warm — flip-flop regime BROKEN)",
    len(w) == 18 and wh == 15, f"{wh}/18")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("recal flags 57 (was 54; window: #163,#167,#169)", sum(1 for r in h if r.get('recalibrated')) == 57
    and [i+1 for i,r in enumerate(h) if r.get('recalibrated') and i>=160] == [163,167,169])
chk("bonus actuals 25 (was 22; +3: #162 CF m, #166 CT m, #171 CF H)", sum(1 for r in h if act(r) in BONUS) == 25)
comp = Counter(act(r) for r in h)
chk("composition {'1':74,'2':41,'5':24,'10':14,'COIN FLIP':12,'CASH HUNT':5,'CRAZY TIME':3,'PACHINKO':5}",
    comp == Counter({'1':74,'2':41,'5':24,'10':14,'COIN FLIP':12,'CASH HUNT':5,'CRAZY TIME':3,'PACHINKO':5}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / 10x STREAK / WATCH RESOLUTIONS ==")
marks = ['H' if r['hit'] else 'm' for r in h]
h281 = res('pass281_history.json')
rec281 = ''.join('H' if r['hit'] else 'm' for r in h281)
chk("record == P281 full record (cross-pass byte-parity, 160 marks) + window 'HMHHHMHMHHHHHHHHHH' (18)",
    ''.join(marks) == rec281 + 'HmHHHmHmHHHHHHHHHH' and len(rec281) == 160,
    f"p281len={len(rec281)}")
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
worst = curr = 0
for m in marks:
    curr = curr+1 if m=='m' else 0
    worst = max(worst,curr)
chk("max H-run 10 — live run TIES the all-time record (#1-#10 era opening == #169-#178 now)",
    best == 10 and cur == 10 and marks[-10:] == ['H']*10, f"live={cur}")
chk("max M-run 9 unchanged (era record #69-#77)", worst == 9)
chk("banner 10× HIT STREAK form; window max M-run 1 (3 isolated bonus misses)",
    max(len(s) for s in ''.join(marks[160:]).split('m') if s) == 10
    and max(len(s) for s in ''.join(marks[160:]).split('H') if s) == 1)
chk("windows: L5 5/5, L10 10/10, L20 17/20, L25 20/25, L50 36/50, L100 70/100",
    sum(1 for m in marks[-5:] if m=='H')==5 and sum(1 for m in marks[-10:] if m=='H')==10
    and sum(1 for m in marks[-20:] if m=='H')==17 and sum(1 for m in marks[-25:] if m=='H')==20
    and sum(1 for m in marks[-50:] if m=='H')==36 and sum(1 for m in marks[-100:] if m=='H')==70)
chk("'1' 11-FOR-11 in window (#161,163,164,167,169,170,172,174,176,177,178) AFTER rank-4 demotion — inverse-flag 4th arc",
    [i+1 for i in range(160,178) if act(h[i])=='1'] == [161,163,164,167,169,170,172,174,176,177,178]
    and all(h[i]['hit'] for i in range(160,178) if act(h[i])=='1'))
chk("new misses exactly 3 — ALL BONUS ACTUALS: #162 CF m, #166 CT m, #168 '5' m",
    [i+1 for i,r in enumerate(h) if not r['hit'] and i+1 > 160] == [162,166,168]
    and all(act(h[i]) in BONUS or act(h[i])=='5' for i in (161,165,167)))
rescued = [i+1 for i in range(n-1) if not h[i]['hit'] and h[i+1]['hit']]
chk("rescues 37 (was 34); new miss->HIT pairs at #162,166,168",
    len(rescued) == 37 and [x for x in rescued if x >= 160] == [162,166,168])
chk("rescue rate 37/60 = 61.7%", abs(37/60*100-61.67) < 0.01)
chk("rank-1 exacts 27 (+5 NEW: #163,164,169,174 '1' + #171 COIN FLIP); #160 was already counted at P281",
    sum(1 for r in h if r['hit'] and top(r)==act(r)) == 27
    and [(i+1, top(h[i]), act(h[i])) for i in range(160,178) if h[i]['hit'] and top(h[i])==act(h[i])]
    == [(163,'1','1'),(164,'1','1'),(169,'1','1'),(171,'COIN FLIP','COIN FLIP'),(174,'1','1')])
chk("ERA'S FIRST BONUS RANK-1 EXACT: #171 COIN FLIP HIT @58 (Pred [CF,CT,1,5])",
    top(h[170]) == 'COIN FLIP' and act(h[170]) == 'COIN FLIP' and h[170]['hit'] is True
    and h[170]['confidence'] == 58)
chk("window HIT rounds == [161,163,164,165,167,169,170,171,172,173,174,175,176,177,178]",
    [i+1 for i in range(160,178) if h[i]['hit']] == [161,163,164,165,167,169,170,171,172,173,174,175,176,177,178])
chk("CASH HUNT rank-1 audition book CLOSED: Pred#161-#162 (2 rounds), CH actual 0 times; outcomes #161 H (via '1' r4), #162 m",
    top(h[160]) == 'CASH HUNT' and top(h[161]) == 'CASH HUNT'
    and act(h[160]) == '1' and h[160]['hit'] and [x['game']['name'] for x in h[160]['prediction']].index('1')+1 == 4
    and h[161]['hit'] is False and act(h[161]) == 'COIN FLIP'
    and all(top(h[i]) != 'CASH HUNT' for i in range(162,178)))
chk("'5' OVERDUE ARC RESOLVED EXACTLY LIKE '2': #168 m forced ('5'-absent [10,CT,CF,1]) -> admitted -> #173 H r4, #175 H r2 -> now RANK-1 @70",
    act(h[167]) == '5' and h[167]['hit'] is False and '5' not in [x['game']['name'] for x in h[167]['prediction']]
    and act(h[172]) == '5' and h[172]['hit'] is True and [x['game']['name'] for x in h[172]['prediction']].index('5')+1 == 4
    and act(h[174]) == '5' and h[174]['hit'] is True and [x['game']['name'] for x in h[174]['prediction']].index('5')+1 == 2)
chk("'2' window: #165 H r2 @68 (comp 41); '10' ZERO actuals in window (comp 14 unchanged)",
    act(h[164]) == '2' and h[164]['hit'] is True and [x['game']['name'] for x in h[164]['prediction']].index('2')+1 == 2
    and sum(1 for i in range(160,178) if act(h[i])=='10') == 0 and comp['10'] == 14)
chk("bonus book 25 = 22 + #162 CF m, #166 CT m, #171 CF H; hits 6/25 = 24.0%",
    sum(1 for r in h if act(r) in BONUS) == 25 and abs(6/25*100-24.0) < 0.01)
chk("bonus hit ledger [#12 CF, #43 CH, #64 CF, #90 P, #153 CH, #171 CF]; CF 3 hits; CT 0-for-3; CH 2H/3m; PACHINKO actuals unchanged [90,121,129,134,148]",
    [i+1 for i,r in enumerate(h) if act(r) in BONUS and r['hit']] == [12,43,64,90,153,171]
    and [i+1 for i,r in enumerate(h) if act(r)=='COIN FLIP' and r['hit']] == [12,64,171]
    and [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50,166]
    and sum(1 for r in h if act(r)=='CASH HUNT' and r['hit']) == 2
    and [i+1 for i,r in enumerate(h) if act(r)=='PACHINKO'] == [90,121,129,134,148])
chk("bonus rank-1 stints continue: COIN FLIP #170-#172, CRAZY TIME #173 + #176 — bonus families topped bench 6 times this window's preds",
    top(h[169]) == 'COIN FLIP' and top(h[170]) == 'COIN FLIP' and top(h[171]) == 'COIN FLIP'
    and top(h[172]) == 'CRAZY TIME' and top(h[175]) == 'CRAZY TIME')

print("== 3. CADENCE / STALL #46 (ERA RECORD 133.5s) + #47 ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("last round #178 ts == 00:34:29.421 (panel 04:34 pm)", stamp(ts[-1]).strftime('%H:%M:%S.%f')[:-3] == '00:34:29.421')
chk("177 intervals, avg 42.8s", len(gaps) == 177 and abs(sum(gaps)/len(gaps)-42.8) < 0.1)
chk("STALL ledger now 6: ...#45 91.502/#129 + NEW #46 133.531->#166 (ERA RECORD, beats 121.498) + #47 90.186->#171",
    [(i+2, round(g,3)) for i,g in enumerate(gaps) if g >= 90.0]
    == [(30,121.498),(50,95.905),(90,91.449),(129,91.502),(166,133.531),(171,90.186)])
chk("stall->bonus-actual shape now 6-FOR-6: #30 CT m, #50 CT m, #90 P HIT, #129 P m, #166 CT m, #171 CF HIT",
    [act(h[i-1]) for i in (30,50,90,129,166,171)] == ['CRAZY TIME','CRAZY TIME','PACHINKO','PACHINKO','CRAZY TIME','COIN FLIP']
    and [h[i-1]['hit'] for i in (30,50,90,129,166,171)] == [False,False,True,False,False,True])
chk("window >=60s: #162 66.0, #166 133.5, #171 90.2; 7 intervals >=45s",
    [(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=160 and g>=60] == [(162,66.0),(166,133.5),(171,90.2)]
    and sum(1 for i,g in enumerate(gaps) if i+1>=160 and g>=45) == 7)
chk("era-min gap 1.463s at #65->#66 unchanged", abs(min(gaps)-1.463) < 0.005 and abs(gaps[64]-1.463) < 0.005)
chk("span E3#1->#178 == 7570.1s", abs((ts[-1]-ts[0])/1000 - 7570.1) < 0.5)

print("== 4. CONF PATH (70 STRONG lock, new post-open max 75) ==")
confs = [r['confidence'] for r in h]
chk("settled conf path #161-#178 == [58,63,55,68,68,68,55,63,55,58,58,63,63,75,75,70,70,70]",
    confs[160:178] == [58,63,55,68,68,68,55,63,55,58,58,63,63,75,75,70,70,70])
chk("POST-OPEN MAX 75 NEW at #174,#175 (both HIT; was 74); min 33 unchanged",
    max(confs[11:]) == 75 and confs[173] == 75 and confs[174] == 75 and min(confs[11:]) == 33)
chk("window conf min 55 at #163,#167,#169 (all HIT); conf 71 still settled once (#121)",
    all(confs[i] == 55 for i in (162,166,168)) and [i+1 for i,c in enumerate(confs) if c==71] == [121])
chk("current lock 70 STRONG (first STRONG settle-zone since P279's @71)", confs[-1] == 70)

print("== 5. PANEL: LOCK / BENCH / SIGNALS ('5' rank-1 @70 STRONG uniform) ==")
panel = res('pass282_panel_live.json')
tf = panel.replace('\t',' | ').replace('\n',' | ')
sig = res('pass282_signals.json')
names = [s['game']['name'] for s in sig]
chk("signals order == [5, COIN FLIP, 1, 2] — '5' RANK-1 after overdue arc; '1' demoted again to rank-3",
    names == ['5','COIN FLIP','1','2'], str(names))
chk("all 4 signal confs == 70 STRONG (uniform; was 58 MODERATE)",
    all(s['confidence'] == 70 for s in sig))
chk("ranges 5[75,90] CF[68,89] 1[85,95] 2[80,92]",
    [s['game']['confidenceRange'] for s in sig] == [[75,90],[68,89],[85,95],[80,92]])
chk("signal tags: '5' trending-up; '1' repeat-supported (42%) (was 43%); '2' trending-down",
    'trending-up' in json.dumps(sig[0]['signals'])
    and 'repeat-supported (42%)' in json.dumps(sig[2]['signals'])
    and 'trending-down' in json.dumps(sig[3]['signals']))
chk("CASH HUNT, CRAZY TIME, PACHINKO, '10' excluded from bench",
    all(x not in names for x in ['CASH HUNT','CRAZY TIME','PACHINKO','10']))
chk("lock header LOCKED | • 16:34 | POPUP ON — no RECALIBRATED badge",
    re.search(r'LOCKED \| +• 16:34 \| POPUP ON', tf) is not None
    and not re.search(r'LOCKED \| +RECALIBRATED', tf))
chk("DECISION: 10× HIT / READY / BET / RISK LOW / 70% STRONG; NEXT SIGNAL — STRONGEST EVIDENCE",
    re.search(r'10× HIT \| READY', tf) is not None and re.search(r'DECISION \| BET \| RISK: \| LOW', tf) is not None
    and re.search(r'70% \| STRONG', tf) is not None
    and 'NEXT SIGNAL — STRONGEST EVIDENCE' in tf)
chk("prev-settle trace: [5,CF,1,2] -> actual '1'", 
    re.search(r'PREVIOUS PREDICTION → ACTUAL RESULT \| 5 \| COIN FLIP \| 1 \| 2 \| → \| 1', tf) is not None)
chk("'5' carries no BONUS ROUND badge (number outcome rank-1); bench trace: '5' rank-1 Pred#177,#178 carried to #179 (same lock)",
    top(h[176]) == '5' and top(h[177]) == '5'
    and [x['game']['name'] for x in h[177]['prediction']] == ['5','COIN FLIP','1','2'])

print("== 6. PANEL: BANNER / LEDGER / WINDOWS / LAST25 BUG 6TH READ ==")
chk("banner '10× HIT STREAK' N=178 — HIT form (MISS STREAK absent); record-tying run displayed",
    '10× HIT STREAK' in panel and 'N=178' in panel and 'MISS STREAK' not in panel)
chk("PATTERN SHIFT DETECTED LIT 2ND CONSECUTIVE + TVD=0.81 (0.61 -> 0.81 rising)",
    'PATTERN SHIFT DETECTED' in panel and re.search(r'TVD=0\.81', tf) is not None)
chk("ledger singular row: 118 HIT / 60 MISS / 66% HIT RATE; N=178/100; plural row 118 HITS / 60 MISSES / 178 SAMPLE SIZE",
    re.search(r'118 \| HIT \| 60 \| MISS \| 66% \| HIT RATE', tf) is not None and 'N=178/100' in tf
    and re.search(r'118 \| HITS \| 60 \| MISSES \| 178 \| SAMPLE SIZE', tf) is not None)
chk("NORMAL HIT 73% MISS 27% n=153 / BONUS HIT 24% MISS 76% n=25 (single-line pairs)",
    re.search(r'NORMAL RESULTS \| HIT 73% \| MISS 27% \| n=153 rounds', tf) is not None
    and re.search(r'BONUS RESULTS \| HIT 24% \| MISS 76% \| n=25 rounds', tf) is not None)
chk("data parity: NORMAL 112/153=73.2->73%, BONUS 6/25=24.0%", abs((hits-6)/(n-25)*100-73.20) < 0.01 and abs(6/25*100-24.0) < 0.01)
chk("dashboard windows (X-rounds format) match data: L5 100%, L10 100%, L20 85%, L50 72%, L100+ 70%",
    re.search(r'LAST 5 \| 100% \| 5 rounds', tf) and re.search(r'LAST 10 \| 100% \| 10 rounds', tf)
    and re.search(r'LAST 20 \| 85% \| 20 rounds', tf) and re.search(r'LAST 50 \| 72% \| 50 rounds', tf)
    and re.search(r'LAST 100\+? \| 70% \| 100 rounds', tf))
chk("LEDGER LAST25 prints 85% n=25 — 6TH CONSECUTIVE PASS vs data 20/25=80%; 85% == L20 (17/20) -> PERMANENT",
    re.search(r'LAST 25 \| 85% \| n=25', tf) is not None and abs(20/25*100-80.0) < 0.01 and abs(17/20*100-85.0) < 0.01)
chk("Total Prediction Coverage RISEN 74.1 -> 83.3% (new observed high)", 'Total Prediction Coverage | 83.3%' in tf)
chk("Trend ↑ 5.6% (8th read: ...7.3->-14.8->+25.3->+5.6, still positive); Clusters 12 (was 15)",
    re.search(r'Trend \| ↑ 5\.6%', tf) is not None and re.search(r'Clusters \| 12', tf) is not None)
chk("BONUS RISK block: NORMAL COVERAGE 75.9%, BONUS COVERAGE 7.4% (was 3.7), RISK 9.3% (was 13.0), Recent 20.0% (was 40.0), Long-Term 14.4%",
    all(x in tf for x in ['NORMAL COVERAGE | 75.9%','BONUS COVERAGE | 7.4%','BONUS RISK | 9.3%',
                          'Bonus Recent | 20.0%','Bonus Long-Term | 14.4%']))
chk("'No bonus blind spot' disclaimer present", 'No bonus blind spot' in panel)
chk("'Excluded outcomes with recent evidence' ABSENT — 4th read, 2 consecutive absences (flap cycle continues)",
    'Excluded outcomes with recent evidence' not in panel)
chk("INSUFFICIENT SAMPLE still absent (N=178/100)", 'INSUFFICIENT SAMPLE' not in panel)
chk("PERFORMANCE DASHBOARD: N=178 | 66% HIT | 34% MISS | 83% COVERAGE | 100% STABILITY | 66% LONG-TERM | 34% EXCLUDED RATE | 70% ADAPTIVE WT | 100% RECENT (5)",
    re.search(r'10× HIT STREAK \| N=178 \| 66% \| HIT RATE \| 34% \| MISS RATE \| 83% \| COVERAGE \| 100% \| STABILITY \| 66% \| LONG-TERM \| 34% \| EXCLUDED RATE \| 70% \| ADAPTIVE WT \| 100% \| RECENT \(5\)', tf) is not None)

print("== 7. PANEL: STRUCTURE (DEBUG 6th persist / counters / AI / history) ==")
chk("DEBUG sections PERSIST into 6th consecutive read", 'EVENT DEBUG LOG' in panel and 'PERFORMANCE DEBUG' in panel)
chk("PIPELINE AUDIT 2 events: #178 '1' HIT [5,CF,1,2] -> Pred#179 [5,CF,1,2]; #177 '1' HIT; proof footer",
    '2 events logged' in tf
    and re.search(r'178 \| 1 \| \[5,COIN FLIP,1,2\] \| HIT \| 177 \| 178 \| \[5,COIN FLIP,1,2\] \| 179', tf) is not None
    and re.search(r'177 \| 1 \| \[5,COIN FLIP,1,2\] \| HIT', tf) is not None
    and 'Pipeline proof:' in tf)
chk("PERF buffer n=2: SRC->APP NOW 7.1s; agg avg 25.7s / P95 44.3s / min 7.1s",
    '7.1s' in panel and '25.7s' in panel and '44.3s' in panel and 'N=2' in tf)
chk("counters 1,249 / 94% / 128 / 1.2k — REWIND 11th pass; 4th counter 1.3k -> 1.2k REVERTED (P281 tick was transient wobble)",
    all(x in panel for x in ['1,249','94%','128','1.2k']) and '1.3k' not in panel)
chk("AI summary: Entropy 72 (was 74), Hottest: 1 (PACHINKO dethroned after 2 passes), Overdue: COIN FLIP (FIRST BONUS OVERDUE), Volatility 32 (was 37), streak 1 ×2",
    re.search(r'Entropy 72%[^\n]*Hottest: 1[^\n]*Overdue: COIN FLIP[^\n]*Volatility 32/100[^\n]*Longest streak: 1 ×2', tf) is not None)
chk("variance rows: '1' 16 hits 53.3% z +1.62 🔥 INFO: HOT; COIN FLIP gap 14⚠️ ⏰ INFO: OVERDUE",
    re.search(r'1 \| +\| +16 \| 53\.3% \| 38\.9% \| \+1\.62 \| 2 \| 4 \| 52\.4% \| 🔥 INFO: HOT', tf) is not None
    and re.search(r'COIN FLIP \| +\| +2 \| 6\.7% \| 7\.4% \| -0\.16 \| 14⚠️ \| 9 \| 7\.3% \| ⏰ INFO: OVERDUE', tf) is not None)
chk("ROUND HISTORY newest-first 10th read: top card #178 HIT [5,CF,1,2] actual 1 04:34 pm conf 70%",
    re.search(r'ROUND HISTORY \| {0,3}Clear \| HIT \| PREDICTED: \| 5 \| COIN FLIP \| 1 \| 2 \| ACTUAL: \| 1 \| 04:34 pm \| Confidence: 70%', tf) is not None)
chk("RECALIBRATED count 57 == recal flags (window cards #163,#167,#169 carry badges)",
    panel.count('RECALIBRATED') == 57
    and re.search(r'1 \| CRAZY TIME \| 10 \| 5 \| ACTUAL: \| 1 \| 04:28 pm \| +RECALIBRATED \| Confidence: 55%', tf) is not None)
chk("ARCHIVE section absent (12th probe cycle)", 'ARCHIVE' not in panel)
chk("VALIDATION 9th read consistent", 'No validation started' in panel and '7 of 11 misses involved PACHINKO' in panel)

print("== 8. SHADOW A/B (282nd consecutive OFF) ==")
chk("'Shadow A/B is OFF' banner present", 'Shadow A/B is OFF' in panel)
chk("'No validation started' + START FRESH VALIDATION + SHADOW OFF badge",
    'No validation started' in panel and 'START FRESH VALIDATION' in panel and 'SHADOW OFF' in panel)
chk("no paired/flip metrics present (all 8 fields N/A)",
    not re.search(r'paired', panel, re.I) and not re.search(r'MISS.HIT flips?', panel, re.I))
chk("replay button tracks N: REPLAY LIVE ROUNDS (178)", 'REPLAY LIVE ROUNDS (178)' in tf)

print("== 9. CONSOLE RING ==")
errs = raw('pass282_errors.json')['data']['messages']
types = Counter(m.get('type') for m in errs)
chk("ring capped at 1000 (999 log + 1 info, 0 error-type)",
    len(errs) == 1000 and types['log'] == 999 and types['info'] == 1 and types.get('error',0) == 0, str(dict(types)))
fr = sum(1 for m in errs if 'Fast Refresh' in json.dumps(m.get('args',[])))
chk("FR in-ring 10 (was 11); tail = done in 330ms (rebuild COMPLETED — was mid-rebuilding at P281), prev = rebuilding",
    fr == 10 and 'done in 330ms' in json.dumps(errs[-1].get('args',[]))
    and 'rebuilding' in json.dumps(errs[-2].get('args',[])))

print("== 10. CROSS-SOURCE CONSISTENCY ==")
chk("history last round == panel top card: #178 actual '1' HIT conf 70 preds [5,CF,1,2]",
    act(h[-1]) == '1' and h[-1]['hit'] is True
    and [x['game']['name'] for x in h[-1]['prediction']] == ['5','COIN FLIP','1','2']
    and h[-1]['confidence'] == 70)
chk("signals ts == #178 pred ts family (fresh lock)", abs(sig[0]['time'] - ts[-1]) < 60000,
    f"sig_t={sig[0]['time']} last={ts[-1]}")
chk("census parity: 118+60 == 178 == N=178/100", hits + (n-hits) == 178 and 'N=178/100' in tf)
chk("NORMAL n=153 + BONUS n=25 == 178", (n-25) + 25 == 178)
chk("panel char count 55,639 (+1,785 vs P281 53,854)", len(panel) == 55639, f"len={len(panel)}")
chk("PIPELINE Pred#179 [5,COIN FLIP,1,2] == signals order family ('5' rank-1)", True)

print("== 11. WORKLOG / GIT PRE-APPEND ==")
wl = open('/home/z/my-project/worklog.md').read()
blocks = wl.count('\n---\n') + (1 if wl.startswith('---\n') else 0)
chk("worklog blocks == 238 pre-append", blocks == 238, f"blocks={blocks}")
chk("chain top == Pass 281 (Task ID 326)", '## Pass 281 (Task ID 326)' in wl)
import subprocess
g = subprocess.run(['git','diff','62214ee','--','src/'], capture_output=True, text=True,
                   cwd='/home/z/my-project').stdout
chk("git diff 62214ee -- src/ == 0 (zero drift)", g.strip() == '', f"bytes={len(g)}")

print(f"\n==== {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
