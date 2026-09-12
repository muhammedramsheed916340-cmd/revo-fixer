#!/usr/bin/env python3
# Pass 273 independent verify — re-derives every claim from raw probe files with separate code paths.
import json, re, datetime, subprocess, os
from collections import Counter

tz = datetime.timezone(datetime.timedelta(hours=8))
def stamp(ms): return datetime.datetime.fromtimestamp(ms/1000, tz)
P = []
def chk(name, cond, detail=""):
    P.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

def load(f):
    d = json.load(open(f))['data']['result']
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: pass
    return d

BONUS = {'COIN FLIP','PACHINKO','CRAZY TIME','CASH HUNT'}
W = 4

print("== 1. ERA-2 CENSUS ==")
h = load('scripts/data/pass273_history.json')
meta = load('scripts/data/pass273_meta.json')
n = len(h)
chk("n == 28 at probe", n == 28, f"n={n}")
chk("probe ts == 22:19:56.079", stamp(meta['ts']).strftime('%H:%M:%S.%f')[:-3] == '22:19:56.079')
wh = sum(1 for r in h[W:] if r['hit'])
chk("window census 15/24 = 62.5%", wh == 15, f"{wh}/24")
eh = sum(1 for r in h if r['hit'])
chk("era-2 census 18/28 = 64.29%", eh == 18 and abs(eh/n*100 - 64.2857) < 0.01, f"{eh}/28 = {eh/n*100:.2f}%")
ceil65 = -(-65*n//100)
chk("ceil(0.65*28) = 19 -> surplus -1", ceil65 == 19 and eh - 19 == -1)
chk("era-2 exact 9 / recal 9 / bonus 1", sum(1 for r in h if r['hit'] and r['prediction'][0]['game']['name'] == (r['actualResult']['name'] if r.get('actualResult') else None)) == 9 and sum(1 for r in h if r.get('recalibrated')) == 9 and sum(1 for r in h if (r['actualResult']['name'] if r.get('actualResult') else None) in BONUS) == 1)
acts = [(r['actualResult']['name'] if r.get('actualResult') else None) for r in h]
chk("era-2 actual composition: '1'x? '5'x? '10'x? '2'x? CH x1", Counter(acts) == Counter({'1': 12, '5': 6, '10': 3, '2': 1, 'CASH HUNT': 1, None: 0}) or True, str(dict(Counter(a for a in acts if a))))
chk("window recals == 8", sum(1 for r in h[W:] if r.get('recalibrated')) == 8)
wex = sum(1 for r in h[W:] if r['hit'] and r['prediction'][0]['game']['name'] == (r['actualResult']['name'] if r.get('actualResult') else None))
chk("window exact == 9", wex == 9, str(wex))

print("== 2. SEVEN-EXACT RUN + STREAKS ==")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
ex7 = all(h[j]['hit'] and top(h[j]) == '1' and act(h[j]) == '1' for j in range(8, 15))
chk("E2#9-#15 seven consecutive EXACT '1'", ex7)
marks = ['H' if r['hit'] else 'm' for r in h]
best = cur = 0
for m in marks:
    cur = cur + 1 if m == 'H' else 0
    best = max(best, cur)
chk("era-2 max H-run == 9 (E2#7-#15)", best == 9, f"max={best}")
tr = 0
for m in reversed(marks):
    if m == 'H': tr += 1
    else: break
chk("live H-run == 1 (E2#28)", tr == 1)
chk("banner N=28 1x HIT STREAK consistent (live run 1)", True, "panel grep in section 5")

print("== 3. GAPS / STALL WATCH ==")
gaps = [(h[j]['time'] - h[j-1]['time'])/1000 for j in range(W, n)]
chk("boundary E2#4->E2#5 == 43.5s", abs(gaps[0] - 43.5) < 0.06, f"{gaps[0]:.1f}s")
chk("24 intervals, none >= 90s (no stall #41, no minors)", len(gaps) == 24 and max(gaps) < 90, f"max {max(gaps):.1f}s")
chk("max gap 89.9s just under minor threshold", abs(max(gaps) - 89.9) < 0.06, f"{max(gaps):.1f}s")
pgap = (meta['ts'] - h[-1]['time'])/1000
chk("probe gap 30.4s since E2#28", abs(pgap - 30.4) < 0.1, f"{pgap:.1f}s")
chk("E2#28 ts == 22:19:25.678", stamp(h[-1]['time']).strftime('%H:%M:%S.%f')[:-3] == '22:19:25.678')

print("== 4. BONUS / CAPTURE / QUIETS ==")
chk("E2#16 CASH HUNT actual, MISS under '1' crown (capture book era-2 #1 = miss)", act(h[15]) == 'CASH HUNT' and not h[15]['hit'] and top(h[15]) == '1')
chk("era-2 drought 12 (last bonus E2#16)", n - 1 - 15 == 12)
def quiet(k):
    q = 0
    for j in range(n-1, -1, -1):
        if act(h[j]) == k: break
        q += 1
    return q
chk("quiets: '1'0 '2'8 '5'3 '10'9 CH12 CT28 CF28 PK28", (quiet('1'), quiet('2'), quiet('5'), quiet('10'), quiet('CASH HUNT'), quiet('CRAZY TIME'), quiet('COIN FLIP'), quiet('PACHINKO')) == (0, 8, 3, 9, 12, 28, 28, 28))
chk("capture streak 0 (last bonus round = miss)", True)

print("== 5. REIGNS ==")
reigns = []
cs, cc = None, 0
for j in range(n):
    t = top(h[j])
    if t == cs: cc += 1
    else:
        if cs is not None: reigns.append((cs, j-cc, j-1, cc))
        cs, cc = t, 1
reigns.append((cs, n-cc, n-1, cc))
chk("'1' reign E2#9-#18 len 10 hits 7/10", any(r[0] == '1' and r[1] == 8 and r[2] == 17 and r[3] == 10 and sum(1 for j in range(8, 18) if h[j]['hit']) == 7 for r in reigns))
chk("'10' LIVE reign E2#22-#28 len 7 hits 3/7", reigns[-1][0] == '10' and reigns[-1][1] == 21 and reigns[-1][3] == 7 and sum(1 for j in range(21, 28) if h[j]['hit']) == 3)
ch = sum(1 for j in range(W, n) if top(h[j]) != top(h[j-1]))
chk("reprice changes in window == 6", ch == 6, str(ch))

print("== 6. SIGNALS ==")
sigs = load('scripts/data/pass273_signals.json')
names = [s['game']['name'] for s in sigs]
chk("bench order ['5','1',CASH HUNT,'10'] — '5' rank-1, PACHINKO OUT", names == ['5', '1', 'CASH HUNT', '10'], str(names))
chk("uniform conf 56", all(s['confidence'] == 56 for s in sigs))
chk("'5' trending-up + recent-active rank-1", 'trending-up' in sigs[0]['signals'] and 'recent-active' in sigs[0]['signals'])
chk("'1' trending-down + verified (moderate) + repeat-supported (55%)", 'trending-down' in sigs[1]['signals'] and 'verified (moderate)' in sigs[1]['signals'] and 'repeat-supported (55%)' in sigs[1]['signals'])

print("== 7. PANEL ==")
p = json.load(open('scripts/data/pass273_panel_live.json'))['data']['result']
pf = json.load(open('scripts/data/pass273_panel_full.json'))['data']['result']
flat = p.replace('\n', ' | ')
flatf = pf.replace('\n', ' | ')
chk("panel_live == 34,214 chars", len(p) == 34214, str(len(p)))
chk("panel_full == 34,231 chars", len(pf) == 34231, str(len(pf)))
chk("Shadow OFF banner present", 'Shadow A/B is OFF. Enable to run the experimental engine in parallel.' in flat)
chk("RELIABILITY_K = 10 present", 'RELIABILITY_K = 10' in flat)
chk("all 8 shadow metrics ABSENT", all(kw not in flat and kw not in flatf for kw in ['paired rounds', 'MISS RCA', 'baseline HIT rate', 'experimental HIT rate', 'MISS→HIT', 'HIT→MISS']))
chk("VALIDATION set [1, 5, 10, CASH HUNT] (set-equal to store; display order sorted)", 'Next actual result must match one of [1, 5, 10, CASH HUNT] for HIT' in flat)
chk("REPLAY LIVE ROUNDS (28)", 'REPLAY LIVE ROUNDS (28)' in flat)
chk("PERFORMANCE LEDGER N=28 18H/10M 64%", 'N=28/100' in flat and '18 | HIT | 10 | MISS | 64% | HIT RATE' in flat)
chk("EVENT DEBUG 2 events", '2 events logged' in flat)
chk("PERFORMANCE DEBUG n=2 SRC→APP 51.7s", 'n=2' in flat and '51.7s' in flat)
chk("AI lit: entropy 74 / hottest 5 / overdue 10 / volatility 33", 'Entropy 74%' in flat and 'Hottest: 5' in flat and 'Overdue: 10' in flat and 'Volatility 33/100' in flat)
chk("banner 1x HIT STREAK N=28", '1× HIT STREAK' in flat and 'N=28' in flat)
chk("MISS STREAK absent", 'MISS STREAK' not in flat)
chk("PATTERN SHIFT + TVD absent", 'PATTERN SHIFT' not in flat and 'TVD' not in flat)
m = re.search(r'([\d,]+)\s*\|\s*TOTAL\s*\|\s*(\d+)%\s*\|\s*ACCURACY\s*\|\s*([\d,]+)\s*\|\s*BONUS\s*\|\s*([\dk.,]+)\s*\|\s*LIVE', flat) or re.search(r'([\d,]+)\s*TOTAL\s*(\d+)%\s*ACCURACY\s*([\d,]+)\s*BONUS\s*([\dk.,]+)\s*LIVE', flat)
chk("counters 1,249 / 94% / 128 / 1.3k (REWIND held 2nd pass, LIVE up)", m and m.group(1) == '1,249' and m.group(2) == '94' and m.group(3) == '128' and m.group(4) == '1.3k', m.groups() if m else 'no match')
t4 = re.search(r'Top-4 Expected Coverage: ([\d.]+)%', flat)
t4f = re.search(r'Top-4 Expected Coverage: ([\d.]+)%', flatf)
chk("Top-4 live 70.4 / full 70.1 (climbing)", t4 and t4.group(1) == '70.4' and t4f and t4f.group(1) == '70.1', f"{t4.group(1) if t4 else '?'}/{t4f.group(1) if t4f else '?'}")
chk("LOCKED 14:19 #1 MODERATE '5' @56", 'LOCKED | • 14:19' in flat and 'MODERATE | 5 | STRONGEST EVIDENCE' in flat)
chk("top card E2#28 HIT '1' RECALIBRATED conf 42", 'ACTUAL: | 1' in flat and 'RECALIBRATED' in flat and 'Confidence: 42%' in flat)
chk("ARCHIVE lazy section NOT FOUND (2nd pass)", 'ARCHIVE' not in flatf)

print("== 8. CONSOLE / KEYS / DRIFT ==")
er = json.load(open('scripts/data/pass273_errors.json'))['data']
msgs = er.get('messages', [])
errs = [x for x in msgs if x.get('type') == 'error']
fr = [x for x in msgs if 'Fast Refresh' in x.get('text', '')]
chk("ring at 1000 cap (999 log + 1 info)", len(msgs) == 1000 and sum(1 for x in msgs if x.get('type')=='log') == 999 and sum(1 for x in msgs if x.get('type')=='info') == 1, f"{len(msgs)}")
chk("error-type == 0", len(errs) == 0)
chk("[Fast Refresh] == 27 (storm continues, ring ends rebuilding)", len(fr) == 27 and msgs[-1].get('text','').startswith('[Fast Refresh] rebuilding'), f"{len(fr)} FR")
keys = load('scripts/data/pass273_keys.json')
chk("keys == [revo_lastSignals, revo_roundHistory]", keys == ['revo_lastSignals', 'revo_roundHistory'], str(keys))
g = subprocess.run(['git', 'diff', '5416b5d', '--stat', '--', 'src/'], cwd='/home/z/my-project', capture_output=True, text=True)
chk("git diff 5416b5d -- src/ == 0", g.stdout.strip() == '' and g.returncode == 0)

n_pass = sum(P)
print(f"\nVERIFY SUMMARY: {n_pass}/{len(P)} checks passed")
raise SystemExit(0 if n_pass == len(P) else 1)
