// Shadow A/B ledger extractor — pass 15+ (metrics-only protocol)
// Tab-reuse safe: NO navigation, NO reload. Reads localStorage directly.
(function () {
  var raw = localStorage.getItem('revo_shadowLedger');
  if (!raw) return JSON.stringify({ error: 'NO_LEDGER' });
  var L;
  try { L = JSON.parse(raw); } catch (e) { return JSON.stringify({ error: 'PARSE_FAIL', raw: String(raw).slice(0, 200) }); }
  return JSON.stringify({
    now: Date.now(),
    n: L.length,
    minId: L.length ? L[0].roundId : null,
    maxId: L.length ? L[L.length - 1].roundId : null,
    rows: L.map(function (r) {
      return {
        i: r.roundId, ts: r.ts, a: r.actual,
        bp: r.baselinePreds, ep: r.expPreds,
        bh: r.baselineHit, eh: r.expHit, th: r.theoHit,
        bc: r.baselineCoverage, ec: r.expCoverage
      };
    })
  });
})()
