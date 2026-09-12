#!/usr/bin/env python3
# Pass 274 state derivation — era-3 first full-window pass (all prior state scripts lost in the P273 rollback).
# Derives every metric from raw probe files only. Observation-only.
import json, datetime
from collections import Counter

tz = datetime.timezone(datetime.timedelta(hours=8))
def stamp(ms): return datetime.datetime.fromtimestamp(ms/1000, tz)

def load(f):
    d = json.load(open('scripts/data/'+f))['data']['result']
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: pass
    return d

BONUS = {'COIN FLIP','PACHINKO','CRAZY TIME','CASH HUNT'}
MINOR_GAP = 90.0   # era-2 threshold: max 89.9s "missed the 90s minor threshold by 0.1s"

print("== A. ERA-3 CENSUS ==")
h = load('pass274_history.json')
meta = load('pass274_meta.json')
page = load('pass274_page.json')
n = len(h)
print(f"n = {n} (meta probe said {meta['n']}; +{n-meta['n']} landed during probe window)")
print(f"meta ts   = {stamp(meta['ts'])}  ({meta['ts']})")
print(f"page ts   = {stamp(page['ts'])}  ({page['ts']})")
print(f"localStorage keys = {meta['keys']}")
hits = sum(1 for r in h if r['hit'])
rate = hits/n*100
ceil65 = -(-65*n//100)
ceil60 = -(-60*n//100)
print(f"census = {hits}/{n} = {rate:.2f}%  | ceil(0.65*n)={ceil65} surplus {hits-ceil65:+d} | ceil(0.60*n)={ceil60} surplus {hits-ceil60:+d}")
def top(r): return r['prediction'][0]['game']['name']
def act(r): return r['actualResult']['name'] if r.get('actualResult') else None
exact = sum(1 for r in h if r['hit'] and top(r) == act(r))
recal = sum(1 for r in h if r.get('recalibrated'))
bonusA = sum(1 for r in h if act(r) in BONUS)
print(f"exact {exact} | recal {recal} | bonus actuals {bonusA}")
acts = [act(r) for r in h]
print("actual composition:", dict(Counter(a for a in acts if a)))

print("\n== B. CADENCE / GAPS ==")
ts = [r['time'] for r in h]
first_ts = ts[0]
gaps = [(ts[i+1]-ts[i])/1000 for i in range(len(ts)-1)]
print(f"E3#1 ts = {stamp(first_ts)} ({first_ts})")
print(f"gaps: min {min(gaps):.1f}s / max {max(gaps):.1f}s / avg {sum(gaps)/len(gaps):.1f}s over {len(gaps)} intervals")
stall = [g for g in gaps if g >= MINOR_GAP]
print(f"stall-class (>= {MINOR_GAP:.0f}s): {len(stall)} {stall if stall else '— NONE'}")
era3_open_to_probe = (meta['ts']-first_ts)/1000
print(f"era-3 span E3#1 → meta probe: {era3_open_to_probe:.1f}s")

print("\n== C. STREAKS / RUNS ==")
marks = ['H' if r['hit'] else 'm' for r in h]
best = cur = 0
for m in marks:
    cur = cur+1 if m=='H' else 0
    best = max(best,cur)
print(f"round record: {''.join(marks)}")
print(f"max H-run {best} | live H-run {cur}")
# exact-run detail
def exmark(r):
    if r['hit'] and top(r)==act(r): return 'X'
    return 'H' if r['hit'] else 'm'
print("exact map:", ' '.join(f"{i+1}{exmark(r)}{('/'+act(r)[:2] if act(r) else '')}{'r' if r.get('recalibrated') else ''}{'[B]' if act(r) in BONUS else ''}" for i,r in enumerate(h)))

print("\n== D. ROUND TABLE (E3#1–#%d) ==" % n)
for i,r in enumerate(h):
    preds = ','.join(p['game']['name'] for p in r['prediction'])
    print(f"E3#{i+1:2d} {stamp(r['time'])} pred[{preds}] actual '{act(r)}' {'HIT ' if r['hit'] else 'MISS'} conf {r['confidence']}%{' RECAL' if r.get('recalibrated') else ''}{' BONUS-ACTUAL' if act(r) in BONUS else ''}")

print("\n== E. CONF PATH ==")
print("conf by round:", [r['confidence'] for r in h])
print("lock label (panel): MODERATE @55 (see panel); conf range in rounds: %d–%d" % (min(r['confidence'] for r in h), max(r['confidence'] for r in h)))

print("\n== F. SIGNALS / BENCH ==")
s = load('pass274_signals.json')
print("bench order:", [x['game']['name'] for x in s])
print("uniform conf:", set(x['confidence'] for x in s))
for x in s:
    tags = {k:v for k,v in x.items() if isinstance(v,bool)}
    print(f"  #{x['rank']} {x['game']['name']:10s} label={x.get('label')} range={x['game'].get('confidenceRange')} bonus={x['game'].get('isBonus')} tags={tags}")

print("\n== G. PANEL FACTS ==")
t = load('pass274_panel_live.json')
print(f"panel chars = {len(t)}")
i = t.find('Shadow A/B is OFF')
print("Shadow OFF banner:", 'PRESENT' if i>=0 else 'ABSENT')
for k in ['paired rounds','Baseline HIT rate','Experimental','MISS→HIT','HIT→MISS','theoretical','MISS RCA']:
    print(f"  shadow metric '{k}': {'PRESENT' if k.lower() in t.lower() else 'absent'}")
j = t.find('VALIDATION CRITERIA')
print("VALIDATION:", ' '.join(t[j:j+150].split())[:140])
replay = t[t.find('REPLAY LIVE ROUNDS'):t.find('REPLAY LIVE ROUNDS')+40].replace('\n',' ')
print("REPLAY strip:", replay[:34])
k2 = t.find('PERFORMANCE LEDGER')
print("LEDGER head:", ' '.join(t[k2:k2+220].split())[:200])
for key in ['PATTERN SHIFT DETECTED','MISS STREAK','ARCHIVE']:
    idx = t.find(key)
    print(f"'{key}': {'LIT/PRESENT @'+str(idx) if idx>=0 else 'ABSENT'}")
b = t.find('HIT STREAK')
print("banner:", ' '.join(t[b:b+130].split()))
tr = t.find('Trend')
print("trend/tpc:", ' '.join(t[tr:tr+120].split()))
br = t.find('BONUS RISK ANALYSIS')
print("bonus risk:", ' '.join(t[br:br+150].split())[:140])
ai = t.find('AI ANALYSIS SUMMARY')
print("AI:", ' '.join(t[ai:ai+140].split()))
ev = t.find('EVENT DEBUG LOG')
print("EVENT DEBUG:", ' '.join(t[ev:ev+60].split()))
pd_ = t.find('PERFORMANCE DEBUG')
print("PERF DEBUG:", ' '.join(t[pd_:pd_+180].split())[:170])
c = t.find('1,249')
print("platform counters:", ' '.join(t[c:c+70].split()) if c>=0 else 'NOT FOUND')

print("\n== H. CONSOLE RING ==")
raw = json.load(open('scripts/data/pass274_errors.json'))
con = raw.get('data', raw)
msgs = con.get('messages', con if isinstance(con, list) else [])
types = Counter(m.get('type','?') for m in msgs)
fr = sum(1 for m in msgs if '[Fast Refresh]' in json.dumps(m.get('args',[])))
errlike = sum(1 for m in msgs if m.get('type') in ('error','warning') or 'error' in json.dumps(m.get('args',[])).lower()[:200])
print(f"ring messages = {len(msgs)} | by type {dict(types)} | [Fast Refresh] {fr} | error-ish {errlike}")
if msgs:
    last = msgs[-1]
    txt = json.dumps(last.get('args',[]))[:120]
    print("ring tail:", txt)
