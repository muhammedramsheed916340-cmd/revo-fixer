// Shadow A/B panel text extractor v2 — smallest node containing panel signature
(function () {
  var nodes = document.querySelectorAll('*');
  var cands = [];
  for (var k = 0; k < nodes.length; k++) {
    var t = nodes[k].textContent || '';
    if (/Shadow A\/B/i.test(t) && /Reliability|Baseline|Experimental/i.test(t)) {
      cands.push({ el: nodes[k], len: t.length, kids: nodes[k].getElementsByTagName('*').length });
    }
  }
  if (!cands.length) return 'PANEL_NOT_FOUND';
  // smallest subtree that still contains the panel signature
  cands.sort(function (a, b) { return a.kids - b.kids; });
  var el = cands[0].el;
  // walk UP until the text looks like a full panel (has % signs and enough length)
  for (var i = 0; i < 6 && el; i++) {
    var p = el.parentElement;
    if (!p) break;
    var pt = p.innerText || '';
    if (pt.length > 400 && pt.length < 4000 && (pt.match(/%/g) || []).length >= 4) { el = p; break; }
    el = p;
  }
  return (el.innerText || '').slice(0, 1600);
})()
