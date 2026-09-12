#!/usr/bin/env python3
"""
Top-4 Coverage RCA — diagnostic ONLY (no code changes).
Analyzes the clean walk-forward validation history (pass282_history.json,
178 baseline-mode rounds) to quantify WHY the dynamic Top-4 loses to the
theoretical [1,2,5,10] baseline.

Benchmarks on the SAME 178 actuals:
  A. Current dynamic (baseline mode) — stored locked Top-4
  C. Theoretical [1,2,5,10]
  D. Random Top-4 (uniform over 8 outcomes, pick 4)

Plus miss attribution: exclusion misses by outcome, bonus displacement,
wasted inclusions, per-outcome inclusion/coverage stats.
"""
import json, random
from collections import Counter, defaultdict
from itertools import combinations

THEO = {"1":0.3889,"2":0.2407,"5":0.1296,"10":0.0741,
        "COIN FLIP":0.0741,"PACHINKO":0.0370,"CASH HUNT":0.0370,"CRAZY TIME":0.0185}
BONUS = {"PACHINKO","COIN FLIP","CASH HUNT","CRAZY TIME"}
NUMS = ["1","2","5","10"]
GAMES = ["1","2","5","10","COIN FLIP","PACHINKO","CASH HUNT","CRAZY TIME"]

def load_rounds(path):
    d = json.load(open(path))
    r = d["data"]["result"]
    return json.loads(r) if isinstance(r, str) else r

def main():
    rounds = load_rounds("scripts/data/pass282_history.json")
    N = len(rounds)
    actuals = [r["actualResult"]["name"] for r in rounds]
    locked = [set(p["game"]["name"] for p in r["prediction"]) for r in rounds]

    # ---------- Benchmark A: current dynamic (baseline) ----------
    A_hits = sum(1 for i in range(N) if actuals[i] in locked[i])
    # ---------- Benchmark C: theoretical [1,2,5,10] ----------
    C_set = {"1","2","5","10"}
    C_hits = sum(1 for i in range(N) if actuals[i] in C_set)
    # ---------- Benchmark D: random Top-4 ----------
    random.seed(42)
    D_sims = 2000
    D_hit_total = 0
    for _ in range(D_sims):
        for i in range(N):
            combo = set(random.sample(GAMES, 4))
            if actuals[i] in combo:
                D_hit_total += 1
    D_rate = D_hit_total / (D_sims * N)
    # analytical random expected: each outcome in 4/8 of random combos => 0.5
    D_analytical = 0.5

    print("="*70)
    print("BENCHMARK COMPARISON (same %d unseen rounds)" % N)
    print("="*70)
    print(f"  A. Current dynamic (baseline mode) : {A_hits}/{N} = {A_hits/N*100:.2f}%")
    print(f"  C. Theoretical [1,2,5,10]          : {C_hits}/{N} = {C_hits/N*100:.2f}%")
    print(f"  D. Random Top-4 (analytical)       : {D_analytical*100:.2f}%   (sim {D_rate*100:.2f}%)")
    print(f"  Gap dynamic vs theoretical         : {(A_hits/N - C_hits/N)*100:+.2f} pp")
    print(f"  Gap dynamic vs random              : {(A_hits/N - D_analytical)*100:+.2f} pp")

    # ---------- Actual distribution vs theoretical ----------
    act_counts = Counter(actuals)
    print("\n"+"="*70)
    print("ACTUAL DISTRIBUTION vs THEORETICAL PRIOR")
    print("="*70)
    print(f"  {'outcome':12} {'actual':>7} {'act%':>7} {'theo%':>7} {'dev':>8}")
    for g in GAMES:
        c = act_counts.get(g,0)
        ap = c/N*100
        tp = THEO[g]*100
        dev = (ap-tp)/tp*100 if tp else 0
        print(f"  {g:12} {c:>7} {ap:>6.2f}% {tp:>6.2f}% {dev:>+7.1f}%")

    # ---------- Per-outcome inclusion / coverage ----------
    print("\n"+"="*70)
    print("PER-OUTCOME: INCLUSION vs ACTUAL COVERAGE (baseline mode)")
    print("="*70)
    print(f"  {'outcome':12} {'incl':>5} {'act':>5} {'cover':>6} {'incl%':>7} {'act%':>7} {'miss_when_act':>13} {'waste':>6}")
    incl = Counter(); cover = Counter(); miss_when_act = Counter()
    waste = Counter()  # included but not the actual
    for i in range(N):
        for n in locked[i]:
            incl[n]+=1
            if n != actuals[i]:
                waste[n]+=1
        cover[actuals[i]] += 1 if actuals[i] in locked[i] else 0
        if actuals[i] not in locked[i]:
            miss_when_act[actuals[i]] += 1
    for g in GAMES:
        ic=incl.get(g,0); ac=act_counts.get(g,0); cv=cover.get(g,0)
        mw=miss_when_act.get(g,0); ws=waste.get(g,0)
        print(f"  {g:12} {ic:>5} {ac:>5} {cv:>6} {ic/N*100:>6.1f}% {ac/N*100:>6.1f}% {mw:>13} {ws:>6}")

    # ---------- Miss attribution ----------
    print("\n"+"="*70)
    print(f"MISS ATTRIBUTION  ({N-A_hits} misses)")
    print("="*70)
    # For each miss: actual was excluded. Displacer = selected outcome with LOWEST theo prior
    # (the one that "shouldn't" be there vs the actual). If actual is a number and a bonus is
    # selected, the bonus displaced it. If actual is a number and a lower-prior number selected,
    # that number displaced it.
    disp_counter = Counter()
    num_excl_miss = Counter()  # actual number excluded
    bonus_displace_miss = Counter()  # bonus in locked that displaced an actual number
    for i in range(N):
        if actuals[i] in locked[i]:
            continue
        act = actuals[i]
        sel = locked[i]
        # displacer candidates: selected outcomes with theo prior <= actual's theo prior
        cand = [n for n in sel if THEO[n] <= THEO[act]]
        if cand:
            # pick the lowest-prior selected as "the displacer"
            disp = min(cand, key=lambda n: THEO[n])
            disp_counter[disp]+=1
        if act in NUMS:
            num_excl_miss[act]+=1
            # which bonuses were in the locked set (displacing the number)?
            bsel = [n for n in sel if n in BONUS]
            for b in bsel:
                bonus_displace_miss[b]+=1
        else:
            # actual was a bonus and was excluded -> number displaced it (rare-event under-coverage)
            pass
    print("  Misses where actual was a NUMBER excluded (per number):")
    for n in NUMS:
        print(f"     {n:>3} excluded-when-actual : {num_excl_miss[n]:>3}   (theo {THEO[n]*100:.2f}%)")
    print(f"     TOTAL number-exclusion misses : {sum(num_excl_miss.values())}")
    print("  Bonus in Top-4 that displaced an actual number (per bonus):")
    for b in BONUS:
        print(f"     {b:12} displacing : {bonus_displace_miss[b]:>3}   (theo {THEO[b]*100:.2f}%)")
    print(f"     TOTAL bonus-displacement incidents : {sum(bonus_displace_miss.values())} (a single miss may have >1 bonus)")
    print("  Most frequent 'displacer' (lowest-prior selected outcome in misses):")
    for n,c in disp_counter.most_common():
        print(f"     {n:12} : {c}")

    # ---------- Wasted bonus inclusions ----------
    print("\n"+"="*70)
    print("WASTED BONUS INCLUSIONS (bonus in Top-4 but not the actual)")
    print("="*70)
    total_bonus_slots = sum(incl.get(b,0) for b in BONUS)
    total_bonus_hits = sum(cover.get(b,0) for b in BONUS)
    total_bonus_waste = sum(waste.get(b,0) for b in BONUS)
    print(f"  Total bonus slots used in Top-4   : {total_bonus_slots} (of {N*4}={N*4} total slots)")
    print(f"  Bonus slots that HIT (actual=bonus): {total_bonus_hits}")
    print(f"  Bonus slots WASTED (not the actual): {total_bonus_waste}")
    if total_bonus_slots:
        print(f"  Bonus inclusion HIT efficiency    : {total_bonus_hits/total_bonus_slots*100:.1f}%")
        print(f"  Theoretical bonus HIT rate        : {sum(THEO[b] for b in BONUS)*100:.2f}% (combined bonus prior)")

    # ---------- Exclusion rates of 1/2/5/10 ----------
    print("\n"+"="*70)
    print("EXCLUSION RATE OF HIGH-PRIOR NUMBERS (1/2/5/10) from Top-4")
    print("="*70)
    for n in NUMS:
        excl = sum(1 for i in range(N) if n not in locked[i])
        print(f"  {n:>3} excluded {excl}/{N} = {excl/N*100:.1f}% of rounds   (theo {THEO[n]*100:.2f}%)")

    # ---------- Bonus inclusion rate ----------
    print("\n"+"="*70)
    print("BONUS INCLUSION RATE (how often each bonus entered Top-4)")
    print("="*70)
    for b in BONUS:
        inc = incl.get(b,0)
        print(f"  {b:12} included {inc}/{N} = {inc/N*100:.1f}%   (theo {THEO[b]*100:.2f}%)   -> {cover.get(b,0)} hits, {waste.get(b,0)} waste")

    # ---------- Predictable / stale prediction detection ----------
    print("\n"+"="*70)
    print("PREDICTION STABILITY (consecutive identical Top-4 sets)")
    print("="*70)
    same=0; changes=0
    for i in range(1,N):
        if locked[i]==locked[i-1]:
            same+=1
        else:
            changes+=1
    print(f"  Consecutive identical : {same}/{N-1} = {same/(N-1)*100:.1f}%")
    print(f"  Changes               : {changes}/{N-1} = {changes/(N-1)*100:.1f}%")
    # how many UNIQUE Top-4 sets
    uniq = len(set(frozenset(s) for s in locked))
    print(f"  Unique Top-4 sets     : {uniq}")
    top_sets = Counter(frozenset(s) for s in locked).most_common(5)
    print("  Most frequent Top-4 sets:")
    for s,c in top_sets:
        print(f"     {sorted(s)}  x{c} ({c/N*100:.1f}%)")

    # ---------- MISS list (first 25) ----------
    print("\n"+"="*70)
    print("MISS LOG (first 25)")
    print("="*70)
    cnt=0
    for i in range(N):
        if actuals[i] in locked[i]:
            continue
        cnt+=1
        if cnt>25: break
        sel = sorted(locked[i])
        act = actuals[i]
        # displacer
        cand = [n for n in locked[i] if THEO[n] <= THEO[act]]
        disp = min(cand, key=lambda n: THEO[n]) if cand else "-"
        print(f"  #{i+1:>3} act={act:12} locked={sel}  displacer={disp}")

if __name__ == "__main__":
    main()
