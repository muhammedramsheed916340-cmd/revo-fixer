#!/usr/bin/env python3
# Pass 16 escalation add-on: stall forensics
import json, statistics, datetime
d = json.loads(json.load(open('/home/z/my-project/scripts/data/ledger_pass16_raw.json')))
rows = d['rows']
idx = {r['i']: r for r in rows}

def ts_str(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone(datetime.timedelta(hours=8))).strftime('%H:%M:%S')

# exact gaps > 8 min
for a, b in zip(rows, rows[1:]):
    s = (b['ts'] - a['ts']) / 1000
    if s > 480:
        print('GAP %d->%d: %.0fs (%.1f min) | %s -> %s (+08)' % (a['i'], b['i'], s, s / 60, ts_str(a['ts']), ts_str(b['ts'])))

# local cadence before the new stall (rows 160-227, excluding any >5min gap itself)
pre = [r for r in rows if 160 <= r['i'] <= 227]
diffs = [(b['ts'] - a['ts']) / 1000 for a, b in zip(pre, pre[1:]) if (b['ts'] - a['ts']) / 1000 < 300]
med = statistics.median(diffs)
print('local cadence median rows 160-227 (n=%d): %.0fs -> est missed in 25-min stall: ~%.0f rounds' % (len(diffs), med, 25 * 60 / med))

# overall
alld = [(b['ts'] - a['ts']) / 1000 for a, b in zip(rows, rows[1:])]
print('overall median inter-round: %.0fs ; window elapsed %.0f min / 199 intervals' % (statistics.median(alld), (rows[-1]['ts'] - rows[0]['ts']) / 60000))

# context of rows around new stall
for i in (226, 227, 228, 229):
    r = idx[i]
    print('row %d: ts %s actual=%s base=%s exp=%s' % (i, ts_str(r['ts']), r['a'], r['bh'], r['eh']))

# '5' frequency context
fives = [r['i'] for r in rows if r['a'] == '5']
print("all '5' landings in window (n=%d): %s" % (len(fives), fives))
