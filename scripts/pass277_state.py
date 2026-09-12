#!/usr/bin/env python3
"""Pass 277 state extraction — derived from pass276_state.py (sed-adapted).
ERA-3 fourth-window deep-cold observation: deficit-crossed census (61%),
9x MISS STREAK, uniform 33% bench, DEBUG sections returned.
Read-only analysis of pass277_* probe artifacts. No engine contact."""
import json, re, datetime, zoneinfo

BASE = '/home/z/my-project'
JST = zoneinfo.ZoneInfo('Asia/Calcutta')  # +08 session tz

def load(name):
    d = json.load(open(f'{BASE}/scripts/data/pass277_{name}.json'))
    return d['data']['result']

hist = json.loads(load('history'))
sigs = json.loads(load('signals'))
panel = load('panel_live')
tfx = panel.replace('\t', ' | ')  # EVENT DEBUG cells are TAB-separated (P275 lesson)
tf = tfx.replace(' | \n', ' | ').replace('\n', ' | ')  # flatten for line-spanning matchers

out = []
def p(s=''):
    out.append(str(s))

p(f'PANEL_CHARS={len(panel)}')
p(f'N_ROUNDS={len(hist)}')

# --- census ---
hits = sum(1 for r in hist if r['hit'])
misses = len(hist) - hits
p(f'CENSUS={hits}/{len(hist)}={hits/len(hist)*100:.2f}%')
ceil65 = -(-65 * len(hist) // 100)
p(f'CEIL65={ceil65} SURPLUS={hits - ceil65}')
import math
p(f'BASE65_PCT={65.2916:.4f}')  # era-1 terminal for reference

# --- unseen window since P276 (n was 54) ---
w = hist[54:]
wh = sum(1 for r in w if r['hit'])
p(f'WINDOW_55_77={wh}/{len(w)}={wh/len(w)*100:.2f}%')

# --- streaks: current live MISS run + max H-run + longest M-run ---
res = ['H' if r['hit'] else 'M' for r in hist]
live_m = 0
for c in reversed(res):
    if c == 'M':
        live_m += 1
    else:
        break
p(f'LIVE_MISS_RUN={live_m}')
runs = []
cur, n = res[0], 1
for c in res[1:]:
    if c == cur:
        n += 1
    else:
        runs.append((cur, n)); cur, n = c, 1
runs.append((cur, n))
maxh = max(n for c, n in runs if c == 'H')
maxm = max(n for c, n in runs if c == 'M')
p(f'MAX_H_RUN={maxh}')
p(f'MAX_M_RUN={maxm} (at idx {[i for i,(c,k) in enumerate(runs) if c=="M" and k==maxm]})')
p(f'RUNS_TAIL={runs[-8:]}')

# --- windows ---
def wr(k):
    seg = res[-k:]
    return f'{sum(1 for c in seg if c=="H")}/{len(seg)}'
p(f'LAST5={wr(5)} LAST10={wr(10)} LAST25={wr(25)} LAST50={wr(50)}')

# --- recal flags + rescue bookkeeping ---
recal = [i for i, r in enumerate(hist) if r.get('recalibrated')]
p(f'RECAL_N={len(recal)} ROUNDS={[i+1 for i in recal]}')
# rescue: round after a MISS that HIT (any MISS, engine-wide rescue view)
rescue_after_miss = []
for i in range(len(hist) - 1):
    if not hist[i]['hit'] and hist[i+1]['hit']:
        rescue_after_miss.append(i + 2)  # 1-based round number
p(f'HIT_AFTER_MISS_ROUNDS={rescue_after_miss}')
# consecutive recal-MISS chain state (P276: #51-#54 4x)
m_recal_miss_tail = []
for i in range(len(hist) - 1, -1, -1):
    if not hist[i]['hit']:
        m_recal_miss_tail.append(i + 1)
    else:
        break
p(f'LIVE_MISS_ROUNDS={list(reversed(m_recal_miss_tail))}')

# --- miss rounds list ---
mrounds = [i + 1 for i, r in enumerate(hist) if not r['hit']]
p(f'MISS_ROUNDS={mrounds}')
hrounds = [i + 1 for i, r in enumerate(hist) if r['hit']]
p(f'HIT_ROUNDS_LAST20={[i+1 for i in range(57,77) if hist[i]["hit"]]}')

# --- composition / bonus actuals ---
from collections import Counter
comp = Counter(r['actualResult']['name'] for r in hist)
p(f'COMPOSITION={dict(comp)}')
pach = [i + 1 for i, r in enumerate(hist) if r['actualResult']['name'] == 'PACHINKO']
p(f'PACHINKO_ACTUAL_ROUNDS={pach}')
bonus_names = {'PACHINKO', 'COIN FLIP', 'CASH HUNT', 'CRAZY TIME'}
bonus_rounds = [(i + 1, r['actualResult']['name'], 'H' if r['hit'] else 'm')
                for i, r in enumerate(hist) if r['actualResult']['name'] in bonus_names]
p(f'BONUS_ACTUALS_N={len(bonus_rounds)}')
p(f'BONUS_BOOK={bonus_rounds}')
bh = sum(1 for _, _, s in bonus_rounds if s == 'H')
p(f'BONUS_HIT_RATE={bh}/{len(bonus_rounds)}={bh/len(bonus_rounds)*100:.1f}%' if bonus_rounds else 'BONUS_HIT_RATE=N/A')
five_hits = [i + 1 for i, r in enumerate(hist) if r['hit'] and r['prediction'][0]['game']['name'] == '5']
# actual '5' rounds (P276: only as MISS actuals #38,#53)
five_actual = [i + 1 for i, r in enumerate(hist) if r['actualResult']['name'] == '5']
p(f'FIVE_ACTUAL_ROUNDS={five_actual}')

# --- exact matches (all 4 preds in order? engine defines exact as pred set == actual set order?) ---
# P276 counted 'exact 8' — replicate: rounds where actual == predicted[0] game (rank-1 exact)
exact1 = sum(1 for r in hist if r['actualResult']['name'] == r['prediction'][0]['game']['name'] and r['hit'])
p(f'RANK1_EXACT_HITS={exact1}')

# --- cadence / stalls (use result times; era-3 started at round 1 = idx0) ---
times = [r['time'] for r in hist]
gaps = [(times[i+1] - times[i]) / 1000 for i in range(len(times) - 1)]
p(f'GAPS_N={len(gaps)} AVG={sum(gaps)/len(gaps):.1f}s MIN={min(gaps):.3f}s MIN_AT=#'+str(gaps.index(min(gaps))+2))
stall = [(i + 2, round(g, 3)) for i, g in enumerate(gaps) if g >= 90.0]
p(f'STALLS_GE90={stall}')
span = (times[-1] - times[0]) / 1000
p(f'SPAN_E3={span:.1f}s')
# gap detail for the new window (#55->#77 = idx 54..76)
newgaps = [(i + 2, round(g, 3)) for i, g in enumerate(gaps) if i + 1 >= 55]
p(f'NEW_WINDOW_GAPS_GE60={[(n, g) for n, g in newgaps if g >= 60]}')

# --- conf path ---
confs = [r['confidence'] for r in hist]
p(f'CONF_MIN={min(confs)} AT=#' + str(confs.index(min(confs)) + 1))
p(f'CONF_MAX={max(confs)}')
p(f'CONF_PATH_50_77={[confs[i] for i in range(49, 77)]}')
# uniform-33 first occurrence
uni33 = [i + 1 for i, c in enumerate(confs) if c == 33]
p(f'CONF33_ROUNDS={uni33}')
p(f'CONF_WINDOW_55_77={[confs[i] for i in range(54, 77)]}')

# --- last round & prediction #78 (from panel lock) ---
last = hist[-1]
p(f'LAST_ROUND_N={len(hist)} ACTUAL={last["actualResult"]["name"]} HIT={last["hit"]} CONF={last["confidence"]}')
p(f'LAST_PREDS={[x["game"]["name"] for x in last["prediction"]]}')

# --- signals / bench ---
try:
    b = sigs[0] if isinstance(sigs, list) else sigs
    p(f'SIGNALS_N={len(sigs)}')
    for s in sigs[:4]:
        g = s.get('game', {})
        p(f'SIGNAL: {g.get("name")} range={g.get("confidenceRange")} keys={sorted(s.keys())}')
except Exception as e:
    p(f'SIGNALS_PARSE_ERR={e}')

# --- VALIDATION set-equal: signals vs bench in panel ---
p('SIGNALS_RAW_HEAD=' + json.dumps(sigs, ensure_ascii=False)[:600])

# --- panel label checks ---
checks = {
    'SHADOW_OFF_BANNER': 'Shadow A/B is OFF' in panel,
    'DEBUG_EVENT_LOG': 'EVENT DEBUG LOG' in panel,
    'DEBUG_PERF': 'PERFORMANCE DEBUG' in panel,
    'MISS_STREAK_BANNER': 'MISS STREAK' in panel,
    'HIT_STREAK_BANNER': 'HIT STREAK' in panel,
    'PATTERN_SHIFT': 'PATTERN SHIFT' in panel,
    'ARCHIVE_SECTION': 'ARCHIVE' in panel,
    'REWIND_LABEL': 'REWIND' in panel,
    'COUNTER_1249': '1,249' in panel,
    'TPC_LABEL': 'TPC' in panel,
    'TOTAL_PRED_COVERAGE': 'Total Prediction Coverage' in panel,
    'BENCH_LABEL': 'BENCH' in panel,
    'LOW_CONF_LABEL': 'LOW CONFIDENCE' in panel,
    'STRONG_LABEL': 'STRONG' in panel,
    'MODERATE_LABEL': 'MODERATE' in panel,
    'LOCKED_15_20': '15:20' in tfx,
    'PRED78_CASH_HUNT_RANK1': tf.find('CASH HUNT') < tf.find('COIN FLIP'),
    'BANNER_9X': '9× MISS STREAK' in tfx,
    'RISK_HIGH': 'RISK' in tfx and 'HIGH' in tfx,
    'VALIDATION_SET_EQUAL': 'VALIDATION' in panel,
    'NO_BONUS_BLIND_SPOT': 'No bonus blind spot' in panel,
    'INSUFFICIENT_SAMPLE': 'INSUFFICIENT SAMPLE' in panel,
}
for k, v in checks.items():
    p(f'CHK_{k}={v}')

p(f'TIMESTAMP_LAST_ROUND={datetime.datetime.fromtimestamp(times[-1]/1000, JST).strftime("%H:%M:%S.%f")[:-3]}')
p(f'TIMESTAMP_FIRST_ROUND={datetime.datetime.fromtimestamp(times[0]/1000, JST).strftime("%H:%M:%S.%f")[:-3]}')

open(f'{BASE}/scripts/data/pass277_state_out.txt', 'w').write('\n'.join(out))
print('\n'.join(out))
