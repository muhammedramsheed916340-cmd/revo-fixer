#!/usr/bin/env python3
"""Pass 278 state extraction — derived from pass277_state.py (sed-adapted + tz fix).
ERA-3 fifth-window warm reversal: 9x streak broken, census 62/98, PATTERN SHIFT
back (TVD 0.66), PACHINKO first-ever rank-1, MODERATE @54 lock.
Read-only analysis of pass278_* probe artifacts. No engine contact."""
import json, re, datetime
from collections import Counter

BASE = '/home/z/my-project'
TZ = datetime.timezone(datetime.timedelta(hours=8))  # fixed +08 (P277 tz-label bug fixed)

def load(name):
    d = json.load(open(f'{BASE}/scripts/data/pass278_{name}.json'))
    return d['data']['result']

hist = json.loads(load('history'))
sigs = json.loads(load('signals'))
panel = load('panel_live')
tfx = panel.replace('\t', ' | ')
tf = tfx.replace('\n', ' | ')

out = []
def p(s=''):
    out.append(str(s))

p(f'PANEL_CHARS={len(panel)}')
p(f'N_ROUNDS={len(hist)}')

hits = sum(1 for r in hist if r['hit'])
p(f'CENSUS={hits}/{len(hist)}={hits/len(hist)*100:.2f}%')
ceil65 = -(-65 * len(hist) // 100)
p(f'CEIL65={ceil65} SURPLUS={hits - ceil65}')

w = hist[77:]  # rounds #78-#98, unseen at P277
wh = sum(1 for r in w if r['hit'])
p(f'WINDOW_78_98={wh}/{len(w)}={wh/len(w)*100:.2f}%')

res = ['H' if r['hit'] else 'M' for r in hist]
live_m = 0
for c in reversed(res):
    if c == 'M': live_m += 1
    else: break
p(f'LIVE_MISS_RUN={live_m}')
runs = []
cur, n = res[0], 1
for c in res[1:]:
    if c == cur: n += 1
    else: runs.append((cur, n)); cur, n = c, 1
runs.append((cur, n))
p(f'MAX_H_RUN={max(n for c,n in runs if c=="H")}')
p(f'MAX_M_RUN={max(n for c,n in runs if c=="M")}')
p(f'RUNS_TAIL={runs[-6:]}')
p(f'WINDOW_MARKS={" ".join(res[77:])}')
p(f'WINDOW_ROUND_DETAIL={[(i+1, hist[i]["actualResult"]["name"], "H" if hist[i]["hit"] else "m", hist[i]["confidence"]) for i in range(77, 98)]}')

def wr(k):
    seg = res[-k:]
    return f'{sum(1 for c in seg if c=="H")}/{len(seg)}'
p(f'LAST5={wr(5)} LAST10={wr(10)} LAST20={wr(20)} LAST25={wr(25)} LAST50={wr(50)}')

recal = [i for i, r in enumerate(hist) if r.get('recalibrated')]
p(f'RECAL_N={len(recal)}')
rescues = [i+1 for i in range(len(hist)-1) if not hist[i]['hit'] and hist[i+1]['hit']]
p(f'RESCUE_ROUNDS={rescues} N={len(rescues)}')
p(f'RESCUE_78={78 in rescues}')

mrounds = [i + 1 for i, r in enumerate(hist) if not r['hit']]
p(f'MISS_ROUNDS={mrounds}')

comp = Counter(r['actualResult']['name'] for r in hist)
p(f'COMPOSITION={dict(comp)}')
p(f'PACHINKO_ACTUAL_ROUNDS={[i+1 for i,r in enumerate(hist) if r["actualResult"]["name"]=="PACHINKO"]}')
BONUS = {'PACHINKO','COIN FLIP','CASH HUNT','CRAZY TIME'}
bonus_rounds = [(i+1, r['actualResult']['name'], 'H' if r['hit'] else 'm') for i,r in enumerate(hist) if r['actualResult']['name'] in BONUS]
bh = sum(1 for _,_,s in bonus_rounds if s=='H')
p(f'BONUS_ACTUALS_N={len(bonus_rounds)} BONUS_HITS={bh}')
p(f'BONUS_NEW_SINCE_P277={bonus_rounds[13:]}')
one_actual = [i+1 for i,r in enumerate(hist) if r['actualResult']['name']=='1']
p(f'ONE_ACTUAL_ROUNDS={one_actual}')
p(f'ONE_ACTUAL_IN_WINDOW={[(i+1,"H" if hist[i]["hit"] else "m") for i in range(77,98) if hist[i]["actualResult"]["name"]=="1"]}')
p(f'RANK1_EXACT_HITS={sum(1 for r in hist if r["hit"] and r["actualResult"]["name"]==r["prediction"][0]["game"]["name"])}')
p(f'FIVE_HITS_END_AT={max((i+1 for i,r in enumerate(hist) if r["hit"] and r["actualResult"]["name"]=="5"), default=0)}')

times = [r['time'] for r in hist]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
p(f'GAPS_N={len(gaps)} AVG={sum(gaps)/len(gaps):.1f}s MIN={min(gaps):.3f}s MIN_AT=#'+str(gaps.index(min(gaps))+2))
p(f'STALLS_GE90={[(i+2, round(g,3)) for i,g in enumerate(gaps) if g>=90.0]}')
p(f'NEW_WINDOW_GAPS_GE60={[(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=78 and g>=60]}')
p(f'SPAN_E3={(times[-1]-times[0])/1000:.1f}s')
p(f'LAST_ROUND_TS={datetime.datetime.fromtimestamp(times[-1]/1000, TZ).strftime("%H:%M:%S.%f")[:-3]}')

confs = [r['confidence'] for r in hist]
p(f'CONF_78_98={[confs[i] for i in range(77,98)]}')
p(f'CONF33_SETTLED={[i+1 for i,c in enumerate(confs) if c==33]}')
p(f'CONF_MIN_SETTLED_POST_OPEN={min(confs[11:])}')

last = hist[-1]
p(f'LAST_ROUND_N={len(hist)} ACTUAL={last["actualResult"]["name"]} HIT={last["hit"]} CONF={last["confidence"]}')
p(f'LAST_PREDS={[x["game"]["name"] for x in last["prediction"]]}')

p(f'SIGNALS_N={len(sigs)}')
for s in sigs[:4]:
    p(f'SIGNAL: {s["game"]["name"]} conf={s["confidence"]} rank={s["rank"]} range={s["game"]["confidenceRange"]} sigs={s["signals"][:3]}')

checks = {
    'SHADOW_OFF': 'Shadow A/B is OFF' in panel,
    'DEBUG_EVENT': 'EVENT DEBUG LOG' in panel,
    'DEBUG_PERF': 'PERFORMANCE DEBUG' in panel,
    'BANNER_1X': '1× MISS STREAK' in panel,
    'HIT_STREAK': 'HIT STREAK' in panel,
    'PATTERN_SHIFT': 'PATTERN SHIFT DETECTED' in panel,
    'TVD_066': 'TVD=0.66' in panel,
    'ARCHIVE': 'ARCHIVE' in panel,
    'COUNTER_1249': '1,249' in panel,
    'LOCK_MODERATE': 'MODERATE' in panel,
    'LOCK_LOW': 'LOW CONFIDENCE' in panel,
    'PACHINKO_RANK1': 'PACHINKO' in tf[:tf.find('PERFORMANCE DEBUG')] if 'PERFORMANCE DEBUG' in tf else None,
    'ONE_IN_BENCH': re.search(r'#4[^#]{0,120}1 \|?[^0-9]', tf) is not None,
    'RECAL_TS_1534': '15:34' in tfx,
}
for k, v in checks.items():
    p(f'CHK_{k}={v}')

p('LEDGER_LAST25_REGION=' + (tf[tf.find('LAST 25'):tf.find('LAST 25')+40] if 'LAST 25' in tf else 'NOT FOUND'))
p('PERF_REGION=' + tf[tf.find('PERFORMANCE DEBUG'):tf.find('PERFORMANCE DEBUG')+260] if 'PERFORMANCE DEBUG' in tf else 'PERF NOT FOUND')
p('AI_REGION=' + tf[tf.find('AI ANALYSIS SUMMARY'):tf.find('AI ANALYSIS SUMMARY')+130] if 'AI ANALYSIS SUMMARY' in tf else 'AI NOT FOUND')

open(f'{BASE}/scripts/data/pass278_state_out.txt', 'w').write('\n'.join(out))
print('\n'.join(out))
