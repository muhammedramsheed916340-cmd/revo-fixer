#!/usr/bin/env python3
# Shadow A/B pass-15 analyzer (metrics-only protocol)
# Anchor = pass 14 (Task 58): window IDs 22-221, base 127/200, exp 126/200,
# theo 156/200, M2H {22,116,163,164,178}, H2M {24,45,67,161,188,200}, streak 21.
import json, math, sys

RAW = '/home/z/my-project/scripts/data/ledger_pass15_raw.json'

# frozen lifetime accounting (worklog cross-reference, Tasks 46-58)
LIFE_M2H = {4, 8, 22, 116, 163, 164, 178}          # baseline MISS, exp HIT
LIFE_H2M_V = {12, 161, 188, 200}                    # verified H2M
DEGRADED = {6, 24, 45, 67}                          # reload-era artifacts
# pass-14 window anchor
A_MAXID, A_MINID = 221, 22
A_BASE, A_EXP, A_THEO = 127, 126, 156
A_M2H = {22, 116, 163, 164, 178}
A_H2M = {24, 45, 67, 161, 188, 200}
A_STREAK = 21

def is_degraded(r):
    def empty(p):
        return p is None or (isinstance(p, list) and (len(p) == 0 or all(x in (None, '') for x in p)))
    return empty(r.get('bp')) or empty(r.get('ep'))

def mcnemar_exact(b, c):
    n = b + c
    if n == 0: return 1.0
    k = min(b, c)
    p_le = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return min(1.0, 2 * p_le)

def main():
    outer = json.load(open(RAW))
    d = json.loads(outer)
    if 'error' in d:
        print('EXTRACTION ERROR:', d); sys.exit(1)
    rows = d['rows']
    now = d['now']; n = len(rows)
    ids = [r['i'] for r in rows]
    assert ids == sorted(ids), 'ledger not sorted'

    deg = [r['i'] for r in rows if is_degraded(r)]
    clean = [r for r in rows if r['i'] not in deg]

    bh = sum(1 for r in clean if r['bh'])
    eh = sum(1 for r in clean if r['eh'])
    th = sum(1 for r in clean if r['th'])

    m2h = sorted(r['i'] for r in clean if r['eh'] and not r['bh'])
    h2m = sorted(r['i'] for r in clean if r['bh'] and not r['eh'])

    # agreement streak from tail
    streak = 0
    for r in reversed(rows):
        if r['bh'] == r['eh']: streak += 1
        else: break

    # window diff vs anchor
    evicted = [r for r in rows if r['i'] <= A_MAXID and r['i'] < min(ids)]
    new = [r for r in rows if r['i'] > A_MAXID]
    ev_ids = [r['i'] for r in evicted]; new_ids = [r['i'] for r in new]

    # recompute anchor-window hits restricted to surviving anchor rows
    surv = [r for r in rows if r['i'] >= A_MINID and r['i'] <= A_MAXID and r['i'] not in deg]
    s_bh = sum(1 for r in surv if r['bh']); s_eh = sum(1 for r in surv if r['eh']); s_th = sum(1 for r in surv if r['th'])
    d_base = bh - (A_BASE - (A_BASE - s_bh)) # placeholder, real deltas below
    # anchor surviving counts vs full anchor: evicted anchor rows carried:
    ev_rows = [r for r in rows if r['i'] in ev_ids]
    ev_bh = sum(1 for r in ev_rows if r['bh'] and r['i'] not in deg)
    ev_eh = sum(1 for r in ev_rows if r['eh'] and r['i'] not in deg)
    ev_th = sum(1 for r in ev_rows if r['th'] and r['i'] not in deg)
    new_rows = new
    n_bh = sum(1 for r in new_rows if r['bh'] and r['i'] not in deg)
    n_eh = sum(1 for r in new_rows if r['eh'] and r['i'] not in deg)
    n_th = sum(1 for r in new_rows if r['th'] and r['i'] not in deg)

    # flips among new rounds
    new_m2h = sorted(r['i'] for r in new_rows if r['i'] not in deg and r['eh'] and not r['bh'])
    new_h2m = sorted(r['i'] for r in new_rows if r['i'] not in deg and r['bh'] and not r['eh'])
    new_deg = [r['i'] for r in new_rows if is_degraded(r)]

    # McNemar: window raw; verified-only (exclude degraded flips from discordant counts)
    b, c = len(m2h), len(h2m)
    p_win = mcnemar_exact(b, c)
    v_m2h = [i for i in m2h if i not in DEGRADED]
    v_h2m = [i for i in h2m if i not in DEGRADED]
    p_ver = mcnemar_exact(len(v_m2h), len(v_h2m))

    # lifetime extrapolation: frozen sets + any new flips
    life_m2h = sorted(LIFE_M2H | set(new_m2h))
    life_h2m_v = sorted(LIFE_H2M_V | set(new_h2m))
    life_h2m_all = sorted(set(life_h2m_v) | ({24, 45, 67} & (set(h2m) | {24, 45, 67})))
    p_life_v = mcnemar_exact(len(life_m2h), len(life_h2m_v))
    p_life_raw = mcnemar_exact(len(life_m2h), len(life_h2m_v) + 3)  # +3 degraded artifacts 24/45/67

    # feed freshness
    last_ts = rows[-1]['ts']; age_s = (now - last_ts) / 1000

    # coverage averages (clean rows)
    bc = [r['bc'] for r in clean if isinstance(r.get('bc'), (int, float))]
    ec = [r['ec'] for r in clean if isinstance(r.get('ec'), (int, float))]

    print('=== PASS 15 WINDOW METRICS (IDs %d-%d, n=%d) ===' % (min(ids), max(ids), n))
    print('paired rounds: %d (clean %d, degraded-in-window %s)' % (n, len(clean), deg))
    print('baseline HIT: %d/%d = %.1f%%' % (bh, len(clean), 100 * bh / len(clean)))
    print('experimental HIT: %d/%d = %.1f%%' % (eh, len(clean), 100 * eh / len(clean)))
    print('delta raw: %+d hits (%+.2fpp)' % (eh - bh, 100 * (eh - bh) / len(clean)))
    print('M2H window (%d): %s' % (len(m2h), m2h))
    print('H2M window (%d): %s  (verified %s, degraded %s)' % (len(h2m), h2m, [i for i in h2m if i not in DEGRADED], [i for i in h2m if i in DEGRADED]))
    print('theoretical [1,2,5,10]: %d/%d = %.1f%%' % (th, len(clean), 100 * th / len(clean)))
    print('agreement streak: %d (last flip id: %s)' % (streak, rows[len(rows)-1-streak]['i'] if streak < len(rows) else 'ALL'))
    print('avg coverage: base %.2f%% exp %.2f%%' % (100 * sum(bc)/len(bc), 100 * sum(ec)/len(ec)))
    print()
    print('=== WINDOW DIFF vs PASS 14 ANCHOR ===')
    print('evicted (FIFO): %s' % ev_ids)
    print('new rounds: %s' % new_ids)
    print('anchor-surviving base/exp/theo: %d/%d/%d ; evicted carried b/e/t: %d/%d/%d ; new added b/e/t: %d/%d/%d' % (s_bh, s_eh, s_th, ev_bh, ev_eh, ev_th, n_bh, n_eh, n_th))
    print('window base delta: %+d (127 -> %d) ; exp delta: %+d (126 -> %d) ; theo delta: %+d (156 -> %d)' % (bh - A_BASE, bh, eh - A_EXP, eh, th - A_THEO, th))
    print('new flips: M2H %s ; H2M %s ; new degraded: %s' % (new_m2h, new_h2m, new_deg))
    print('new-round detail: %s' % [(r['i'], r['a'], r['bh'], r['eh']) for r in new_rows])
    print()
    print('=== McNEMAR ===')
    print('window raw: %dv%d p=%.3f' % (b, c, p_win))
    print('window verified-only: %dv%d p=%.3f' % (len(v_m2h), len(v_h2m), p_ver))
    print('lifetime raw (7+new vs 4+3deg+new): %dv%d p=%.3f' % (len(life_m2h), len(life_h2m_v) + 3, p_life_raw))
    print('lifetime verified: %dv%d p=%.3f' % (len(life_m2h), len(life_h2m_v), p_life_v))
    print('lifetime M2H set: %s' % life_m2h)
    print('lifetime H2M verified set: %s' % life_h2m_v)
    print()
    print('=== FEED / DATA QUALITY ===')
    print('latest round ts age: %.0fs (now %d)' % (age_s, now))
    print('degraded set check: window=%s ; frozen={6,24,45,67} ; new_degraded=%s' % (deg, new_deg))
    print('anchor flip survival: M2H aged-out %s ; H2M aged-out %s' % (sorted(A_M2H - set(m2h)), sorted(A_H2M - set(h2m))))

if __name__ == '__main__':
    main()
