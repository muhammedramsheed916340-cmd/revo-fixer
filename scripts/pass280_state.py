#!/usr/bin/env python3
"""Pass 280 state extraction — derived from pass279_state.py (sed-adapted).
ERA-3 seventh window: +19 rounds landed (#121-#139). Watches: 10x H-RUN RECORD
(live 9x at P279 close), '10' rank-1 audition book (Pred#121 @71 STRONG),
'2' OVERDUE forced-MISS watch, bonus blind spot (COV 3.7%), TVD trajectory,
LAST25 bug 4th read, STALL #45, REWIND 9th, ARCHIVE 10th.
Read-only analysis of pass280_* probe artifacts. No engine contact."""
import json, re, datetime
from collections import Counter

BASE = '/home/z/my-project'
TZ = datetime.timezone(datetime.timedelta(hours=8))  # fixed +08

def load(name):
    d = json.load(open(f'{BASE}/scripts/data/pass280_{name}.json'))
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

w = hist[120:]  # rounds #121-#139, unseen at P279
wh = sum(1 for r in w if r['hit'])
p(f'WINDOW_121_139={wh}/{len(w)}={wh/len(w)*100:.2f}%')

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
p(f'MAX_H_RUN={max(n for c,n in runs if c=="H")}')
p(f'MAX_M_RUN={max(n for c,n in runs if c=="M")}')
p(f'RUNS_TAIL={runs[-6:]}')
p(f'WINDOW_MARKS={" ".join(res[120:])}')
p(f'WINDOW_ROUND_DETAIL={[(i+1, hist[i]["actualResult"]["name"], "H" if hist[i]["hit"] else "m", hist[i]["confidence"]) for i in range(120, 139)]}')

def wr(k):
    seg = res[-k:]
    return f'{sum(1 for c in seg if c=="H")}/{len(seg)}'
p(f'LAST5={wr(5)} LAST10={wr(10)} LAST20={wr(20)} LAST25={wr(25)} LAST50={wr(50)} LAST100={wr(100)}')

recal = [i for i, r in enumerate(hist) if r.get('recalibrated')]
p(f'RECAL_N={len(recal)}')
rescues = [i+1 for i in range(len(hist)-1) if not hist[i]['hit'] and hist[i+1]['hit']]
p(f'RESCUE_N={len(rescues)} NEW_RESCUES={[x for x in rescues if x >= 120]}')

mrounds = [i + 1 for i, r in enumerate(hist) if not r['hit']]
p(f'NEW_MISSES_SINCE_P279={[m for m in mrounds if m > 120]}')

comp = Counter(r['actualResult']['name'] for r in hist)
p(f'COMPOSITION={dict(comp)}')
p(f'PACHINKO_ACTUAL_ROUNDS={[i+1 for i,r in enumerate(hist) if r["actualResult"]["name"]=="PACHINKO"]}')
BONUS = {'PACHINKO','COIN FLIP','CASH HUNT','CRAZY TIME'}
bonus_rounds = [(i+1, r['actualResult']['name'], 'H' if r['hit'] else 'm') for i,r in enumerate(hist) if r['actualResult']['name'] in BONUS]
bh = sum(1 for _,_,s in bonus_rounds if s=='H')
p(f'BONUS_ACTUALS_N={len(bonus_rounds)} BONUS_HITS={bh}')
p(f'BONUS_NEW_SINCE_P279={bonus_rounds[16:]}')
p(f'TWO_ACTUAL_WINDOW={[(i+1,"H" if hist[i]["hit"] else "m", hist[i]["confidence"]) for i in range(120,139) if hist[i]["actualResult"]["name"]=="2"]}')
p(f'RANK1_EXACT_HITS={sum(1 for r in hist if r["hit"] and r["actualResult"]["name"]==r["prediction"][0]["game"]["name"])}')
p(f'WINDOW_RANK1_EXACTS={[(i+1, hist[i]["prediction"][0]["game"]["name"]) for i in range(120,139) if hist[i]["hit"] and hist[i]["actualResult"]["name"]==hist[i]["prediction"][0]["game"]["name"]]}')
p(f'WINDOW_PREDS={[(i+1, [x["game"]["name"] for x in hist[i]["prediction"]]) for i in range(120,139)]}')

times = [r['time'] for r in hist]
gaps = [(times[i+1]-times[i])/1000 for i in range(len(times)-1)]
p(f'GAPS_N={len(gaps)} AVG={sum(gaps)/len(gaps):.1f}s MIN={min(gaps):.3f}s MIN_AT=#'+str(gaps.index(min(gaps))+2))
p(f'STALLS_GE90={[(i+2, round(g,3)) for i,g in enumerate(gaps) if g>=90.0]}')
p(f'NEW_WINDOW_GAPS_GE60={[(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=120 and g>=60]}')
p(f'NEW_WINDOW_GAPS_GE45={[(i+2, round(g,1)) for i,g in enumerate(gaps) if i+1>=120 and g>=45]}')
p(f'SPAN_E3={(times[-1]-times[0])/1000:.1f}s')
p(f'LAST_ROUND_TS={datetime.datetime.fromtimestamp(times[-1]/1000, TZ).strftime("%H:%M:%S.%f")[:-3]}')

confs = [r['confidence'] for r in hist]
p(f'CONF_121_139={[confs[i] for i in range(120,139)]}')
p(f'CONF71_SETTLED={[i+1 for i,c in enumerate(confs) if c==71]}')
p(f'CONF_MIN_SETTLED_POST_OPEN={min(confs[11:])} CONF_MAX_SETTLED_POST_OPEN={max(confs[11:])}')

last = hist[-1]
p(f'LAST_ROUND_N={len(hist)} ACTUAL={last["actualResult"]["name"]} HIT={last["hit"]} CONF={last["confidence"]}')
p(f'LAST_PREDS={[x["game"]["name"] for x in last["prediction"]]}')

p(f'SIGNALS_N={len(sigs)}')
for s in sigs[:4]:
    p(f'SIGNAL: {s["game"]["name"]} conf={s["confidence"]} rank={s["rank"]} range={s["game"]["confidenceRange"]} sigs={s["signals"][:4]}')

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
    'LOCK_HEADER': (re.search(r'(LOCKED \| • \d+:\d+[^#]{0,20})', tf) or [None,''])[1],
    'INSUFFICIENT': 'INSUFFICIENT SAMPLE' in panel,
    'EXCLUDED_EVIDENCE_LINE': 'Excluded outcomes with recent evidence' in panel,
}
for k, v in checks.items():
    p(f'CHK_{k}={v}')

p('LEDGER_LAST25_REGION=' + (tf[tf.find('LAST 25'):tf.find('LAST 25')+40] if 'LAST 25' in tf else 'NOT FOUND'))
p('DECISION_REGION=' + (tf[tf.find('DECISION ENGINE'):tf.find('DECISION ENGINE')+200] if 'DECISION ENGINE' in tf else 'NOT FOUND'))
p('PIPELINE_REGION=' + (tf[tf.find('PIPELINE AUDIT'):tf.find('PIPELINE AUDIT')+430] if 'PIPELINE AUDIT' in tf else 'NOT FOUND'))
p('PERF_REGION=' + (tf[tf.find('PERFORMANCE DEBUG'):tf.find('PERFORMANCE DEBUG')+300] if 'PERFORMANCE DEBUG' in tf else 'PERF NOT FOUND'))
p('AI_REGION=' + (tf[tf.find('AI ANALYSIS SUMMARY'):tf.find('AI ANALYSIS SUMMARY')+150] if 'AI ANALYSIS SUMMARY' in tf else 'AI NOT FOUND'))
p('TOPCARD_REGION=' + (tf[tf.find('ROUND HISTORY'):tf.find('ROUND HISTORY')+340] if 'ROUND HISTORY' in tf else 'NOT FOUND'))
p('BONUSRISK_REGION=' + (tf[tf.find('BONUS RISK ANALYSIS'):tf.find('BONUS RISK ANALYSIS')+230] if 'BONUS RISK ANALYSIS' in tf else 'NOT FOUND'))

open(f'{BASE}/scripts/data/pass280_state_out.txt', 'w').write('\n'.join(out))
print('\n'.join(out))
