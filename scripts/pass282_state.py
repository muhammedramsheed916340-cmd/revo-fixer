#!/usr/bin/env python3
"""Pass 281 state extraction — derived from pass280_state.py (sed-adapted).
ERA-3 eighth window: +21 rounds landed (#140-#178). Watches from P280:
PACHINKO rank-1 3rd-stint survival (Pred#140 [P,2,1,10] @49), 4th PACHINKO
actual / first bonus rank-1 exact, RISK MEDIUM escalation ladder, census
V-shape recovery from -4, '2' consolidation, '1' trending-down, TVD re-light,
LAST25 5th read, 'excluded evidence' line 3rd read, STALL #46, REWIND 10th,
ARCHIVE 11th, VALIDATION 8th, replay parity, Shadow 281st OFF.
Read-only analysis of pass282_* probe artifacts. No engine contact."""
import json, re, datetime
from collections import Counter

BASE = '/home/z/my-project'
TZ = datetime.timezone(datetime.timedelta(hours=8))  # fixed +08

def load(name):
    d = json.load(open(f'{BASE}/scripts/data/pass282_{name}.json'))
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

w = hist[159:]  # rounds #140-#178, unseen at P280
wh = sum(1 for r in w if r['hit'])
p(f'WINDOW_140_178={wh}/{len(w)}={wh/len(w)*100:.2f}%')

res = ['H' if r['hit'] else 'M' for r in hist]
live_h = 0
for c in reversed(res):
    if c == 'H': live_h += 1
    else: break
live_m = 0
for c in reversed(res):
    if c == 'M': live_m += 1
    else: break
p(f'LIVE_HIT_RUN={live_h} LIVE_MISS_RUN={live_m}')
runs = []
cur, n = res[0], 1
for c in res[1:]:
    if c == cur: n += 1
    else: runs.append((cur, n)); cur, n = c, 1
runs.append((cur, n))
p(f'MAX_H_RUN={max(nn for c,nn in runs if c=="H")}')
p(f'MAX_M_RUN={max(nn for c,nn in runs if c=="M")}')
p(f'RUNS_TAIL={runs[-6:]}')
p(f'WINDOW_MARKS={" ".join(res[159:])}')
p(f'WINDOW_ROUND_DETAIL={[(i+1, hist[i]["actualResult"]["name"], "H" if hist[i]["hit"] else "m", hist[i]["confidence"]) for i in range(159, 178)]}')

def wr(k):
    seg = res[-k:]
    return f'{sum(1 for c in seg if c=="H")}/{len(seg)}'
p(f'LAST5={wr(5)} LAST10={wr(10)} LAST20={wr(20)} LAST25={wr(25)} LAST50={wr(50)} LAST100={wr(100)}')

recal = [i for i, r in enumerate(hist) if r.get('recalibrated')]
p(f'RECAL_N={len(recal)}')
rescues = [i+1 for i in range(len(hist)-1) if not hist[i]['hit'] and hist[i+1]['hit']]
p(f'RESCUE_N={len(rescues)} NEW_RESCUES={[x for x in rescues if x >= 159]}')

mrounds = [i + 1 for i, r in enumerate(hist) if not r['hit']]
p(f'NEW_MISSES_SINCE_P280={[m for m in mrounds if m > 159]}')

comp = Counter(r['actualResult']['name'] for r in hist)
p(f'COMPOSITION={dict(comp)}')
p(f'PACHINKO_ACTUAL_ROUNDS={[i+1 for i,r in enumerate(hist) if r["actualResult"]["name"]=="PACHINKO"]}')
BONUS = {'PACHINKO','COIN FLIP','CASH HUNT','CRAZY TIME'}
bonus_rounds = [(i+1, r['actualResult']['name'], 'H' if r['hit'] else 'm') for i,r in enumerate(hist) if r['actualResult']['name'] in BONUS]
bh = sum(1 for _,_,s in bonus_rounds if s=='H')
p(f'BONUS_ACTUALS_N={len(bonus_rounds)} BONUS_HITS={bh}')
p(f'BONUS_NEW_SINCE_P280={bonus_rounds[22:]}')
p(f'TWO_ACTUAL_WINDOW={[(i+1,"H" if hist[i]["hit"] else "m", hist[i]["confidence"]) for i in range(159,178) if hist[i]["actualResult"]["name"]=="2"]}')
p(f'FIVE_ACTUAL_WINDOW={[(i+1,"H" if hist[i]["hit"] else "m") for i in range(159,178) if hist[i]["actualResult"]["name"]=="5"]}')
p(f'ONE_ACTUAL_WINDOW={[(i+1,"H" if hist[i]["hit"] else "m") for i in range(159,178) if hist[i]["actualResult"]["name"]=="1"]}')
p(f'RANK1_EXACT_HITS={sum(1 for r in hist if r["hit"] and r["actualResult"]["name"]==r["prediction"][0]["game"]["name"])}')
p(f'WINDOW_RANK1_EXACTS={[(i+1, hist[i]["prediction"][0]["game"]["name"], hist[i]["actualResult"]["name"]) for i in range(159,178) if hist[i]["hit"] and hist[i]["actualResult"]["name"]==hist[i]["prediction"][0]["game"]["name"]]}')
p(f'WINDOW_PREDS={[(i+1, [x["game"]["name"] for x in hist[i]["prediction"]]) for i in range(159,178)]}')
p(f'WINDOW_HIT_ROUNDS={[(i+1, [x["game"]["name"] for x in hist[i]["prediction"]].index(hist[i]["actualResult"]["name"])+1) for i in range(159,178) if hist[i]["hit"]]}')

times = [r['time'] for r in hist]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
p(f'GAPS_N={len(gaps)} AVG={sum(gaps)/len(gaps):.1f}s MIN={min(gaps):.3f}s MIN_AT=#'+str(gaps.index(min(gaps))+2))
p(f'STALLS_GE90={[(i+2, round(g,3)) for i,g in enumerate(gaps) if g>=90.0]}')
p(f'NEW_WINDOW_GAPS_GE60={[(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=159 and g>=60]}')
p(f'NEW_WINDOW_GAPS_GE45={[(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=159 and g>=45]}')
p(f'SPAN_E3={(times[-1]-times[0])/1000:.1f}s')
p(f'LAST_ROUND_TS={datetime.datetime.fromtimestamp(times[-1]/1000, TZ).strftime("%H:%M:%S.%f")[:-3]}')

confs = [r['confidence'] for r in hist]
p(f'CONF_140_178={[confs[i] for i in range(159,178)]}')
p(f'CONF71_SETTLED={[i+1 for i,c in enumerate(confs) if c==71]}')
p(f'CONF_MIN_SETTLED_POST_OPEN={min(confs[11:])} CONF_MAX_SETTLED_POST_OPEN={max(confs[11:])}')

last = hist[-1]
p(f'LAST_ROUND_N={len(hist)} ACTUAL={last["actualResult"]["name"]} HIT={last["hit"]} CONF={last["confidence"]}')
p(f'LAST_PREDS={[x["game"]["name"] for x in last["prediction"]]}')

p(f'SIGNALS_N={len(sigs)}')
for s in sigs[:4]:
    p(f'SIGNAL: {s["game"]["name"]} conf={s["confidence"]} rank={s["rank"]} range={s["game"]["confidenceRange"]} sigs={s["signals"][:5]}')

checks = {
    'SHADOW_OFF': 'Shadow A/B is OFF' in panel,
    'DEBUG_EVENT': 'EVENT DEBUG LOG' in panel,
    'DEBUG_PERF': 'PERFORMANCE DEBUG' in panel,
    'BANNER_TEXT': (re.search(r'(\d+× [A-Z]+ STREAK)', tfx) or [None,''])[1],
    'HIT_STREAK': 'HIT STREAK' in panel,
    'MISS_STREAK': 'MISS STREAK' in panel,
    'PATTERN_SHIFT': 'PATTERN SHIFT DETECTED' in panel,
    'TVD_MATCH': (re.search(r'TVD=([\d.]+)', tf) or [None,''])[1],
    'ARCHIVE': 'ARCHIVE' in panel,
    'COUNTER_1249': '1,249' in panel,
    'LOCK_MODERATE': 'MODERATE' in panel,
    'LOCK_STRONG_DECISION': bool(re.search(r'\d+% \| STRONG', tf)),
    'LOCK_HEADER': (re.search(r'(LOCKED \| [^#]{0,40})', tf) or [None,''])[1],
    'INSUFFICIENT': 'INSUFFICIENT SAMPLE' in panel,
    'EXCLUDED_EVIDENCE_LINE': 'Excluded outcomes with recent evidence' in panel,
}
for k, v in checks.items():
    p(f'CHK_{k}={v}')

p('LEDGER_LAST25_REGION=' + (tf[tf.find('LAST 25'):tf.find('LAST 25')+40] if 'LAST 25' in tf else 'NOT FOUND'))
p('DECISION_REGION=' + (tf[tf.find('DECISION ENGINE'):tf.find('DECISION ENGINE')+220] if 'DECISION ENGINE' in tf else 'NOT FOUND'))
p('PIPELINE_REGION=' + (tf[tf.find('PIPELINE AUDIT'):tf.find('PIPELINE AUDIT')+430] if 'PIPELINE AUDIT' in tf else 'NOT FOUND'))
p('PERF_REGION=' + (tf[tf.find('PERFORMANCE DEBUG'):tf.find('PERFORMANCE DEBUG')+300] if 'PERFORMANCE DEBUG' in tf else 'PERF NOT FOUND'))
p('AI_REGION=' + (tf[tf.find('AI ANALYSIS SUMMARY'):tf.find('AI ANALYSIS SUMMARY')+178] if 'AI ANALYSIS SUMMARY' in tf else 'AI NOT FOUND'))
p('TOPCARD_REGION=' + (tf[tf.find('ROUND HISTORY'):tf.find('ROUND HISTORY')+360] if 'ROUND HISTORY' in tf else 'NOT FOUND'))
p('BONUSRISK_REGION=' + (tf[tf.find('BONUS RISK ANALYSIS'):tf.find('BONUS RISK ANALYSIS')+240] if 'BONUS RISK ANALYSIS' in tf else 'NOT FOUND'))
p('TREND_REGION=' + (tf[tf.find('Trend | '):tf.find('Trend | ')+60] if 'Trend | ' in tf else 'NOT FOUND'))
p('TPC_REGION=' + (tf[tf.find('Total Prediction Coverage'):tf.find('Total Prediction Coverage')+40] if 'Total Prediction Coverage' in tf else 'NOT FOUND'))

open(f'{BASE}/scripts/data/pass282_state_out.txt', 'w').write('\n'.join(out))
print('\n'.join(out))
