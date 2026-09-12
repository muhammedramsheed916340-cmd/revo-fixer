#!/usr/bin/env python3
# Pass 275 independent verify — re-derives every claim from raw probe files with code paths
# separate from pass275_state.py (regex where state used find, independent loops, cross-source
# cross-checks). Verify-before-write convention.
# Boundary: this pass answers P274's watch list — regression glide, STALL #42, bench revolution,
# conf rung 70, REWIND 4th pass, ARCHIVE 5th probe, ring post-cap, VALIDATION 2nd read.
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

print("== 1. ERA-3 CENSUS (regression watch) ==")
h = res('pass275_history.json')
meta = res('pass275_meta.json')
n = len(h)
chk("n == 37", n == 37, f"n={n}")
chk("meta n == 37 (+0 landed during probe window — unlike P274's +1)", meta['n'] == 37 and meta['n'] == n, f"meta.n={meta['n']}")
hits = sum(1 for r in h if r['hit'] is True)
chk("census 30/37 = 81.08%", hits == 30 and abs(hits/n*100 - 81.081) < 0.01, f"{hits}/37 = {hits/n*100:.2f}%")
chk("glide from 88.24% (P274, n=17) toward era-1 lifetime 65.29%", 65.29 < hits/n*100 < 88.24, f"{hits/n*100:.2f}% between anchors")
chk("ceil(0.65*37)=25 -> surplus +5", -(-65*n//100) == 25 and hits-25 == 5)
chk("ceil(0.60*37)=23 -> surplus +7", -(-60*n//100) == 23 and hits-23 == 7)
w2 = h[17:]  # rounds #18-#37, the window P274 had not seen
w2hits = sum(1 for r in w2 if r['hit'])
chk("incremental window #18-#37 = 15/20 = 75.0% (still >65% base)", len(w2) == 20 and w2hits == 15 and abs(w2hits/20*100-75.0) < 0.01, f"{w2hits}/20")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
chk("exact 8 (top-1 == actual among hits)", sum(1 for r in h if r['hit'] and top(r)==act(r)) == 8)
chk("recal 7", sum(1 for r in h if r.get('recalibrated')) == 7)
chk("bonus actuals 4", sum(1 for r in h if act(r) in BONUS) == 4)
comp = Counter(act(r) for r in h)
chk("composition {'1':12,'2':10,'5':8,'10':3,'COIN FLIP':2,'CASH HUNT':1,'CRAZY TIME':1}",
    comp == Counter({'1':12,'2':10,'5':8,'10':3,'COIN FLIP':2,'CASH HUNT':1,'CRAZY TIME':1}), str(dict(comp)))
chk("keys == [revo_lastSignals, revo_roundHistory]", sorted(meta['keys']) == ['revo_lastSignals','revo_roundHistory'], str(meta['keys']))

print("== 2. RUNS / '5' DROUGHT / EXACT MAP ==")
marks = ['H' if r['hit'] else 'm' for r in h]
chk("record == HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHH", ''.join(marks) == 'HHHHHHHHHHmHHHHmHmHHmHHHHHmHHmHmHHHHH')
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
chk("max H-run 10 (opening run unchanged)", best == 10)
chk("live H-run 5 (#33-#37)", cur == 5)
chk("'5' went dry after #16 (flood 8/17 then zero in rounds 17-37)",
    max((i+1 for i,r in enumerate(h) if act(r)=='5'), default=0) == 16)
chk("exact X exactly at #4,#5,#6,#10,#15,#24,#25,#26",
    [i+1 for i,r in enumerate(h) if r['hit'] and top(r)==act(r)] == [4,5,6,10,15,24,25,26])
chk("'1' exact trio #24-#26 (rank-1 lock)", all(top(h[j])=='1' and act(h[j])=='1' for j in (23,24,25)))

print("== 3. CADENCE + STALL #42 ==")
ts = [r['time'] for r in h]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
chk("E3#1 ts == 22:28:19.285 (era start unchanged)", stamp(ts[0]).strftime('%H:%M:%S.%f')[:-3] == '22:28:19.285', stamp(ts[0]).isoformat())
chk("36 intervals", len(gaps) == 36)
chk("STALL #42: gap #29->#30 == 121.5s, the only >=90s of era-3", abs(gaps[28]-121.5) < 0.1 and sum(1 for g in gaps if g >= 90.0) == 1, f"g28={gaps[28]:.1f}s")
chk("STALL #42 wall-clock 22:46:44.672 -> 22:48:46.170", stamp(ts[28]).strftime('%H:%M:%S')=='22:46:44' and stamp(ts[29]).strftime('%H:%M:%S')=='22:48:46')
chk("min gap 1.465s at #18->#19 (instant recal-rescue; #36->#37 1.503s second — both sub-1.6s)",
    abs(gaps[17]-1.465) < 0.05 and gaps.index(min(gaps)) == 17 and abs(gaps[35]-1.503) < 0.05, f"min={min(gaps):.3f}s@idx17, g35={gaps[35]:.3f}s")
chk("avg 41.3s", abs(sum(gaps)/len(gaps)-41.3) < 0.15, f"avg={sum(gaps)/len(gaps):.1f}s")
chk("era-3 span E3#1 -> meta probe 1501.6s", abs((meta['ts']-ts[0])/1000-1501.6) < 1.0, f"{(meta['ts']-ts[0])/1000:.1f}s")

print("== 4. CONF LADDER BROKE 55 -> 70 (no longer monotone) ==")
confs = [r['confidence'] for r in h]
chk("head path [24]x5+[40]x5+[55]x10", confs[:20] == [24]*5+[40]*5+[55]*10, str(confs[:20]))
chk("ladder peak 70 reached (P274 watch: next rung 55 -> 70)", max(confs) == 70)
chk("no longer monotone (first drop 69 -> 59 at #22 after miss #21)", confs != sorted(confs) and confs[20] == 69 and confs[21] == 59)
chk("miss #21 at conf 69 = highest-conf miss of era-3", (not h[20]['hit']) and h[20]['confidence'] == 69)
chk("tail oscillates 58-70 (recal dips 59/58/65/59)", min(confs[20:]) == 58 and max(confs[20:]) == 70)

print("== 5. RECAL-ON-MISS: 7/7 RESCUE ==")
miss_idx = [i+1 for i,r in enumerate(h) if not r['hit']]
recal_idx = [i+1 for i,r in enumerate(h) if r.get('recalibrated')]
chk("misses exactly at #11,#16,#18,#21,#27,#30,#32", miss_idx == [11,16,18,21,27,30,32], str(miss_idx))
chk("recal flags exactly the round after each miss (#12,#17,#19,#22,#28,#31,#33)", recal_idx == [12,17,19,22,28,31,33], str(recal_idx))
chk("ALL 7 post-miss recal rounds HIT (7/7 rescue)", all(h[i-1]['hit'] for i in recal_idx))
chk("bonus miss book: #11 m CF, #27 m CH, #30 m CT; only bonus HIT is #12 CF",
    act(h[10])=='COIN FLIP' and act(h[26])=='CASH HUNT' and act(h[29])=='CRAZY TIME' and act(h[11])=='COIN FLIP' and h[11]['hit']
    and sum(1 for r in h if act(r) in BONUS and r['hit']) == 1)

print("== 6. SIGNALS / BENCH REVOLUTION ==")
s = res('pass275_signals.json')
order = [x['game']['name'] for x in s]
chk("bench order [CRAZY TIME, CASH HUNT, 2, 1]", order == ['CRAZY TIME','CASH HUNT','2','1'], str(order))
chk("CRAZY TIME rank-1 — first-ever CT top slot (audition answer: CF out, CT in)", order[0] == 'CRAZY TIME')
chk("'2' re-entered bench (rank-3) and '5' out entirely — P274 watch answered", '2' in order and '5' not in order)
chk("uniform conf 70 across all 4 (was 55 at P274)", set(x['confidence'] for x in s) == {70})
chk("2 of 4 bench entries are bonus games (CT, CH)", sum(1 for x in s if x['game'].get('isBonus')) == 2)
chk("ranges CT[55,82] CH[65,87] 2[80,92] 1[85,95]",
    [x['game']['confidenceRange'] for x in s] == [[55,82],[65,87],[80,92],[85,95]], str([x['game']['confidenceRange'] for x in s]))
chk("rank labels strongest/second/third/fourth", [x['label'] for x in s] == ['strongest evidence','second strongest','third strongest','fourth strongest'])

print("== 7. PANEL ==")
t = res('pass275_panel_live.json')
tf = t.replace('\n',' | ')
tfx = tf.replace('\t',' | ')   # EVENT DEBUG cells are TAB-separated (P275 matcher lesson)
chk("panel 34,853 chars (±2 tolerance; was 32,799 at P274)", abs(len(t)-34853) <= 2, str(len(t)))
chk("Shadow OFF banner PRESENT", 'Shadow A/B is OFF' in t)
missing = [k for k in ['paired rounds','MISS→HIT','HIT→MISS','MISS RCA'] if k in t]
chk("shadow metric labels ABSENT (paired/flip/RCA)", missing == [], str(missing))
chk("'theoretical' hit is benign footnote (wheel-coverage disclaimer)", 'Theoretical wheel coverage is a mathematical baseline' in t)
m8 = re.search(r'REPLAY LIVE ROUNDS \((\d+)\)', tf)
chk("REPLAY LIVE ROUNDS (37)", m8 and m8.group(1) == '37')
mv = re.search(r'VALIDATION CRITERIA \|? Next actual result must match one of \[([^\]]+)\]', tf)
valset = set(x.strip() for x in mv.group(1).split(',')) if mv else set()
chk("VALIDATION set-equal to bench (2nd read confirmed)", valset == set(order), str(valset))
ml = re.search(r'N=(\d+)/100 \|? \d+ \|? TOTAL PREDICTIONS \|? (\d+) \|? HIT \|? (\d+) \|? MISS \|? (\d+)% \|? HIT RATE', tf)
chk("LEDGER N=37 30H 7M 81%", ml and (ml.group(1),ml.group(2),ml.group(3),ml.group(4))==('37','30','7','81'), ml.groups() if ml else 'no match')
chk("LAST 5 100% / LAST 10 80% / LAST 25 75% n=25", re.search(r'LAST 5 \|? 100% \|? n=5 \|? LAST 10 \|? 80% \|? n=10 \|? LAST 25 \|? 75% \|? n=25', tf) is not None)
chk("LAST 50 81% n=37 / LAST 100 81% n=37", re.search(r'LAST 50 \|? 81% \|? n=37 \|? LAST 100 \|? 81% \|? n=37', tf) is not None)
chk("NORMAL 88% n=33 / BONUS 25% n=4", re.search(r'NORMAL RESULTS \|? 88% \|? n=33', tf) and re.search(r'BONUS RESULTS \|? 25% \|? n=4', tf))
chk("census parity: ledger 30H/7M == history 30/37", (30+7) == 37 and hits == 30)
chk("PATTERN SHIFT DETECTED lit 2nd read, TVD eased 1.20 -> 0.81", 'PATTERN SHIFT DETECTED' in t and 'TVD=0.81 > 0.60' in tf)
chk("MISS STREAK absent", 'MISS STREAK' not in t)
chk("ARCHIVE lazy section ABSENT (5th probe cycle)", 'ARCHIVE' not in t)
chk("banner N=37 81/19/69/68/81/19/61/100", re.search(r'HIT STREAK \|? N=37 \|? 81% \|? HIT RATE \|? 19% \|? MISS RATE \|? 69% \|? COVERAGE \|? 68% \|? STABILITY \|? 81% \|? LONG-TERM \|? 19% \|? EXCLUDED RATE \|? 61% \|? ADAPTIVE WT \|? 100% \|? RECENT', tf) is not None)
chk("Trend FLIPPED to ↑ 8.1 / Clusters 4 / TPC 68.5 (was ↓ 10.6 / 4 / 74.1)", re.search(r'Trend \|? ↑ 8\.1% \|? Clusters \|? 4 \|? Total Prediction Coverage \|? 68\.5%', tf) is not None)
chk("BONUS RISK 63.0/5.5/11.1/20.0/11.9 (Bonus Recent 0.0 -> 20.0)", re.search(r'NORMAL COVERAGE \|? 63\.0% \|? BONUS COVERAGE \|? 5\.5% \|? BONUS RISK \|? 11\.1% \|? Bonus Recent \|? 20\.0% \|? Bonus Long-Term \|? 11\.9%', tf) is not None)
chk("AI format change: Hottest field GONE, Entropy 78, Overdue 10, Vol 26, streak 1 x3",
    re.search(r'30 spins analyzed • Entropy 78% • Overdue: 10 • Volatility 26/100 • Longest streak: 1 ×3', tf) is not None and 'Hottest:' not in t)
chk("EVENT DEBUG 2 events (rolling buffer rolled #16/#17 -> #36/#37)", '2 events logged' in t)
chk("PERF DEBUG n=2, SRC→APP (NOW) 48.5s (latency regression watch: was 2.2s, era-2 spike 51.7s)", re.search(r'n=2 \|? SRC→APP \(NOW\) \|? 48\.5s', tf) is not None, tf[tf.find('SRC→APP'):tf.find('SRC→APP')+60] if 'SRC→APP' in tf else '')
chk("stale:0 dup:0", 'stale:0 dup:0' in t)
chk("platform counters 1,249/94%/128/1.2k (REWIND held 4th pass)", re.search(r'1,249 \|? TOTAL \|? 94% \|? ACCURACY \|? 128 \|? BONUS \|? 1\.2k \|? LIVE', tf) is not None)
chk("lock label UPGRADED: MODERATE gone, STRONG • 14:53 (Pred#38 locked 22:53:07 +08)",
    'MODERATE' not in t and re.search(r'LOCKED \|? • 14:53 \|? POPUP ON \|? #1 \|? STRONG \|? CRAZY TIME \|? ★ BONUS ROUND', tfx) is not None)
ih = t.find('ROUND HISTORY')
topcard = t[ih:ih+200]
chk("ROUND HISTORY top card = #37 HIT pred [CH,CT,2,1] actual '2' 02:53 pm conf 70% (not RECAL)",
    ('HIT' in topcard and 'ACTUAL: | 2 | 02:53 pm' in topcard.replace('\n',' | ') and '70%' in topcard and 'RECALIBRATED' not in topcard), topcard[:120].replace('\n',' | '))
i249 = t.find('1,249')
lastcard = t[max(0,i249-400):i249]
chk("list bottom card = E3#1 (pred [10,5,1,2] actual '2' 02:28 pm conf 24%) — newest-first 3rd read",
    ('10 | 5 | 1 | 2' in lastcard.replace('\n',' | ') and 'ACTUAL: | 2 | 02:28 pm' in lastcard.replace('\n',' | ')), lastcard[:120].replace('\n',' | '))

print("== 8. CONSOLE RING (post-cap) ==")
con = raw('pass275_errors.json').get('data', {})
msgs = con.get('messages', [])
types = Counter(m.get('type','?') for m in msgs)
fr = sum(1 for m in msgs if '[Fast Refresh]' in json.dumps(m.get('args',[])))
errs = sum(1 for m in msgs if m.get('type') in ('error','warning'))
chk("ring == 1000 messages (still at cap)", len(msgs) == 1000, str(len(msgs)))
chk("999 log + 1 info, 0 error/warning", types.get('log')==999 and types.get('info')==1 and errs==0, str(dict(types)))
chk("[Fast Refresh] = 18 (recompile storm continues, count 20 -> 18)", fr == 18, str(fr))
chk("ring tail is a Fast Refresh completion", '[Fast Refresh]' in json.dumps(msgs[-1].get('args',[])))

print("== 9. CROSS-CHECKS (event debug vs history) ==")
ev37 = re.search(r'37 \|? 2 \|? \[CASH HUNT,CRAZY TIME,2,1\] \|? HIT \|? 36 \|? 37 \|? \[CRAZY TIME,CASH HUNT,2,1\]', tfx)
ev36 = re.search(r'36 \|? 1 \|? \[CASH HUNT,CRAZY TIME,2,1\] \|? HIT \|? 35 \|? 36 \|? \[CASH HUNT,CRAZY TIME,2,1\]', tfx)
chk("EVENT DEBUG row #37 matches history (actual 2, HIT, 36->37, new pred CT,CH,2,1 Pred#38)", ev37 is not None)
chk("EVENT DEBUG row #36 matches history (actual 1, HIT, 35->36)", ev36 is not None)
chk("history #37 pred [CASH HUNT,CRAZY TIME,2,1]", [p['game']['name'] for p in h[36]['prediction']] == ['CASH HUNT','CRAZY TIME','2','1'], str([p['game']['name'] for p in h[36]['prediction']]))
chk("history #11 pred contains PACHINKO+CASH HUNT (bonus entries were in play)", {'PACHINKO','CASH HUNT'} <= {p['game']['name'] for p in h[10]['prediction']})
chk("pipeline proof line present", 'Pipeline proof:' in t)

print("== 10. GIT ZERO-DRIFT + CHAIN ==")
last_src = subprocess.run(['git','log','-1','--format=%H','--','src/'], capture_output=True, text=True).stdout.strip()
diff = subprocess.run(['git','diff',last_src,'--','src/'], capture_output=True, text=True).stdout
chk(f"git diff {last_src[:7]} -- src/ == 0", diff == '', f"({len(diff)} bytes)")
nblocks = subprocess.run(['rg','-c','^---$','worklog.md'], capture_output=True, text=True).stdout.strip()
chk("worklog blocks == 231 pre-append (chain top P274)", nblocks == '231', nblocks)
topline = subprocess.run(['rg','-n','^## Pass 274','worklog.md'], capture_output=True, text=True).stdout
chk("chain top block is Pass 274", topline.strip() != '')

print("== 11. INCIDENT EVIDENCE (probe files) ==")
import os
for f in ['pass275_open.json','pass275_meta.json','pass275_history.json','pass275_signals.json','pass275_panel_live.json','pass275_errors.json','pass275_page.json']:
    chk(f"{f} exists non-empty", os.path.getsize('scripts/data/'+f) > 100)
op = raw('pass275_open.json')['data']['lifecycle']
chk("open reused:true (era-3 browser alive, no relaunch)", op.get('reused') is True and op.get('launched') is False, str({k:op.get(k) for k in ('reused','launched')}))
pg = res('pass275_page.json')
chk("page ts == 22:53:21.178 (probe window integrity)", stamp(pg['ts']).strftime('%H:%M:%S.%f')[:-3] == '22:53:21.178', stamp(pg['ts']).isoformat())

print(f"\n==== VERIFY SUMMARY: {sum(P)}/{len(P)} PASSED ====")
raise SystemExit(0 if all(P) else 1)
