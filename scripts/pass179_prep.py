#!/usr/bin/env python3
"""Pass 179 (Task ID 224) — evidence normalization + quick pre-read."""
import json, datetime

BASE = '/home/z/my-project/scripts/data/'

m = json.load(open(BASE + 'pass179_meta.json'))
mr = m['data']['result'] if isinstance(m.get('data'), dict) and 'result' in m['data'] else m
meta = json.loads(mr) if isinstance(mr, str) else mr
print(f"META: now_epoch={meta['now']} n={meta['n']} (pass178 ended at 1257)")

p = json.load(open(BASE + 'pass179_panel_raw.json'))
pr = p['data']['result'] if isinstance(p.get('data'), dict) and 'result' in p['data'] else str(p)
open(BASE + 'pass179_panel.txt', 'w').write(pr)
print(f"PANEL: len={len(pr)}, OFF={'SHADOW OFF' in pr or 'No validation' in pr}, NoVal idx={pr.find('No validation')}")

E = json.load(open(BASE + 'pass179_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text', '')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text', '')]
print(f"ERRORS: total {len(errs)}, loadCritical {len(lc)}, uncaught-promise {len(fam)}")
try:
    E0 = json.load(open(BASE + 'pass178_errors.json'))
    t0 = sorted(e.get('text', '') for e in E0['data']['errors'])
    t1 = sorted(e.get('text', '') for e in errs)
    from collections import Counter
    d_add = list((Counter(t1) - Counter(t0)).elements())
    d_rem = list((Counter(t0) - Counter(t1)).elements())
    print(f"ERROR DIFF vs pass178: +{d_add} -{d_rem}")
except Exception as e:
    print(f"error-diff skipped: {e}")

K = json.load(open(BASE + 'pass179_keys.json'))
kr = K['data']['result'] if isinstance(K.get('data'), dict) and 'result' in K['data'] else str(K)
print(f"KEYS: {kr}")

try:
    sig = json.loads(json.load(open(BASE + 'pass179_sig.json'))['data']['result'])
    st = datetime.datetime.fromtimestamp(sig[0]['time'] / 1000).strftime('%H:%M:%S')
    print(f"SIGNALS: updated {st} UTC, top={sig[0]['game']['name']} conf={sig[0]['confidence']}")
    print(f"  ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")

_d = json.load(open(BASE + 'pass179_history.json'))
H = json.loads(_d['data']['result']) if isinstance(_d.get('data'), dict) and 'result' in _d['data'] else _d
N = len(H)
last = H[-1]
lt = datetime.datetime.fromtimestamp(last['time'] / 1000).strftime('%H:%M:%S')
age = (datetime.datetime.now().timestamp() * 1000 - last['time']) / 1000
print(f"HISTORY: n={N}, last #{N} at {lt} UTC ({age:.0f}s fresh at read time), actual={last['actualResult']['name']}, hit={last['hit']}")
# cadence peek since pass178 start (#1238)
if N > 1257:
    t1238 = H[1237]['time']
    t_last = H[-1]['time']
    print(f"POST-#1257 SLICE: {N-1257} new rounds, span {(t_last-t1238)/1000:.0f}s from #1238")
