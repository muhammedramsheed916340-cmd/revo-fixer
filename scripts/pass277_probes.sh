#!/bin/bash
# Pass 277 probes — replicate pass276 extraction formulas exactly
cd /home/z/my-project

# 2) meta: localStorage roundHistory length + keys + ts
agent-browser eval "JSON.stringify({n:(JSON.parse(localStorage.getItem('revo_roundHistory')||'[]')).length, keys:Object.keys(localStorage), ts:Date.now()})" --json > scripts/data/pass277_meta.json 2>&1

# 3) history: raw revo_roundHistory
agent-browser eval "localStorage.getItem('revo_roundHistory')" --json > scripts/data/pass277_history.json 2>&1

# 4) signals: raw revo_lastSignals
agent-browser eval "localStorage.getItem('revo_lastSignals')" --json > scripts/data/pass277_signals.json 2>&1

# 5) page: url+title fingerprint
agent-browser eval "JSON.stringify({url:location.href,title:document.title})" --json > scripts/data/pass277_page.json 2>&1

# 6) panel_live: full body innerText
agent-browser eval "document.body.innerText" --json > scripts/data/pass277_panel_live.json 2>&1

# 7) errors: console messages
agent-browser console --json > scripts/data/pass277_errors.json 2>&1

echo "=== probe sizes ==="
for f in open meta history signals page panel_live errors; do
  echo "pass277_$f.json: $(wc -c < scripts/data/pass277_$f.json) bytes"
done
echo "=== meta result ==="
python3 -c "import json; d=json.load(open('scripts/data/pass277_meta.json')); print(d['data']['result'][:200])"
echo "=== errors summary ==="
python3 -c "
import json
d=json.load(open('scripts/data/pass277_errors.json'))
msgs=d.get('data',{}).get('messages',[])
from collections import Counter
c=Counter(m.get('type','?') for m in msgs)
print('total:',len(msgs),'by type:',dict(c))
"
