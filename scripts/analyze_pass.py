#!/usr/bin/env python3
# Shadow A/B generalized pass analyzer (metrics-only protocol, cron Job 369099)
# Usage: python3 analyze_pass.py <ledger_raw.json> [anchor.json]
# Reads frozen anchor (last pass state), computes current window metrics,
# diffs vs anchor, checks escalation triggers, writes updated anchor.json.
import json, math, sys, os

LIFE_M2H_DEF = [4, 8, 22, 116, 163, 164, 178]
LIFE_H2M_V_DEF = [12, 161, 188, 200]
DEGRADED_DEF = [6, 24, 45, 67]

def is_degraded(r):
    def empty(p):
        return p is None or (isinstance(p, list) and (len(p) == 0 or all(x in (None, '') for x in p)))
    return empty(r.get('bp')) or empty(r.get('ep'))

def mcnemar_exact(b, c):
    n = b + c
    if n == 0: return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)

def main():
    raw_file = sys.argv[1]
    anchor_file = sys.argv[2] if len(sys.argv) > 2 else '/home/z/my-project/scripts/data/anchor.json'
    A = json.load(open(anchor_file))
    outer = json.load(open(raw_file))
    d = json.loads(outer)
    if 'error' in d:
        print('EXTRACTION ERROR:', d); sys.exit(1)
    rows = d['rows']; now = d['now']; n = len(rows)
    ids = [r['i'] for r in rows]
    min_id, max_id = min(ids), max(ids)

    deg = [r['i'] for r in rows if is_degraded(r)]
    degset = set(deg)
    clean = [r for r in rows if r['i'] not in degset]
    cn = len(clean)

    bh = sum(1 for r in clean if r['bh'])
    eh = sum(1 for r in clean if r['eh'])
    th = sum(1 for r in clean if r['th'])
    bh_raw = bh + len(degset)          # panel convention: degraded rows gift baseline a hit
    theo_raw = th + sum(1 for r in rows if r['i'] in degset and r['th'])

    m2h = sorted(r['i'] for r in clean if r['eh'] and not r['bh'])
    h2m_v = sorted(r['i'] for r in clean if r['bh'] and not r['eh'])
    h2m_raw = sorted(h2m_v + [i for i in deg if i in set(a['i'] for a in rows) and any(r['i'] == i and r['bh'] and not r['eh'] for r in rows)])
    # note: degraded rows in-window with bh&!eh are H2M artifacts (panel counts them)

    streak = 0
    for r in reversed(rows):
        if r['bh'] == r['eh']: streak += 1
        else: break
    last_flip = rows[len(rows) - 1 - streak]['i'] if streak < len(rows) else None

    # window diff vs anchor
    new = [r for r in rows if r['i'] > A['max_id']]
    new_ids = [r['i'] for r in new]
    evicted_ids = list(range(A['min_id'], min_id))
    new_m2h = sorted(r['i'] for r in new if r['i'] not in degset and r['eh'] and not r['bh'])
    new_h2m_v = sorted(r['i'] for r in new if r['i'] not in degset and r['bh'] and not r['eh'])
    new_deg = [r['i'] for r in new if is_degraded(r)]
    new_agree = sum(1 for r in new if r['bh'] == r['eh'])
    new_detail = [(r['i'], r['a'], r['bh'], r['eh'], r['th']) for r in new]

    # McNemar
    life_m2h = sorted(set(A['lifetime_m2h']) | set(new_m2h))
    life_h2m_v = sorted(set(A['lifetime_h2m_verified']) | set(new_h2m_v))
    n_deg_h2m = len(A['lifetime_h2m_degraded_ids'])
    p_win_ver = mcnemar_exact(len(m2h), len(h2m_v))
    p_life_ver = mcnemar_exact(len(life_m2h), len(life_h2m_v))
    p_life_raw = mcnemar_exact(len(life_m2h), len(life_h2m_v) + n_deg_h2m)

    # feed quality
    last_ts = rows[-1]['ts']; age_s = (now - last_ts) / 1000
    known_gaps = {tuple(g) for g in A.get('known_gaps', [])}
    ts_gaps = []
    for a, b in zip(rows, rows[1:]):
        g = (b['ts'] - a['ts']) / 1000
        if g > 480:
            if (a['i'], b['i']) in known_gaps:
                print('[gap %d->%d: KNOWN (documented outage) — excluded from triggers]' % (a['i'], b['i']))
            else:
                ts_gaps.append((a['i'], b['i'], round(g / 60)))
    deg_unknown = sorted(set(deg) - set(A['degraded_all']))

    bc = [r['bc'] for r in clean if isinstance(r.get('bc'), (int, float))]
    ec = [r['ec'] for r in clean if isinstance(r.get('ec'), (int, float))]
    cb = round(100 * sum(bc) / len(bc), 2) if bc else None
    ce = round(100 * sum(ec) / len(ec), 2) if ec else None

    print('=== WINDOW METRICS (IDs %d-%d, n=%d) ===' % (min_id, max_id, n))
    print('degraded in-window: %s ; clean n=%d' % (deg, cn))
    print('baseline HIT: raw %d/%d = %.1f%% | clean %d/%d = %.1f%%' % (bh_raw, n, 100 * bh_raw / n, bh, cn, 100 * bh / cn))
    print('experimental HIT: %d/%d = %.1f%% (clean==raw; degraded rows never hit exp)' % (eh, n, 100 * eh / n))
    print('delta: raw %+d hits (%+.2fpp) | clean %+d hits (%+.2fpp)' % (eh - bh_raw, 100 * (eh - bh_raw) / n, eh - bh, 100 * (eh - bh) / cn))
    print('M2H window (%d): %s' % (len(m2h), m2h))
    print('H2M raw window (%d): %s | verified %s' % (len(h2m_raw), h2m_raw, h2m_v))
    print('theoretical: raw %d/%d = %.1f%% | clean %d/%d = %.1f%%' % (theo_raw, n, 100 * theo_raw / n, th, cn, 100 * th / cn))
    print('agreement streak: %d (last flip: %s)' % (streak, last_flip))
    print('avg coverage: base %s exp %s' % (('%0.2f%%' % cb) if cb is not None else 'n/a (not extracted)', ('%0.2f%%' % ce) if ce is not None else 'n/a'))
    print()
    print('=== DIFF vs PASS %d ANCHOR (IDs %d-%d) ===' % (A['pass'], A['min_id'], A['max_id']))
    print('evicted (inferred): %s' % (evicted_ids if evicted_ids else 'none'))
    print('new rounds (%d): %s' % (len(new_ids), new_ids))
    print('new detail (id, actual, base, exp, theo): %s' % new_detail)
    print('new: agree %d/%d | M2H %s | H2M %s | degraded %s' % (new_agree, len(new_ids), new_m2h, new_h2m_v, new_deg))
    print('raw hit deltas: base %+d (%d->%d) | exp %+d (%d->%d) | theo %+d (%d->%d)' % (
        bh_raw - A['base_raw'], A['base_raw'], bh_raw, eh - A['exp_raw'], A['exp_raw'], eh, theo_raw - A['theo_raw'], A['theo_raw'], theo_raw))
    print()
    print('=== McNEMAR ===')
    print('window verified: %dv%d p=%.3f' % (len(m2h), len(h2m_v), p_win_ver))
    print('lifetime verified: %dv%d p=%.3f  %s' % (len(life_m2h), len(life_h2m_v), p_life_ver, life_h2m_v))
    print('lifetime raw: %dv%d p=%.3f' % (len(life_m2h), len(life_h2m_v) + n_deg_h2m, p_life_raw))
    print('lifetime M2H: %s' % life_m2h)
    print()
    print('=== FEED / QUALITY ===')
    print('latest ts age: %.0fs ; >8min inter-row gaps: %s' % (age_s, ts_gaps if ts_gaps else 'none'))
    print('degraded set check: unknown-new=%s' % (deg_unknown if deg_unknown else 'NONE (frozen)'))
    print()
    print('=== TRIGGERS ===')
    t1 = p_life_ver < 0.05 or p_win_ver < 0.05
    t2 = bool(new_deg) or bool(deg_unknown) or bool(ts_gaps)
    t3 = len(new_m2h) + len(new_h2m_v) >= 3
    print('(a) significance crossing: %s' % ('YES' if t1 else 'no (p=%.3f lifetime verified)' % p_life_ver))
    print('(b) degradation/coverage anomaly: %s' % ('YES: deg=%s gaps=%s' % (new_deg or deg_unknown, ts_gaps) if t2 else 'no'))
    print('(c) 3+ same-direction flips: %s' % ('YES' if t3 else 'no (%d new flips)' % (len(new_m2h) + len(new_h2m_v))))
    print('VERDICT: %s' % ('ESCALATE — full analysis' if (t1 or t2 or t3) else 'metrics-only steady state'))
    print()
    # write updated anchor for next pass
    nxt = {
        "pass": A['pass'] + 1, "task": A['task'] + 1,
        "min_id": min_id, "max_id": max_id, "n": n,
        "base_raw": bh_raw, "exp_raw": eh, "theo_raw": theo_raw,
        "base_clean": bh, "exp_clean": eh, "theo_clean": th, "clean_n": cn,
        "m2h_window": m2h, "h2m_raw_window": h2m_raw, "h2m_verified_window": h2m_v,
        "streak": streak, "last_flip": last_flip,
        "lifetime_m2h": life_m2h, "lifetime_h2m_verified": life_h2m_v,
        "degraded_all": sorted(set(A['degraded_all']) | set(deg)),
        "lifetime_h2m_degraded_ids": A['lifetime_h2m_degraded_ids'],
        "coverage_base": cb, "coverage_exp": ce,
        "known_gaps": sorted(list(known_gaps | {(a['i'], b['i']) for a, b in zip(rows, rows[1:]) if (b['ts'] - a['ts']) / 1000 > 480}))
    }
    json.dump(nxt, open(anchor_file, 'w'), indent=2)
    print('anchor.json updated -> pass %d state' % nxt['pass'])

if __name__ == '__main__':
    main()
