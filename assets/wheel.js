(function () {
  'use strict';

  var Core = window.WheelCore;
  var HEROES = window.HERO_DATA.heroes, IMAGES = window.HERO_DATA.images;
  var BY = {}; HEROES.forEach(function (h) { BY[h.id] = h; });
  var PLAYERS = [{ id: 'lukas', name: 'Lukas' }, { id: 'philipp', name: 'Philipp' }, { id: 'daniel', name: 'Daniel' }];
  var CLASSES = [['tank', 'Tank'], ['damage', 'Damage'], ['support', 'Support']];
  var CLS_NAME = { tank: 'Tank', damage: 'Damage', support: 'Support' };
  var THEME_KEY = 'mystery-hub-theme';
  var CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nameOf(pid) { return PLAYERS.filter(function (p) { return p.id === pid; })[0].name; }

  /* ---------- Shared state (Supabase) ---------- */
  var SUPABASE_URL = 'https://dwsieddjvldzurosjdpp.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_SREC_XokfKppXeP7rTgnMQ_-2ZyEXMp';
  var S = null, remote = null, sb = null, loaded = false, writing = 0, failed = false, dirty = false, seenAt = 0;
  var chain = Promise.resolve();
  var MODE_TEXT = { connecting: 'Connecting…', live: 'Live, shared with everyone', saving: 'Saving…', error: 'Connection problem, retrying', offline: 'Not connected' };
  function setMode(m) {
    var el = $('sync'); if (!el) return;
    el.setAttribute('data-state', m === 'live' ? 'live' : (m === 'saving' ? 'saving' : (m === 'connecting' ? 'connecting' : 'error')));
    $('syncText').textContent = MODE_TEXT[m];
  }
  function freshState() {
    return { removed: { lukas: {}, philipp: {}, daniel: {} }, sel: { lukas: true, philipp: true, daniel: true }, order: {}, pending: null, opts: { limits: true, balance: true } };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function shuffledIds() {
    var a = HEROES.map(function (h) { return h.id; });
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Core.randFloat() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Heroes still on a wheel, in that wheel's own random slice order (reshuffled on every reset).
  function remaining(pid) { return S.order[pid].map(function (id) { return BY[id]; }).filter(function (h) { return !S.removed[pid][h.id]; }); }
  function archiveWheel(pids) {
    if (!sb) return; var d = { players: {} }, any = false;
    pids.forEach(function (pid) { var n = Object.keys(S.removed[pid]).length; if (n > 0) { any = true; d.players[pid] = { wins: n, heroes: Object.keys(S.removed[pid]) }; } });
    if (any) sb.from('game_results').insert({ mode: 'wheel', data: d }).then(function () {}, function () {});
  }
  function wonCount(pid) { return Object.keys(S.removed[pid]).length; }
  function validOrder(ord) { return Array.isArray(ord) && ord.length === HEROES.length && ord.every(function (id) { return BY[id]; }) && new Set(ord).size === HEROES.length; }
  function sig(st) { return PLAYERS.map(function (p) { return Object.keys(st.removed[p.id]).sort().join(',') + '|' + st.order[p.id].join(','); }).join('#'); }

  /* ---------- Writing: every change to S is saved by comparing it with the last shared copy ---------- */
  function enqueue(fn) {
    writing++; setMode('saving');
    chain = chain.then(fn).then(function (res) { if (res && res.error) throw res.error; }).catch(function () { failed = true; }).then(function () {
      writing--;
      if (writing) return;
      if (failed) { failed = false; toast('Could not save everything. Showing the shared state again.'); }
      loadAll();
    });
  }
  function saveState() {
    if (!sb || !remote) return;
    var prev = remote; remote = clone(S);
    PLAYERS.forEach(function (pl) {
      var id = pl.id;
      if (JSON.stringify(prev.order[id]) !== JSON.stringify(S.order[id])) enqueue(function () { return sb.from('wheel_order').upsert({ player: id, hero_order: S.order[id] }, { onConflict: 'player' }); });
      var add = Object.keys(S.removed[id]).filter(function (k) { return !prev.removed[id][k]; });
      var del = Object.keys(prev.removed[id]).filter(function (k) { return !S.removed[id][k]; });
      if (del.length) enqueue(function () { return sb.from('wheel_removed').delete().eq('player', id).in('hero', del); });
      if (add.length) enqueue(function () { return sb.from('wheel_removed').upsert(add.map(function (h) { return { player: id, hero: h }; }), { onConflict: 'player,hero', ignoreDuplicates: true }); });
    });
    PLAYERS.forEach(function (pl) {
      var id = pl.id, v = !!S.sel[id];
      if (!!prev.sel[id] !== v) enqueue(function () { return sb.rpc('wheel_set_sel', { p_player: id, p_value: v }); });
    });
    ['limits', 'balance'].forEach(function (k) {
      var v = !!S.opts[k];
      if (!!prev.opts[k] !== v) enqueue(function () { return sb.rpc('wheel_set_opt', { p_key: k, p_value: v }); });
    });
    if (JSON.stringify(prev.pending) !== JSON.stringify(S.pending)) { var pend = S.pending; enqueue(function () { return sb.from('wheel_state').update({ pending: pend }).eq('id', 1); }); }
  }

  /* ---------- Reading ---------- */
  function afterBusy() { if (dirty && !writing && !spinning) { dirty = false; loadAll(); } }
  function placeWheels() {
    if (!S.pending || spinning) return;
    S.pending.players.forEach(function (pid) {
      var w = wheels[pid]; w.list = remaining(pid); w.angle = angleFor(pid, S.pending.picks[pid], false); drawWheel(pid);
    });
  }
  function remoteSpin() {
    spinning = true; renderWheelPage();
    Promise.all(S.pending.players.map(function (pid, i) { return animate(pid, 4200 + i * 700, 5 + i); })).then(function () {
      spinning = false; renderWheelPage(); afterBusy();
    });
  }
  function applyRemote(removedRows, orderRows, st) {
    var next = freshState(), fix = [];
    removedRows.forEach(function (r) { if (next.removed[r.player] && BY[r.hero]) next.removed[r.player][r.hero] = true; });
    PLAYERS.forEach(function (pl) {
      var row = orderRows.filter(function (x) { return x.player === pl.id; })[0];
      if (row && validOrder(row.hero_order)) next.order[pl.id] = row.hero_order;
      else { next.order[pl.id] = (S && validOrder(S.order[pl.id])) ? S.order[pl.id] : shuffledIds(); fix.push(pl.id); }
    });
    if (st) {
      PLAYERS.forEach(function (pl) { if (st.sel && typeof st.sel[pl.id] === 'boolean') next.sel[pl.id] = st.sel[pl.id]; });
      if (st.opts) { next.opts.limits = st.opts.limits !== false; next.opts.balance = st.opts.balance !== false; }
      var pd = st.pending;
      if (pd && Array.isArray(pd.players) && pd.picks && pd.players.every(function (pid) { return next.removed[pid] && BY[pd.picks[pid]] && !next.removed[pid][pd.picks[pid]]; })) next.pending = pd;
    }
    var first = !loaded, changed = !S || sig(S) !== sig(next);
    var fresh = !!next.pending && (next.pending.at || 0) > seenAt;
    if (next.pending && (next.pending.at || 0) > seenAt) seenAt = next.pending.at || 0;
    S = next; remote = clone(next); loaded = true; setMode('live');
    fix.forEach(function (pid) { enqueue(function () { return sb.from('wheel_order').upsert({ player: pid, hero_order: S.order[pid] }, { onConflict: 'player' }); }); });
    renderWheelPage(first || changed);
    if ((first || changed) && S.pending) placeWheels();
    if (fresh && !first) remoteSpin();
  }
  function loadAll() {
    if (!sb) return Promise.resolve();
    return Promise.all([
      sb.from('wheel_removed').select('player,hero'),
      sb.from('wheel_order').select('player,hero_order'),
      sb.from('wheel_state').select('sel,opts,pending').eq('id', 1).maybeSingle()
    ]).then(function (r) {
      if (r.some(function (x) { return x.error; })) { setMode(loaded ? 'error' : 'offline'); return; }
      if (writing || spinning) { dirty = true; return; }
      applyRemote(r[0].data || [], r[1].data || [], r[2].data);
    }, function () { setMode(loaded ? 'error' : 'offline'); });
  }
  function connect() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { setMode('offline'); return; }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    loadAll();
    var t = null;
    function poke() { clearTimeout(t); t = setTimeout(loadAll, 150); }
    var ch = sb.channel('wheel-changes');
    ['wheel_removed', 'wheel_order', 'wheel_state'].forEach(function (tb) { ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: tb }, poke); });
    ch.subscribe();
    setInterval(loadAll, 20000);
  }

  /* ---------- Theme ---------- */
  var SUN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></svg>';
  var MOON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z"/></svg>';
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function paintThemeBtns() {
    Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (b) {
      b.innerHTML = (isDark() ? SUN : MOON) + '<span>' + (isDark() ? 'Light mode' : 'Dark mode') + '</span>';
    });
  }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    paintThemeBtns(); rebuildAllWheels();
  }
  try { var st0 = localStorage.getItem(THEME_KEY); if (st0 === 'dark' || st0 === 'light') document.documentElement.setAttribute('data-theme', st0); } catch (e) { /* ignore */ }
  Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (b) { b.addEventListener('click', function () { setTheme(isDark() ? 'light' : 'dark'); }); });

  /* ---------- Toast and dialog ---------- */
  var toastT = null;
  function toast(msg, actionLabel, action) {
    var t = $('toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>';
    if (actionLabel) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = actionLabel;
      b.addEventListener('click', function () { t.hidden = true; action(); });
      t.appendChild(b);
    }
    t.hidden = false; clearTimeout(toastT);
    toastT = setTimeout(function () { t.hidden = true; }, actionLabel ? 9000 : 3200);
  }
  var dlgOk = null;
  function confirmDlg(title, text, okLabel, cancelLabel, onOk) {
    $('dlgTitle').textContent = title; $('dlgText').textContent = text;
    $('dlgOk').textContent = okLabel; $('dlgCancel').textContent = cancelLabel;
    dlgOk = onOk; $('scrim').hidden = false; $('dlgCancel').focus();
  }
  function closeDlg() { $('scrim').hidden = true; dlgOk = null; }
  $('dlgCancel').addEventListener('click', closeDlg);
  $('dlgOk').addEventListener('click', function () { var f = dlgOk; closeDlg(); if (f) f(); });
  $('scrim').addEventListener('click', function (e) { if (e.target === $('scrim')) closeDlg(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('scrim').hidden) closeDlg(); });

  /* ---------- Canvas wheel ---------- */
  var imgs = {}, imgsLoaded = 0;
  HEROES.forEach(function (h) {
    var im = new Image();
    im.onload = function () { imgsLoaded++; scheduleRedraw(); };
    im.src = IMAGES[h.id]; imgs[h.id] = im;
  });
  var redrawQueued = false;
  function scheduleRedraw() {
    if (redrawQueued) return; redrawQueued = true;
    setTimeout(function () { redrawQueued = false; rebuildAllWheels(); }, 120);
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
  function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function shade(hex, f) { var c = hexToRgb(hex), t = f < 0 ? 0 : 255, a = Math.abs(f); return 'rgb(' + c.map(function (v) { return Math.round(v + (t - v) * a); }).join(',') + ')'; }

  // Draws the static wheel (all slices) into an offscreen canvas. Slice i is centred (i+0.5)*step degrees clockwise from the top.
  function makeBitmap(list, cssSize, dpr) {
    var S2 = Math.round(cssSize * dpr), c = document.createElement('canvas'); c.width = c.height = S2;
    var x = c.getContext('2d'), R = S2 / 2 - 3 * dpr, n = list.length;
    var col = { tank: cssVar('--tank'), damage: cssVar('--damage'), support: cssVar('--support') };
    x.translate(S2 / 2, S2 / 2);
    if (!n) {
      x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fillStyle = cssVar('--surface2'); x.fill();
      x.lineWidth = 2 * dpr; x.strokeStyle = cssVar('--line'); x.stroke();
      return c;
    }
    var step = Math.PI * 2 / n;
        var wOuter = n === 1 ? R * 2 : 2 * R * Math.sin(step / 2);
    var sz = Math.max(R * 0.95, wOuter * 1.05), cy = R - sz / 2; // portrait covers the whole slice, head toward the rim
    var fs = Math.max(8 * dpr, Math.min(16 * dpr, step * R * 0.9 * 0.62));
    for (var i = 0; i < n; i++) {
      var h = list[i], theta = (i + 0.5) * step;
      x.save(); x.rotate(theta);
      x.beginPath();
      if (n === 1) { x.arc(0, 0, R, 0, Math.PI * 2); } else { x.moveTo(0, 0); x.arc(0, 0, R, -Math.PI / 2 - step / 2, -Math.PI / 2 + step / 2); x.closePath(); }
      var g = x.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
      g.addColorStop(0, shade(col[h.cls], -0.35)); g.addColorStop(1, shade(col[h.cls], 0.08));
      x.fillStyle = g; x.fill();
      x.save(); x.clip();
      var im = imgs[h.id];
      if (im && im.complete && im.naturalWidth) x.drawImage(im, -sz / 2, -cy - sz / 2, sz, sz);
      x.restore();
      x.beginPath(); // class-coloured rim band so the role stays readable even when the portrait fills the slice
      if (n === 1) { x.arc(0, 0, R, 0, Math.PI * 2); x.arc(0, 0, R * 0.93, 0, Math.PI * 2, true); }
      else { x.arc(0, 0, R, -Math.PI / 2 - step / 2, -Math.PI / 2 + step / 2); x.arc(0, 0, R * 0.93, -Math.PI / 2 + step / 2, -Math.PI / 2 - step / 2, true); x.closePath(); }
      x.fillStyle = col[h.cls]; x.fill();
      x.beginPath();
      if (n === 1) { x.arc(0, 0, R, 0, Math.PI * 2); } else { x.moveTo(0, 0); x.arc(0, 0, R, -Math.PI / 2 - step / 2, -Math.PI / 2 + step / 2); x.closePath(); }
      if (n > 1) { x.lineWidth = 1 * dpr; x.strokeStyle = 'rgba(0,0,0,0.2)'; x.stroke(); }
      // name along the radius, ending near the rim, semi-transparent so the face stays visible
      x.rotate(-Math.PI / 2);
      var f = fs; x.font = '600 ' + f + 'px "IBM Plex Sans", system-ui, sans-serif';
      var maxLen = R * 0.7, w = x.measureText(h.name).width;
      if (w > maxLen) { f = Math.max(6 * dpr, f * maxLen / w); x.font = '600 ' + f + 'px "IBM Plex Sans", system-ui, sans-serif'; }
      x.textAlign = 'right'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      x.lineWidth = Math.max(2, f * 0.28); x.strokeStyle = 'rgba(0,0,0,0.3)'; x.strokeText(h.name, R - 8 * dpr, 0);
      x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText(h.name, R - 8 * dpr, 0);
      x.restore();
    }
    x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.lineWidth = 3 * dpr; x.strokeStyle = cssVar('--line'); x.stroke();
    x.beginPath(); x.arc(0, 0, R * 0.1, 0, Math.PI * 2); x.fillStyle = cssVar('--surface'); x.fill(); x.lineWidth = 2 * dpr; x.strokeStyle = cssVar('--line'); x.stroke();
    return c;
  }

  var wheels = {}; // pid -> { canvas, list, bitmap, size, angle }
  function drawWheel(pid) {
    var w = wheels[pid]; if (!w || !w.bitmap) return;
    var cv = w.canvas, x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    var off = (cv.width - w.bitmap.width) / 2;
    x.save(); x.translate(cv.width / 2, cv.height / 2); x.rotate(w.angle * Math.PI / 180);
    x.drawImage(w.bitmap, -w.bitmap.width / 2, -w.bitmap.height / 2); x.restore();
  }
  function rebuildWheel(pid) {
    var w = wheels[pid]; if (!w) return;
    var box = w.canvas.parentNode, cssSize = Math.max(120, box.clientWidth - 0), dpr = Math.min(2, window.devicePixelRatio || 1);
    var inner = Math.round(cssSize * 0.96);
    w.canvas.width = Math.round(cssSize * dpr); w.canvas.height = Math.round(cssSize * dpr);
    w.list = remaining(pid);
    w.bitmap = makeBitmap(w.list, inner, dpr);
    drawWheel(pid);
  }
  function rebuildAllWheels() { if (!S) return; PLAYERS.forEach(function (p) { rebuildWheel(p.id); }); }
  window.addEventListener('resize', function () { clearTimeout(rebuildAllWheels.t); rebuildAllWheels.t = setTimeout(rebuildAllWheels, 150); });

  function angleFor(pid, heroId, jitter) {
    var list = wheels[pid].list, n = list.length, i = list.findIndex(function (h) { return h.id === heroId; });
    if (i < 0) return 0;
    var step = 360 / n;
    return -((i + 0.5) * step + (jitter ? (Core.randFloat() - 0.5) * 0.7 * step : 0));
  }
  function animate(pid, dur, turns) {
    return new Promise(function (resolve) {
      var w = wheels[pid], from = w.angle, base = angleFor(pid, S.pending.picks[pid], true);
      var m = Math.ceil((from + 360 * turns - base) / 360), to = base + 360 * m, t0 = performance.now();
      function frame(t) {
        var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4);
        w.angle = from + (to - from) * e; drawWheel(pid);
        if (p < 1) requestAnimationFrame(frame); else { w.angle = to % 360; drawWheel(pid); resolve(); }
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---------- Wheel page ---------- */
  var spinning = false, relaxNext = false, lastWin = null;
  function spinnable() { return PLAYERS.filter(function (p) { return S.sel[p.id] && remaining(p.id).length > 0; }).map(function (p) { return p.id; }); }

  function buildWheelCards() {
    var host = $('wheels'); host.innerHTML = '';
    PLAYERS.forEach(function (p) {
      var card = document.createElement('section'); card.className = 'wcard'; card.id = 'card-' + p.id;
      card.innerHTML =
        '<div class="wcard-head"><div><h2>' + p.name + '</h2><div class="meta" id="meta-' + p.id + '"></div></div>' +
        '<label class="chk"><input type="checkbox" id="sel-' + p.id + '"> Spinning</label></div>' +
        '<div class="wbox" id="wbox-' + p.id + '"><span class="pointer"></span><canvas id="cv-' + p.id + '" aria-label="' + p.name + '\'s wheel"></canvas></div>' +
        '<div class="mix" id="mix-' + p.id + '"></div>' +
        '<div class="result idle" id="res-' + p.id + '"></div>' +
        '<details class="edit" id="edit-' + p.id + '"><summary>Edit heroes</summary><div class="edit-body" id="eb-' + p.id + '"></div></details>' +
        '<div class="wfoot"><button class="linkish warn" id="reset-' + p.id + '" type="button">Reset ' + p.name + '\'s wheel</button></div>';
      host.appendChild(card);
      wheels[p.id] = { canvas: $('cv-' + p.id), list: [], bitmap: null, angle: Math.random() * 360 };
      $('sel-' + p.id).addEventListener('change', function (e) { S.sel[p.id] = e.target.checked; saveState(); renderWheelPage(); });
      $('reset-' + p.id).addEventListener('click', function () {
        confirmDlg('Reset ' + p.name + '\'s wheel?', 'All 54 heroes go back on ' + p.name + '\'s wheel and the ' + wonCount(p.id) + ' wins are cleared.', 'Reset wheel', 'Keep it', function () {
          archiveWheel([p.id]); S.removed[p.id] = {}; S.order[p.id] = shuffledIds();
          if (S.pending && S.pending.players.indexOf(p.id) >= 0) S.pending = null;
          saveState(); renderWheelPage(true); toast(p.name + '\'s wheel is full again');
        });
      });
      $('edit-' + p.id).addEventListener('toggle', function () { renderEdit(p.id); });
      // Tapping a wheel does the same as the Spin button, as long as that wheel takes part.
      var box = $('wbox-' + p.id);
      box.addEventListener('click', function () { if (box.classList.contains('can-spin')) spin(); });
      box.addEventListener('keydown', function (e) {
        if ((e.key === 'Enter' || e.key === ' ') && box.classList.contains('can-spin')) { e.preventDefault(); spin(); }
      });
    });
  }

  function classCounts(pid) {
    var c = { tank: 0, damage: 0, support: 0 };
    remaining(pid).forEach(function (h) { c[h.cls]++; }); return c;
  }

  function renderEdit(pid) {
    var det = $('edit-' + pid); if (!det.open) return;
    var body = $('eb-' + pid), html = '<p>Tap a hero to mark it as won (grey) or put it back on the wheel.</p>';
    CLASSES.forEach(function (c) {
      var list = HEROES.filter(function (h) { return h.cls === c[0]; });
      var left = list.filter(function (h) { return !S.removed[pid][h.id]; }).length;
      html += '<div style="--c:var(--' + c[0] + ')"><div class="ehead">' + c[1] + '<span>' + left + ' of ' + list.length + ' on wheel</span></div><div class="egrid">';
      list.forEach(function (h) {
        var won = !!S.removed[pid][h.id];
        html += '<button type="button" class="etile" data-h="' + h.id + '" aria-pressed="' + won + '" aria-label="' + esc(h.name) + (won ? ', won' : ', on wheel') + '" style="--c:var(--' + c[0] + ')">' +
          '<img src="' + IMAGES[h.id] + '" alt=""><span class="en">' + esc(h.name) + '</span><span class="ok">' + CHECK + '</span></button>';
      });
      html += '</div></div>';
    });
    var scroll = window.scrollY;
    body.innerHTML = html;
    window.scrollTo(0, scroll);
    Array.prototype.forEach.call(body.querySelectorAll('.etile'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-h');
        if (S.removed[pid][id]) delete S.removed[pid][id]; else S.removed[pid][id] = true;
        if (S.pending && S.pending.players.indexOf(pid) >= 0) { S.pending = null; toast('Round result cleared because the wheel changed'); }
        saveState(); renderWheelPage(true);
      });
    });
  }

  function chipsHTML(c) {
    var out = '';
    CLASSES.forEach(function (k) { if (c[k[0]]) out += '<span class="chip" style="--c:var(--' + k[0] + ')">' + c[k[0]] + ' ' + k[1] + '</span>'; });
    return '<span class="chips">' + out + '</span>';
  }

  function renderWheelPage(rebuild) {
    var pend = S.pending, act = spinnable();
    $('optLimits').checked = S.opts.limits; $('optBalance').checked = S.opts.balance; $('optBalance').disabled = !S.opts.limits;
    PLAYERS.forEach(function (p) {
      var pid = p.id, left = remaining(pid).length, c = classCounts(pid);
      var done = left === 0, inRound = pend && pend.players.indexOf(pid) >= 0;
      var card = $('card-' + pid);
      card.classList.toggle('off', !S.sel[pid] || done);
      var cb = $('sel-' + pid); cb.checked = !!S.sel[pid] && !done; cb.disabled = !!pend || spinning || done;
      $('meta-' + pid).textContent = done ? 'All 54 heroes won' : left + ' left · ' + wonCount(pid) + ' won';
      $('mix-' + pid).innerHTML = CLASSES.map(function (k) { return '<span style="--c:var(--' + k[0] + ')"><i></i>' + k[1] + ' ' + c[k[0]] + '</span>'; }).join('');
      var res = $('res-' + pid);
      if (inRound && !spinning) {
        var h = BY[pend.picks[pid]];
        res.className = 'result'; res.style.setProperty('--c', 'var(--' + h.cls + ')');
        res.innerHTML = '<div class="pic"><img src="' + IMAGES[h.id] + '" alt=""></div><div><div class="cl">' + CLS_NAME[h.cls] + '</div><div class="nm2">' + esc(h.name) + '</div></div>';
      } else if (inRound && spinning) {
        res.className = 'result idle'; res.style.removeProperty('--c'); res.innerHTML = '<div class="pic">?</div><div>Spinning…</div>';
      } else {
        res.className = 'result idle'; res.style.removeProperty('--c');
        res.innerHTML = '<div class="pic">' + (done ? '✓' : (S.sel[pid] ? '?' : '–')) + '</div><div>' + (done ? 'Nothing left to spin.' : (S.sel[pid] ? 'Waiting for the next spin.' : 'Sitting out this round.')) + '</div>';
      }
      var canSpin = !spinning && !done && !!S.sel[pid] && !(pend && !act.length), box = $('wbox-' + pid);
      box.classList.toggle('can-spin', canSpin);
      if (canSpin) { box.setAttribute('role', 'button'); box.tabIndex = 0; box.title = pend ? 'Spin again' : 'Spin'; }
      else { box.removeAttribute('role'); box.removeAttribute('tabindex'); box.removeAttribute('title'); }
      $('reset-' + pid).disabled = spinning;
      if (rebuild) rebuildWheel(pid);
      renderEdit(pid);
    });
    var allDone = PLAYERS.every(function (p) { return remaining(p.id).length === 0; });
    $('done').hidden = !allDone; $('rulesBox').hidden = allDone; $('actionBar').hidden = allDone;
    // action bar
    var spinBtn = $('spinBtn'), winBtn = $('winBtn');
    spinBtn.textContent = pend ? 'Spin again' : (act.length ? 'Spin ' + (act.length === 1 ? '1 wheel' : act.length + ' wheels') : 'Spin');
    spinBtn.disabled = spinning || !act.length && !pend;
    if (pend && !act.length) spinBtn.disabled = true;
    winBtn.hidden = !pend; winBtn.disabled = spinning || !pend;
    $('discardBtn').hidden = !pend; $('discardBtn').disabled = spinning;
    var st = $('status');
    if (spinning) st.innerHTML = '<b>Spinning…</b>';
    else if (pend) {
      var cnt = { tank: 0, damage: 0, support: 0 }; pend.players.forEach(function (pid) { cnt[BY[pend.picks[pid]].cls]++; });
      st.innerHTML = '<b>Round set.</b> ' + chipsHTML(cnt) + (pend.relaxed ? ' <span>Role limits were off for this round.</span>' : '') + '<br>Won the match? Remove these heroes. Lost? Spin again.';
    } else if (!act.length) st.textContent = 'Tick at least one wheel to spin.';
    else st.textContent = act.map(nameOf).join(', ') + (act.length === 1 ? ' spins.' : ' spin.') + ' Wheels that are not ticked never lose heroes.';
  }

  function spin() {
    if (spinning || !S) return;
    var act = S.pending ? S.pending.players.filter(function (pid) { return remaining(pid).length; }) : spinnable();
    if (S.pending) act = spinnable();
    if (!act.length) return;
    var pools = act.map(remaining), useLimits = S.opts.limits && !relaxNext;
    $('blocked').hidden = true;
    var combo = Core.pickCombo(pools, { limits: useLimits, balance: S.opts.balance });
    if (!combo) { showBlocked(act); return; }
    var picks = {}; act.forEach(function (pid, i) { picks[pid] = combo[i].id; });
    S.pending = { players: act, picks: picks, relaxed: S.opts.limits && !useLimits, at: Date.now() }; seenAt = S.pending.at;
    relaxNext = false; saveState();
    spinning = true; renderWheelPage();
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    Promise.all(act.map(function (pid, i) { return animate(pid, reduce ? 500 : 4200 + i * 700, reduce ? 1 : 5 + i); })).then(function () {
      spinning = false; renderWheelPage(); afterBusy();
    });
  }

  function showBlocked(act) {
    var c = { tank: 0, damage: 0, support: 0 };
    act.forEach(function (pid) { var k = classCounts(pid); CLASSES.forEach(function (x) { c[x[0]] += k[x[0]]; }); });
    $('blockedText').innerHTML = '<b>No valid team is possible with the heroes left on these wheels.</b><br>Together they hold ' + c.tank + ' Tank, ' + c.damage + ' Damage and ' + c.support + ' Support heroes, and the limits are 1 Tank, 2 Damage and 2 Support. You can spin without role limits for this round, or untick a wheel after discarding the result.';
    $('blocked').hidden = false;
  }
  $('relaxBtn').addEventListener('click', function () { relaxNext = true; $('blocked').hidden = true; spin(); });
  $('blockedClose').addEventListener('click', function () { $('blocked').hidden = true; });

  function win() {
    if (!S || !S.pending || spinning) return;
    var p = S.pending, removedNow = [];
    p.players.forEach(function (pid) { var id = p.picks[pid]; if (!S.removed[pid][id]) { S.removed[pid][id] = true; removedNow.push([pid, id]); } });
    S.pending = null; lastWin = { removed: removedNow, pending: p }; saveState();
    renderWheelPage(true);
    var names = removedNow.map(function (r) { return BY[r[1]].name; }).join(', ');
    toast('Removed ' + names, 'Undo', function () {
      if (!lastWin) return;
      lastWin.removed.forEach(function (r) { delete S.removed[r[0]][r[1]]; });
      S.pending = lastWin.pending; lastWin = null; saveState();
      renderWheelPage(true);
      PLAYERS.forEach(function (pl) { if (S.pending.players.indexOf(pl.id) >= 0) wheels[pl.id].angle = angleFor(pl.id, S.pending.picks[pl.id], false); drawWheel(pl.id); });
    });
  }
  $('resetAllBtn').addEventListener('click', function () {
    confirmDlg('Reset all wheels?', 'All 54 heroes go back on every wheel and all 162 wins are cleared.', 'Reset all wheels', 'Keep them', function () {
      archiveWheel(PLAYERS.map(function (p) { return p.id; }));
      PLAYERS.forEach(function (p) { S.removed[p.id] = {}; S.order[p.id] = shuffledIds(); }); S.pending = null; lastWin = null; saveState();
      renderWheelPage(true); toast('All wheels are full again');
    });
  });
  $('spinBtn').addEventListener('click', spin);
  $('winBtn').addEventListener('click', win);
  $('discardBtn').addEventListener('click', function () { S.pending = null; saveState(); renderWheelPage(); });
  $('optLimits').addEventListener('change', function (e) { S.opts.limits = e.target.checked; saveState(); renderWheelPage(); });
  $('optBalance').addEventListener('change', function (e) { S.opts.balance = e.target.checked; saveState(); renderWheelPage(); });

  // Endgame outlook: plays the rest of the run many times assuming every match is won.
  $('checkBtn').addEventListener('click', function () {
    var out = $('checkOut'), act = spinnable();
    if (!act.length) { out.textContent = 'Tick at least one wheel first.'; return; }
    if (!S.opts.limits) { out.textContent = 'Role limits are off, so no team can get stuck.'; return; }
    if (act.length === 1) { out.textContent = 'One wheel alone can never get stuck.'; return; }
    out.textContent = 'Checking…';
    setTimeout(function () {
      var N = 40, stuck = 0, leftSum = 0;
      for (var r = 0; r < N; r++) {
        var pools = act.map(remaining), guard = 0;
        while (pools.some(function (p) { return p.length; }) && guard++ < 400) {
          var idx = pools.map(function (p, i) { return i; }).filter(function (i) { return pools[i].length; });
          var combo = Core.pickCombo(idx.map(function (i) { return pools[i]; }), { limits: true, balance: S.opts.balance });
          if (!combo) { stuck++; leftSum += pools.reduce(function (a, p) { return a + p.length; }, 0); break; }
          idx.forEach(function (pi, j) { pools[pi] = pools[pi].filter(function (h) { return h.id !== combo[j].id; }); });
        }
      }
      out.textContent = stuck
        ? stuck + ' of ' + N + ' simulated runs got stuck (about ' + Math.round(leftSum / stuck) + ' heroes left over). Simulation assumes every match is won.'
        : 'None of ' + N + ' simulated runs got stuck. Simulation assumes every match is won.';
    }, 30);
  });

  buildWheelCards(); paintThemeBtns(); connect();
  window.__app = { S: function () { return S; }, spin: spin, win: win, render: renderWheelPage };
})();
