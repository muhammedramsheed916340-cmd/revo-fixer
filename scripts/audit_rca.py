#!/usr/bin/env python3
# Shadow A/B diagnostic audit — RCA of the dynamic-vs-theoretical gap
# Observation-only. No model changes. Audits the frozen k=30 baseline (active displayed model).
# Window: current clean n=200 (IDs 88-287 at capture). Full probability vectors available.
import json, math, sys
from collections import Counter, defaultdict

RAW = '/home/z/my-project/scripts/data/ledger_audit_raw.json'
NORMAL = {'1', '2', '5', '10'}
BONUS = {'PACHINKO', 'COIN FLIP', 'CASH HUNT', 'CRAZY TIME'}
STATIC = {'1', '2', '5', '10'}  # theoretical [1,2,5,10] always = these four

d = json.loads(json.load(open(RAW)))
rows = d['rows']
n = len(rows)
ids = [r['i'] for r in rows]

# --- data quality / outage separation ---
ts_gaps = []
for a, b in zip(rows, rows[1:]):
    g = (b['ts'] - a['ts']) / 1000
    if g > 480:
        ts_gaps.append((a['i'], b['i'], round(g / 60)))

deg = [r for r in rows if not r['bp'] or not r['ep']]
valid = [r for r in rows if r not in deg]
vn = len(valid)

# --- headline ---
bh = sum(1 for r in valid if r['bh'])
eh = sum(1 for r in valid if r['eh'])
th = sum(1 for r in valid if r['th'])

print('=' * 72)
print('DIAGNOSTIC AUDIT — clean n=%d window (IDs %d-%d)' % (vn, min(ids), max(ids)))
print('=' * 72)
print()
print('DATA QUALITY / OUTAGE SEPARATION:')
print('  total rows in window: %d' % n)
print('  degraded (outage-corrupted) rows: %d %s' % (len(deg), [r['i'] for r in deg] if deg else '[]'))
print('  valid prediction rounds: %d' % vn)
print('  inter-row time gaps >8min (upstream outage windows, rounds simply absent — not counted as misses):')
if ts_gaps:
    for a, b, m in ts_gaps:
        print('    %d->%d (%d min) — rounds during this window never received IDs; absent from ledger, NOT model misses' % (a, b, m))
else:
    print('    none')
print()
print('HEADLINE (valid rounds only, n=%d):' % vn)
print('  Baseline (frozen k=30, active model): %d/%d = %.2f%%' % (bh, vn, 100 * bh / vn))
print('  Experimental (reliability layer):     %d/%d = %.2f%%' % (eh, vn, 100 * eh / vn))
print('  Theoretical [1,2,5,10]:               %d/%d = %.2f%%' % (th, vn, 100 * th / vn))
print('  Gap (theo - base): %.2fpp' % (100 * (th - bh) / vn))
print('  Gap (theo - exp):  %.2fpp' % (100 * (th - eh) / vn))
print()

# --- gap decomposition: which rounds make up theo-vs-base gap ---
# gap-contributing = theo HIT AND base MISS
# shared-miss = theo MISS AND base MISS (both miss, no gap contribution)
# base-only-bonus = base HIT AND theo MISS (base hit a bonus theo missed — narrows gap)
gap_rounds = [r for r in valid if r['th'] and not r['bh']]
shared_miss = [r for r in valid if not r['th'] and not r['bh']]
base_bonus_hit = [r for r in valid if r['bh'] and not r['th']]
print('GAP DECOMPOSITION (theo %d vs base %d):' % (th, bh))
print('  theo-HIT & base-MISS (gap-contributing misses): %d rounds' % len(gap_rounds))
print('  theo-MISS & base-MISS (shared misses, bonus actuals — NOT gap): %d rounds' % len(shared_miss))
print('  base-HIT & theo-MISS (base hit bonus, narrows gap): %d rounds' % len(base_bonus_hit))
print('  => net gap = %d - %d = %d rounds = %.2fpp' % (len(gap_rounds), len(base_bonus_hit), len(gap_rounds) - len(base_bonus_hit), 100 * (len(gap_rounds) - len(base_bonus_hit)) / vn))
print()

# --- classify each baseline MISS ---
print('=' * 72)
print('MISS CLASSIFICATION (baseline misses, n=%d)' % (vn - bh))
print('=' * 72)
base_misses = [r for r in valid if not r['bh']]

# classes
class_counts = Counter()
class_detail = defaultdict(list)
excl_by_number = Counter()      # misses caused by excluding each normal outcome
bonus_inclusion_misses = 0       # misses where a bonus was in top-4 displacing a number
actual_of_bonus_miss = Counter()  # bonus actuals (shared misses)
actual_of_normal_miss = Counter()  # normal actuals (gap-contributing)

# stale detection
stale_count = 0
prev_bp = None

for r in base_misses:
    actual = r['a']
    bp = r['bp']
    bpr = r['bpr'] or {}
    bonus_in_bp = [x for x in bp if x in BONUS]
    normal_in_bp = [x for x in bp if x in NORMAL]
    stale = (bp == prev_bp)
    if stale:
        stale_count += 1

    if actual in NORMAL:
        actual_of_normal_miss[actual] += 1
        excl_by_number[actual] += 1
        # rank actual by probability
        ranked = sorted(bpr.items(), key=lambda x: -x[1]) if bpr else []
        rank_actual = None
        for idx, (k, v) in enumerate(ranked):
            if k == actual:
                rank_actual = idx + 1
                break
        prob_actual = bpr.get(actual, 0)

        if bonus_in_bp:
            # a bonus occupied a slot -> unnecessary bonus inclusion displaced a number
            bonus_inclusion_misses += 1
            cls = '6_unnecessary_bonus_inclusion'
            # further: was the bonus rated ABOVE the actual number? (rare-outcome over-selection)
            over_select = any(bpr.get(b, 0) > prob_actual for b in bonus_in_bp)
            if over_select:
                cls += ' +1_rare_outcome_over_selection'
            # which bonus
            cls += ' [bonus:%s excl:%s rank_actual:%s p_actual:%.3f]' % ('/'.join(bonus_in_bp), actual, rank_actual, prob_actual)
        else:
            # no bonus in top-4, 4 numbers picked, actual was 5th+
            if rank_actual is not None and rank_actual <= 6:
                cls = '8_optimizer_selection_error [actual rank %d, p=%.3f, just outside top-4]' % (rank_actual, prob_actual)
            else:
                cls = '7_probability_calibration_error [actual rank %s, p=%.3f, rated too low]' % (rank_actual, prob_actual)
        if stale:
            cls += ' +9_stale'
        class_counts[cls.split(' [')[0].split(' +')[0] if '+9' not in cls else cls.split(' +')[0]] += 1
        class_detail[cls.split(' [')[0].split(' +')[0]].append(r['i'])
    else:
        # actual is a bonus -> shared miss with theoretical (not gap-contributing)
        actual_of_bonus_miss[actual] += 1
        cls = '11_other_bonus_actual_shared_miss [actual:%s]' % actual
        if stale:
            cls += ' +9_stale'
        class_counts[cls.split(' [')[0].split(' +')[0]] += 1
        class_detail[cls.split(' [')[0].split(' +')[0]].append(r['i'])
    prev_bp = bp

print()
print('A. MISSES BY EXCLUSION OF EACH NORMAL OUTCOME:')
for num in ['1', '2', '5', '10']:
    print('  actual=%s excluded (not in top-4) and landed: %d misses' % (num, excl_by_number[num]))
print('  subtotal (normal-exclusion, gap-contributing): %d' % sum(excl_by_number.values()))
print()
print('B. MISSES BY UNNECESSARY BONUS INCLUSION (bonus in top-4 displaced a number that landed):')
print('  %d of %d baseline misses' % (bonus_inclusion_misses, len(base_misses)))
print()
print('C. BONUS-ACTUAL SHARED MISSES (actual was bonus, theo also missed — NOT gap-contributing):')
for b, c in sorted(actual_of_bonus_miss.items(), key=lambda x: -x[1]):
    print('  actual=%s: %d' % (b, c))
print('  subtotal: %d' % sum(actual_of_bonus_miss.values()))
print()
print('D. FULL CLASS COUNTS:')
for cls, c in sorted(class_counts.items(), key=lambda x: -x[1]):
    print('  %3d  %s  %s' % (c, cls, class_detail[cls][:12]))
print('  stale-tagged total: %d' % stale_count)
print()

# --- Top-4 inclusion rate for 1/2/5/10 ---
print('=' * 72)
print('TOP-4 INCLUSION RATE (baseline, how often each outcome appears in top-4)')
print('=' * 72)
for outcome in ['1', '2', '5', '10', 'PACHINKO', 'COIN FLIP', 'CASH HUNT', 'CRAZY TIME']:
    cnt = sum(1 for r in valid if outcome in r['bp'])
    print('  %-12s: %3d/%d = %.1f%%' % (outcome, cnt, vn, 100 * cnt / vn))
print()

# --- actual frequency ---
print('ACTUAL FREQUENCY (regime characterization):')
af = Counter(r['a'] for r in valid)
for outcome in ['1', '2', '5', '10', 'PACHINKO', 'COIN FLIP', 'CASH HUNT', 'CRAZY TIME']:
    print('  %-12s: %3d/%d = %.1f%%' % (outcome, af.get(outcome, 0), vn, 100 * af.get(outcome, 0) / vn))
print()

# --- conditional hit rate when each outcome excluded ---
print('=' * 72)
print('CONDITIONAL: actual landed WHEN outcome was EXCLUDED from baseline top-4')
print('=' * 72)
for outcome in ['1', '2', '5', '10']:
    excl_rounds = [r for r in valid if outcome not in r['bp']]
    landed = [r for r in excl_rounds if r['a'] == outcome]
    print('  %-3s excluded in %d/%d rounds; of those, actual=%s in %d (%.1f%%) -> all misses'
          % (outcome, len(excl_rounds), vn, outcome, len(landed), 100 * len(landed) / len(excl_rounds) if excl_rounds else 0))
print()

# --- dynamic vs static divergence ---
print('=' * 72)
print('DYNAMIC-vs-STATIC DIVERGENCE')
print('=' * 72)
same = [r for r in valid if set(r['bp']) == STATIC]
diff = [r for r in valid if set(r['bp']) != STATIC]
same_hit = sum(1 for r in same if r['bh'])
diff_hit = sum(1 for r in diff if r['bh'])
same_theo = sum(1 for r in same if r['th'])
diff_theo = sum(1 for r in diff if r['th'])
print('  rounds where baseline top-4 == {1,2,5,10}: %d/%d = %.1f%%' % (len(same), vn, 100 * len(same) / vn))
print('    baseline HIT on these: %d/%d = %.1f%%' % (same_hit, len(same), 100 * same_hit / len(same) if same else 0))
print('    theoretical HIT on these: %d/%d = %.1f%%' % (same_theo, len(same), 100 * same_theo / len(same) if same else 0))
print('  rounds where baseline top-4 != {1,2,5,10}: %d/%d = %.1f%%' % (len(diff), vn, 100 * len(diff) / vn))
print('    baseline HIT on these: %d/%d = %.1f%%' % (diff_hit, len(diff), 100 * diff_hit / len(diff) if diff else 0))
print('    theoretical HIT on these: %d/%d = %.1f%%' % (diff_theo, len(diff), 100 * diff_theo / len(diff) if diff else 0))
print()
# what does the model swap in/out when it diverges?
print('  when diverging, what bonuses does baseline include?')
bonus_when_diff = Counter()
for r in diff:
    for x in r['bp']:
        if x in BONUS:
            bonus_when_diff[x] += 1
for b, c in sorted(bonus_when_diff.items(), key=lambda x: -x[1]):
    print('    %-12s: in %d/%d divergent rounds (%.1f%%)' % (b, c, len(diff), 100 * c / len(diff)))
print('  when diverging, which normal number is dropped most?')
drop_when_diff = Counter()
for r in diff:
    for num in ['1', '2', '5', '10']:
        if num not in r['bp']:
            drop_when_diff[num] += 1
for num, c in sorted(drop_when_diff.items(), key=lambda x: -x[1]):
    print('    %-3s dropped: %d/%d divergent rounds (%.1f%%)' % (num, c, len(diff), 100 * c / len(diff)))
print()

# --- probability calibration check ---
print('=' * 72)
print('PROBABILITY CALIBRATION CHECK (when bonus displaced a number that landed)')
print('=' * 72)
# for each gap-contributing miss with bonus in bp: was the bonus prob > actual prob?
over_select_misses = 0
for r in gap_rounds:
    actual = r['a']
    bp = r['bp']
    bpr = r['bpr'] or {}
    if actual in NORMAL and actual not in bp:
        bonus_in_bp = [x for x in bp if x in BONUS]
        if bonus_in_bp:
            pa = bpr.get(actual, 0)
            if any(bpr.get(b, 0) > pa for b in bonus_in_bp):
                over_select_misses += 1
print('  gap-misses where >=1 bonus in top-4 was rated ABOVE the excluded number that landed: %d/%d' % (over_select_misses, len(gap_rounds)))
print('  => these are pure rare-outcome over-selection: model assigned higher prob to a bonus than to the number that actually landed')
print()

# --- dominant source summary ---
print('=' * 72)
print('DOMINANT SOURCE OF THE %.1fpp GAP' % (100 * (th - bh) / vn))
print('=' * 72)
print('  1. Normal-exclusion misses (gap-contributing): %d' % len(gap_rounds))
print('     - of which unnecessary bonus inclusion displaced the number: %d' % bonus_inclusion_misses)
print('     - of which no bonus but number ranked 5th-6th (optimizer cap): %d' % class_counts.get('8_optimizer_selection_error', 0))
print('     - of which no bonus but number ranked low (calibration): %d' % class_counts.get('7_probability_calibration_error', 0))
print('  2. Bonus-actual shared misses (not gap): %d' % len(shared_miss))
print('  3. Base bonus-hits (narrow gap): %d' % len(base_bonus_hit))
print()
print('  => The gap is dominated by: %s' % (
    'UNNECESSARY BONUS INCLUSION (rare-outcome over-selection)' if bonus_inclusion_misses > class_counts.get('8_optimizer_selection_error', 0) + class_counts.get('7_probability_calibration_error', 0)
    else 'optimizer/calibration cap on number slots'))
print('  => The dynamic model includes PACHINKO/COIN FLIP/etc. in its top-4,')
print('     displacing one of {1,2,5,10}; when the displaced number lands, dynamic misses')
print('     while the static [1,2,5,10] floor always hits. This is structurally identical')
print('     to the mechanism-symmetry finding (Task 57): the model trades number slots for bonus slots.')
