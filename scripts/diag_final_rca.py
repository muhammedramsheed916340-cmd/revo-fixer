#!/usr/bin/env python3
"""
FINAL Top-4 RCA — quantitative diagnostic (observation-only, no engine changes).
Dataset: scripts/data/pass282_history.json (era-3 clean walk-forward, n=178,
stored locked Top-4 per round, stored confidence, recal flags).

Sections:
  S1  Benchmarks A (stored dynamic) vs C [1,2,5,10] vs D random + McNemar
  S2  Wheel i.i.d. tests: chi-square GOF, bonus-runs test, lag-1 transitions
  S3  Bonus-slot economics: k-distribution, slot efficiency league, unnecessary
      inclusions, displacement exchange rates
  S4  Mechanism reconstruction from stored history (deterministic parts):
      pattern-shift overwrite regime, anomaly overwrite, persistence penalty
  S5  Confidence calibration (displayed vs realized top-4 coverage)
  S6  Per-miss ledger with displacement attribution + avoidable classification
"""
import json, math, random
from collections import Counter
from itertools import combinations
from scipy import stats as st

THEO = {"1": 21/54, "2": 13/54, "5": 7/54, "10": 4/54,
        "COIN FLIP": 4/54, "CASH HUNT": 2/54, "PACHINKO": 2/54, "CRAZY TIME": 1/54}
BONUS = ["PACHINKO", "COIN FLIP", "CASH HUNT", "CRAZY TIME"]
NUMS = ["1", "2", "5", "10"]
GAMES = NUMS + BONUS
C_SET = set(NUMS)

d = json.load(open("scripts/data/pass282_history.json"))
rounds = json.loads(d["data"]["result"]) if isinstance(d["data"]["result"], str) else d["data"]["result"]
N = len(rounds)
actuals = [r["actualResult"]["name"] for r in rounds]
locked = [ [p["game"]["name"] for p in r["prediction"]] for r in rounds ]
locked_sets = [set(x) for x in locked]
confs = [r["confidence"] for r in rounds]
hits = [r["hit"] for r in rounds]
recal = [r.get("recalibrated", False) for r in rounds]

out = []
def P(s=""):
    out.append(str(s)); print(s)

P("=" * 74)
P(f"S1 BENCHMARKS on same {N} stored rounds")
P("=" * 74)
A = sum(hits)
C_hits = sum(1 for a in actuals if a in C_SET)
random.seed(42)
sims = 2000
Dtot = 0
for _ in range(sims):
    for a in actuals:
        if a in random.sample(GAMES, 4):
            Dtot += 1
D_rate = Dtot / (sims * N)
P(f"  A stored dynamic baseline : {A}/{N} = {A/N*100:.2f}%   [95% CI {A/N*100-1.96*100*math.sqrt(A/N*(1-A/N)/N):.1f} .. {A/N*100+1.96*100*math.sqrt(A/N*(1-A/N)/N):.1f}]")
P(f"  C theoretical [1,2,5,10]  : {C_hits}/{N} = {C_hits/N*100:.2f}%   [95% CI {C_hits/N*100-1.96*100*math.sqrt(C_hits/N*(1-C_hits/N)/N):.1f} .. {C_hits/N*100+1.96*100*math.sqrt(C_hits/N*(1-C_hits/N)/N):.1f}]")
P(f"  D random Top-4            : 50.00% (analytical; sim {D_rate*100:.2f}%)")
P(f"  deficit A-C               : {A-C_hits} rounds = {(A-C_hits)/N*100:+.2f} pp")
# McNemar: b = C-hit & A-miss, c = A-hit & C-miss
b = sum(1 for i in range(N) if actuals[i] in C_SET and not hits[i])
c = sum(1 for i in range(N) if actuals[i] not in C_SET and hits[i])
mc = (abs(b - c) - 1) ** 2 / (b + c)
p_mc = 1 - st.chi2.cdf(mc, 1)
P(f"  McNemar paired test       : b={b} (baseline-hit/dynamic-miss), c={c} (dynamic-hit/baseline-miss)")
P(f"  McNemar chi2={mc:.1f}, p = {p_mc:.2e}  -> deficit is NOT sampling noise")

P("")
P("=" * 74)
P("S2 WHEEL STRUCTURE TESTS (is there anything to exploit?)")
P("=" * 74)
cnt = Counter(actuals)
exp = [THEO[g] * N for g in GAMES]
obs = [cnt.get(g, 0) for g in GAMES]
chi2 = sum((o - e) ** 2 / e for o, e in zip(obs, exp))
p_chi = 1 - st.chi2.cdf(chi2, 7)
P(f"  chi-square GOF (7 dof): stat={chi2:.2f}, p={p_chi:.3f}  -> {'CONSISTENT with i.i.d. 54-segment wheel' if p_chi>0.05 else 'DIVERGENT'}")
P("    " + "  ".join(f"{g}:{o}(e{e:.0f})" for g, o, e in zip(GAMES, obs, exp)))
# runs test on bonus binary
bb = [1 if a in BONUS else 0 for a in actuals]
n1 = sum(bb); n0 = N - n1
runs = 1 + sum(1 for i in range(1, N) if bb[i] != bb[i-1])
mu = 1 + 2 * n1 * n0 / N
var = 2 * n1 * n0 * (2 * n1 * n0 - N) / (N * N * (N - 1))
z_runs = (runs - mu) / math.sqrt(var) if var > 0 else 0
p_runs = 2 * (1 - st.norm.cdf(abs(z_runs)))
P(f"  bonus runs test: observed runs={runs}, expected={mu:.1f}, z={z_runs:+.2f}, p={p_runs:.3f} -> {'no clustering evidence' if p_runs>0.05 else 'clustering!'}")
# lag-1 transitions bonus vs number
b_after_b = sum(1 for i in range(1, N) if bb[i] == 1 and bb[i-1] == 1)
b_prev_b = sum(1 for i in range(1, N) if bb[i-1] == 1)
b_after_n = sum(1 for i in range(1, N) if bb[i] == 1 and bb[i-1] == 0)
b_prev_n = N - 1 - b_prev_b
table = [[b_after_b, b_prev_b - b_after_b], [b_after_n, b_prev_n - b_after_n]]
chi2_t, p_t, _, _ = st.chi2_contingency(table, correction=True)
P(f"  P(bonus|prev bonus) = {b_after_b}/{b_prev_b} = {b_after_b/max(1,b_prev_b)*100:.1f}%   P(bonus|prev number) = {b_after_n}/{b_prev_n} = {b_after_n/max(1,b_prev_n)*100:.1f}%")
P(f"  2x2 transition chi2={chi2_t:.2f}, p={p_t:.3f} -> {'DEPENDENT' if p_t<=0.05 else 'no next-round dependence (i.i.d. holds)'}")
# '1' lag-1 autocorrelation
o1 = [1 if a == "1" else 0 for a in actuals]
pairs = [(o1[i], o1[i+1]) for i in range(N-1)]
phi = (sum(1 for x, y in pairs if x == 1 and y == 1) * sum(1 for x, y in pairs if x == 0 and y == 0)
       - sum(1 for x, y in pairs if x == 1 and y == 0) * sum(1 for x, y in pairs if x == 0 and y == 1))
n00 = sum(1 for x, y in pairs if x == 0 and y == 0); n01 = sum(1 for x, y in pairs if x == 0 and y == 1)
n10 = sum(1 for x, y in pairs if x == 1 and y == 0); n11 = sum(1 for x, y in pairs if x == 1 and y == 1)
den = math.sqrt((n00+n01)*(n10+n11)*(n00+n10)*(n01+n11))
phi /= den if den else 1
P(f"  '1' lag-1 phi autocorrelation = {phi:+.3f} (n={N-1} pairs) -> {'~0, i.i.d.' if abs(phi)<0.15 else 'structure!'}")

P("")
P("=" * 74)
P("S3 BONUS-SLOT ECONOMICS (stored locked Top-4)")
P("=" * 74)
kBins = Counter(len(s & set(BONUS)) for s in locked_sets)
P(f"  rounds by #bonus in Top-4: " + ", ".join(f"k={k}: {kBins.get(k,0)}" for k in sorted(kBins)))
B_rounds = sum(v for k, v in kBins.items() if k >= 1)
P(f"  rounds with >=1 bonus slot: {B_rounds}/{N} = {B_rounds/N*100:.1f}%  (bonus actual rate: {n1}/{N} = {n1/N*100:.1f}%)")
incl = Counter(); cover = Counter(); waste = Counter()
for i in range(N):
    for g in locked_sets[i]:
        incl[g] += 1
        if g != actuals[i]:
            waste[g] += 1
    if actuals[i] in locked_sets[i]:
        cover[actuals[i]] += 1
tot_bonus_slots = sum(incl[g] for g in BONUS)
tot_bonus_hits = sum(cover[g] for g in BONUS)
P(f"  {'outcome':12} {'slots':>5} {'slot%':>6} {'prior%':>7} {'over':>5} {'hits':>4} {'eff%':>6}  slot-eff vs prior")
for g in GAMES:
    ic = incl[g]; cv = cover[g]; pr = THEO[g]
    eff = cv / ic * 100 if ic else 0
    P(f"  {g:12} {ic:>5} {ic/N*100:>5.1f}% {pr*100:>6.2f}% {ic/N/pr:>4.1f}x {cv:>4} {eff:>5.1f}%  {eff/(pr*100):.2f}x")
P(f"  TOTAL bonus slots {tot_bonus_slots} ({tot_bonus_slots/(4*N)*100:.1f}% of {4*N} slots) -> {tot_bonus_hits} hits, efficiency {tot_bonus_hits/tot_bonus_slots*100:.2f}%")
unnecessary = sum(1 for i in range(N) if (locked_sets[i] & set(BONUS)) and actuals[i] in NUMS and not hits[i])
P(f"  'unnecessary bonus inclusions' (bonus in Top-4 AND number actual missed): {unnecessary} rounds = {unnecessary/A if A else 0:.0%} of misses-causing rounds")
P(f"  (each such round had 1+ bonus slot that a [1,2,5,10] lock would have used for the actual number)")
# exchange rate
P(f"  exchange rate: {unnecessary} number-misses bought {tot_bonus_hits} bonus-hits  (need <=2:1 for CF-slot breakeven, ~1:1 for CH/P)")

P("")
P("=" * 74)
P("S4 MECHANISM RECONSTRUCTION (deterministic from stored history)")
P("=" * 74)
# pattern shift: TVD(last10 vs prior history) > 0.6 (detectPatternShift, n>=15)
ps_rounds = []
for i in range(N):
    if i + 1 < 15:
        continue
    long_slice = actuals[:max(0, i + 1 - 10)]
    recent_slice = actuals[i + 1 - 10:i + 1]
    lf = Counter(long_slice); rf = Counter(recent_slice)
    ln = max(1, len(long_slice)); rn = max(1, len(recent_slice))
    tvd = sum(abs(rf.get(g, 0) / rn - lf.get(g, 0) / ln) for g in GAMES)
    if tvd > 0.6:
        ps_rounds.append(i + 1)
# compress ranges
def ranges(lst):
    out = []
    for r in lst:
        if out and r == out[-1][1] + 1:
            out[-1][1] = r
        else:
            out.append([r, r])
    return ", ".join(f"#{a}" if a == b else f"#{a}-#{b}" for a, b in out)
P(f"  pattern-shift OVERWRITE regime active (TVD>0.6, score := 1+1.3*dev10): {len(ps_rounds)}/{N} rounds")
P(f"    rounds: {ranges(ps_rounds) if ps_rounds else 'none'}")
P("    (in these rounds every outcome's score = pure last-10 recency deviation x1.3 + prior x0.5)")
# anomaly chi2>18.5 reconstruction (n>=10) - rolling
an_rounds = []
for i in range(N):
    if i + 1 < 10:
        continue
    sl = actuals[:i + 1]
    cn = Counter(sl); nn = len(sl)
    x2 = sum((cn.get(g, 0) - THEO[g] * nn) ** 2 / (THEO[g] * nn) for g in GAMES)
    if x2 > 18.5:
        an_rounds.append(i + 1)
P(f"  anomaly OVERWRITE regime active (rolling chi2>18.5): {len(an_rounds)}/{N} rounds {ranges(an_rounds) if an_rounds else ''}")
# persistence penalty reconstruction
pen_rounds = []
pen_on_1 = 0
run_miss = 0
for i in range(N):
    if not hits[i]:
        run_miss += 1
    else:
        run_miss = 0
    # penalty applied when GENERATING next prediction after this state:
    if run_miss >= 2:
        prev = locked_sets[i]
        pen_rounds.append(i + 1)
        if "1" in prev:
            pen_on_1 += 1
P(f"  persistence-penalty regime active (consecMisses>=2 at scoring time): {len(pen_rounds)}/{N} rounds")
P(f"    of those, '1' was in the punished previous prediction {pen_on_1} times (penalty -3..-15% on a 38.9%-prior outcome)")

P("")
P("=" * 74)
P("S5 CONFIDENCE CALIBRATION (displayed conf ~= P(actual in Top-4))")
P("=" * 74)
P(f"  overall: mean displayed conf = {sum(confs)/N:.1f}  vs realized HIT rate = {A/N*100:.2f}%")
buckets = [(30, 45), (45, 55), (55, 65), (65, 76)]
for lo, hi in buckets:
    idx = [i for i in range(N) if lo <= confs[i] < hi]
    if idx:
        r = sum(hits[i] for i in idx) / len(idx)
        mc_ = sum(confs[i] for i in idx) / len(idx)
        P(f"    conf [{lo},{hi}): n={len(idx):>3}, mean conf {mc_:.1f}, realized {r*100:>5.1f}%  (gap {r*100-mc_:+.1f} pp)")
recal_hits = sum(1 for i in range(N) if recal[i] and hits[i])
recal_n = sum(1 for i in range(N) if recal[i])
P(f"  recalibrated-flag rounds: {recal_n}, HIT rate within them {recal_hits}/{recal_n} = {recal_hits/max(1,recal_n)*100:.1f}%")

P("")
P("=" * 74)
P(f"S6 PER-MISS LEDGER WITH DISPLACEMENT ATTRIBUTION ({N-A} misses)")
P("=" * 74)
avoid_direct = 0; structural = 0
for i in range(N):
    if hits[i]:
        continue
    act = actuals[i]
    sel = locked[i]
    bon = [g for g in sel if g in BONUS]
    if act in NUMS:
        avoid_direct += 1
        cls = "AVOIDABLE(baseline-lock)"
    else:
        structural += 1
        cls = "STRUCTURAL(bonus-uncovered)"
    cand = [g for g in sel if THEO[g] <= THEO[act]]
    disp = min(cand, key=lambda g: THEO[g]) if cand else "-"
    P(f"  #{i+1:>3} act={act:11} locked=[{','.join(sorted(sel))}] kB={len(bon)} conf={confs[i]:>2} displacer={disp:11} {cls}")
P(f"  AVOIDABLE-by-[1,2,5,10]-lock: {avoid_direct}   STRUCTURAL (bonus actual, not covered): {structural}")
P("")
P("done -> scripts/data/diag_final_rca_out.txt")
with open("scripts/data/diag_final_rca_out.txt", "w") as f:
    f.write("\n".join(out) + "\n")
