#!/usr/bin/env python3
# ============================================================
# diag_top4_gap.py — READ-ONLY diagnostic
# Dynamic Top-4 vs theoretical [1,2,5,10]: exact source of the gap.
# Uses ONLY ledger snapshots. No engine code is read into the app,
# no engine state is modified. Diagnosis only.
# ============================================================
import json, glob, os
from collections import defaultdict

DATA = '/home/z/my-project/scripts/data'
NORMALS = ['1', '2', '5', '10']
BONUSES = ['PACHINKO', 'COIN FLIP', 'CASH HUNT', 'CRAZY TIME']
THEO_SET = set(NORMALS)
THEO = {'1': 0.3889, '2': 0.2407, '5': 0.1296, '10': 0.0741,
        'COIN FLIP': 0.0741, 'PACHINKO': 0.0370, 'CASH HUNT': 0.0370, 'CRAZY TIME': 0.0185}

def load_snapshot(path):
    raw = open(path).read().strip()
    if raw.startswith('"'):
        raw = json.loads(raw)   # unwrap the agent-browser JSON-string envelope
    return json.loads(raw)

# ---------- 1) Load all snapshots; dedupe by round id (latest maxId wins) ----------
files = []
for p in glob.glob(f'{DATA}/ledger_*.json'):
    try:
        d = load_snapshot(p)
        if 'rows' in d and d['rows']:
            files.append((d['maxId'], os.path.getmtime(p), p, d))
    except Exception as e:
        print(f'  [skip {os.path.basename(p)}: {e}]')
files.sort(key=lambda t: (t[0], t[2]))

pool = {}           # id -> row dict (merged fields)
mismatch = 0
checked = 0
for maxId, mt, p, d in files:
    for r in d['rows']:
        row = {'i': r['i'], 'ts': r['ts'], 'a': r['a'], 'bp': r['bp'], 'ep': r['ep'],
               'bh': r['bh'], 'eh': r['eh'], 'th': r['th']}
        for k in ('bc', 'ec', 'bpr', 'epr'):
            if k in r and r[k] is not None:
                row[k] = r[k]
        if r['i'] in pool:
            old = pool[r['i']]
            checked += 1
            for k in ('a', 'bh', 'eh', 'th'):
                if old[k] != row[k]:
                    mismatch += 1
                    print(f'  [MISMATCH id={r["i"]} {k}: {old[k]} vs {row[k]} -> keep newer]')
            for k in ('bp', 'ep'):
                if sorted(old[k]) != sorted(row[k]):
                    mismatch += 1
                    print(f'  [MISMATCH id={r["i"]} {k}: {old[k]} vs {row[k]} -> keep newer]')
        pool[r['i']] = row          # newer (higher maxId) file overwrites
ids = sorted(pool)
print(f'\nPOOL: {len(ids)} unique rounds  [{ids[0]}..{ids[-1]}]  dupes_checked={checked} mismatches={mismatch}')

# continuity segments
segs = []
start = prev = ids[0]
for i in ids[1:]:
    if i == prev + 1:
        prev = i
    else:
        segs.append((start, prev)); start = prev = i
segs.append((start, prev))
print(f'POOL segments: {segs}  (gap 307-636 absent from snapshots)')

# ordered list for streak/recency reconstruction
seq = [pool[i] for i in ids]
idx_of = {r['i']: k for k, r in enumerate(seq)}

def streak_before(k):
    """engine consecutive base-miss streak immediately before seq[k]"""
    s = 0
    j = k - 1
    while j >= 0 and not seq[j]['bh']:
        s += 1; j -= 1
    return s

def prev_bp(k):
    return seq[k - 1]['bp'] if k - 1 >= 0 else None

def recency_elevated(k, name, last_n=5, need=2):
    """user-round recency proxy (live spins NOT in ledger — lower bound)"""
    cnt = sum(1 for r in seq[max(0, k - last_n):k] if r['a'] == name)
    return cnt >= need, cnt

# ---------- 2) generic metric block for a round range ----------
def analyze(lo, hi, label, probs_available=None):
    rounds = [pool[i] for i in ids if lo <= i <= hi]
    n = len(rounds)
    theo_hits = sum(1 for r in rounds if r['th'])
    base_hits = sum(1 for r in rounds if r['bh'])
    exp_hits = sum(1 for r in rounds if r['eh'])
    normal_rounds = [r for r in rounds if r['a'] in THEO_SET]
    bonus_rounds = [r for r in rounds if r['a'] not in THEO_SET]
    Hn = sum(1 for r in normal_rounds if r['bh'])
    Hb = sum(1 for r in bonus_rounds if r['bh'])
    print(f'\n=== {label}  (ids {lo}-{hi}, n={n}) ===')
    print(f'base {base_hits}/{n} = {base_hits/n:.1%} | exp {exp_hits}/{n} = {exp_hits/n:.1%} | theo {theo_hits}/{n} = {theo_hits/n:.1%}')
    print(f'normal rounds (actual in [1,2,5,10]): {len(normal_rounds)} | base hits on them: {Hn} ({Hn/len(normal_rounds):.1%})')
    print(f'bonus  rounds: {len(bonus_rounds)} | base hits on them: {Hb} ({Hb/len(bonus_rounds):.1%})')
    gap = theo_hits - base_hits
    print(f'GAP (theo - base) = {gap} rounds = normal-round misses({len(normal_rounds)-Hn}) - bonus-round hits({Hb})')

    # inclusion rates + landing rates + conditional hit rates
    print('\n-- per-outcome inclusion / landing / hit-when-included (BASE engine) --')
    print(f'{"outcome":<11} {"incl%":>7} {"land%":>7} {"hit|incl":>9} {"incl|land":>10} {"n_incl":>7} {"n_land":>7}')
    for g in NORMALS + BONUSES:
        incl = [r for r in rounds if g in r['bp']]
        land = [r for r in rounds if r['a'] == g]
        hit_incl = sum(1 for r in incl if r['bh'])
        incl_land = sum(1 for r in land if g in r['bp'])
        print(f'{g:<11} {len(incl)/n:>7.1%} {len(land)/n:>7.1%} '
              f'{(hit_incl/len(incl) if incl else 0):>9.1%} {(incl_land/len(land) if land else 0):>10.1%} '
              f'{len(incl):>7} {len(land):>7}')

    # swap ledger vs theoretical set
    swap = [r for r in rounds if set(r['bp']) != THEO_SET]
    same = [r for r in rounds if set(r['bp']) == THEO_SET]
    gain = [r for r in swap if r['bh'] and not r['th']]
    cost = [r for r in swap if not r['bh'] and r['th']]
    push = [r for r in swap if r['bh'] and r['th']]
    dmiss = [r for r in swap if not r['bh'] and not r['th']]
    print(f'\n-- SWAP LEDGER (base Top4 != [1,2,5,10]) --')
    print(f'set==theo: {len(same)} rounds, hit rate {sum(1 for r in same if r["bh"])/len(same):.1%} (= P(normal) on those rounds)')
    print(f'set!=theo: {len(swap)} rounds, hit rate {sum(1 for r in swap if r["bh"])/len(swap):.1%}')
    print(f'  swap-GAIN  (base hit, theo miss): {len(gain)}   e.g. {[r["i"] for r in gain][:12]}')
    print(f'  swap-COST  (base miss, theo hit): {len(cost)}   -> THE GAP MAKERS')
    print(f'  swap-push  (both hit):            {len(push)}')
    print(f'  both-miss  (bonus actual, base missed too): {len(dmiss)}')
    print(f'  net swap P&L = gain - cost = {len(gain)} - {len(cost)} = {len(gain)-len(cost)}  (== base - theo on swap rounds)')

    # miss attribution by excluded normal
    print('\n-- base MISS attribution: which normal was excluded (actual==X, X not in bp) --')
    for x in NORMALS:
        c = sum(1 for r in rounds if r['a'] == x and x not in r['bp'] and not r['bh'])
        land = sum(1 for r in rounds if r['a'] == x)
        print(f'  {x:<4}: {c:>3} misses caused by exclusion  (landed {land}× total)')
    # bonus wasted inclusions
    print('-- bonus inclusions that produced MISS (B in bp, base missed) --')
    for b in BONUSES:
        w = sum(1 for r in rounds if b in r['bp'] and not r['bh'])
        h = sum(1 for r in rounds if b in r['bp'] and r['bh'])
        disp = sum(1 for r in rounds if b in r['bp'] and r['a'] in THEO_SET)
        print(f'  {b:<11}: in {sum(1 for r in rounds if b in r["bp"]):>3} | hit {h} | wasted(miss) {w:>3} | in rounds where a normal landed {disp:>3}')
    agg_w = sum(1 for r in rounds if any(b in r['bp'] for b in BONUSES) and not r['bh'])
    agg_i = sum(1 for r in rounds if any(b in r['bp'] for b in BONUSES))
    print(f'  ANY-bonus-included rounds: {agg_i} | of which base missed: {agg_w}')

    # per-miss detail (structural, first 40)
    print('\n-- base MISS detail (id | actual | bp | excluded-normals | displacing-bonus | streak_before | N in prev bp?) --')
    det = []
    for k, r in [(idx_of[r['i']], r) for r in rounds if not r['bh']]:
        excl = [x for x in NORMALS if r['a'] == x and x not in r['bp']]
        dis = [b for b in BONUSES if b in r['bp']]
        sb = streak_before(k)
        pb = prev_bp(k)
        n_in_prev = (r['a'] in pb) if pb else None
        det.append((r['i'], r['a'], excl, dis, sb, n_in_prev))
    for d in det[:40]:
        print(f'  #{d[0]:<5} a={d[1]:<10} excl={d[2] or "-"} disp={d[3] or "-"} streak={d[4]} N∈prevbp={d[5]}')
    if len(det) > 40:
        print(f'  ... {len(det)-40} more')

    # persistence penalty exposure
    pent = [d for d in det if d[4] >= 2 and d[5]]
    pact = [d for d in det if d[4] >= 2]
    print(f'\nmisses with engine miss-streak>=2 (penalty signal ACTIVE): {len(pact)}/{len(det)}')
    print(f'  ...and missed normal WAS in previous bp (penalty targeted it): {len(pent)}')

    # exp engine set stats
    exp_same = [r for r in rounds if set(r['ep']) == THEO_SET]
    exp_swap = [r for r in rounds if set(r['ep']) != THEO_SET]
    div = [r for r in rounds if set(r['bp']) != set(r['ep'])]
    print(f'\nEXP engine: set==theo {len(exp_same)} | set!=theo {len(exp_swap)} | set!=BASE {len(div)} rounds {([r["i"] for r in div][:12])}')
    if div:
        for r in div[:8]:
            print(f'   #{r["i"]} a={r["a"]:<10} base={r["bp"]} exp={r["ep"]} bh={r["bh"]} eh={r["eh"]}')
    return {'rounds': rounds, 'swap_cost': cost, 'swap_gain': gain, 'detail': det,
            'n': n, 'base_hits': base_hits, 'theo_hits': theo_hits, 'exp_hits': exp_hits}

# ---------- 3) PINNED window ----------
W = analyze(832, 1031, 'PINNED LATEST CLEAN WINDOW')

# ---------- 4) PROB DEEP-DIVE on 853-1031 (bpr/epr available) ----------
print('\n' + '=' * 70)
print('PROB DEEP-DIVE (rounds with recorded calibrated probabilities)')
print('=' * 70)
prob_rows = [pool[i] for i in ids if 853 <= i <= 1031 and 'bpr' in pool[i]]
print(f'prob-covered rounds overlapping pinned window: {len(prob_rows)} / 200 (853-1031)')

# sanity: bc == sum of selected probs?
chk = [(r['i'], r['bc'], sum(r['bpr'].get(x, 0) for x in r['bp'])) for r in prob_rows if 'bc' in r]
bad = [c for c in chk if abs(c[1] - c[2]) > 0.02]
print(f'bc-vs-sum(bpr) sanity: {len(chk)} checked, {len(bad)} off by >2pp')

# calibration table
print('\n-- CALIBRATION (base engine bpr vs empirical, on prob-covered subset) --')
print(f'{"outcome":<11} {"mean bpr":>9} {"empirical":>10} {"err(pp)":>8} {"brier":>7} {"n_land":>7}')
cal = {}
for g in NORMALS + BONUSES:
    mp = sum(r['bpr'].get(g, 0) for r in prob_rows) / len(prob_rows)
    lands = sum(1 for r in prob_rows if r['a'] == g)
    ef = lands / len(prob_rows)
    brier = sum((r['bpr'].get(g, 0) - (1 if r['a'] == g else 0)) ** 2 for r in prob_rows) / len(prob_rows)
    cal[g] = (mp, ef, mp - ef)
    print(f'{g:<11} {mp:>9.1%} {ef:>10.1%} {(mp-ef)*100:>+8.1f} {brier:>7.3f} {lands:>7}')
bs = sum(sum((r['bpr'].get(g, 0) - (1 if r['a'] == g else 0)) ** 2 for g in r['bpr']) / len(r['bpr']) for r in prob_rows) / len(prob_rows)
print(f'multi-class Brier (8-outcome mean): {bs:.4f}')
mbc = sum(r['bc'] for r in prob_rows if 'bc' in r) / max(1, sum(1 for r in prob_rows if 'bc' in r))
mhit = sum(1 for r in prob_rows if r['bh']) / len(prob_rows)
print(f'expected coverage mean(bc) {mbc:.1%} vs actual hit rate {mhit:.1%}  -> coverage calibration gap {(mhit-mbc)*100:+.1f}pp')

# reliability curve: hit rate by bc bucket
print('\n-- hit rate by expected-coverage bucket --')
for lo_, hi_ in [(0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.95)]:
    bkt = [r for r in prob_rows if 'bc' in r and lo_ <= r['bc'] < hi_]
    if bkt:
        hr = sum(1 for r in bkt if r['bh']) / len(bkt)
        print(f'  bc in [{lo_:.1f},{hi_:.1f}): n={len(bkt):>3} hit={hr:.1%}')

# per-cost-round prob attribution
print('\n-- PER-COST-ROUND ATTRIBUTION (theo hit but base missed; prob subset) --')
print('   id     a    excluded  displacer        bpr[N]  bpr[D]  theo[N] theo[D]  epr[N]  epr[D]  exp-set-kept?')
attrib = defaultdict(int)
cost_detail = []
for r in W['swap_cost']:
    if r['i'] < 853 or 'bpr' not in r:
        continue
    N = r['a']
    Ds = [b for b in BONUSES if b in r['bp']]
    D = max(Ds, key=lambda b: r['bpr'].get(b, 0))
    bprN, bprD = r['bpr'].get(N, 0), r['bpr'].get(D, 0)
    eprN, eprD = r['epr'].get(N, 0), r['epr'].get(D, 0)
    k = idx_of[r['i']]
    sb = streak_before(k)
    rec, rc = recency_elevated(k, D)
    inprev = N in (prev_bp(k) or [])
    # classification
    if eprD < eprN and bprD > bprN:
        cls = 'Q6 rare-evidence (reliability layer would flip it)'
        attrib['Q6'] += 1
    elif rec:
        cls = 'Q7 recent-frequency (displacer hot in last 5)'
        attrib['Q7'] += 1
    elif sb >= 2 and inprev:
        cls = 'Q9 persistence penalty (N was incumbent, engine on streak)'
        attrib['Q9'] += 1
    else:
        cls = 'Q11 calibration/blend residual (both engines displace)'
        attrib['Q11'] += 1
    cost_detail.append((r['i'], N, D, bprN, bprD, eprN, eprD, cls, sb, rec, inprev))
    print(f'  #{r["i"]:<5} {N:<4} {str([x for x in NORMALS if x not in r["bp"]]):<24}'
          f' {D:<11} {bprN:>6.1%} {bprD:>7.1%} {THEO[N]:>7.1%} {THEO[D]:>7.1%} {eprN:>7.1%} {eprD:>7.1%}  eh={r["eh"]} | {cls}')
print(f'\nattribution tally (prob-covered cost rounds): {dict(attrib)}')

# mirror: swap-gain rounds on prob subset
print('\n-- swap-GAIN rounds (base won where theo lost) --')
for r in W['swap_gain']:
    extra = ''
    if 'bpr' in r:
        b = [x for x in BONUSES if x in r['bp']]
        extra = f' bonus_in={b} bpr[{r["a"] if r["a"] in BONUSES else "-"}]={r["bpr"].get(r["a"], 0):.1%}'
    print(f'  #{r["i"]} a={r["a"]:<10} bp={r["bp"]}{extra}')

# ---------- 5) POOLED ----------
print('\n' + '=' * 70)
print('POOLED META-ANALYSIS (individual windows + pool; NOT a fresh validation)')
print('=' * 70)
# individual windows
seen = set()
print('\n-- individual snapshot windows (each n=200; chronological) --')
print(f'{"window":<14} {"base":>9} {"exp":>9} {"theo":>9} {"swapR":>6} {"gain":>5} {"cost":>5}')
for maxId, mt, p, d in files:
    key = (d['minId'], d['maxId'])
    if key in seen:
        continue
    seen.add(key)
    rs = [pool[r['i']] for r in d['rows'] if r['i'] in pool]
    if len(rs) < 200:
        continue
    bh = sum(1 for r in rs if r['bh']); eh = sum(1 for r in rs if r['eh']); th = sum(1 for r in rs if r['th'])
    sw = [r for r in rs if set(r['bp']) != THEO_SET]
    g = sum(1 for r in sw if r['bh'] and not r['th']); c = sum(1 for r in sw if not r['bh'] and r['th'])
    print(f'{str(key[0])+"-"+str(key[1]):<14} {bh:>4}/200 {eh:>4}/200 {th:>4}/200 {len(sw):>6} {g:>5} {c:>5}')

# pooled structural (two segments)
analyze(28, 306, 'POOLED SEGMENT EARLY (28-306)')
analyze(637, 1052, 'POOLED SEGMENT RECENT (637-1052)')

# pooled calibration (88-306 + 853-1060 prob rounds)
pr2 = [pool[i] for i in ids if 'bpr' in pool[i] and ((28 <= i <= 306) or (637 <= i <= 1060))]
print(f'\n-- POOLED CALIBRATION on {len(pr2)} prob-covered rounds --')
print(f'{"outcome":<11} {"mean bpr":>9} {"empirical":>10} {"err(pp)":>8}')
for g in NORMALS + BONUSES:
    mp = sum(r['bpr'].get(g, 0) for r in pr2) / len(pr2)
    ef = sum(1 for r in pr2 if r['a'] == g) / len(pr2)
    print(f'{g:<11} {mp:>9.1%} {ef:>10.1%} {(mp-ef)*100:>+8.1f}')

# save machine-readable result
out = {'pinned_window': {'ids': '832-1031',
        'swap_cost': [r['i'] for r in W['swap_cost']],
        'swap_gain': [r['i'] for r in W['swap_gain']],
        'miss_detail': W['detail']},
       'prob_attribution': [{'id': c[0], 'actual': c[1], 'displacer': c[2], 'class': c[7]} for c in cost_detail],
       'pooled_ids': f'{ids[0]}-{ids[-1]}'}
with open(f'{DATA}/diag_top4_result.json', 'w') as f:
    json.dump(out, f, indent=1)
print('\nsaved: scripts/data/diag_top4_result.json')
