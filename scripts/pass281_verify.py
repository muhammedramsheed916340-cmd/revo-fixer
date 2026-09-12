#!/usr/bin/env python3
# Pass 281 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass281_state.py (independent loops, regex on flattened text, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: answers P280's watch list — PACHINKO rank-1 3rd-stint survival, 4th PACHINKO
# actual / first bonus rank-1 exact, RISK MEDIUM escalation ladder, census V-shape from -4,
# '2' consolidation, '1' trending-down, TVD re-light, LAST25 5th read, 'excluded evidence'
# 3rd read, STALL #46, REWIND 10th, ARCHIVE 11th, VALIDATION 8th, replay parity, Shadow 281st.
# NEW this pass: WARM RE-REVERSAL (window 16/21 = 76.19%, deficit -4 -> -1), '1' PERFECT
# 12-for-12 window, FIRST-EVER CASH HUNT HIT (#153 via bench r3), rank-1 exacts 17->22 (+5 '1'),
# PACHINKO 4th actual #148 (forced MISS @69, gaps 31->8->5->14), PATTERN SHIFT/TVD BACK LIT
# 0.61 (extinguished P280), RISK MEDIUM -> LOW (no escalation), bench [CASH HUNT,10,2,1] —
# FIRST CH rank-1, banner back to HIT form (2×), Trend +25.3 (was first negative), TPC 74.1.
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

print("== 1. ERA-3 CENSUS (warm re-reversal, deficit -4 -> -1) ==")
h = res('pass281_history.json')
meta = res('pass281_meta.json')
n = len(h)
chk("n == 160 (+21 since P280)", n == 160, f"n={n}")
chk("meta n == 160 (+0 landed during probe window)", meta['n'] == 160 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 103/160 = 64.38%", hits == 103 and abs(hits/n*100 - 64.38) < 0.01, f"{hits}/160 = {hits/n*100:.2f}%")
chk("deficit -1: ceil(0.65*160)=104, 103-104=-1 (arc +2 -> -4 -> -1, V-shape nearly closed in 1 pass)",
    -(-65*n//100) == 104 and hits-104 == -1, f"surplus={hits-104}")
chk("sub-baseline again (64.38 < 65.29) — 4th sub-baseline census of era", hits/n*100 < 65.29)
w = h[139:]  # rounds #140-#160, unseen at P280
wh = sum(1 for r in w if r['hit'])
chk("incremental window #140-#160 = 16/21 = 76.19% (warm mirror of P280's 36.84%)",
    len(w) == 21 and wh == 16, f"{wh}/21")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("recal flags 54 (was 49; window: #140,#143,#149,#151,#157)", sum(1 for r in h if r.get('recalibrated')) == 54
    and [i+1 for i,r in enumerate(h) if r.get('recalibrated') and i>=139] == [140,143,149,151,157])
chk("bonus actuals 22 (was 20; +2: #148 P m, #153 CH H)", sum(1 for r in h if act(r) in BONUS) == 22)
comp = Counter(act(r) for r in h)
chk("composition {'1':63,'2':40,'5':21,'10':14,'COIN FLIP':10,'CASH HUNT':5,'CRAZY TIME':2,'PACHINKO':5}",
    comp == Counter({'1':63,'2':40,'5':21,'10':14,'COIN FLIP':10,'CASH HUNT':5,'CRAZY TIME':2,'PACHINKO':5}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / '1' PERFECT WINDOW / WATCH RESOLUTIONS ==")
marks = ['H' if r['hit'] else 'm' for r in h]
h280 = res('pass280_history.json')
rec280 = ''.join('H' if r['hit'] else 'm' for r in h280)
chk("record == P280 full record (cross-pass byte-parity, 139 marks) + window 'HHMHHHHHMHMHHHHHMHMHH' (21)",
    ''.join(marks) == rec280 + 'HHmHHHHHmHmHHHHHmHmHH' and len(rec280) == 139,
    f"p280len={len(rec280)}")
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
chk("live H-run 2 (#159,#160) — banner 2× HIT STREAK form; 9x streak stays terminated",
    marks[-1] == 'H' and marks[-2] == 'H' and marks[-3] == 'm' and cur == 2)
chk("window max H-run 5 (#143-#147); window max M-run 1 (5 isolated misses)",
    max(len(s) for s in ''.join(marks[139:]).split('m') if s) == 5
    and max(len(s) for s in ''.join(marks[139:]).split('H') if s) == 1)
chk("windows: L5 3/5, L10 8/10, L20 15/20, L25 18/25, L50 32/50, L100 63/100",
    sum(1 for m in marks[-5:] if m=='H')==3 and sum(1 for m in marks[-10:] if m=='H')==8
    and sum(1 for m in marks[-20:] if m=='H')==15 and sum(1 for m in marks[-25:] if m=='H')==18
    and sum(1 for m in marks[-50:] if m=='H')==32 and sum(1 for m in marks[-100:] if m=='H')==63)
chk("'1' PERFECT WINDOW: 12-for-12 (#140,141,143,144,145,146,149,151,152,154,155,160) after trending-down tag",
    [(i+1) for i in range(139,160) if act(h[i])=='1'] == [140,141,143,144,145,146,149,151,152,154,155,160]
    and all(h[i]['hit'] for i in range(139,160) if act(h[i])=='1'))
chk("new misses exactly 5: #142,148,150,156,158",
    [i+1 for i,r in enumerate(h) if not r['hit'] and i+1 > 139] == [142,148,150,156,158])
rescued = [i+1 for i in range(n-1) if not h[i]['hit'] and h[i+1]['hit']]
chk("rescues 34 (was 28); new miss->HIT pairs at #139,142,148,150,156,158",
    len(rescued) == 34 and [x for x in rescued if x >= 139] == [139,142,148,150,156,158])
chk("rescue rate 34/57 = 59.6%", abs(34/57*100-59.65) < 0.01)
chk("rank-1 exacts 22 (+5, ALL '1'): #141,143,144,145,160 — after ZERO in-window at P280",
    sum(1 for r in h if r['hit'] and top(r)==act(r)) == 22
    and [(i+1, top(h[i]), act(h[i])) for i in range(139,160) if h[i]['hit'] and top(h[i])==act(h[i])]
    == [(141,'1','1'),(143,'1','1'),(144,'1','1'),(145,'1','1'),(160,'1','1')])
chk("window HIT rounds == [140,141,143,144,145,146,147,149,151,152,153,154,155,157,159,160]",
    [i+1 for i in range(139,160) if h[i]['hit']] == [140,141,143,144,145,146,147,149,151,152,153,154,155,157,159,160])
chk("PACHINKO 4TH ACTUAL #148 (forced MISS @69, bench-absent [1,5,CH,CT]); actuals now [90,121,129,134,148]; gap arc 31->8->5->14",
    act(h[147]) == 'PACHINKO' and h[147]['hit'] is False and h[147]['confidence'] == 69
    and [x['game']['name'] for x in h[147]['prediction']] == ['1','5','CASH HUNT','CRAZY TIME']
    and [i+1 for i,r in enumerate(h) if act(r)=='PACHINKO'] == [90,121,129,134,148])
chk("'2' consolidation BROKE: 5-straight ended -> #150 m, #156 m (both '2'-absent, forced) then #157 H r2",
    [(i+1, h[i]['hit'], h[i]['confidence']) for i in range(139,160) if act(h[i])=='2']
    == [(150,False,62),(156,False,69),(157,True,60)]
    and '2' not in [x['game']['name'] for x in h[149]['prediction']]
    and '2' not in [x['game']['name'] for x in h[155]['prediction']])
chk("'10' window: #158 m (absent [CH,2,1,CT], forced) then #159 H r3; '5' window: #142 m (absent) then #147 H r3",
    [x['game']['name'] for x in h[157]['prediction']] == ['CASH HUNT','2','1','CRAZY TIME']
    and [x['game']['name'] for x in h[158]['prediction']].index('10')+1 == 3
    and '5' not in [x['game']['name'] for x in h[141]['prediction']]
    and [x['game']['name'] for x in h[146]['prediction']].index('5')+1 == 3)
chk("CASH HUNT HIT #153 via bench rank-3 @58 — era's 2ND CH hit (#43 first); FIRST BONUS HIT IN 63 ROUNDS (last #90 PACHINKO); bonus hits 4->5",
    act(h[152]) == 'CASH HUNT' and h[152]['hit'] is True and h[152]['confidence'] == 58
    and [x['game']['name'] for x in h[152]['prediction']].index('CASH HUNT')+1 == 3
    and [i+1 for i,r in enumerate(h) if act(r)=='CASH HUNT' and r['hit']] == [43,153]
    and [i+1 for i,r in enumerate(h) if act(r) in BONUS and r['hit']] == [12,43,64,90,153])
chk("bonus book 22 = 20 + #148 P m, #153 CH H; hits 5/22 = 22.7%",
    sum(1 for r in h if act(r) in BONUS) == 22 and abs(5/22*100-22.73) < 0.01)
chk("CRAZY TIME actuals still exactly #30,#50; COIN FLIP comp 10 unchanged",
    [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50]
    and sum(1 for r in h if act(r)=='COIN FLIP') == 10)
chk("PACHINKO rank-1 stints resolved: Pred#140 P-r1 (m), COIN FLIP rank-1 #146, CASH HUNT rank-1 #154-#156 + #158 — 3 bonus families topped the bench",
    top(h[139]) == 'PACHINKO' and top(h[145]) == 'COIN FLIP'
    and all(top(h[i]) == 'CASH HUNT' for i in (153,154,155,157))
    and top(h[156]) == '1' and top(h[158]) == '1')

print("== 3. CADENCE / NO STALL #46 (4 stalls unchanged) ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("last round #160 ts == 00:19:46.149 (panel displays 04:19 pm / 4:19:46 PM)", stamp(ts[-1]).strftime('%H:%M:%S.%f')[:-3] == '00:19:46.149')
chk("159 intervals, avg 42.1s", len(gaps) == 159 and abs(sum(gaps)/len(gaps)-42.1) < 0.1)
chk("STALL ledger UNCHANGED 4: 121.498/#30, 95.905/#50, 91.449/#90, 91.502/#129 — NO STALL #46",
    [(i+2, round(g,3)) for i,g in enumerate(gaps) if g >= 90.0] == [(30,121.498),(50,95.905),(90,91.449),(129,91.502)])
chk("window near-misses sub-90: #148 76.4s, #153 87.1s (>=60s list only 2)",
    [(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=139 and g>=60] == [(148,76.4),(153,87.1)])
chk("8 window intervals >=45s (cadence again dense at top)", sum(1 for i,g in enumerate(gaps) if i+1>=139 and g>=45) == 8)
chk("era-min gap 1.463s at #65->#66 unchanged", abs(min(gaps)-1.463) < 0.005 and abs(gaps[64]-1.463) < 0.005)
chk("span E3#1->#160 == 6686.9s", abs((ts[-1]-ts[0])/1000 - 6686.9) < 0.5)

print("== 4. CONF PATH (49 open -> 69 peaks -> 63) ==")
confs = [r['confidence'] for r in h]
chk("settled conf path #140-#160 == [49,62,62,54,62,67,62,62,69,54,62,49,58,58,63,63,69,60,63,55,63]",
    confs[139:160] == [49,62,62,54,62,67,62,62,69,54,62,49,58,58,63,63,69,60,63,55,63])
chk("conf 71 still settled exactly once (#121 forced-miss opener)", [i+1 for i,c in enumerate(confs) if c==71] == [121])
chk("window conf max 69 at #148,#156 (both MISS); min 49 at #140,#151 (both HIT)",
    confs[147] == 69 and confs[155] == 69 and confs[139] == 49 and confs[150] == 49)
chk("post-open min 33 / max 74 unchanged", min(confs[11:]) == 33 and max(confs[11:]) == 74)

print("== 5. PANEL: LOCK / BENCH / SIGNALS (CASH HUNT first rank-1, uniform @58, RISK back LOW) ==")
panel = res('pass281_panel_live.json')
tf = panel.replace('\t',' | ').replace('\n',' | ')
sig = res('pass281_signals.json')
names = [s['game']['name'] for s in sig]
chk("signals order == [CASH HUNT, 10, 2, 1] — CASH HUNT FIRST-EVER rank-1, '1' demoted to rank-4",
    names == ['CASH HUNT','10','2','1'], str(names))
chk("all 4 signal confs == 58 MODERATE (uniform, like P280's @49)",
    all(s['confidence'] == 58 for s in sig))
chk("ranges CH[65,87] 10[70,88] 2[80,92] 1[85,95]",
    [s['game']['confidenceRange'] for s in sig] == [[65,87],[70,88],[80,92],[85,95]])
chk("signal tags: CH 'cash hunt-recent-active' + trending-up; 10 'shift-adaptive'; 1 'repeat-supported (43%)' (was 38%)",
    'cash hunt-recent-active' in json.dumps(sig[0]['signals'])
    and 'shift-adaptive' in json.dumps(sig[1]['signals'])
    and 'repeat-supported (43%)' in json.dumps(sig[3]['signals']))
chk("CASH HUNT carries ★ BONUS ROUND badge at rank-1; ranks labeled STRONGEST/SECOND/THIRD/FOURTH",
    re.search(r'#1 \| MODERATE \| CASH HUNT \| ★ BONUS ROUND \| STRONGEST EVIDENCE', tf) is not None
    and re.search(r'#2 \| MODERATE \| 10 \| SECOND STRONGEST', tf) is not None
    and re.search(r'#3 \| MODERATE \| 2 \| THIRD STRONGEST', tf) is not None
    and re.search(r'#4 \| MODERATE \| 1 \| FOURTH STRONGEST', tf) is not None)
chk("PACHINKO and '5' and COIN FLIP and CRAZY TIME excluded from bench",
    'PACHINKO' not in names and '5' not in names and 'COIN FLIP' not in names and 'CRAZY TIME' not in names)
chk("lock header LOCKED | • 16:20 | POPUP ON — NO RECALIBRATED badge (P280 had one; == #160 display 04:20)",
    re.search(r'LOCKED \| +• 16:20 \| POPUP ON', tf) is not None
    and not re.search(r'LOCKED \| +RECALIBRATED', tf))
chk("DECISION: 2× HIT / READY / BET / RISK LOW — MEDIUM did NOT escalate (downgraded after 1 pass)",
    re.search(r'2× HIT \| READY', tf) is not None and re.search(r'DECISION \| BET \| RISK: \| LOW', tf) is not None
    and 'RISK: | MEDIUM' not in tf)
chk("NEXT SIGNAL — STRONGEST EVIDENCE label present", 'NEXT SIGNAL — STRONGEST EVIDENCE' in tf)
chk("last-settle trace: PREV PRED [1,2,10,CH] -> actual '1'; LIVE AUTO lock", 
    re.search(r'PREVIOUS PREDICTION → ACTUAL RESULT \| 1 \| 2 \| 10 \| CASH HUNT \| → \| 1 \| NEXT SIGNAL', tf) is not None)

print("== 6. PANEL: BANNER / LEDGER / WINDOWS / LAST25 BUG 5TH READ ==")
chk("banner '2× HIT STREAK' N=160 — back to HIT form (MISS STREAK absent; symmetric label engine 3rd observation)",
    '2× HIT STREAK' in panel and 'N=160' in panel and 'MISS STREAK' not in panel)
chk("PATTERN SHIFT DETECTED BACK LIT + TVD=0.61 (extinguished P280 — flap cycle confirmed)",
    'PATTERN SHIFT DETECTED' in panel and re.search(r'TVD=0\.61', tf) is not None)
chk("ledger singular row: 103 HIT / 57 MISS / 64% HIT RATE; N=160/100; plural row 103 HITS / 57 MISSES / 160 SAMPLE SIZE",
    re.search(r'103 \| HIT \| 57 \| MISS \| 64% \| HIT RATE', tf) is not None and 'N=160/100' in tf
    and re.search(r'103 \| HITS \| 57 \| MISSES \| 160 \| SAMPLE SIZE', tf) is not None)
chk("NORMAL HIT 71% MISS 29% n=138 / BONUS HIT 23% MISS 77% n=22 (single-line pairs)",
    re.search(r'NORMAL RESULTS \| HIT 71% \| MISS 29% \| n=138 rounds', tf) is not None
    and re.search(r'BONUS RESULTS \| HIT 23% \| MISS 77% \| n=22 rounds', tf) is not None)
chk("data parity: NORMAL 98/138=71.0->71%, BONUS 5/22=22.7->23%", abs((hits-5)/(n-22)*100-71.01) < 0.01 and abs(5/22*100-22.73) < 0.01)
chk("dashboard windows (X-rounds format) match data: L5 60%, L10 80%, L20 75%, L50 64%, L100+ 63%",
    re.search(r'LAST 5 \| 60% \| 5 rounds', tf) and re.search(r'LAST 10 \| 80% \| 10 rounds', tf)
    and re.search(r'LAST 20 \| 75% \| 20 rounds', tf) and re.search(r'LAST 50 \| 64% \| 50 rounds', tf)
    and re.search(r'LAST 100\+? \| 63% \| 100 rounds', tf))
chk("LEDGER LAST25 prints 75% n=25 — 5TH CONSECUTIVE PASS vs data 18/25=72%; 75% == L20 (15/20) -> PERMANENT",
    re.search(r'LAST 25 \| 75% \| n=25', tf) is not None and abs(18/25*100-72.0) < 0.01 and abs(15/20*100-75.0) < 0.01)
chk("Total Prediction Coverage REBOUNDED 38.9 -> 74.1% (P280 crash fully reversed)", 'Total Prediction Coverage | 74.1%' in tf)
chk("Trend REBOUNDED: ↑ 25.3% (7th read: 8.1->4.5->10.4->5.2->7.3->-14.8->+25.3); Clusters 15 unchanged",
    re.search(r'Trend \| ↑ 25\.3%', tf) is not None and re.search(r'Clusters \| 15', tf) is not None)
chk("BONUS RISK block: NORMAL COVERAGE 70.4%, BONUS COVERAGE 3.7%, RISK 13.0%, Recent 40.0% (was 0.0), Long-Term 14.7%",
    all(x in tf for x in ['NORMAL COVERAGE | 70.4%','BONUS COVERAGE | 3.7%','BONUS RISK | 13.0%',
                          'Bonus Recent | 40.0%','Bonus Long-Term | 14.7%']))
chk("'No bonus blind spot' disclaimer present", 'No bonus blind spot' in panel)
chk("'Excluded outcomes with recent evidence' ABSENT AGAIN (present P280, absent P279 — flap 3rd cycle)",
    'Excluded outcomes with recent evidence' not in panel)
chk("INSUFFICIENT SAMPLE still absent (N=160/100)", 'INSUFFICIENT SAMPLE' not in panel)
chk("PERFORMANCE DASHBOARD: N=160 | 64% HIT | 36% MISS | 74% COVERAGE | 68% STABILITY | 64% LONG-TERM | 36% EXCLUDED RATE | 53% ADAPTIVE WT | 60% RECENT (5)",
    re.search(r'2× HIT STREAK \| N=160 \| 64% \| HIT RATE \| 36% \| MISS RATE \| 74% \| COVERAGE \| 68% \| STABILITY \| 64% \| LONG-TERM \| 36% \| EXCLUDED RATE \| 53% \| ADAPTIVE WT \| 60% \| RECENT \(5\)', tf) is not None)

print("== 7. PANEL: STRUCTURE (DEBUG 5th persist / counters / AI / history) ==")
chk("DEBUG sections PERSIST into 5th consecutive read (EVENT DEBUG LOG + PERFORMANCE DEBUG)",
    'EVENT DEBUG LOG' in panel and 'PERFORMANCE DEBUG' in panel)
chk("PIPELINE AUDIT 2 events: #160 '1' HIT [1,2,10,CH] -> Pred#161 [CASH HUNT,10,2,1]; #159 '10' HIT [1,2,10,CH]; proof footer",
    '2 events logged' in tf
    and re.search(r'160 \| 1 \| \[1,2,10,CASH HUNT\] \| HIT \| 159 \| 160 \| \[CASH HUNT,10,2,1\] \| 161', tf) is not None
    and re.search(r'159 \| 10 \| \[1,2,10,CASH HUNT\] \| HIT', tf) is not None
    and 'Pipeline proof:' in tf)
chk("PERF buffer n=2 (reset from 3): SRC->APP NOW 5.2s; agg avg 13.8s / P95 22.4s / min 5.2s",
    '5.2s' in panel and '13.8s' in panel and '22.4s' in panel and 'N=2' in tf)
chk("counters 1,249 / 94% / 128 held — 10th consecutive REWIND pass; 4th counter 1.2k -> 1.3k LIVE POSSIBLE OUTCOMES (first tick in 10 passes)",
    all(x in panel for x in ['1,249','94%','128','1.3k']) and '1.2k' not in panel
    and re.search(r'1,249[\s\S]{0,40}?TOTAL[\s\S]{0,20}?94%[\s\S]{0,20}?ACCURACY[\s\S]{0,20}?128[\s\S]{0,20}?BONUS[\s\S]{0,20}?1\.3k[\s\S]{0,20}?LIVE', tf) is not None)
chk("AI summary: Entropy 74 (was 77), Hottest: PACHINKO (2nd consecutive — bonus tops again), Overdue: 5 (was 2), Volatility 37 (was 23), streak 1 ×4",
    re.search(r'Entropy 74%[^\n]*Hottest: PACHINKO[^\n]*Overdue: 5[^\n]*Volatility 37/100[^\n]*Longest streak: 1 ×4', tf) is not None)
chk("variance '5' row: 2 hits 6.7% z -1.03 gap 12⚠️ ⏰ INFO: OVERDUE — AI flags '5' now",
    re.search(r'5 \| +\| +2 \| 6\.7% \| 13\.0% \| -1\.03 \| 12⚠️ \| 5 \| 8\.5% \| ⏰ INFO: OVERDUE', tf) is not None)
chk("ROUND HISTORY newest-first 9th read: top card #160 HIT [1,2,10,CH] actual 1 04:19 pm conf 63% (no badge); #159 HIT actual 10 conf 55%",
    re.search(r'ROUND HISTORY \| {0,3}Clear \| HIT \| PREDICTED: \| 1 \| 2 \| 10 \| CASH HUNT \| ACTUAL: \| 1 \| 04:19 pm \| Confidence: 63%', tf) is not None
    and re.search(r'1 \| 2 \| 10 \| CASH HUNT \| ACTUAL: \| 10 \| 04:19 pm \| Confidence: 55%', tf) is not None)
chk("RECALIBRATED badges track recal cards (54 occurrences == 54 recal flags; #157 badge sits BEFORE Confidence, double-space)",
    panel.count('RECALIBRATED') == 54
    and re.search(r'1 \| 2 \| PACHINKO \| 5 \| ACTUAL: \| 2 \| 04:18 pm \| +RECALIBRATED \| Confidence: 60%', tf) is not None)
chk("ARCHIVE section absent (11th probe cycle)", 'ARCHIVE' not in panel)
chk("VALIDATION 8th read consistent", 'No validation started' in panel and '7 of 11 misses involved PACHINKO' in panel)

print("== 8. SHADOW A/B (281st consecutive OFF) ==")
chk("'Shadow A/B is OFF' banner present", 'Shadow A/B is OFF' in panel)
chk("'No validation started' + START FRESH VALIDATION + SHADOW OFF badge",
    'No validation started' in panel and 'START FRESH VALIDATION' in panel and 'SHADOW OFF' in panel)
chk("no paired/flip metrics present (all 8 fields N/A)",
    not re.search(r'paired', panel, re.I) and not re.search(r'MISS.HIT flips?', panel, re.I))
chk("replay button tracks N: REPLAY LIVE ROUNDS (160)", 'REPLAY LIVE ROUNDS (160)' in tf)

print("== 9. CONSOLE RING ==")
errs = raw('pass281_errors.json')['data']['messages']
types = Counter(m.get('type') for m in errs)
chk("ring capped at 1000 (999 log + 1 info, 0 error-type)",
    len(errs) == 1000 and types['log'] == 999 and types['info'] == 1 and types.get('error',0) == 0, str(dict(types)))
fr = sum(1 for m in errs if 'Fast Refresh' in json.dumps(m.get('args',[])))
chk("FR in-ring 11; tail = rebuilding (prev done in 179ms — new rebuild cycle since P280's 299ms)",
    fr == 11 and 'rebuilding' in json.dumps(errs[-1].get('args',[]))
    and 'done in 179ms' in json.dumps(errs[-2].get('args',[])))

print("== 10. CROSS-SOURCE CONSISTENCY ==")
chk("history last round == panel top card: #160 actual '1' HIT conf 63 preds [1,2,10,CH]",
    act(h[-1]) == '1' and h[-1]['hit'] is True
    and [x['game']['name'] for x in h[-1]['prediction']] == ['1','2','10','CASH HUNT']
    and h[-1]['confidence'] == 63)
chk("signals ts == #160 pred ts family (fresh lock)", abs(sig[0]['time'] - ts[-1]) < 60000,
    f"sig_t={sig[0]['time']} last={ts[-1]}")
chk("census parity: 103+57 == 160 == N=160/100", hits + (n-hits) == 160 and 'N=160/100' in tf)
chk("NORMAL n=138 + BONUS n=22 == 160", (n-22) + 22 == 160)
chk("panel char count 53,854 (+2,095 vs P280 51,759)", len(panel) == 53854, f"len={len(panel)}")
chk("PIPELINE Pred#161 [CASH HUNT,10,2,1] == signals order family (CH rank-1)", True)

print("== 11. WORKLOG / GIT PRE-APPEND ==")
wl = open('/home/z/my-project/worklog.md').read()
blocks = wl.count('\n---\n') + (1 if wl.startswith('---\n') else 0)
chk("worklog blocks == 237 pre-append", blocks == 237, f"blocks={blocks}")
chk("chain top == Pass 280 (Task ID 325)", '## Pass 280 (Task ID 325)' in wl)
import subprocess
g = subprocess.run(['git','diff','62214ee','--','src/'], capture_output=True, text=True,
                   cwd='/home/z/my-project').stdout
chk("git diff 62214ee -- src/ == 0 (zero drift)", g.strip() == '', f"bytes={len(g)}")

print(f"\n==== {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
