/* ═══════════════════════════════════════════════════════════════════════
   Photo Timeline — headless harness
   Runs assets/photo-timeline.js against a minimal DOM shim so runtime
   failures surface without a browser. No dependencies.

       "$OD_NODE_BIN" timeline-harness.js       (or: node timeline-harness.js)

   Exits non-zero if any check fails. Run it after touching the timeline code.
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

/* ── DOM shim ─────────────────────────────────────────────────────── */
let uid = 0;
function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = [];
  this.style = { setProperty() {}, };
  this.attrs = {};
  this._text = '';
  this._uid = ++uid;
  this._h = {};
  this.clientWidth = 1100;
  this.clientHeight = 240;
  this.parentNode = null;
  this.classList = {
    _s: new Set(),
    add(...c) { c.forEach(x => this._s.add(x)); },
    remove(...c) { c.forEach(x => this._s.delete(x)); },
    contains(c) { return this._s.has(c); },
    toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }
  };
}
El.prototype = {
  get firstChild() { return this.children[0] || null; },
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
  removeAttribute(k) { delete this.attrs[k]; },
  addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); },
  removeEventListener() {},
  dispatch(t, ev) { (this._h[t] || []).forEach(fn => fn(Object.assign({ preventDefault() {}, stopPropagation() {} }, ev))); },
  setPointerCapture() {}, releasePointerCapture() {},
  focus() { global.__focused = this; },
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
  set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
  set className(v) { this.attrs.class = v; }, get className() { return this.attrs.class || ''; },
  set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html || ''; },
  querySelector(s) { return this.querySelectorAll(s)[0] || null; },
  querySelectorAll(sel) {
    const isClass = sel.charAt(0) === '.';
    const want = sel.replace(/^\./, '');
    const out = [];
    (function walk(n) {
      for (const c of n.children) {
        if (isClass ? (c.classList.contains(want) || c.className === want) : c.tagName === want.toUpperCase()) out.push(c);
        walk(c);
      }
    })(this);
    return out;
  }
};

function byId(root, id) {
  let found = null;
  (function walk(n) { for (const c of n.children) { if (c.attrs.id === id) { found = c; return; } walk(c); } })(root);
  return found;
}

const documentElement = new El('html');
const body = new El('body');
documentElement.appendChild(body);

global.document = {
  documentElement, body,
  createElement: t => new El(t),
  createElementNS: (ns, t) => new El(t),
  getElementById: id => byId(documentElement, id),
  querySelector: s => documentElement.querySelector(s),
  querySelectorAll: s => documentElement.querySelectorAll(s)
};
global.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, ResizeObserver: null };
global.getComputedStyle = () => ({
  getPropertyValue: () => '',
  paddingLeft: '20px', paddingRight: '20px', paddingTop: '20px'
});

let rafQueue = null;
global.requestAnimationFrame = cb => { rafQueue = cb; return 1; };
function pump(n) {
  n = n || 1;
  while (n-- > 0 && rafQueue) { const cb = rafQueue; rafQueue = null; cb(); }
}

/* ── stage markup, matching screen-2-timeline.html ────────────────── */
function mk(cls, id, parent, w, h) {
  const e = new El('div');
  if (cls) e.className = cls;
  if (id) e.attrs.id = id;
  if (w != null) e.clientWidth = w;
  if (h != null) e.clientHeight = h;
  (parent || body).appendChild(e);
  return e;
}
const STAGE_W = 1100;
const stage = mk('tl-stage', 'tl-stage', body, STAGE_W, 400);
mk('tl-cloud', 'tl-cloud', stage, STAGE_W, 240);
mk('tl-plot', 'tl-plot', stage, STAGE_W, 78);
mk('tl-scale', 'tl-scale', stage, STAGE_W, 24);
const rail = mk('tl-info', 'tl-info', body, 44, 400);
mk('tl-info-tab', 'tl-info-tab', rail, 44, 400);
const panel = mk('tl-info-panel', 'tl-info-panel', rail, 296, 400);
mk('tl-info-close', 'tl-info-close', panel);
mk('tl-info-body', 'tl-info-body', panel);

/* ── load the real module ─────────────────────────────────────────── */
const src = fs.readFileSync(path.join(__dirname, 'assets', 'photo-timeline.js'), 'utf8');
new Function('window', 'document', 'requestAnimationFrame', 'getComputedStyle', src)(
  global.window, global.document, global.requestAnimationFrame, global.getComputedStyle);
const TL = global.window.TL;

/* ── boot, exactly as screen 2 does ───────────────────────────────── */
const fail = [];
let checks = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) fail.push(name + (extra ? ' → ' + extra : ''));
  console.log((cond ? '  ok    ' : '  FAIL  ') + name + (extra ? '   ' + extra : ''));
}

TL.initTheme();
TL.setDataset(TL.placeholderPhotos(), { kind: 'placeholder', label: 'sample record', illustrative: true });

let frame = null, selected = null;
const tl = TL.initTimeline({
  stage,
  onFrame: f => { frame = f; },
  onSelect: p => { selected = p; }
});
const info = TL.initInfoPanel({ onClose: () => tl.close() });

const thumbs = stage.querySelectorAll('.tl-thumb');
const settled = () => { for (let i = 0; i < 60; i++) pump(1); };

/* ── 1. it renders ────────────────────────────────────────────────── */
console.log('\n1. renders the cloud');
check('every record got a thumbnail', thumbs.length === 219, thumbs.length + ' thumbs');
check('every thumbnail was positioned', thumbs.filter(t => t.style.transform).length === 219);
check('collapsed photos are the 20px square', new Set(thumbs.map(t => t.style.height)).has('20.0px'));
check('the frame callback reports a live sigma', !!frame && frame.sigma > 0, frame ? 'σ ' + frame.sigma.toFixed(1) + 'd, ' + frame.open + ' open' : 'none');

/* ── 2. the axis is alive ─────────────────────────────────────────── */
console.log('\n2. the axis is alive end to end');
let dead = 0, maxOpen = 0, maxDistinct = 0;
const lo = Math.min.apply(null, TL.placeholderPhotos().map(p => p.day));
for (let d = lo; d < lo + 2200; d++) {
  tl.setTarget(d); pump(1);
  if (!frame || frame.open === 0) dead++;
  if (frame && frame.open > maxOpen) maxOpen = frame.open;
  const n = new Set(thumbs.filter(t => parseFloat(t.style.height) > 20.1).map(t => t.style.height)).size;
  if (n > maxDistinct) maxDistinct = n;
}
check('no position leaves the cloud dead', dead === 0, dead + ' dead of 2200');
check('busiest focus opens a real cluster', maxOpen >= 6, 'peak ' + maxOpen + ' open');
check('thumbnails take a range of sizes', maxDistinct >= 4, maxDistinct + ' distinct sizes at peak');

/* ── 3. geometry stays inside the stage ───────────────────────────── */
console.log('\n3. geometry');
tl.setTarget(lo + 1000); settled();
let outside = 0, negative = 0;
for (const t of thumbs) {
  const b = t._box; if (!b) continue;
  if (b[0] < -1 || b[0] + b[2] > STAGE_W + 1) outside++;
  if (b[1] < -1) negative++;
}
check('nothing overflows the cloud horizontally', outside === 0, outside + ' outside');
check('nothing overflows the cloud vertically', negative === 0, negative + ' above the top');

/* ── 4. wheel travels the timeline ────────────────────────────────── */
console.log('\n4. scroll moves the focus');
const w0 = tl.focus;
stage.dispatch('wheel', { deltaX: 0, deltaY: 120, shiftKey: false });
settled();
const w1 = tl.focus;
check('wheel advances the focus', w1 > w0, (w1 - w0).toFixed(1) + ' days');
const w1s = tl.focus;
stage.dispatch('wheel', { deltaX: 0, deltaY: 120, shiftKey: true });
settled();
const w2 = tl.focus;
check('shift + wheel is a finer step', Math.abs(w2 - w1s) < Math.abs(w1 - w0), Math.abs(w2 - w1s).toFixed(1) + ' vs ' + Math.abs(w1 - w0).toFixed(1) + ' days');
stage.dispatch('wheel', { deltaX: 0, deltaY: -120, shiftKey: false });
settled();
const back = w2 - (w1 - w0);
check('scroll back returns', Math.abs(tl.focus - back) < 1.5, tl.focus.toFixed(1) + ' vs ' + back.toFixed(1));

/* ── 5. drag travels, click selects ───────────────────────────────── */
console.log('\n5. drag and click are separate gestures');
const k0 = tl.focus;
stage.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 500, clientY: 300 });
stage.dispatch('pointermove', { button: 0, pointerId: 1, clientX: 700, clientY: 300 });
stage.dispatch('pointerup', { button: 0, pointerId: 1, clientX: 700, clientY: 300 });
settled();
check('a drag moves the focus', Math.abs(tl.focus - k0) > 5, (tl.focus - k0).toFixed(1) + ' days');
check('a drag does not select a photo', selected === null);

tl.setTarget(lo + 1000); settled();
const big = thumbs.filter(t => t._box && t._box[2] > 40).sort((a, b) => b._box[2] - a._box[2])[0];
const bx = big._box[0] + big._box[2] / 2, by = big._box[1] + big._box[3] / 2;
const bcx = bx;
const f0 = tl.focus;
stage.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: bx, clientY: by });
stage.dispatch('pointerup', { button: 0, pointerId: 2, clientX: bx + 1, clientY: by });
const selEl = thumbs.find(t => t.classList.contains('is-sel'));
const bcx0 = selEl._box[0] + selEl._box[2] / 2;
settled();
check('a click selects the photo under it', !!selected, selected ? selected.day + '' : 'nothing selected');
check('a click does not move the focus', Math.abs(tl.focus - f0) < 0.01);
check('the record panel received the record', info.isOpen() || !!selected);
const scx = selEl._box[0] + selEl._box[2] / 2;
check('the selected record expands', selEl._box[2] > 40, selEl._box[2].toFixed(0) + 'px wide');
check('the selected record moves toward the centre', Math.abs(scx - STAGE_W / 2) < Math.abs(bcx0 - STAGE_W / 2) * 0.6, scx.toFixed(0) + ' of ' + STAGE_W / 2);

stage.dispatch('keydown', { key: 'Escape' });
settled();
check('escape clears the selection', selected === null);

/* ── 6. keyboard ──────────────────────────────────────────────────── */
console.log('\n6. keyboard');
const k1 = tl.focus;
stage.dispatch('keydown', { key: 'ArrowRight' }); settled();
check('arrow right advances one day', Math.abs(tl.focus - k1 - 1) < 0.01, (tl.focus - k1).toFixed(2) + ' days');
stage.dispatch('keydown', { key: 'PageDown' }); settled();
check('page down advances a week', Math.abs(tl.focus - k1 - 8) < 0.01, (tl.focus - k1).toFixed(2) + ' days');
stage.dispatch('keydown', { key: 'Home' }); settled();
const home = tl.focus;
stage.dispatch('keydown', { key: 'End' }); settled();
check('home and end reach the archive ends', tl.focus > home + 2000, home.toFixed(0) + ' → ' + tl.focus.toFixed(0));

/* ── 7. record panel ──────────────────────────────────────────────── */
console.log('\n7. record panel');
check('collapsed by default', !info.isOpen());
info.setOpen(true);
check('the tab opens it', info.isOpen());
const tab = byId(documentElement, 'tl-info-tab');
tab.dispatch('click', {}); check('the tab closes it again', !info.isOpen());
let threw = null;
try { info.show({ day: 12345, pi: 3, name: 'x.jpg' }); } catch (e) { threw = e.message; }
check('renders a record without throwing', !threw, threw || '');

/* ── 8. theme ─────────────────────────────────────────────────────── */
console.log('\n8. theme');
TL.initTheme();
check('theme is applied to the document', !!documentElement.getAttribute('data-theme'), documentElement.getAttribute('data-theme'));

/* ── result ───────────────────────────────────────────────────────── */
console.log('\n' + (fail.length
  ? '✗ ' + fail.length + ' of ' + checks + ' checks FAILED:\n   - ' + fail.join('\n   - ')
  : '✓ all ' + checks + ' checks passed'));
process.exit(fail.length ? 1 : 0);
