#!/usr/bin/env python3
"""Pass 279 supplementary region extraction (for verify authoring)."""
import json, re

def load(name):
    d = json.load(open(f'/home/z/my-project/scripts/data/pass279_{name}.json'))
    return d['data']['result']

panel = load('panel_live')
tfx = panel.replace('\t', ' | ')
tf = tfx.replace('\n', ' | ')

def show(label, needle, before=0, after=260):
    i = tf.find(needle)
    print(f'--- {label} (idx={i}) ---')
    print(tf[max(0,i-before):i+after] if i >= 0 else 'NOT FOUND')
    print()

show('LOCK BOX (RECALIBRATED?)', 'LOCKED')
show('LOCK STATUS WORDS', 'CONFIDENCE LOCK', 100, 200)
show('RECALIBRATED any', 'RECALIBRATED', 60, 120)
show('EXCLUDED OUTCOMES', 'Excluded outcomes', 0, 120)
show('SHADOW SECTION', 'Shadow A/B', 80, 700)
show('VALIDATION mentions', 'VALIDATION', 0, 160)
show('LEDGER HEAD', 'LEDGER', 0, 300)
show('TPC + TREND', 'Total Prediction Coverage', 0, 300)
show('BONUS RISK', 'BONUS RISK', 0, 240)
show('RCA TYPE', 'RCA TYPE', 60, 200)
show('AI VARIANCE', 'VARIANCE', 0, 340)
print('=== counts ===')
for token in ['RECALIBRATED', 'MODERATE', 'STRONG', 'LOW CONFIDENCE', 'BET', 'RECALIBRATE',
              'HIT STREAK', 'MISS STREAK', 'PATTERN SHIFT', 'INSUFFICIENT', 'Pred#', 'Pred']:
    print(f'{token!r}: {tf.count(token)}')
import re
print('banner:', re.search(r'\d+× [A-Z]+ STREAK', tfx).group(0) if re.search(r'\d+× [A-Z]+ STREAK', tfx) else None)
print('signals json full:')
sig = load('signals')
print(json.dumps(sig, indent=1)[:1600])
