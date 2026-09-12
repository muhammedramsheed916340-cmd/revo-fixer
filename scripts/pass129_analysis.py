#!/usr/bin/env python3
"""Pass 129 (Task ID 174) — read-only stall-verification analysis.
History byte-identical to pass 128 (no new rounds); measures the open feed gap."""
import json, datetime, filecmp

H128 = '/home/z/my-project/scripts/data/pass128_history.json'
H129 = '/home/z/my-project/scripts/data/pass129_history.json'
ident = filecmp.cmp(H128, H129, shallow=False)
d = json.load(open(H129))
h = json.loads(d['data']['result'])
N = len(h)
now_ms = datetime.datetime.now().timestamp()*1000
gap = (now_ms - h[-1]['time'])/1000
latest = datetime.datetime.fromtimestamp(h[-1]['time']/1000).strftime('%H:%M:%S')
print(f"history identical to pass128: {ident}")
print(f"n={N} latest #{N} at {latest} local")
print(f"OPEN GAP at script-run: {gap:.0f}s ({gap/60:.1f} min)")
print(f"era ranks: #5=215s #4=708s #3=1047s #2=1136s #1=1823s  -> current = era #{1 if gap>1823 else 2 if gap>1136 else 3 if gap>1047 else 4 if gap>708 else 5}")
print(f"record crossing (1823s) at ~{datetime.datetime.fromtimestamp(h[-1]['time']/1000 + 1823).strftime('%H:%M:%S')} local")
sig = json.loads(json.load(open('/home/z/my-project/scripts/data/pass129_signals.json'))['data']['result'])
print("live signals:", [(s['game']['name'], s['confidence']) for s in sig])
print("census unchanged from pass128 (n=580): baseline 366/580=63.1%, bonus 38/96=39.6%, theo 484/580=83.4%, recal 202/580=34.8%")
