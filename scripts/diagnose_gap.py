#!/usr/bin/env python3
"""
DIAGNOSTIC ONLY — reads extracted ledger JSON. Does NOT touch the engine/model.

Compares dynamic Top-4 (baseline k=30) vs theoretical [1,2,5,10] on the current
clean window, decomposes the 12pp gap into structural causes, and performs a
pooled meta-analysis over all observed (deduplicated) rounds.

Usage:
  python3 diagnose_gap.py <current_window_ledger.json> [<full_prob_ledger.json>] [pooled_ledger1.json ...]
"""
import json, sys, os, math
from collections import defaultdict, Counter

NORMAL = ['1', '2', '5', '10']
BONUS  = ['PACHINKO', 'COIN FLIP', 'CRAZY TIME', 'CASH HUNT']
THEO_SET = set(NORMAL)

def load_ledger(path):
    """Ledger files are JSON-string-wrapped JSON (agent-browser eval output)."""
    outer = json.load(open(path))
    if isinstance(outer, str):
        return json.loads(outer)
    return outer  # already dict

def is_normal(a):  return a in THEO_SET
def is_bonus(a):   return a in set(BONUS)

def top4_from_probs(pr):
    """Reconstruct the optimizer's top-4 by descending probability."""
    if not pr: return None
    items = sorted(pr.items(), key=lambda kv: (-kv[1], kv[0]))
    return [k for k, _ in items[:4]]

def rank_of(outcome, pr):
    """1-based rank of an outcome in the probability ordering (1 = highest prob)."""
    if not pr or outcome not in pr: return None
    items = sorted(pr.items(), key=lambda kv: (-kv[1], kv[0]))
    for i, (k, _) in enumerate(items):
        if k == outcome: return i + 1
    return None

# ---------------------------------------------------------------------------
# INDIVIDUAL-WINDOW DIAGNOSTIC
# ---------------------------------------------------------------------------
def diagnose_window(d, prob_lookup=None, label=""):
    rows = d['rows']
    n = len(rows)
    minId, maxId = d['minId'], d['maxId']

    base_hit = sum(1 for r in rows if r['bh'])
    exp_hit  = sum(1 for r in rows if r['eh'])
    theo_hit = sum(1 for r in rows if r['th'])
    base_rate = base_hit / n
    exp_rate  = exp_hit / n
    theo_rate = theo_hit / n

    print("=" * 78)
    print(f"WINDOW {label}: IDs {minId}-{maxId}, n={n}")
    print("=" * 78)
    print(f"  Baseline (k=30 dynamic) HIT : {base_hit}/{n} = {base_rate*100:.1f}%")
    print(f"  Experimental (shadow)  HIT : {exp_hit}/{n} = {exp_rate*100:.1f}%")
    print(f"  Theoretical [1,2,5,10] HIT : {theo_hit}/{n} = {theo_rate*100:.1f}%")
    print(f"  GAP (theo - base)         : {theo_hit - base_hit} rounds = {(theo_rate-base_rate)*100:.1f}pp")

    # ---- 2x2 decomposition theo x base ----
    A = [r for r in rows if r['th'] and r['bh']]      # both hit, normal landed
    B = [r for r in rows if r['th'] and not r['bh']]  # theo hit, base MISS (normal excluded)
    C = [r for r in rows if not r['th'] and r['bh']]  # base hit bonus, theo MISS
    D = [r for r in rows if not r['th'] and not r['bh']]  # both MISS, bonus landed
    print(f"\n  2x2 decomposition (theo x base):")
    print(f"    A  both HIT  (normal landed, included)   : {len(A)}")
    print(f"    B  theo HIT, base MISS (normal EXCLUDED) : {len(B)}  <- GAP SOURCE (+)")
    print(f"    C  base HIT bonus, theo MISS              : {len(C)}  <- GAP REDUCER (-)")
    print(f"    D  both MISS (bonus landed, neither had)  : {len(D)}  <- unavoidable")
    print(f"    Net gap = B - C = {len(B)} - {len(C)} = {len(B)-len(C)}  (checks: theo-base = {theo_hit-base_hit})")

    # ---- Top-4 inclusion rate for each normal ----
    print(f"\n  Top-4 INCLUSION rate (how often each normal appears in baseline prediction):")
    inc = {}
    for nm in NORMAL:
        cnt = sum(1 for r in rows if nm in r['bp'])
        inc[nm] = cnt
        print(f"    '{nm}': {cnt}/{n} = {cnt/n*100:.1f}%")
    # actual-result coverage
    print(f"\n  ACTUAL-result distribution & per-outcome HIT rate:")
    act_dist = Counter(r['a'] for r in rows)
    for out in NORMAL + BONUS:
        tot = act_dist.get(out, 0)
        if tot == 0: continue
        bh = sum(1 for r in rows if r['a'] == out and r['bh'])
        th = sum(1 for r in rows if r['a'] == out and r['th'])
        print(f"    {out:12s}: landed {tot:3d} ({tot/n*100:5.1f}%) | base HIT {bh}/{tot}={bh/tot*100:5.1f}% | theo HIT {th}/{tot}={th/tot*100:5.1f}%")

    # ---- dynamic Top-4 == theo vs != theo ----
    same = [r for r in rows if set(r['bp']) == THEO_SET]
    diff = [r for r in rows if set(r['bp']) != THEO_SET]
    same_hit = sum(1 for r in same if r['bh'])
    diff_hit = sum(1 for r in diff if r['bh'])
    print(f"\n  Dynamic Top-4 vs [1,2,5,10]:")
    print(f"    Rounds where bp == [1,2,5,10]: {len(same)}/{n} = {len(same)/n*100:.1f}%  | HIT {same_hit}/{len(same)} = {(same_hit/len(same)*100 if same else 0):.1f}%")
    print(f"    Rounds where bp != [1,2,5,10]: {len(diff)}/{n} = {len(diff)/n*100:.1f}%  | HIT {diff_hit}/{len(diff)} = {(diff_hit/len(diff)*100 if diff else 0):.1f}%")

    # ---- Per-MISS 12-point diagnostic ----
    base_miss = [r for r in rows if not r['bh']]
    print(f"\n  PER-MISS DIAGNOSTIC ({len(base_miss)} baseline MISSes):")
    # tallies
    excluded_normal_count = Counter()  # which normal was excluded (and was the actual)
    displacer_count = Counter()       # which bonus displaced
    cause_tally = Counter()
    unavoidable_bonus = 0
    marginal_exclusions = []  # rounds where actual normal was rank-5 (just below cutoff)

    for r in base_miss:
        a = r['a']; bp_set = set(r['bp'])
        excluded_normals = THEO_SET - bp_set
        displacers = bp_set - THEO_SET
        actual_is_normal = is_normal(a)
        actual_is_bonus = is_bonus(a)

        if actual_is_normal and a in excluded_normals:
            # THE gap source: a normal landed but was excluded
            excluded_normal_count[a] += 1
            for disp in displacers:
                displacer_count[disp] += 1
            # cause inference
            if 'PACHINKO' in displacers:
                cause_tally['rare-outcome evidence (PACHINKO displaced normal)'] += 1
            elif displacers:
                cause_tally['recent-frequency/optimizer (other bonus displaced normal)'] += 1
            else:
                cause_tally['normal-vs-normal displacement (no bonus?)'] += 1
            # marginal check via probs
            if prob_lookup and r['i'] in prob_lookup:
                pr = prob_lookup[r['i']].get('bpr')
                if pr:
                    rk = rank_of(a, pr)
                    if rk == 5:
                        # find the rank-4 outcome that edged it out
                        top4 = top4_from_probs(pr)
                        edge = top4[3] if top4 else None
                        p_actual = pr.get(a, 0)
                        p_edge = pr.get(edge, 0) if edge else 0
                        marginal_exclusions.append((r['i'], a, p_actual, edge, p_edge, pr))
                        cause_tally['marginal optimizer cutoff (actual was rank-5)'] += 1
        elif actual_is_bonus:
            unavoidable_bonus += 1
            cause_tally['unavoidable (bonus landed, theo also missed)'] += 1
            if displacers:
                cause_tally['  -> wrong bonus included instead'] += 1
        else:
            cause_tally['other'] += 1

    print(f"    MISSes where actual was BONUS (unavoidable): {unavoidable_bonus}")
    print(f"    MISSes where actual was NORMAL but excluded (GAP SOURCE): {sum(excluded_normal_count.values())}")
    print(f"\n    Normal outcome excluded-and-landed (gap source by outcome):")
    for nm in NORMAL:
        print(f"      '{nm}' excluded & landed: {excluded_normal_count[nm]}")
    print(f"\n    Bonus displacer tally (when a normal was excluded):")
    for b, c in displacer_count.most_common():
        print(f"      {b:12s} displaced a normal: {c}")
    print(f"\n    Cause inference (structural; probs where available):")
    for cause, c in cause_tally.most_common():
        print(f"      {c:3d}  {cause}")

    if marginal_exclusions:
        print(f"\n    MARGINAL exclusions (actual normal was rank-5, just below top-4 cutoff):")
        for rid, a, pa, edge, pe, pr in marginal_exclusions[:8]:
            print(f"      #{rid} actual='{a}' p={pa:.4f} (rank5) | edge-in='{edge}' p={pe:.4f} (rank4) | margin={pe-pa:.4f}")
        if len(marginal_exclusions) > 8:
            print(f"      ... and {len(marginal_exclusions)-8} more")
        print(f"      TOTAL marginal: {len(marginal_exclusions)} / {sum(excluded_normal_count.values())} gap-source misses")

    # ---- Expected coverage vs actual ----
    bcs = [r.get('bc') for r in rows if r.get('bc') is not None]
    if bcs:
        avg_cov = sum(bcs) / len(bcs)
        print(f"\n  EXPECTED vs ACTUAL coverage:")
        print(f"    Avg expected coverage (sum of 4 selected probs): {avg_cov*100:.2f}%")
        print(f"    Actual HIT rate (base)                        : {base_rate*100:.2f}%")
        print(f"    Calibration gap (expected - actual)           : {(avg_cov-base_rate)*100:.2f}pp  {'(optimistic)' if avg_cov>base_rate else '(pessimistic)'}")

    # ---- Per-outcome calibration (if prob data) ----
    if prob_lookup:
        print(f"\n  PER-OUTCOME CALIBRATION (from prob-augmented subset):")
        cal_rows = [r for r in rows if r['i'] in prob_lookup]
        print(f"    Rounds with prob data: {len(cal_rows)}/{n}")
        # For each outcome, collect (predicted_prob, empirical_hit) pairs
        for out in NORMAL + BONUS:
            preds = []
            for r in cal_rows:
                pr = prob_lookup[r['i']].get('bpr', {})
                if out in pr:
                    preds.append((pr[out], 1 if r['a'] == out else 0))
            if not preds: continue
            avg_p = sum(p for p, _ in preds) / len(preds)
            emp = sum(h for _, h in preds) / len(preds)
            print(f"    {out:12s}: avg predicted prob {avg_p*100:6.2f}% | empirical freq {emp*100:6.2f}% | error {(avg_p-emp)*100:+.2f}pp")
        # Reliability bins for the actual outcome's predicted prob
        bins = [(0, 0.05), (0.05, 0.10), (0.10, 0.15), (0.15, 0.20), (0.20, 0.35), (0.35, 1.0)]
        print(f"\n    Reliability diagram (predicted prob of ACTUAL outcome vs empirical):")
        for lo, hi in bins:
            bucket = []
            for r in cal_rows:
                pr = prob_lookup[r['i']].get('bpr', {})
                p = pr.get(r['a'])
                if p is not None and lo <= p < hi:
                    bucket.append(p)
            if bucket:
                avg_p = sum(bucket) / len(bucket)
                emp = len(bucket) / len(cal_rows)  # freq of actual-in-bin... not quite right
                print(f"      [{lo:.2f},{hi:.2f}): n={len(bucket):3d} avg_pred={avg_p*100:5.1f}%")

    return {
        'n': n, 'minId': minId, 'maxId': maxId,
        'base_hit': base_hit, 'exp_hit': exp_hit, 'theo_hit': theo_hit,
        'A': len(A), 'B': len(B), 'C': len(C), 'D': len(D),
        'same': len(same), 'diff': len(diff),
        'same_hit': same_hit, 'diff_hit': diff_hit,
        'excluded_normal': dict(excluded_normal_count),
        'displacers': dict(displacer_count),
    }

# ---------------------------------------------------------------------------
# POOLED META-ANALYSIS (deduplicated by round ID)
# ---------------------------------------------------------------------------
def pooled_meta(ledger_paths):
    by_id = {}
    for p in ledger_paths:
        try:
            d = load_ledger(p)
        except Exception as e:
            print(f"  (skip {p}: {e})"); continue
        for r in d['rows']:
            # keep the richest version (prefer one with bpr)
            if r['i'] not in by_id or ('bpr' in r and 'bpr' not in by_id[r['i']]):
                by_id[r['i']] = r
    rows = [by_id[k] for k in sorted(by_id)]
    n = len(rows)
    if n == 0:
        print("  (no rows)"); return None
    base_hit = sum(1 for r in rows if r['bh'])
    exp_hit  = sum(1 for r in rows if r['eh'])
    theo_hit = sum(1 for r in rows if r['th'])
    A = sum(1 for r in rows if r['th'] and r['bh'])
    B = sum(1 for r in rows if r['th'] and not r['bh'])
    C = sum(1 for r in rows if not r['th'] and r['bh'])
    D = sum(1 for r in rows if not r['th'] and not r['bh'])
    same = sum(1 for r in rows if set(r['bp']) == THEO_SET)
    diff = n - same
    same_hit = sum(1 for r in rows if set(r['bp']) == THEO_SET and r['bh'])
    diff_hit = sum(1 for r in rows if set(r['bp']) != THEO_SET and r['bh'])
    print(f"\n  Pooled unique rounds: {n} (IDs {rows[0]['i']}-{rows[-1]['i']})")
    print(f"  NOTE: pooled is a DIAGNOSTIC meta-analysis, NOT a fresh validation.")
    print(f"  Base HIT {base_hit}/{n}={base_hit/n*100:.1f}% | Exp HIT {exp_hit}/{n}={exp_hit/n*100:.1f}% | Theo HIT {theo_hit}/{n}={theo_hit/n*100:.1f}%")
    print(f"  Gap (theo-base) = {theo_hit-base_hit} = {(theo_hit-base_hit)/n*100:.1f}pp")
    print(f"  2x2: A(both,normal)={A} B(theo hit,base MISS)={B} C(base hit bonus,theo MISS)={C} D(both MISS,bonus)={D}")
    print(f"  bp==theo: {same}/{n} HIT {same_hit}/{same}={same_hit/same*100 if same else 0:.1f}% | bp!=theo: {diff}/{n} HIT {diff_hit}/{diff}={diff_hit/diff*100 if diff else 0:.1f}%")
    # per-outcome exclusion gap source
    excl = Counter()
    disp = Counter()
    for r in rows:
        if not r['bh'] and r['th']:
            excl[r['a']] += 1
            for b in set(r['bp']) - THEO_SET:
                disp[b] += 1
    print(f"  Gap-source (B) by excluded normal: {dict(excl)}")
    print(f"  Gap-source (B) by displacer: {dict(disp)}")
    return {'n': n, 'base': base_hit, 'exp': exp_hit, 'theo': theo_hit, 'B': B, 'C': C}

# ---------------------------------------------------------------------------
def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    cur = load_ledger(args[0])
    prob_lookup = {}
    if len(args) > 1 and os.path.exists(args[1]):
        full = load_ledger(args[1])
        for r in full['rows']:
            prob_lookup[r['i']] = r
        print(f"[prob data loaded from {args[1]}: {len(prob_lookup)} rows, IDs {full['minId']}-{full['maxId']}]")
    r = diagnose_window(cur, prob_lookup, label="CURRENT (user-stated)")
    # pooled
    if len(args) > 2:
        print("\n" + "=" * 78)
        print("POOLED META-ANALYSIS (all observed snapshots, deduplicated by round ID)")
        print("=" * 78)
        pooled_meta(args[2:])
    print("\n" + "=" * 78)
    print("DOMINANT-CAUSE SYNTHESIS")
    print("=" * 78)
    B, C = r['B'], r['C']
    print(f"  Net gap = {r['theo_hit']-r['base_hit']} rounds = B(gap source) - C(gap reducer) = {B} - {C}")
    print(f"  B = {B} rounds where a NORMAL landed but the dynamic Top-4 excluded it (theo would have hit).")
    print(f"  C = {C} rounds where the dynamic Top-4 HIT a bonus that [1,2,5,10] could not (theo missed).")
    if r['excluded_normal']:
        worst = max(r['excluded_normal'], key=r['excluded_normal'].get)
        print(f"  Dominant excluded normal: '{worst}' ({r['excluded_normal'][worst]} of {B} gap-source misses).")
    if r['displacers']:
        topd = max(r['displacers'], key=r['displacers'].get)
        print(f"  Dominant displacer: {topd} ({r['displacers'][topd]} displacements).")
    print(f"  bp != [1,2,5,10] in {r['diff']}/{r['n']} rounds ({r['diff']/r['n']*100:.1f}%); HIT rate there {r['diff_hit']}/{r['diff']}={r['diff_hit']/r['diff']*100 if r['diff'] else 0:.1f}%.")
    print(f"  bp == [1,2,5,10] in {r['same']}/{r['n']} rounds ({r['same']/r['n']*100:.1f}%); HIT rate there {r['same_hit']}/{r['same']}={r['same_hit']/r['same']*100 if r['same'] else 0:.1f}%.")
    print("\n  See per-cause tally above for the 12-point attribution. Questions 6-11")
    print("  (rare-outcome/recent-freq/blending/persistence/optimizer/calibration)")
    print("  are INFERRED structurally; probs used where available for marginal-cutoff analysis.")

if __name__ == '__main__':
    main()
