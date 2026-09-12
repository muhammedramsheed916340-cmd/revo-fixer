// Pass 94 (Task ID 139) full probe — Shadow A/B panel + ledger + full-span gap scan
// Read-only: extracts panel text, localStorage ledger, computes window metrics, streak, gaps.
(function () {
  function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function txt(el) { return el ? (el.innerText || el.textContent || '').trim() : null; }

  // 1) Locate the Shadow panel by heading text
  var panel = null, panelText = null;
  var heads = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,h4,div,span'));
  for (var i = 0; i < heads.length; i++) {
    var t = txt(heads[i]);
    if (t && t.indexOf('Shadow A/B') !== -1 && t.indexOf('Rare-Outcome') !== -1) {
      var p = heads[i];
      for (var up = 0; up < 6 && p; up++) {
        if (txt(p) && txt(p).length > 200 && txt(p).indexOf('Shadow A/B') !== -1) { panel = p; break; }
        p = p.parentElement;
      }
      if (panel) break;
    }
  }
  panelText = panel ? txt(panel) : 'PANEL_NOT_FOUND';

  // 2) Ledger extraction (compact rows for full-span analysis)
  var raw = null;
  try { raw = localStorage.getItem('revo_shadowLedger'); } catch (e) { raw = null; }
  var ledger = { present: !!raw, error: null };
  if (raw) {
    try {
      var L = JSON.parse(raw);
      ledger.n = L.length;
      ledger.minId = L.length ? L[0].roundId : null;
      ledger.maxId = L.length ? L[L.length - 1].roundId : null;
      ledger.rows = L.map(function (r) {
        return { i: r.roundId, ts: r.ts, a: r.actual, bh: r.baselineHit, eh: r.expHit, th: r.theoHit };
      });
    } catch (e) { ledger.error = 'PARSE_FAIL: ' + e.message; }
  } else { ledger.error = 'NO_LEDGER'; }

  return JSON.stringify({
    now: Date.now(),
    nowIso: new Date().toISOString(),
    url: location.href,
    title: document.title,
    panelText: panelText,
    ledger: ledger
  });
})()
