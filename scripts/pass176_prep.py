#!/usr/bin/env python3
"""Pass 176 (Task ID 221) — evidence normalization + quick pre-read."""
import json, datetime

BASE = '/home/z/my-project/scripts/data/'

m = json.load(open(BASE + 'pass176_meta.json'))
mr = m['data']['result'] if isinstance(m.get('data'), dict) and 'result' in m['data'] else m
meta = json.loads(mr) if isinstance(mr, str) else mr
print(f"META: now_epoch={meta['now']} n={meta['n']} (pass175 ended 1217)")

p = json.load(open(BASE + 'pass176_panel_raw.json'))
pr = p['data']['result'] if isinstance(p.get('data'), dict) and 'result' in p['data'] else str(p)
open(BASE + 'pass176_panel.txt', 'w').write(pr)
print(f"PANEL: len={len(pr)}, OFF={'SHADOW OFF' in pr or 'No validation' in pr}, NoVal idx={pr.find('No validation')}")

E = json.load(open(BASE + 'pass176_errors.json'))
errs = E['data']['errors']
lc = [e for e in errs if 'loadCritical' in e.get('text', '')]
fam = [e for e in errs if 'Uncaught (in promise)' in e.get('text', '')]
print(f"ERRORS: total {len(errs)}, loadCritical {len(lc)}, uncaught-promise {len(fam)}")

K = json.load(open(BASE + 'pass176_keys.json'))
kr = K['data']['result'] if isinstance(K.get('data'), dict) and 'result' in K['data'] else str(K)
print(f"KEYS: {kr}")

try:
    sig = json.loads(json.load(open(BASE + 'pass176_sig.json'))['data']['result'])
    st = datetime.datetime.fromtimestamp(sig[0]['time'] / 1000).strftime('%H:%M:%S')
    print(f"SIGNALS: updated {st} UTC, top={sig[0]['game']['name']} conf={sig[0]['confidence']}")
    print(f"  ranks={[(s['game']['name'], s['confidence']) for s in sig[:6]]}")
except Exception as e:
    print(f"SIGNALS parse: {e}")

_d = json.load(open(BASE + 'pass176_history.json'))
H = json.loads(_d['data']['result']) if isinstance(_d.get('data'), dict) and 'result' in _d['data'] else _d
N = len(H)
last = H[-1]
lt = datetime.datetime.fromtimestamp(last['time'] / 1000).strftime('%H:%M:%S')
age = (datetime.datetime.now().timestamp() * 1000 - last['time']) / 1000
print(f"HISTORY: n={N}, last #{N} at {lt} UTC ({age:.0f}s fresh at read time), actual={last['actualResult']['name']}, hit={last['hit']}")
