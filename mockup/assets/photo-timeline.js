/* ═══════════════════════════════════════════════════════════════════════
   Photo Timeline — behaviour

   The expansion model, which is deliberately never shown to the user:

     σ(focus) = clamp( localGap(focus) / PHI , SIGMA_MIN , σmax )
     e(t,f)   = exp( −(t − f)² / (2 σ(f)²) )

   localGap is the distance from the focus day to the nearest OTHER day that
   holds photos, so σ is tight inside a cluster and widens to span the quiet
   stretch the dot is standing in. PHI is the only free parameter and it sets
   the valley depth exactly: valley = exp(-PHI²/2).

   Nothing below renders σ, a kernel, or an influence band. The user sees
   photos, one smooth grey histogram, and a dot.
   ═══════════════════════════════════════════════════════════════════════ */
window.TL = (function () {
  'use strict';

  var DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DEAD = 0.045;          /* below this a photo collapses to a plain square */
  var PHI = 1.2;             /* valley depth; 1.2 -> the two flanking clusters sit at 49% */
  var SIGMA_MIN = 1.4;       /* the width that works inside a trip */
  var SCROLL_GAIN = 0.32;    /* wheel -> days, as a fraction of axis width */
  var FINE_GAIN = 0.22;      /* shift + wheel */
  var CLICK_SLOP = 5;        /* px of movement still counted as a click */
  var PICK_SLOP = 26;        /* px forgiveness when hitting a collapsed square */
  var SMOOTH_PASSES = 2;     /* [1 2 1]/4 kernel passes over the histogram bins */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmtDay(d) {
    var t = new Date(d * DAY);
    return t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }
  function fmtChip(d) {
    var t = new Date(d * DAY);
    return (t.getUTCDate() < 10 ? '0' : '') + t.getUTCDate() + ' ' + MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
  }
  function hash(n) {
    var x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
    return ((x ^ (x >>> 16)) >>> 0);
  }
  function pick(arr, n) { return arr[hash(n) % arr.length]; }

  /* ══ theme ═══════════════════════════════════════════════════════ */
  var THEME_KEY = 'photo-timeline:theme';

  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);
    try { localStorage.setItem(THEME_KEY, name); } catch (e) {}
    var btns = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-theme-set') === name));
    }
  }
  function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function initTheme() {
    var btns = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { applyTheme(btn.getAttribute('data-theme-set')); });
      })(btns[i]);
    }
    applyTheme(currentTheme());
  }

  /* ══ dataset ═════════════════════════════════════════════════════ */
  var T0 = 0, T1 = 1, NDAYS = 1, FOCUS0 = 0, SIGMA_MAX = 70;
  var PHOTOS = [], GROUPS = [];
  var SOURCE = { kind: 'placeholder', label: 'placeholder records', illustrative: true };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function placeholderPhotos() {
    var rnd = mulberry32(20140314);
    var clusters = [
      [10, 3, 7], [88, 2, 4], [142, 4, 8], [206, 1, 3], [262, 5, 6], [334, 2, 5],
      [396, 3, 9], [468, 2, 4], [526, 4, 7], [598, 2, 5], [658, 3, 6], [740, 1, 5],
      [798, 4, 8], [884, 2, 4], [940, 3, 6], [1024, 2, 5], [1092, 5, 7], [1166, 3, 8],
      [1236, 3, 6], [1316, 2, 5], [1394, 3, 7], [1470, 2, 4], [1532, 4, 8], [1610, 2, 5],
      [1668, 3, 6], [1744, 2, 4], [1806, 5, 7], [1888, 2, 5], [1946, 3, 6], [2010, 2, 4],
      [2066, 3, 5], [2120, 4, 6]
    ];
    var out = [];
    for (var c = 0; c < clusters.length; c++) {
      var start = clusters[c][0], span = clusters[c][1], peak = clusters[c][2];
      var left = peak, share = Math.max(1, Math.round(peak / span));
      for (var k = 0; k < span; k++) {
        var take = Math.max(1, Math.min(left - (span - k - 1), share - 1 + Math.floor(rnd() * 3)));
        for (var j = 0; j < take; j++) out.push({ day: start + k, jr: rnd() });
        left -= take;
      }
      for (var r = 0; r < left; r++) out.push({ day: start + span - 1, jr: rnd() });
    }
    for (var s = 0; s < 34; s++) out.push({ day: Math.floor(rnd() * 2190) + 5, jr: rnd() });
    return out;
  }

  function setDataset(list, source) {
    PHOTOS = list.slice().sort(function (a, b) { return a.day - b.day; });
    SOURCE = source || { kind: 'placeholder', label: 'placeholder records', illustrative: true };

    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < PHOTOS.length; i++) {
      if (PHOTOS[i].day < min) min = PHOTOS[i].day;
      if (PHOTOS[i].day > max) max = PHOTOS[i].day;
    }
    T0 = Math.floor(min) - 25;
    T1 = Math.ceil(max) + 26;
    NDAYS = Math.max(2, T1 - T0);
    /* σ ceiling scales with the archive so a 20-year library still breathes */
    SIGMA_MAX = clamp(0.03 * NDAYS, 25, 400);

    var map = new Map();
    for (i = 0; i < PHOTOS.length; i++) {
      var d = PHOTOS[i].day;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(i);
    }
    GROUPS = [];
    map.forEach(function (ids, day) { GROUPS.push({ day: day, ids: ids }); });
    GROUPS.sort(function (a, b) { return a.day - b.day; });
    for (var gi = 0; gi < GROUPS.length; gi++) {
      for (var q = 0; q < GROUPS[gi].ids.length; q++) {
        PHOTOS[GROUPS[gi].ids[q]].g = gi;
        PHOTOS[GROUPS[gi].ids[q]].k = q;
        PHOTOS[GROUPS[gi].ids[q]].pi = GROUPS[gi].ids[q];
      }
    }

    /* open on the densest day so the first thing you see is the idea */
    var best = GROUPS[0];
    for (gi = 0; gi < GROUPS.length; gi++) if (GROUPS[gi].ids.length > best.ids.length) best = GROUPS[gi];
    FOCUS0 = best ? best.day : T0;
  }

  function sigmaOf(gap) { return clamp(gap / PHI, SIGMA_MIN, SIGMA_MAX); }

  /* distance from f to the nearest photo day OTHER than f */
  function localGap(f) {
    var n = GROUPS.length;
    if (!n) return SIGMA_MAX;
    var lo = 0, hi = n - 1, best = Infinity;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (GROUPS[mid].day < f) lo = mid + 1; else hi = mid - 1; }
    if (lo < n) { var a = Math.abs(GROUPS[lo].day - f); if (a > 1e-4 && a < best) best = a; }
    if (hi >= 0) { var b = Math.abs(GROUPS[hi].day - f); if (b > 1e-4 && b < best) best = b; }
    return best === Infinity ? SIGMA_MAX : best;
  }

  /* ══ illustrative metadata for placeholder records ═══════════════ */
  var CAM = ['Fujifilm X-T4', 'Sony α7 IV', 'Canon EOS R6', 'Nikon Z6 II', 'Ricoh GR IIIx'];
  var LENS = ['23mm f/1.4', '35mm f/1.4', '16–55mm f/2.8', '40mm f/2', '28mm f/2.8'];
  var SHUTTER = ['1/2000', '1/1000', '1/500', '1/250', '1/125', '1/60', '1/30'];
  var APERTURE = ['f/1.4', 'f/2', 'f/2.8', 'f/4', 'f/5.6', 'f/8'];
  var ISO = [100, 200, 400, 800, 1600, 3200];
  var SIZES = [['4032 × 3024', 3.8], ['4032 × 2268', 2.9], ['3024 × 4032', 3.6], ['6000 × 4000', 11.2]];

  function metadataFor(p) {
    var h = hash(p.pi * 7919 + p.day);
    if (SOURCE.kind === 'file') {
      return [
        ['file', p.name],
        ['type', p.mime || '—'],
        ['size', p.bytes != null ? (p.bytes / 1048576).toFixed(1) + ' MB' : '—'],
        ['modified', fmtDay(p.day)],
        ['on timeline', fmtDay(p.day)],
        ['exif', 'not read in this mockup']
      ];
    }
    var dims = SIZES[h % SIZES.length];
    return [
      ['record', 'IMG_' + (1000 + (h >>> 3) % 8999) + '.JPG'],
      ['captured', fmtDay(p.day) + ' · ' + String(8 + (h % 11)).padStart(2, '0') + ':' + String((h >> 4) % 60).padStart(2, '0')],
      ['pixels', dims[0]],
      ['file size', dims[1].toFixed(1) + ' MB'],
      ['camera', pick(CAM, h)],
      ['lens', pick(LENS, h + 1)],
      ['exposure', pick(SHUTTER, h + 2) + ' · ' + pick(APERTURE, h + 3) + ' · ISO ' + pick(ISO, h + 4)],
      ['on timeline', fmtDay(p.day)]
    ];
  }

  /* ══ smooth histogram ════════════════════════════════════════════ */
  /* Monotone cubic Hermite (Fritsch–Carlson). The harmonic-mean tangent rule
     cannot overshoot, so a sparse archive yields a flat floor rather than
     spikes that dive below the axis. */
  function monotonePath(pts, closeTo) {
    var n = pts.length, i;
    if (n < 2) return '';
    var ys = pts.map(function (p) { return p.y; });
    var xs = pts.map(function (p) { return p.x; });
    var m = new Array(n);
    var d0 = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    var dn = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    m[0] = d0; m[n - 1] = dn;
    for (i = 1; i < n - 1; i++) {
      var a = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
      var b = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
      m[i] = (a * b <= 0) ? 0 : 2 * a * b / (a + b);
    }
    var d = 'M' + xs[0].toFixed(1) + ',' + ys[0].toFixed(1);
    for (i = 0; i < n - 1; i++) {
      var h = (xs[i + 1] - xs[i]) / 3;
      d += 'C' + (xs[i] + h).toFixed(1) + ',' + (ys[i] + m[i] * h).toFixed(1) +
           ' ' + (xs[i + 1] - h).toFixed(1) + ',' + (ys[i + 1] - m[i + 1] * h).toFixed(1) +
           ' ' + xs[i + 1].toFixed(1) + ',' + ys[i + 1].toFixed(1);
    }
    if (closeTo != null) {
      d += 'L' + xs[n - 1].toFixed(1) + ',' + closeTo + 'L' + xs[0].toFixed(1) + ',' + closeTo + 'Z';
    }
    return d;
  }

  function histogram(counts) {
    var n = counts.length, pass, i, out;
    for (pass = 0; pass < SMOOTH_PASSES; pass++) {
      out = counts.slice();
      for (i = 1; i < n - 1; i++) out[i] = (counts[i - 1] + 2 * counts[i] + counts[i + 1]) / 4;
      counts = out;
    }
    var max = 0;
    for (i = 0; i < n; i++) if (counts[i] > max) max = counts[i];
    return { counts: counts, max: max || 1 };
  }

  /* ══ timeline ════════════════════════════════════════════════════ */
  function initTimeline(opts) {
    var stage = opts.stage;
    var cloud = stage.querySelector('.tl-cloud');
    var plot = stage.querySelector('.tl-plot');
    var scale = stage.querySelector('.tl-scale');

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('preserveAspectRatio', 'none');
    var area = document.createElementNS(NS, 'path');
    area.setAttribute('fill', 'var(--hist-fill)');
    var edge = document.createElementNS(NS, 'path');
    edge.setAttribute('fill', 'none');
    edge.setAttribute('stroke', 'var(--hist-line)');
    edge.setAttribute('stroke-width', '1.25');
    edge.setAttribute('stroke-linejoin', 'round');
    edge.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(area);
    svg.appendChild(edge);
    plot.appendChild(svg);

    var xhair = document.createElement('div');
    xhair.className = 'tl-xhair';
    cloud.appendChild(xhair);

    var axis = document.createElement('div');
    axis.className = 'tl-axis';
    plot.appendChild(axis);

    var dot = document.createElement('div');
    dot.className = 'tl-dot';
    plot.appendChild(dot);

    var pill = document.createElement('div');
    pill.className = 'tl-pill';
    plot.appendChild(pill);

    var els = [], ticks = [];
    var W = 0, span = 1, pad = 10, cloudH = 200, plotH = 78;
    var minS = 20, maxS = 150, pitchMax = 186;
    var curDay = 0, targetDay = 0, raf = 0, selected = -1, dragging = false;
    var downX = 0, downY = 0, moved = 0;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function x(day) { return pad + (day - T0) / NDAYS * span; }
    function dayAt(px) { return T0 + (clamp(px, pad, pad + span) - pad) / span * NDAYS; }

    function build() {
      var i, t;
      while (cloud.firstChild) cloud.removeChild(cloud.firstChild);
      while (scale.firstChild) scale.removeChild(scale.firstChild);
      cloud.appendChild(xhair);
      plot.appendChild(svg);
      plot.appendChild(axis);
      plot.appendChild(dot);
      plot.appendChild(pill);

      els = []; ticks = []; selected = -1;

      for (i = 0; i < PHOTOS.length; i++) {
        var el = document.createElement('div');
        el.className = 'tl-thumb';
        var chip = document.createElement('div');
        chip.className = 'tl-chip';
        chip.textContent = fmtChip(PHOTOS[i].day);
        el.appendChild(chip);
        cloud.appendChild(el);
        els.push(el);
      }

      for (t = 0; t < NDAYS; t++) {
        var dt = new Date((T0 + t) * DAY);
        if (dt.getUTCDate() !== 1) continue;
        var isYear = dt.getUTCMonth() === 0;
        var tick = document.createElement('div');
        tick.className = 'tl-tick ' + (isYear ? 'y' : 'm');
        scale.appendChild(tick);
        var lab = null;
        if (isYear) {
          lab = document.createElement('div');
          lab.className = 'tl-year';
          lab.textContent = dt.getUTCFullYear();
          scale.appendChild(lab);
        }
        ticks.push({ day: T0 + t, el: tick, lab: lab });
      }

      curDay = targetDay = FOCUS0;
      if (opts.onSelect) opts.onSelect(null);
    }

    function measure() {
      var cs = getComputedStyle(stage);
      minS = parseFloat(cs.getPropertyValue('--tl-min')) || 20;
      maxS = parseFloat(cs.getPropertyValue('--tl-max')) || 150;
      pitchMax = parseFloat(cs.getPropertyValue('--tl-pitch')) || 186;
      plotH = plot.clientHeight || 78;
      cloudH = cloud.clientHeight || 200;
      W = cloud.clientWidth || stage.clientWidth || 1000;
      pad = 10;
      span = Math.max(1, W - pad * 2);

      for (var j = 0; j < ticks.length; j++) {
        var tx = x(ticks[j].day);
        ticks[j].el.style.left = tx + 'px';
        if (ticks[j].lab) {
          ticks[j].lab.style.left = tx + 'px';
          ticks[j].lab.style.transform = (j === ticks.length - 1) ? 'translateX(calc(-100% - 5px))' : 'translateX(5px)';
        }
      }
      drawHistogram();
    }

    /* one smooth grey area, sitting on the axis. Static: it does not react to
       the focus, because the focus is already shown by the dot and the cloud. */
    function drawHistogram() {
      if (!GROUPS.length || W < 2) { area.setAttribute('d', ''); edge.setAttribute('d', ''); return; }
      var N = clamp(Math.round(W / 6), 40, 200);
      var counts = new Array(N).fill(0);
      for (var i = 0; i < GROUPS.length; i++) {
        var bi = clamp(Math.round((GROUPS[i].day - T0) / NDAYS * (N - 1)), 0, N - 1);
        counts[bi] += GROUPS[i].ids.length;
      }
      var h = histogram(counts);
      var top = 2, floor = plotH - 1, usable = floor - top;
      var pts = [];
      for (i = 0; i < N; i++) {
        pts.push({
          x: pad + (i / (N - 1)) * span,
          y: floor - Math.max(0.75, (h.counts[i] / h.max) * usable)
        });
      }
      var line = monotonePath(pts);
      edge.setAttribute('d', line);
      area.setAttribute('d', monotonePath(pts, floor));
    }

    function render(day) {
      if (!PHOTOS.length || !GROUPS.length) return;
      var i, g, e, tn, size, pitch, fanHalf, p, el, s, rec;
      var ginfo = [];
      var sigma = sigmaOf(localGap(day));

      for (i = 0; i < GROUPS.length; i++) {
        g = GROUPS[i];
        e = Math.exp(-Math.pow(day - g.day, 2) / (2 * sigma * sigma));
        tn = clamp((e - DEAD) / (1 - DEAD), 0, 1);
        size = minS + tn * (maxS - minS);
        pitch = Math.min(1180 / g.ids.length, Math.max(size + 12, 30 + tn * (pitchMax - 30)));
        fanHalf = (g.ids.length - 1) / 2 * pitch + size / 2;
        ginfo[i] = { e: e, tn: tn, size: size, pitch: pitch, fanHalf: fanHalf };
      }

      var fx = x(day);
      var roomL = Math.max(0, fx - pad - 34);
      var roomR = Math.max(0, (pad + span) - fx - 34);

      for (i = 0; i < PHOTOS.length; i++) {
        p = PHOTOS[i];
        rec = ginfo[p.g];
        el = els[i];
        var sel = i === selected;
        var tn = rec.tn;
        if (tn === 0 && el._tn === 0 && !sel) continue;
        if (sel && tn < 0.62) tn = 0.62;
        el._tn = tn;

        var w = minS + tn * (maxS - minS);
        if (sel) w = Math.min(w * 1.8 + 40, 420, cloudH * 0.6);
        var d = day - p.day;
        var px = x(p.day) + (p.k - (GROUPS[p.g].ids.length - 1) / 2) * rec.pitch;
        var push = 0;
        if (Math.abs(d) >= 0.5) {
          push = Math.min((rec.fanHalf + 16 + Math.abs(d) * 20) * clamp(rec.e / 0.4, 0, 1), 300, roomL, roomR);
          px += (d < 0 ? -1 : 1) * push;
        }
        px = clamp(px, pad + w / 2, pad + span - w / 2);
        var aspect = 1 + tn / 3;
        if (sel) aspect = 1.22;
        var h = w / aspect;
        var py = cloudH - 4 - p.jr * (cloudH * 0.2) - tn * (cloudH * 0.09);

        if (sel) {
          px = px + (W / 2 - px) * 0.75;
          py = py + (cloudH * 0.52 - py) * 0.75;
          px = clamp(px, pad + w / 2, pad + span - w / 2);
          py = Math.min(Math.max(py, h + 2), cloudH - 2);
        }

        el._box = [px - w / 2, py - h, w, h];
        el._z = 1 + Math.round(tn * 100) + (sel ? 400 : 0);
        s = el.style;
        s.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0) translate(-50%,-100%)';
        s.height = w.toFixed(1) + 'px';
        s.aspectRatio = aspect.toFixed(3);
        s.zIndex = String(el._z);
        s.setProperty('--o', tn.toFixed(3));
      }

      xhair.style.transform = 'translate3d(' + fx.toFixed(1) + 'px,0,0)';
      dot.style.transform = 'translate3d(' + fx.toFixed(1) + 'px,0,0) translate(-50%,50%)';
      pill.style.transform = 'translate3d(' + fx.toFixed(1) + 'px,0,0) translateX(-50%)';
      pill.textContent = fmtDay(day);

      if (opts.onFrame) {
        var open = 0;
        for (i = 0; i < ginfo.length; i++) if (ginfo[i].tn > 0.02) open += GROUPS[i].ids.length;
        opts.onFrame({ day: day, sigma: sigma, open: open });
      }
    }

    function frame() {
      raf = 0;
      var diff = targetDay - curDay;
      if (Math.abs(diff) > 0.004) curDay += diff * (reduced ? 1 : 0.24);
      else curDay = targetDay;
      render(curDay);
      if (curDay !== targetDay) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function setTarget(day) { targetDay = clamp(day, T0, T1 - 0.001); kick(); }

    function hitTest(px, py) {
      var best = -1, bestZ = -1, nearI = -1, nearD = PICK_SLOP;
      for (var i = 0; i < els.length; i++) {
        var b = els[i]._box;
        if (!b) continue;
        if (px >= b[0] && px <= b[0] + b[2] && py >= b[1] && py <= b[1] + b[3]) {
          if (els[i]._z > bestZ) { bestZ = els[i]._z; best = i; }
        } else {
          var dist = Math.hypot(px - (b[0] + b[2] / 2), py - (b[1] + b[3] / 2));
          if (dist < nearD) { nearD = dist; nearI = i; }
        }
      }
      return best >= 0 ? best : nearI;
    }

    function select(i) {
      if (selected >= 0 && els[selected]) els[selected].classList.remove('is-sel');
      selected = i;
      if (selected >= 0) els[selected].classList.add('is-sel');
      if (opts.onSelect) opts.onSelect(selected >= 0 ? PHOTOS[selected] : null);
      kick();
    }

    function localX(ev) {
      var r = stage.getBoundingClientRect();
      return ev.clientX - r.left - parseFloat(getComputedStyle(stage).paddingLeft);
    }
    function localY(ev) {
      var r = stage.getBoundingClientRect();
      return ev.clientY - r.top - parseFloat(getComputedStyle(stage).paddingTop);
    }

    stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      dragging = true; moved = 0;
      downX = ev.clientX; downY = ev.clientY;
      try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
      stage.focus({ preventScroll: true });
      ev.preventDefault();
    });
    stage.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      moved = Math.max(moved, Math.hypot(ev.clientX - downX, ev.clientY - downY));
      if (moved > CLICK_SLOP) setTarget(dayAt(localX(ev)));
    });
    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      try { stage.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (moved <= CLICK_SLOP) select(hitTest(localX(ev), localY(ev)));
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', function () { dragging = false; });

    stage.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var raw = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (ev.deltaMode === 1) raw *= 16;
      var gain = (ev.shiftKey ? FINE_GAIN : SCROLL_GAIN) * NDAYS / Math.max(1, span);
      setTarget(targetDay + raw * gain);
    }, { passive: false });

    stage.addEventListener('keydown', function (ev) {
      var d = 0;
      if (ev.key === 'ArrowLeft') d = -1;
      else if (ev.key === 'ArrowRight') d = 1;
      else if (ev.key === 'PageUp') d = -7;
      else if (ev.key === 'PageDown') d = 7;
      else if (ev.key === 'Home') d = T0 - curDay;
      else if (ev.key === 'End') d = (T1 - 1) - curDay;
      else if (ev.key === 'Escape') { select(-1); if (opts.onClose) opts.onClose(); return; }
      else return;
      ev.preventDefault();
      setTarget(curDay + d);
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () { measure(); render(curDay); }).observe(stage);
    } else {
      window.addEventListener('resize', function () { measure(); render(curDay); });
    }

    build();
    measure();
    render(curDay);

    return {
      reload: function () { build(); measure(); render(curDay); },
      setTarget: setTarget,
      get focus() { return curDay; },
      select: select,
      close: function () { select(-1); }
    };
  }

  /* ══ info panel ═══════════════════════════════════════════════════ */
  function initInfoPanel(opts) {
    var body = document.getElementById('tl-info');
    var shell = body.parentNode;
    var panel = document.getElementById('tl-info-panel');
    var tab = document.getElementById('tl-info-tab');
    var content = document.getElementById('tl-info-body');
    var closeBtn = document.getElementById('tl-info-close');

    function setOpen(open) {
      shell.setAttribute('data-info', open ? 'open' : 'closed');
      panel.hidden = !open;
      tab.setAttribute('aria-expanded', String(open));
      if (!open) content.innerHTML = '<p class="tl-info-empty">Panel closed. Click a photo in the cloud to open it again.</p>';
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function show(p) {
      if (!p) {
        body.setAttribute('data-has-sel', 'false');
        content.innerHTML = SOURCE.illustrative
          ? '<p class="tl-info-empty">Click any photo in the cloud. Placeholder records carry illustrative values only.</p>'
          : '<p class="tl-info-empty">Click any photo in the cloud to read its file record.</p>';
        return;
      }
      body.setAttribute('data-has-sel', 'true');
      var rows = metadataFor(p);
      var html = '<span class="tl-source">' + escapeHtml(SOURCE.label) + '</span><dl class="tl-fields">';
      for (var i = 0; i < rows.length; i++) {
        html += '<dt>' + escapeHtml(rows[i][0]) + '</dt><dd>' + escapeHtml(rows[i][1]) + '</dd>';
      }
      content.innerHTML = html + '</dl>';
    }

    tab.addEventListener('click', function () { setOpen(panel.hidden); });
    closeBtn.addEventListener('click', function () { setOpen(false); if (opts.onClose) opts.onClose(); });
    setOpen(false);
    show(null);
    return { show: show, setOpen: setOpen, isOpen: function () { return !panel.hidden; } };
  }

  /* ══ folder picker ═══════════════════════════════════════════════ */
  function filesToPhotos(fileList, cap) {
    var n = Math.min(fileList.length, cap);
    var list = [], seed = 7;
    for (var i = 0; i < n; i++) {
      var f = fileList[i];
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|heic|gif|webp|tiff?|bmp|avif)$/i.test(f.name)) continue;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      list.push({ day: Math.round(f.lastModified / DAY), jr: (seed % 1000) / 1000, name: f.name, mime: f.type, bytes: f.size });
    }
    return list;
  }

  return {
    initTheme: initTheme,
    currentTheme: currentTheme,
    placeholderPhotos: placeholderPhotos,
    setDataset: setDataset,
    initTimeline: initTimeline,
    initInfoPanel: initInfoPanel,
    filesToPhotos: filesToPhotos,
    fmtDay: fmtDay,
    params: { PHI: PHI, SIGMA_MIN: SIGMA_MIN, DEAD: DEAD, get sigmaMax() { return SIGMA_MAX; } }
  };
})();
