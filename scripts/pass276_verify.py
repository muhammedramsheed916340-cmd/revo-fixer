#!/usr/bin/env python3
# Pass 276 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass276_state.py (regex where state used find, independent loops, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: answers P275's watch list — glide continuation, CT rank-1 audition, STALL #43,
# conf collapse, STRONG lock survival, Trend survival, REWIND 5th, ARCHIVE 6th, ring churn,
# VALIDATION 3rd read. NEW this pass: panel stripped both DEBUG sections; banner label is now
# dynamic ("5x MISS STREAK"); recal mechanism failing (4 consecutive recal-MISS); conf 46.
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

print("== 1. ERA-3 CENSUS (glide overshoot) ==")
h = res('pass276_history.json')
meta = res('pass276_meta.json')
n = len(h)
chk("n == 54", n == 54, f"n={n}")
chk("meta n == 54 (+0 landed during probe window)", meta['n'] == 54 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 38/54 = 70.37%", hits == 38 and abs(hits/n*100 - 70.37) < 0.01, f"{hits}/54 = {hits/n*100:.2f}%")
chk("glide continued: 70.37 between 65.29 lifetime and P275's 81.08", 65.29 < hits/n*100 < 81.09, f"{hits/n*100:.2f}%")
chk("ceil(0.65*54)=36 -> surplus +2 (was +5 at P275)", -(-65*n//100) == 36 and hits-36 == 2)
chk("ceil(0.60*54)=33 -> surplus +5", -(-60*n//100) == 33 and hits-33 == 5)
w3 = h[37:]  # rounds #38-#54, unseen at P275
w3hits = sum(1 for r in w3 if r['hit'])
chk("incremental window #38-#54 = 8/17 = 47.06% — BELOW the 65% base (cold overshoot)", len(w3) == 17 and w3hits == 8 and abs(w3hits/17*100-47.06) < 0.01, f"{w3hits}/17")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("exact 8 (unchanged since P275)", sum(1 for r in h if r['hit'] and top(r)==act(r)) == 8)
chk("recal 15 (was 7)", sum(1 for r in h if r.get('recalibrated')) == 15)
chk("bonus actuals 8 (was 4)", sum(1 for r in h if act(r) in BONUS) == 8)
comp = Counter(act(r) for r in h)
chk("composition {'1':17,'2':15,'5':10,'10':4,'COIN FLIP':3,'CASH HUNT':3,'CRAZY TIME':2}",
    comp == Counter({'1':17,'2':15,'5':10,'10':4,'COIN FLIP':3,'CASH HUNT':3,'CRAZY TIME':2}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / STREAKS / DROUGHTS ==")
marks = ['H' if r['hit'] else 'm' for r in h]
chk("record == HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHHmHHHmHmmHHHHmmmmm", ''.join(marks) == 'HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHHmHHHmHmmHHHHmmmmm')
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
chk("max H-run 10 unchanged", best == 10)
chk("live H-run 0 — five-round MISS streak #50-#54 live", cur == 0 and ''.join(marks[-5:]) == 'mmmmm')
chk("exact X exactly at #4,#5,#6,#10,#15,#24,#25,#26 (no new exacts in #38-#54)",
    [i+1 for i,r in enumerate(h) if r['hit'] and top(r)==act(r)] == [4,5,6,10,15,24,25,26])
chk("'5' HITS still end at #15 (post-#16 '5' actuals all MISS: #16, #38, #53)",
    max((i+1 for i,r in enumerate(h) if r['hit'] and act(r)=='5'), default=0) == 15
    and [i+1 for i,r in enumerate(h) if act(r)=='5' and not r['hit']] == [16,38,53])
chk("PACHINKO STILL zero actuals across 54 rounds", sum(1 for r in h if act(r)=='PACHINKO') == 0)
chk("CRAZY TIME as actual exactly #30 and #50, both MISS (CT book 0-for-2)",
    [i+1 for i,r in enumerate(h) if act(r)=='CRAZY TIME'] == [30,50]
    and not h[29]['hit'] and not h[49]['hit'])

print("== 3. CADENCE + STALL #43 ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285')
chk("53 intervals", len(gaps) == 53)
chk("exactly 2 stall-class gaps: STALL #42 121.5s (idx 28) + STALL #43 95.9s (idx 48)",
    abs(gaps[28]-121.5) < 0.1 and abs(gaps[48]-95.905) < 0.1 and sum(1 for g in gaps if g >= 90.0) == 2, f"g28={gaps[28]:.1f} g48={gaps[48]:.1f}")
chk("STALL #43 wall-clock 23:00:23.872 -> 23:01:59.777 (#49 -> #50)",
    stamp(ts[48]).strftime('%H:%M:%S.%f')[:-3]=='23:00:23.872' and stamp(ts[49]).strftime('%H:%M:%S.%f')[:-3]=='23:01:59.777')
chk("min 1.465s at #18->#19 unchanged", gaps.index(min(gaps)) == 17 and abs(min(gaps)-1.465) < 0.05, f"min={min(gaps):.3f}")
chk("avg 41.3s", abs(sum(gaps)/len(gaps)-41.3) < 0.15, f"avg={sum(gaps)/len(gaps):.1f}")
chk("era-3 span E3#1 -> meta probe 2252.5s", abs((meta['ts']-ts[0])/1000-2252.5) < 1.0, f"{(meta['ts']-ts[0])/1000:.1f}s")

print("== 4. CONF COLLAPSE (70-hold answered: NO) ==")
confs = [r['confidence'] for r in h]
chk("head path [24]x5+[40]x5+[55]x10 unchanged", confs[:20] == [24]*5+[40]*5+[55]*10)
chk("peak 70 unchanged", max(confs) == 70)
chk("#54 conf 46 — era minimum above the opening 24-block", confs[53] == 46 and min(confs[15:]) == 46)
chk("final five confs == [70,62,57,55,46] (#50-#54)", confs[49:] == [70,62,57,55,46], str(confs[49:]))
chk("miss #50 at conf 70 (peak-conf miss), then unbroken slide", (not h[49]['hit']) and h[49]['confidence'] == 70)

print("== 5. RECAL MECHANISM BROKEN ==")
miss_idx = [i+1 for i,r in enumerate(h) if not r['hit']]
recal_idx = [i+1 for i,r in enumerate(h) if r.get('recalibrated')]
chk("misses exactly at #11,#16,#18,#21,#27,#30,#32,#38,#42,#44,#45,#50,#51,#52,#53,#54",
    miss_idx == [11,16,18,21,27,30,32,38,42,44,45,50,51,52,53,54], str(miss_idx))
chk("recal flags exactly at #12,#17,#19,#22,#28,#31,#33,#39,#43,#45,#46,#51,#52,#53,#54",
    recal_idx == [12,17,19,22,28,31,33,39,43,45,46,51,52,53,54], str(recal_idx))
rescued = [i for i in recal_idx if h[i-1]['hit']]
chk("rescue rate 10/15 (was 7/7 at P275 — mechanism degrading)", len(rescued) == 10, str(rescued))
chk("FOUR consecutive recal-MISS at #51-#54 (first multi-failure of era-3)",
    all((not h[i-1]['hit']) for i in (51,52,53,54)))
chk("bonus book: m#11 CF / H#12 CF / m#27 CH / m#30 CT / m#42 CH / H#43 CH / m#45 CF / m#50 CT",
    [(i+1, act(r), r['hit']) for i,r in enumerate(h) if act(r) in BONUS] ==
    [(11,'COIN FLIP',False),(12,'COIN FLIP',True),(27,'CASH HUNT',False),(30,'CRAZY TIME',False),
     (42,'CASH HUNT',False),(43,'CASH HUNT',True),(45,'COIN FLIP',False),(50,'CRAZY TIME',False)])
chk("bonus HIT rate 2/8 = 25% (only #12 CF rescue + #43 CH rescue)", sum(1 for r in h if act(r) in BONUS and r['hit']) == 2)

print("== 6. SIGNALS / BENCH @39 ==")
s = res('pass276_signals.json')
order = [x['game']['name'] for x in s]
chk("bench order [CRAZY TIME, 1, 2, CASH HUNT]", order == ['CRAZY TIME','1','2','CASH HUNT'], str(order))
chk("CRAZY TIME rank-1 for 2nd consecutive read", order[0] == 'CRAZY TIME')
chk("CASH HUNT demoted rank-4; '1' promoted rank-2 (P275 order was CT,CH,2,1)", order[3] == 'CASH HUNT' and order[1] == '1')
chk("uniform conf COLLAPSED 70 -> 39 across all 4", set(x['confidence'] for x in s) == {39})
chk("ranges CT[55,82] 1[85,95] 2[80,92] CH[65,87]",
    [x['game']['confidenceRange'] for x in s] == [[55,82],[85,95],[80,92],[65,87]], str([x['game']['confidenceRange'] for x in s]))
chk("2 of 4 bench entries bonus (CT, CH)", sum(1 for x in s if x['game'].get('isBonus')) == 2)
chk("rank labels strongest/second/third/fourth", [x['label'] for x in s] == ['strongest evidence','second strongest','third strongest','fourth strongest'])

print("== 7. PANEL (restructured) ==")
t = res('pass276_panel_live.json')
tf = t.replace('\n',' | ').replace('\t',' | ')
chk("panel 37,144 chars (±2; was 34,853 at P275)", abs(len(t)-37144) <= 2, str(len(t)))
chk("Shadow OFF banner PRESENT", 'Shadow A/B is OFF' in t)
missing = [k for k in ['paired rounds','MISS→HIT','HIT→MISS','MISS RCA'] if k in t]
chk("shadow metric labels ABSENT (paired/flip/RCA)", missing == [], str(missing))
chk("STRUCTURE CHANGE: both DEBUG sections STRIPPED — zero 'DEBUG' occurrences (was EVENT+PERF DEBUG at P275)", 'DEBUG' not in t)
chk("STRUCTURE CHANGE: banner label dynamic — 'HIT STREAK' absent, '5× MISS STREAK' lit", 'HIT STREAK' not in t and '5× MISS STREAK' in t)
chk("PATTERN SHIFT DETECTED extinguished (was lit 2 reads, TVD 1.20->0.81)", 'PATTERN SHIFT DETECTED' not in t and 'TVD' not in t)
chk("ARCHIVE lazy section ABSENT (6th probe cycle)", 'ARCHIVE' not in t)
m8 = re.search(r'REPLAY LIVE ROUNDS \((\d+)\)', tf)
chk("REPLAY LIVE ROUNDS (54)", m8 and m8.group(1) == '54')
mv = re.search(r'VALIDATION CRITERIA \|? Next actual result must match one of \[([^\]]+)\]', tf)
valset = set(x.strip() for x in mv.group(1).split(',')) if mv else set()
chk("VALIDATION set-equal to bench (3rd read confirmed)", valset == set(order), str(valset))
ml = re.search(r'N=(\d+)/100 \|? \d+ \|? TOTAL PREDICTIONS \|? (\d+) \|? HIT \|? (\d+) \|? MISS \|? (\d+)% \|? HIT RATE', tf)
chk("LEDGER N=54 38H 16M 70%", ml and (ml.group(1),ml.group(2),ml.group(3),ml.group(4))==('54','38','16','70'), ml.groups() if ml else 'no match')
chk("LAST 5 0% n=5 (five-miss streak in ledger)", re.search(r'LAST 5 \|? 0% \|? n=5', tf) is not None)
chk("LAST 10 40% / LAST 25 55% n=25", re.search(r'LAST 10 \|? 40% \|? n=10 \|? LAST 25 \|? 55% \|? n=25', tf) is not None)
chk("LAST 50 68% n=50 / LAST 100 70% n=54", re.search(r'LAST 50 \|? 68% \|? n=50 \|? LAST 100 \|? 70% \|? n=54', tf) is not None)
chk("NORMAL 78% MISS 22% n=46 / BONUS 25% MISS 75% n=8", re.search(r'NORMAL RESULTS \|? HIT 78% \|? MISS 22% \|? n=46', tf) and re.search(r'BONUS RESULTS \|? HIT 25% \|? MISS 75% \|? n=8', tf))
chk("census parity: ledger 38H/16M == history 38/54", (38+16) == 54 and hits == 38)
chk("banner 5× MISS STREAK N=54 70/30/43/52/70/30/80/0", re.search(r'5× MISS STREAK \|? N=54 \|? 70% \|? HIT RATE \|? 30% \|? MISS RATE \|? 43% \|? COVERAGE \|? 52% \|? STABILITY \|? 70% \|? LONG-TERM \|? 30% \|? EXCLUDED RATE \|? 80% \|? ADAPTIVE WT \|? 0% \|? RECENT', tf) is not None)
chk("Trend survived flip but eased: ↑ 4.5% (was 8.1) / Clusters 6 (was 4) / TPC 42.6% (was 68.5)", re.search(r'Trend \|? ↑ 4\.5% \|? Clusters \|? 6 \|? Total Prediction Coverage \|? 42\.6%', tf) is not None)
chk("BONUS RISK 37.0/5.5/11.1/20.0/15.5 (NORMAL COVERAGE 63.0 -> 37.0)", re.search(r'NORMAL COVERAGE \|? 37\.0% \|? BONUS COVERAGE \|? 5\.5% \|? BONUS RISK \|? 11\.1% \|? Bonus Recent \|? 20\.0% \|? Bonus Long-Term \|? 15\.5%', tf) is not None)
chk("AI: Hottest field RETURNED as CRAZY TIME, Entropy 78, Vol 28, streak 1×3",
    re.search(r'30 spins analyzed • Entropy 78% • Hottest: CRAZY TIME • Volatility 28/100 • Longest streak: 1 ×3', tf) is not None)
chk("counters 1,249/94%/128/1.2k (REWIND held 5th pass)", re.search(r'1,249 \|? TOTAL \|? 94% \|? ACCURACY \|? 128 \|? BONUS \|? 1\.2k \|? LIVE', tf) is not None)
chk("lock DOWNgraded to LOW CONFIDENCE • 15:05 (#1 CRAZY TIME; STRONG survived <15 min)", re.search(r'LOCKED \|? • 15:05 \|? POPUP ON \|? #1 \|? LOW CONFIDENCE \|? CRAZY TIME \|? ★ BONUS ROUND', tf) is not None and 'STRONGEST EVIDENCE' in t)
chk("recal note on top card (fresh ranking: repeat-pattern, trend, stability)", 'Recalibration triggered by MISS' in t and 'repeat-pattern' in t)
ih = t.find('ROUND HISTORY')
topcard = t[ih:ih+220]
chk("ROUND HISTORY top card = #54 MISS pred [CT,CH,2,5] actual '1' 03:04 pm RECALIBRATED conf 46%",
    ('MISS' in topcard and 'ACTUAL: | 1 | 03:04 pm' in topcard.replace('\n',' | ') and 'RECALIBRATED' in topcard and '46%' in topcard), topcard[:130].replace('\n',' | '))
i249 = t.find('1,249')
lastcard = t[max(0,i249-400):i249]
chk("list bottom card = E3#1 (pred [10,5,1,2] actual '2' 02:28 pm conf 24%) — newest-first 4th read",
    ('10 | 5 | 1 | 2' in lastcard.replace('\n',' | ') and 'ACTUAL: | 2 | 02:28 pm' in lastcard.replace('\n',' | ')))
chk("'LAST LIVE RESULT' section present", 'LAST LIVE RESULT' in t)

print("== 8. CONSOLE RING (post-cap) ==")
con = raw('pass276_errors.json').get('data', {})
msgs = con.get('messages', [])
types = Counter(m.get('type','?') for m in msgs)
fr = sum(1 for m in msgs if '[Fast Refresh]' in json.dumps(m.get('args',[])))
errs = sum(1 for m in msgs if m.get('type') in ('error','warning'))
chk("ring == 1000 messages (still at cap)", len(msgs) == 1000, str(len(msgs)))
chk("999 log + 1 info, 0 error/warning", types.get('log')==999 and types.get('info')==1 and errs==0, str(dict(types)))
chk("[Fast Refresh] = 22 (storm intensifying: 18 -> 22)", fr == 22, str(fr))
chk("ring tail is a Fast Refresh completion", '[Fast Refresh]' in json.dumps(msgs[-1].get('args',[])))

print("== 9. CROSS-CHECKS (panel vs history, DEBUG sections gone) ==")
chk("history #54 pred [CRAZY TIME,CASH HUNT,2,5] == top card", [p['game']['name'] for p in h[53]['prediction']] == ['CRAZY TIME','CASH HUNT','2','5'], str([p['game']['name'] for p in h[53]['prediction']]))
chk("history #49 pred contains PACHINKO (bonus in play at STALL #43 boundary)", 'PACHINKO' in [p['game']['name'] for p in h[48]['prediction']])
chk("ledger window n=54 == REPLAY (54) == history n (triple parity)", n == 54 and m8.group(1) == '54')
chk("bench order == VALIDATION set == panel lock #1 (CRAZY TIME)", order[0] == 'CRAZY TIME' and valset == set(order))

print("== 10. GIT ZERO-DRIFT + CHAIN ==")
last_src = subprocess.run(['git','log','-1','--format=%H','--','src/'], capture_output=True, text=True).stdout.strip()
diff = subprocess.run(['git','diff',last_src,'--','src/'], capture_output=True, text=True).stdout
chk(f"git diff {last_src[:7]} -- src/ == 0", diff == '', f"({len(diff)} bytes)")
nblocks = subprocess.run(['rg','-c','^---$','worklog.md'], capture_output=True, text=True).stdout.strip()
chk("worklog blocks == 232 pre-append (chain top P275)", nblocks == '232', nblocks)
topline = subprocess.run(['rg','-n','^## Pass 275','worklog.md'], capture_output=True, text=True).stdout
chk("chain top block is Pass 275", topline.strip() != '')

print("== 11. INCIDENT EVIDENCE (probe files) ==")
import os
for f in ['pass276_open.json','pass276_meta.json','pass276_history.json','pass276_signals.json','pass276_panel_live.json','pass276_errors.json','pass276_page.json']:
    chk(f"{f} exists non-empty", os.path.getsize('scripts/data/'+f) > 100)
op = raw('pass276_open.json')['data']['lifecycle']
chk("open reused:true (era-3 browser alive, no relaunch)", op.get('reused') is True and op.get('launched') is False, str({k:op.get(k) for k in ('reused','launched')}))
pg = res('pass276_page.json')
chk("page ts == 23:05:51.967 (probe window integrity)", stamp(pg['ts']).strftime('%H:%M:%S.%f')[:-3] == '23:05:51.967', stamp(pg['ts']).isoformat())

print(f"\n==== VERIFY SUMMARY: {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
