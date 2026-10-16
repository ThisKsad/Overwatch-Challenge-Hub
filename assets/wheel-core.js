/* Mystery Wheel logic: picks one hero per selected player.
   Rules: every hero is unique within a round; optional role limits (1 Tank, 2 Damage, 2 Support).
   The result is uniform over all valid combinations (optionally nudged by "balance mode"). */
(function (root) {
  'use strict';

  var CAP = { tank: 1, damage: 2, support: 2 };
  var BAL_LAMBDA = 4.0;

  var cr = root.crypto || (typeof require !== 'undefined' ? require('crypto').webcrypto : null);

  function randFloat() {
    if (!cr || !cr.getRandomValues) return Math.random();
    var a = new Uint32Array(2);
    cr.getRandomValues(a);
    return ((a[0] >>> 5) * 67108864 + (a[1] >>> 6)) / 9007199254740992;
  }

  function limitsFor(k) {
    return { tank: Math.min(CAP.tank, k), damage: Math.min(CAP.damage, k), support: Math.min(CAP.support, k) };
  }

  // Calls fn(chosen, tankCount, damageCount, supportCount) for every valid combination.
  // fn returns true to stop early.
  function forEachCombo(pools, lim, fn) {
    var k = pools.length, chosen = new Array(k);
    var cnt = { tank: 0, damage: 0, support: 0 };
    function rec(i) {
      if (i === k) return fn(chosen, cnt.tank, cnt.damage, cnt.support) === true;
      var pool = pools[i];
      for (var j = 0; j < pool.length; j++) {
        var h = pool[j], dup = false;
        for (var q = 0; q < i; q++) { if (chosen[q].id === h.id) { dup = true; break; } }
        if (dup) continue;
        if (lim && cnt[h.cls] >= lim[h.cls]) continue;
        chosen[i] = h; cnt[h.cls]++;
        var stop = rec(i + 1);
        cnt[h.cls]--;
        if (stop) return true;
      }
      return false;
    }
    rec(0);
  }

  function anyValid(pools, limitsOn) {
    if (!pools.length) return false;
    var lim = limitsOn ? limitsFor(pools.length) : null, found = false;
    forEachCombo(pools, lim, function () { found = true; return true; });
    return found;
  }

  function countsOf(c) {
    var n = { tank: 0, damage: 0, support: 0 };
    for (var i = 0; i < c.length; i++) n[c[i].cls]++;
    return n;
  }

  function validCombo(c, lim) {
    for (var i = 0; i < c.length; i++) for (var j = 0; j < i; j++) if (c[i].id === c[j].id) return false;
    if (!lim) return true;
    var n = countsOf(c);
    return n.tank <= lim.tank && n.damage <= lim.damage && n.support <= lim.support;
  }

  // Balance mode: combinations that use up the scarcest role pool less are slightly favoured,
  // so scarce roles are not stranded. Weight depends only on role counts.
  function makeWeight(pools, lim) {
    var R = { tank: 0, damage: 0, support: 0 };
    pools.forEach(function (p) { p.forEach(function (h) { R[h.cls]++; }); });
    function ratio(ct, cd, cs) {
      return Math.max((R.tank - ct) / lim.tank, (R.damage - cd) / lim.damage, (R.support - cs) / lim.support);
    }
    var base = ratio(0, 0, 0);
    function w(c) {
      var n = countsOf(c);
      return Math.exp(-BAL_LAMBDA * (ratio(n.tank, n.damage, n.support) - base));
    }
    // upper bound of the weight over every role split that fits the limits
    var k = pools.length, wmax = 1;
    for (var t = 0; t <= lim.tank; t++) for (var d = 0; d <= lim.damage; d++) for (var s = 0; s <= lim.support; s++) {
      if (t + d + s !== k) continue;
      wmax = Math.max(wmax, Math.exp(-BAL_LAMBDA * (ratio(t, d, s) - base)));
    }
    return { w: w, wmax: wmax };
  }

  function drawIndependent(pools) {
    return pools.map(function (p) { return p[Math.floor(randFloat() * p.length)]; });
  }

  // pools: one array of hero objects ({id, cls}) per selected player.
  // opts: { limits: bool, balance: bool }. Returns an array of heroes or null when no valid combination exists.
  // Fast path: rejection sampling (uniform over all valid combinations). Exact fallback: enumeration.
  function pickCombo(pools, opts) {
    opts = opts || {};
    var k = pools.length, i;
    if (!k) return null;
    for (i = 0; i < k; i++) if (!pools[i].length) return null;
    var lim = opts.limits ? limitsFor(k) : null;
    var bal = (opts.balance && lim && k >= 2) ? makeWeight(pools, lim) : null;
    for (var tries = 0; tries < 3000; tries++) {
      var c = drawIndependent(pools);
      if (!validCombo(c, lim)) continue;
      if (bal && randFloat() * bal.wmax > bal.w(c)) continue;
      return c;
    }
    // rare: tiny pools. Enumerate all valid combinations and choose exactly.
    var list = [];
    forEachCombo(pools, lim, function (c) { list.push(c.slice()); });
    if (!list.length) return null;
    if (!bal) return list[Math.floor(randFloat() * list.length)];
    var tot = 0, ws = list.map(function (c) { var x = bal.w(c); tot += x; return x; });
    var r = randFloat() * tot;
    for (i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  var api = { CAP: CAP, randFloat: randFloat, limitsFor: limitsFor, forEachCombo: forEachCombo, anyValid: anyValid, pickCombo: pickCombo,
    setBalance: function (v) { BAL_LAMBDA = v; }, getBalance: function () { return BAL_LAMBDA; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WheelCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
