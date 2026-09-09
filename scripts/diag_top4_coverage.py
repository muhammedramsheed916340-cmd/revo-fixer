#!/usr/bin/env python3
# diag_top4_coverage.py — decision-level coverage analysis (READ-ONLY)
# Q: does the optimizer's MODELED coverage gain over [1,2,5,10] translate
#    into ACTUAL hit-rate gains? (calibration at the decision level)
import json, glob, os
DATA = '/home/z/my-project/scripts/data'
NORMALS = ['1', '2', '5', '10']
BONUSES = ['PACHINKO', 'COIN FLIP', 'CASH HUNT', 'CRAZY TIME']
THEO_SET = set(NORMALS)

def load_snapshot(path):
    raw = open(path).read().strip()
    if raw.startswith('"'):
        raw = json.loads(raw)
    return json.loads(raw)

pool = {}
for p in glob.glob(f'{DATA}/ledger_full_*.json') + glob.glob(f'{DATA}/ledger_audit_raw.json') + glob.glob(f'{DATA}/ledger_pass21_raw.json'):
    try:
        d = load_snapshot(p)
    except Exception:
        continue
    for r in d.get('rows', []):
        if 'bpr' in r and r['bpr']:
            pool[r['i']] = r
ids = sorted(pool)
print(f'prob-covered rounds: {len(ids)} [{ids[0]}..{ids[-1]}]')

# analyze in two blocks: early (88-306), recent (853-1060)
for lo, hi, label in [(88, 306, 'EARLY 88-306'), (853, 1060, 'RECENT 853-1060')]:
    rs = [pool[i] for i in ids if lo <= i <= hi]
    if not rs:
        continue
    n = len(rs)
    sel_cov = [sum(r['bpr'].get(x, 0) for x in r['bp']) for r in rs]
    theo_cov = [sum(r['bpr'].get(x, 0) for x in NORMALS) for r in rs]
    hits = sum(1 for r in rs if r['bh'])
    # how often optimizer's set has HIGHER modeled coverage than theo set
    higher = sum(1 for a, b in zip(sel_cov, theo_cov) if a > b + 1e-9)
    equal = sum(1 for a, b in zip(sel_cov, theo_cov) if abs(a - b) <= 1e-9)
    print(f'\n=== {label} (n={n}) ===')
    print(f'modeled coverage: selected set mean {sum(sel_cov)/n:.1%} | theo set mean {sum(theo_cov)/n:.1%}')
    print(f'optimizer set modeled-coverage > theo set: {higher}/{n} rounds ({higher/n:.0%}); equal: {equal}')
    print(f'ACTUAL: base hit {hits/n:.1%} vs theo-landed {sum(1 for r in rs if r["th"])/n:.1%}')
    # modeled vs realized on the rounds where optimizer claimed an edge
    edge = [r for r, a, b in zip(rs, sel_cov, theo_cov) if a > b + 1e-9]
    if edge:
        eh = sum(1 for r in edge if r['bh']) / len(edge)
        eth = sum(1 for r in edge if r['th']) / len(edge)
        medge = sum(sum(r['bpr'].get(x, 0) for x in r['bp']) - sum(r['bpr'].get(x, 0) for x in NORMALS) for r in edge) / len(edge)
        print(f'on {len(edge)} "claimed-edge" rounds: modeled gain +{medge*100:.1f}pp -> ACTUAL delta (hit - theo) {(eh-eth)*100:+.1f}pp')
    # per-outcome predicted vs realized hit contribution: P(score rank suggests inclusion) etc.
    # top-4 by true prob would be: rank outcomes by EMPIRICAL rate; count matches
    # decomposition of realized minus modeled by outcome on swap rounds
    cost = [r for r in rs if set(r['bp']) != THEO_SET and not r['bh'] and r['th']]
    gain = [r for r in rs if set(r['bp']) != THEO_SET and r['bh'] and not r['th']]
    print(f'swap cost {len(cost)} | gain {len(gain)}')
