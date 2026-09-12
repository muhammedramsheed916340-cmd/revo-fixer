#!/usr/bin/env python3
# Pass 279 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass279_state.py (independent loops, regex on flattened text, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: answers P278's watch list — 100-round threshold (INSUFFICIENT exit), PACHINKO
# rank-1 audition settle, MODERATE @54 survival, '1' in-bench performance, LAST25 bug 3rd
# read, STALL #45, PATTERN SHIFT TVD trajectory, DECISION BET/LOW persistence, REWIND 8th,
# ARCHIVE 9th, VALIDATION 6th, replay parity, Shadow 279th OFF.
# NEW this pass: SURPLUS +2 (deficit arc -4 -> -2 -> +2 closed), 9x HIT STREAK live (banner
# first HIT-form read of era), bench revolution 4.0 ('10' rank-1, uniform STRONG @71),
# '5' post-drought surge (5 hits), '1' 9-for-9, conf peak 74 MISS at #107, near-stall cluster.
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

print("== 1. ERA-3 CENSUS (surplus restored at calibration-grade n) ==")
h = res('pass279_history.json')
meta = res('pass279_meta.json')
n = len(h)
chk("n == 120 (+22 since P278)", n == 120, f"n={n}")
chk("meta n == 120 (+0 landed during probe window)", meta['n'] == 120 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 80/120 = 66.67%", hits == 80 and abs(hits/n*100 - 66.67) < 0.01, f"{hits}/120 = {hits/n*100:.2f}%")
chk("SURPLUS +2: ceil(0.65*120)=78, 80-78=+2 — deficit arc -4 -> -2 -> +2 CLOSED",
    -(-65*n//100) == 78 and hits-78 == 2, f"surplus={hits-78}")
chk("above all-time baseline 65.2916 (first calibration-grade read of era)", hits/n*100 > 65.29)
w = h[98:]  # rounds #99-#120, unseen at P278
wh = sum(1 for r in w if r['hit'])
chk("incremental window #99-#120 = 18/22 = 81.82% (hot)", len(w) == 22 and wh == 18, f"{wh}/22")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("recal flags 38 (was 33)", sum(1 for r in h if r.get('recalibrated')) == 38)
chk("bonus actuals 16 (was 15; +1 = #107 COIN FLIP m)", sum(1 for r in h if act(r) in BONUS) == 16)
comp = Counter(act(r) for r in h)
chk("composition {'1':45,'2':30,'5':19,'10':10,'COIN FLIP':9,'CASH HUNT':4,'CRAZY TIME':2,'PACHINKO':1}",
    comp == Counter({'1':45,'2':30,'5':19,'10':10,'COIN FLIP':9,'CASH HUNT':4,'CRAZY TIME':2,'PACHINKO':1}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / 9x HIT STREAK / MILESTONES ==")
marks = ['H' if r['hit'] else 'm' for r in h]
chk("record == P278 98-char prefix + 'HMMHHHHHMHHHMHHHHHHHHH' (5H #102-106, 9H #112-120)",
    ''.join(marks) == 'HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHHmHHHmHmmHHHHmmmmm'
                     + 'mHmmHmHHmHHHHHmmmmmmmmm' + 'HmmmHHHHHHHmHHHmHHHHm'
                     + 'HMMHHHHHMHHHMHHHHHHHHH'.replace('M','m'))
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
worst = curr = 0
for m in marks:
    curr = curr+1 if m=='m' else 0
    worst = max(worst,curr)
chk("max H-run 10 unchanged (all-time)", best == 10)
chk("max M-run 9 unchanged (era record #69-#77)", worst == 9)
chk("LIVE 9x HIT STREAK: last 9 all H, #111 m", marks[-9:] == ['H']*9 and marks[-10] == 'm' and cur == 9)
chk("windows: L5 5/5, L10 9/10, L20 17/20, L25 20/25, L50 33/50, L100 63/100",
    sum(1 for m in marks[-5:] if m=='H')==5 and sum(1 for m in marks[-10:] if m=='H')==9
    and sum(1 for m in marks[-20:] if m=='H')==17 and sum(1 for m in marks[-25:] if m=='H')==20
    and sum(1 for m in marks[-50:] if m=='H')==33 and sum(1 for m in marks[-100:] if m=='H')==63)
chk("#99 HIT at conf 54 — PACHINKO rank-1 audition line settles HIT via rank-4 '1' exact (MODERATE@54 survival: YES)",
    h[98]['hit'] is True and h[98]['confidence'] == 54 and act(h[98]) == '1'
    and top(h[98]) == 'PACHINKO' and [x['game']['name'] for x in h[98]['prediction']] == ['PACHINKO','5','COIN FLIP','1'])
chk("new misses exactly #100,#101,#107,#111 (4); #100+#101 back-to-back pair",
    [i+1 for i,r in enumerate(h) if not r['hit'] and i+1 > 98] == [100,101,107,111]
    and not h[99]['hit'] and not h[100]['hit'])
rescued = [i+1 for i in range(n-1) if not h[i]['hit'] and h[i+1]['hit']]
chk("rescues 22 (was 18); new pairs m#98->H#99, m#101->H#102, m#107->H#108, m#111->H#112",
    len(rescued) == 22 and all(x in rescued for x in (98,101,107,111)))
chk("rescue rate 22/40 misses = 55.0% (P278: 18/36 = 50.0%)", abs(22/40*100-55.0) < 0.01)
chk("rank-1 exacts 17 (was 12; +5 = #104,#113,#114,#115 '1', #120 '10')",
    sum(1 for r in h if r['hit'] and top(r)==act(r)) == 17
    and [(i+1, top(h[i])) for i in range(98,120) if h[i]['hit'] and top(h[i])==act(h[i])]
        == [(104,'1'),(113,'1'),(114,'1'),(115,'1'),(120,'10')])
chk("'5' post-drought surge: hits #102,#108,#110,#116,#119 (drought ended #95)",
    [i+1 for i,r in enumerate(h) if r['hit'] and act(r)=='5' and i+1>98] == [102,108,110,116,119]
    and max(i+1 for i,r in enumerate(h) if r['hit'] and act(r)=='5') == 119)
chk("'1' in-bench 9-for-9 in window: #99,103,104,109,112,113,114,115,117 all HIT",
    [(i+1, h[i]['hit']) for i in range(98,120) if act(h[i])=='1']
    == [(99,True),(103,True),(104,True),(109,True),(112,True),(113,True),(114,True),(115,True),(117,True)])
bk = [(i+1, act(r), 'H' if r['hit'] else 'm') for i,r in enumerate(h) if act(r) in BONUS]
chk("bonus book 16 = 15 P278 entries + #107 COIN FLIP m; hits 4/16 = 25.0%",
    bk[-1] == (107,'COIN FLIP','m') and len(bk) == 16 and sum(1 for _,_,s in bk if s=='H') == 4)
chk("CRAZY TIME actuals still exactly #30,#50; PACHINKO still only #90",
    [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50]
    and [i+1 for i,r in enumerate(h) if act(r)=='PACHINKO'] == [90])
chk("#107 MISS at conf 74 = highest settled conf of era (COIN FLIP actual, excluded-from-bench risk)",
    h[106]['confidence'] == 74 and not h[106]['hit'] and act(h[106]) == 'COIN FLIP'
    and max(r['confidence'] for r in h[11:]) == 74)

print("== 3. CADENCE / STALL #45 DID NOT FIRE ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("last round #120 ts == 23:49:16.990", stamp(ts[-1]).strftime('%H:%M:%S.%f')[:-3] == '23:49:16.990')
chk("119 intervals, avg 40.8s", len(gaps) == 119 and abs(sum(gaps)/len(gaps)-40.8) < 0.1)
chk("STALL ledger unchanged (3x >=90s): 121.498/#30, 95.905/#50, 91.449/#90 — STALL #45 did NOT fire",
    [(i+2, round(g,3)) for i,g in enumerate(gaps) if g >= 90.0] == [(30,121.498),(50,95.905),(90,91.449)])
chk("window near-stall cluster (>=60s): #102 79.5s, #107 60.0s, #117 80.8s",
    [(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=98 and g>=60] == [(102,79.5),(107,60.0),(117,80.8)])
chk("era-min gap 1.463s at #65->#66 unchanged", abs(min(gaps)-1.463) < 0.005 and abs(gaps[64]-1.463) < 0.005)
chk("span E3#1->#120 == 4857.7s", abs((ts[-1]-ts[0])/1000 - 4857.7) < 0.5)

print("== 4. CONF PATH (54 -> churn -> 70 plateau, peak-74 MISS) ==")
confs = [r['confidence'] for r in h]
chk("settled conf path #99-#120 == [54,62,49,48,57,62,62,67,74,59,67,68,68,55,68,68,68,68,70,70,70,70]",
    confs[98:120] == [54,62,49,48,57,62,62,67,74,59,67,68,68,55,68,68,68,68,70,70,70,70])
chk("conf 54 settled [60,83,99] (3 rounds total)", [i+1 for i,c in enumerate(confs) if c==54] == [60,83,99])
chk("conf 33 still settled exactly once (#78); post-open min 33 / max 74",
    [i+1 for i,c in enumerate(confs) if c==33] == [78] and min(confs[11:]) == 33 and max(confs[11:]) == 74)
chk("final 4 rounds conf 70 plateau (#117-#120)", confs[116:120] == [70,70,70,70])

print("== 5. PANEL: LOCK / BENCH / SIGNALS (revolution 4.0: '10' rank-1, STRONG @71) ==")
panel = res('pass279_panel_live.json')
tf = panel.replace('\t',' | ').replace('\n',' | ')
sig = res('pass279_signals.json')
names = [s['game']['name'] for s in sig]
chk("signals order == [10, 1, 5, CASH HUNT] — '10' rank-1, CASH HUNT back rank-4",
    names == ['10','1','5','CASH HUNT'], str(names))
chk("all 4 signal confs == 71 STRONG (highest uniform lock of era; was 54 MODERATE)",
    all(s['confidence'] == 71 for s in sig))
chk("ranges 10[70,88] 1[85,95] 5[75,90] CH[65,87]",
    [s['game']['confidenceRange'] for s in sig] == [[70,88],[85,95],[75,90],[65,87]])
chk("'10' carries repeat-unlikely (8%); CASH HUNT isBonus=true",
    'repeat-unlikely (8%)' in json.dumps(sig[0]['signals']) and sig[3]['game'].get('isBonus') is True)
chk("PACHINKO and COIN FLIP excluded from bench", 'PACHINKO' not in names and 'COIN FLIP' not in names)
chk("VALIDATION set-equal 6th read: signals set == panel lock order (#1..#4 STRONG boxes)",
    re.search(r'#1 \| STRONG \| 10 \|', tf) is not None and re.search(r'#2 \| STRONG \| 1 \|', tf) is not None
    and re.search(r'#3 \| STRONG \| 5 \|', tf) is not None and re.search(r'#4 \| STRONG \| CASH HUNT', tf) is not None)
chk("lock header LOCKED • 15:49 (== #120 display time 03:49 pm), POPUP ON",
    re.search(r'LOCKED \| • 15:49 \| POPUP ON', tf) is not None)
chk("DECISION ENGINE: 9× HIT / READY / BET / RISK LOW / 71% STRONG",
    re.search(r'9× HIT \| READY', tf) is not None and re.search(r'DECISION \| BET \| RISK: \| LOW', tf) is not None
    and re.search(r'71% \| STRONG', tf) is not None)
chk("bench trace: PACHINKO rank-1 book = 3 rounds #99-#101 (1H/2m) then out",
    top(h[98])=='PACHINKO' and top(h[99])=='PACHINKO' and top(h[100])=='PACHINKO' and top(h[101])!='PACHINKO'
    and [h[i]['hit'] for i in (98,99,100)] == [True,False,False])
chk("'1' rank-1 4 consecutive #113-#116 all HIT", all(top(h[i])=='1' and h[i]['hit'] for i in (112,113,114,115)))
chk("'10' rank-1 #119-#120 both HIT (incl #120 exact)", top(h[118])=='10' and top(h[119])=='10'
    and h[118]['hit'] and h[119]['hit'])

print("== 6. PANEL: BANNER / LEDGER / WINDOWS / LAST25 BUG 3RD READ ==")
chk("banner '9× HIT STREAK' N=120 — first HIT-form banner read of the era (MISS STREAK absent)",
    '9× HIT STREAK' in panel and 'N=120' in panel and 'MISS STREAK' not in panel)
chk("PATTERN SHIFT DETECTED persists, TVD INTENSIFIED 0.66 -> 0.84 > 0.60",
    'PATTERN SHIFT DETECTED' in panel and 'TVD=0.84' in panel)
chk("ledger census row: 80 HIT / 40 MISS / 120 SAMPLE; N=120/100",
    re.search(r'80 \| HIT \| 40 \| MISS \| 67% \| HIT RATE', tf) is not None and 'N=120/100' in tf)
chk("NORMAL HIT 73% MISS 27% n=104 / BONUS HIT 25% MISS 75% n=16 (single-line pairs)",
    re.search(r'NORMAL RESULTS \| HIT 73% \| MISS 27% \| n=104 rounds', tf) is not None
    and re.search(r'BONUS RESULTS \| HIT 25% \| MISS 75% \| n=16 rounds', tf) is not None)
chk("data parity: NORMAL 76/104=73.1->73%, BONUS 4/16=25%", abs((hits-4)/(n-16)*100-73.08) < 0.01 and abs(4/16*100-25.0) < 0.01)
chk("dashboard windows (X-rounds format) match data: L5 100%, L10 90%, L20 85%, L50 66%, L100+ 63%",
    re.search(r'LAST 5 \| 100% \| 5 rounds', tf) and re.search(r'LAST 10 \| 90% \| 10 rounds', tf)
    and re.search(r'LAST 20 \| 85% \| 20 rounds', tf) and re.search(r'LAST 50 \| 66% \| 50 rounds', tf)
    and re.search(r'LAST 100\+? \| 63% \| 100 rounds', tf))
chk("LEDGER LAST25 prints 85% n=25 — 3RD CONSECUTIVE PASS vs data 20/25=80%; 85% == L20 (17/20) -> bug PERMANENT",
    re.search(r'LAST 25 \| 85% \| n=25', tf) is not None and abs(20/25*100-80.0) < 0.01 and abs(17/20*100-85.0) < 0.01)
chk("Total Prediction Coverage 63.0% unchanged", 'Total Prediction Coverage | 63.0%' in tf)
chk("Trend up 7.3% (5th read: 8.1->4.5->10.4->5.2->7.3); Clusters 11 (was 14)",
    re.search(r'Trend \| ↑ 7\.3%', tf) is not None and re.search(r'Clusters \| 11', tf) is not None)
chk("BONUS RISK block: NORMAL COV 59.3, BONUS COV 3.7, RISK 13.0, Recent 20.0, Long-Term 12.7, BONUS ACTIVE",
    all(x in tf for x in ['NORMAL COVERAGE | 59.3%','BONUS COVERAGE | 3.7%','BONUS RISK | 13.0%',
                          'Bonus Recent | 20.0%','Bonus Long-Term | 12.7%','BONUS ACTIVE']))
chk("EXCLUDED RISK BREAKDOWN: Excl. Normal 24.1 / Excl. Bonus 13.0 / Total Exposure 37.0; 'recent evidence' line ABSENT (P278: present — presentation drift)",
    all(x in tf for x in ['Excl. Normal | 24.1%','Excl. Bonus | 13.0%','Total Exposure | 37.0%'])
    and 'Excluded outcomes with recent evidence' not in panel)
chk("INSUFFICIENT SAMPLE notice GONE (threshold exited; N=120/100 remains)", 'INSUFFICIENT SAMPLE' not in panel)
chk("RCA bonus over-selection diagnostic present (PACHINKO incl 23% vs base 4% etc.)",
    'PACHINKO (incl 23% vs base 4%)' in tf and 'over-selected' in tf)

print("== 7. PANEL: STRUCTURE (DEBUG 3rd persist / counters / AI / history) ==")
chk("DEBUG sections PERSIST into 3rd consecutive read (EVENT DEBUG LOG + PERFORMANCE DEBUG)",
    'EVENT DEBUG LOG' in panel and 'PERFORMANCE DEBUG' in panel)
chk("PIPELINE AUDIT 2 events: #120 [10,1,5,CH] HIT -> Pred#121; #119 [10,1,5,CH] HIT -> Pred#120; proof footer",
    '2 events logged' in tf
    and re.search(r'120 \| 10 \| \[10,1,5,CASH HUNT\] \| HIT \| 119 \| 120 \| \[10,1,5,CASH HUNT\] \| 121', tf) is not None
    and re.search(r'119 \| 5 \| \[10,1,5,CASH HUNT\] \| HIT \| 118 \| 119 \| \[10,1,5,CASH HUNT\] \| 120', tf) is not None
    and 'Pipeline proof:' in tf)
chk("PERF buffer n=2 (refilled): SRC->APP NOW 41.3s; agg avg 22.2s / P95 41.3s",
    '41.3s' in panel and '22.2s' in panel and 'N=2' in tf)
chk("counters 1,249 / 94% / 128 / 1.2k held — 8th consecutive REWIND pass",
    all(x in panel for x in ['1,249','94%','128','1.2k']))
chk("AI summary: Entropy 72, Volatility 22 (was 44), Hottest: 5 (field PRESENT again), Overdue: 2, streak 1 ×4",
    re.search(r'Entropy 72%[^\n]*Hottest: 5[^\n]*Overdue: 2[^\n]*Volatility 22/100[^\n]*Longest streak: 1 ×4', tf) is not None)
chk("AI variance table: '5' z +1.69 HOT; '2' z -1.38 OVERDUE gap 8",
    re.search(r'\+1\.69[^\n]*HOT', tf) is not None and re.search(r'-1\.38[^\n]*OVERDUE', tf) is not None)
chk("ROUND HISTORY newest-first 7th read: top card #120 HIT pred [10,1,5,CH] actual 10 03:49 pm conf 70%",
    re.search(r'ROUND HISTORY.{0,200}?10 \| 1 \| 5 \| CASH HUNT \| ACTUAL: \| 10 \| 03:49 pm \| Confidence: 70%', tf) is not None)
chk("ARCHIVE section absent (9th probe cycle)", 'ARCHIVE' not in panel)

print("== 8. SHADOW A/B (279th consecutive OFF) ==")
chk("'Shadow A/B is OFF' banner present", 'Shadow A/B is OFF' in panel)
chk("'No validation started' + START FRESH VALIDATION + SHADOW OFF badge",
    'No validation started' in panel and 'START FRESH VALIDATION' in panel and 'SHADOW OFF' in panel)
chk("no paired/flip metrics present (all 8 fields N/A)",
    not re.search(r'paired', panel, re.I) and not re.search(r'MISS.HIT flips?', panel, re.I))
chk("static pass-93 root-cause note present", '7 of 11 misses involved PACHINKO' in panel)
chk("replay button tracks N: REPLAY LIVE ROUNDS (120)", 'REPLAY LIVE ROUNDS (120)' in tf)

print("== 9. CONSOLE RING ==")
errs = raw('pass279_errors.json')['data']['messages']
types = Counter(m.get('type') for m in errs)
chk("ring capped at 1000 (999 log + 1 info, 0 error-type)",
    len(errs) == 1000 and types['log'] == 999 and types['info'] == 1 and types.get('error',0) == 0, str(dict(types)))
fr = sum(1 for m in errs if 'Fast Refresh' in json.dumps(m.get('args',[])))
chk("FR in-ring 2 (rebuild washed ring; was 15); tail = rebuilding -> done in 486ms",
    fr == 2 and 'rebuilding' in json.dumps(errs[-2].get('args',[]))
    and 'done in 486ms' in json.dumps(errs[-1].get('args',[])))

print("== 10. CROSS-SOURCE CONSISTENCY ==")
chk("history last round == panel top card: #120 actual '10' HIT conf 70 preds [10,1,5,CH]",
    act(h[-1]) == '10' and h[-1]['hit'] is True
    and [x['game']['name'] for x in h[-1]['prediction']] == ['10','1','5','CASH HUNT']
    and h[-1]['confidence'] == 70)
chk("signals ts == #120 pred ts family (fresh lock, 1789228156994)", abs(sig[0]['time'] - ts[-1]) < 60000,
    f"sig_t={sig[0]['time']} last={ts[-1]}")
chk("census parity: 80+40 == 120 == N=120/100", hits + (n-hits) == 120 and 'N=120/100' in tf)
chk("NORMAL n=104 + BONUS n=16 == 120", (n-16) + 16 == 120)
chk("panel char count 47,380 (+1,637 vs P278 45,743 — 22 cards + variance rows)", len(panel) == 47380, f"len={len(panel)}")

print("== 11. WORKLOG / GIT PRE-APPEND ==")
wl = open('/home/z/my-project/worklog.md').read()
blocks = wl.count('\n---\n') + (1 if wl.startswith('---\n') else 0)
chk("worklog blocks == 235 pre-append", blocks == 235, f"blocks={blocks}")
chk("chain top == Pass 278 (Task ID 323)", '## Pass 278 (Task ID 323)' in wl)
import subprocess
g = subprocess.run(['git','diff','62214ee','--','src/'], capture_output=True, text=True,
                   cwd='/home/z/my-project').stdout
chk("git diff 62214ee -- src/ == 0 (zero drift)", g.strip() == '', f"bytes={len(g)}")

print(f"\n==== {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
