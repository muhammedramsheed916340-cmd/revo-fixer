// Full ledger extractor WITH prob projections — for diagnostic audit
// Per row: preds, hits, theo, coverage + model probs for {actual, 1, 2, 5, 10} and all selected preds
(function () {
  var raw = localStorage.getItem('revo_shadowLedger');
  if (!raw) return JSON.stringify({ error: 'NO_LEDGER' });
  var L = JSON.parse(raw);
  function pick(probs, keys) {
    if (!probs) return null;
    var out = {};
    keys.forEach(function (k) { if (k in probs) out[k] = Math.round(probs[k] * 10000) / 10000; });
    return out;
  }
  return JSON.stringify({
    now: Date.now(),
    n: L.length,
    minId: L.length ? L[0].roundId : null,
    maxId: L.length ? L[L.length - 1].roundId : null,
    rows: L.map(function (r) {
      var keys = ['1', '2', '5', '10', String(r.actual)]
        .concat(r.baselinePreds || [], r.expPreds || []);
      return {
        i: r.roundId, ts: r.ts, a: r.actual,
        bp: r.baselinePreds, ep: r.expPreds,
        bh: r.baselineHit, eh: r.expHit, th: r.theoHit,
        bpr: pick(r.baselineProbs, keys), epr: pick(r.expProbs, keys)
      };
    })
  });
})()
