#!/usr/bin/env python3
# DIAGNOSTIC AUDIT — clean n=200 window (IDs 72-271): dynamic Top-4 vs theoretical [1,2,5,10]
# OBSERVATION-ONLY. No tuning, no weight changes, no k changes, no forcing [1,2,5,10].
# Taxonomy (user-specified 11 classes) + required calculations, both models.
import json, itertools
from collections import defaultdict, Counter

NORMALS = {'1', '2', '5', '10'}
W = (72, 271)  # clean audit window

def load():
    rows = {}
    # rows 72-90: pass-19 raw (no probs)
    d19 = json.loads(json.load(open('/home/z/my-project/scripts/data/ledger_pass19_raw.json')))
    for r in d19['rows']:
        if W[0] <= r['i'] <= 90:
            rows[r['i']] = dict(r, bpr=None, epr=None)
    # rows 91-290: full extraction (with probs)
    d20 = json.loads(json.load(open('/home/z/my-project/scripts/data/ledger_full_pass20.json')))
    for r in d20['rows']:
        if 91 <= r['i'] <= W[1]:
            rows[r['i']] = dict(r, bpr=r.get('bpr'), epr=r.get('epr'))
    return [rows[i] for i in sorted(rows)]

def is_bonus(x): return x not in NORMALS
def pget(pr, k):
    if not pr: return None
    return pr.get(k)

def stale_run_flags(rows, key):
    # per row: True if pred-set identical to previous >=2 rows (run length >=3 incl. current)
    flags = {}
    run = 0; prev = None
    for r in rows:
        cur = tuple(sorted(r[key] or []))
        if cur == prev: run += 1
        else: run = 1; prev = cur
        flags[r['i']] = run >= 3
    return flags

def audit_model(rows, model):
    pk = 'bp' if model == 'base' else 'ep'
    hk = 'bh' if model == 'base' else 'eh'
    prk = 'bpr' if model == 'base' else 'epr'
    n = len(rows)
    misses = [r for r in rows if not r[hk]]
    hits = [r for r in rows if r[hk]]
    theo = [r for r in rows if r['th']]

    # --- required calc: Top-4 inclusion rate for 1/2/5/10 + exclusion cost ---
    incl = {x: 0 for x in NORMALS}
    excl_lands = {x: 0 for x in NORMALS}   # X excluded AND X landed
    excl_count = {x: 0 for x in NORMALS}   # X excluded
    excl_roundhit = {x: [0, 0] for x in NORMALS}  # [round hits, rounds] when X excluded
    for r in rows:
        preds = set(r[pk] or [])
        for x in NORMALS:
            if x in preds: incl[x] += 1
            else:
                excl_count[x] += 1
                if r['a'] == x: excl_lands[x] += 1
                if r[hk]: excl_roundhit[x][0] += 1
                excl_roundhit[x][1] += 1

    # --- deviation vs [1,2,5,10] ---
    eq_rows, diff_rows = [], []
    for r in rows:
        (eq_rows if set(r[pk] or []) == NORMALS else diff_rows).append(r)
    hit_eq = sum(1 for r in eq_rows if r[hk])
    hit_diff = sum(1 for r in diff_rows if r[hk])
    theo_eq = sum(1 for r in eq_rows if r['th'])
    theo_diff = sum(1 for r in diff_rows if r['th'])
    # deviation cost: on diff rounds, rounds where theo hit but model missed
    dev_cost = [r for r in diff_rows if r['th'] and not r[hk]]
    # free rides: diff rounds where model hit but theo missed (model beat floor)
    dev_gain = [r for r in diff_rows if r[hk] and not r['th']]

    # --- taxonomy per miss ---
    T = defaultdict(int)            # primary bucket counts
    flags = Counter()               # co-attribute flags
    wasted_slots = 0
    detail = []
    for r in misses:
        preds = r[pk] or []
        pset = set(preds)
        bonuses = [p for p in preds if is_bonus(p)]
        bon_missed = [b for b in bonuses if b != r['a']]
        a = r['a']
        if a in NORMALS:
            # exclusion miss: primary = which normal was excluded
            prim = {'1': '5:1-exclusion', '2': '2:2-exclusion', '5': '3:5-exclusion', '10': '4:10-exclusion'}[a]
            if bon_missed:
                flags['co:unnecessary-bonus-inclusion'] += 1
                flags['co:rare-over-selection'] += 1
                wasted_slots += len(bon_missed)
            else:
                flags['co:pure-reordering-within-normals'] += 1
        else:
            # bonus landed, not selected
            if bonuses:
                prim = '1:rare-over-selection'
                flags['co:unnecessary-bonus-inclusion'] += 1
                wasted_slots += len(bon_missed)
            else:
                prim = '11:other-bonus-surprise'
        # stale co-flag
        if STALE[pk][r['i']]:
            flags['co:stale-run(>=3)'] += 1
        # calibration vs selection (probs subset only)
        pr = r[prk]
        if a in NORMALS and pr:
            pa = pget(pr, a)
            selprobs = [pget(pr, p) for p in preds if pget(pr, p) is not None]
            if pa is not None and selprobs:
                if pa >= min(selprobs):
                    T['sub:8-optimizer-selection-error'] += 1
                else:
                    T['sub:7-calibration-error'] += 1
            else:
                T['sub:probs-missing-for-actual'] += 1
        elif a not in NORMALS and pr:
            pa = pget(pr, a)  # landed bonus's prob if tracked
            selprobs = [pget(pr, p) for p in preds if pget(pr, p) is not None]
            if pa is not None and selprobs and pa >= min(selprobs):
                T['sub:8-optimizer-selection-error'] += 1
            elif pa is not None:
                T['sub:7-calibration-error'] += 1
            else:
                T['sub:probs-missing-for-actual'] += 1
        else:
            T['sub:no-probs(rows72-90)'] += 1
        T[prim] += 1
        detail.append((r['i'], a, prim, len(bon_missed), r['th']))
    return dict(n=n, misses=len(misses), hits=len(hits), theo=len(theo),
                incl=incl, excl_count=excl_count, excl_lands=excl_lands,
                excl_roundhit=excl_roundhit,
                n_eq=len(eq_rows), hit_eq=hit_eq, theo_eq=theo_eq,
                n_diff=len(diff_rows), hit_diff=hit_diff, theo_diff=theo_diff,
                dev_cost=len(dev_cost), dev_cost_ids=[r['i'] for r in dev_cost],
                dev_gain=len(dev_gain), dev_gain_ids=[r['i'] for r in dev_gain],
                tax=T, flags=flags, wasted_slots=wasted_slots, detail=detail)

rows = load()
assert len(rows) == 200 and rows[0]['i'] == 72 and rows[-1]['i'] == 271, (len(rows), rows[0]['i'], rows[-1]['i'])
STALE = {'bp': stale_run_flags(rows, 'bp'), 'ep': stale_run_flags(rows, 'ep')}

# sanity vs established metrics
for m, hk in (('base', 'bh'), ('exp', 'eh')):
    assert sum(1 for r in rows if r[hk]) == 119, m
assert sum(1 for r in rows if r['th']) == 160

# outage accounting inside window
gaps = []
for a, b in zip(rows, rows[1:]):
    g = (b['ts'] - a['ts']) / 1000
    if g > 480: gaps.append((a['i'], b['i'], round(g / 60, 1)))
OUTAGE_ADJ = {75, 76, 227, 228}

print('=' * 72)
print('DIAGNOSTIC AUDIT — clean window IDs 72-271 (n=200), both models')
print('=' * 72)
print('window: base 119/200=59.5%%, exp 119/200=59.5%%, theo 160/200=80.0%%  (verified)')
print('OUTAGE SEPARATION: gaps inside window (UNOBSERVED rounds, NOT model misses):')
for g in gaps: print('  gap %d->%d: %s min' % g)
print('  est. unobserved: ~13-18 (75->76, era cadence) + ~25-35 (227->228, 42s cadence)')
print('  outage-adjacent rows (sensitivity set): 75, 76, 227, 228')
sens = [r for r in rows if r['i'] not in OUTAGE_ADJ]
sb = sum(1 for r in sens if r['bh']); se = sum(1 for r in sens if r['eh']); st = sum(1 for r in sens if r['th'])
print('  sensitivity excl. 75/76/227/228 (n=%d): base %d (%.1f%%) exp %d (%.1f%%) theo %d (%.1f%%)' % (
    len(sens), sb, 100 * sb / len(sens), se, 100 * se / len(sens), st, 100 * st / len(sens)))
print()

for m, label in (('base', 'BASELINE (frozen k=30)'), ('exp', 'EXPERIMENTAL (reliability layer)')):
    A = audit_model(rows, m)
    print('-' * 72)
    print('MODEL: %s — hits %d/200 = %.1f%%, misses %d' % (label, A['hits'], 100 * A['hits'] / 200, A['misses']))
    print('DEVIATION FROM [1,2,5,10]:')
    print('  rounds equal to floor set: %d (%.1f%%) | hit %d (%.1f%% of equal; == theo by construction: theo on equal %d)' % (
        A['n_eq'], 100 * A['n_eq'] / 200, A['hit_eq'], 100 * A['hit_eq'] / max(1, A['n_eq']), A['theo_eq']))
    print('  rounds differing: %d (%.1f%%) | model hit %d (%.1f%%) | theo hit %d (%.1f%%) | floor-beating hits %d %s' % (
        A['n_diff'], 100 * A['n_diff'] / 200, A['hit_diff'], 100 * A['hit_diff'] / max(1, A['n_diff']),
        A['theo_diff'], 100 * A['theo_diff'] / max(1, A['n_diff']), A['dev_gain'], A['dev_gain_ids']))
    print('  DEVIATION COST (diff & theo-hit & model-missed): %d rounds %s' % (A['dev_cost'], A['dev_cost_ids']))
    gap_pp = 100 * (A['theo'] - A['hits']) / 200
    print('  GAP ALGEBRA: theo %d - hits %d = %d lost rounds = %.1fpp; deviation-cost rounds account for %d of them' % (
        A['theo'], A['hits'], A['theo'] - A['hits'], gap_pp, A['dev_cost']))
    print('TOP-4 INCLUSION RATE (per normal outcome):')
    for x in ('1', '2', '5', '10'):
        print('  %s: included %d/200 (%.0f%%) | excluded %d rounds | X landed while excluded: %d (%.1f%% of excl) | round-hit rate when X excluded: %d/%d = %.1f%%' % (
            x, A['incl'][x], 100 * A['incl'][x] / 200, A['excl_count'][x], A['excl_lands'][x],
            100 * A['excl_lands'][x] / max(1, A['excl_count'][x]),
            A['excl_roundhit'][x][0], A['excl_roundhit'][x][1],
            100 * A['excl_roundhit'][x][0] / max(1, A['excl_roundhit'][x][1])))
    print('MISS TAXONOMY (primary buckets, %d misses):' % A['misses'])
    for k in sorted(A['tax']):
        if not k.startswith('sub:'): print('  %-28s %d' % (k, A['tax'][k]))
    print('  co-attribution flags:')
    for k, v in sorted(A['flags'].items()): print('    %-36s %d' % (k, v))
    print('  wasted bonus slots on miss rounds: %d' % A['wasted_slots'])
    print('  CALIBRATION-vs-SELECTION split (probs subset rows 91-271, n=%d):' % (181))
    for k in sorted(A['tax']):
        if k.startswith('sub:'): print('    %-36s %d' % (k, A['tax'][k]))
    print('  miss detail (id, actual, primary, wasted-bonus-slots, theo):')
    for d in A['detail']: print('    %s' % (d,))
    print()

print('=' * 72)
print('CROSS-CHECK: flip rows (base!=exp) inside window:')
for r in rows:
    if r['bh'] != r['eh']:
        print('  #%d actual=%s base=%s exp=%s theo=%s | bp=%s ep=%s' % (r['i'], r['a'], r['bh'], r['eh'], r['th'], r['bp'], r['ep']))
