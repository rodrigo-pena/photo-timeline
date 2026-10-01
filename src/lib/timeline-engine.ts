import type { Dataset, PhotoDay } from './types.js';

export const PHI = 1.2;
export const SIGMA_MIN = 1.4;
export const DEAD = 0.045;
export const SCROLL_GAIN = 0.32;
export const FINE_GAIN = 0.22;

/* Cluster packing. A day owns a block of cards centred on the day's x: the
   block fans out horizontally by at most `fan`, and whatever does not fit
   sideways stacks upward. These ratios are how much of a card its neighbor
   covers — tightly closed, a far-off day shingles into a thin column; open,
   the same day opens into a table where every photo is legible. */
export const PITCH_RATIO = 0.82;
export const ROW_RATIO = 0.72;
/** How much of the cell an open day's card fills: a little overlap, so a block
 *  still reads as cards on a table rather than a spreadsheet. */
export const OPEN_OVERLAP_X = 0.95;
export const OPEN_OVERLAP_Y = 0.92;
export const BOTTOM_INSET = 4;
export const MIN_SHORT_EDGE_RATIO = 0.45;
/** Past this a "photo" is a panorama; it would be a card wider than the plot. */
export const MAX_ASPECT_RATIO = 1 / MIN_SHORT_EDGE_RATIO;
/** Enough to read as a tossed deck, little enough to keep the stack legible. */
export const MAX_TILT_DEG = 2;
/** An open day is cards on a table rather than a stack of cards. */
export const OPEN_TILT_DEG = 12;
export const MAX_NUDGE_PX = 1.5;
/** Cap on the columns considered when choosing an arrangement. */
const MAX_COLS = 24;
/* Jitter is what makes a block look thrown rather than laid out. It is capped
   at this fraction of the card size, and again at the slack the arrangement
   left, and again at the gap that keeps neighboring centres at least
   MIN_CENTRE_GAP of a card apart. That last cap is the guarantee: within an
   open day no card can cover another's centre — and the centre is what you
   click. */
const JITTER_RATIO = 0.22;
const JITTER_Y_RATIO = 0.7;
const MIN_CENTRE_GAP = 0.6;

export interface CloudConfig {
  minSize: number;
  maxSize: number;
  /** Ceiling on a closed day's block width, as a fraction of the plot. */
  fanFrac: number;
  /** Widest a fully open day's block may get, as a fraction of the plot. */
  fanOpen: number;
  /** Ceiling on a closed day's block half-width, in days. */
  fanDays: number;
}

export interface EngineState {
  focus: number;
  target: number;
  days: PhotoDay[];
  minDay: number;
  maxDay: number;
  numDays: number;
  sigmaMax: number;
}

export interface PhotoLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  o: number;
  day: number;
  groupIndex: number;
  photoIndex: number;
  /** Rotation in degrees. Zero until the deck gets its tilt. */
  rot: number;
}

/** Plot-wide facts every day's block is measured against. */
interface Geometry {
  span: number;
  pxPerDay: number;
  /** y of the ground line the blocks stack up from. */
  baseline: number;
  availH: number;
}

/* A day's block: how its cards are laid out around the day's x. */
interface DayBlock {
  tn: number;
  size: number;
  cols: number;
  pitch: number;
  rowH: number;
  /** 0 closed, 1 fully open: how far the day has bloomed out of its column. */
  spread: number;
  /** How far a card may lean, in degrees, and how far it may wander, in px. */
  tilt: number;
  jitterX: number;
  jitterY: number;
}

/* Rows are ordered front to back within a day, so the layer stride has to be
   larger than the deepest row we can ever draw — then day order and row order
   can never fight each other. */
const LAYER_STRIDE = 64;
const SELECTED_Z = 1000000;

export function createEngine(dataset: Dataset): EngineState {
  const days = dataset.days;
  const minDay = dataset.minDay;
  const maxDay = dataset.maxDay;
  const numDays = Math.max(2, maxDay - minDay + 50);
  const sigmaMax = clamp(0.03 * (maxDay - minDay), 25, 400);

  const initialFocus = days.length > 0 ? days[0].day : minDay;

  return {
    focus: initialFocus,
    target: initialFocus,
    days,
    minDay,
    maxDay,
    numDays,
    sigmaMax,
  };
}

export function localGap(state: EngineState, focus: number): number {
  const days = state.days;
  if (days.length === 0) return state.sigmaMax;

  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid].day < focus) lo = mid + 1;
    else hi = mid - 1;
  }

  let best = Infinity;
  if (lo < days.length) {
    const a = Math.abs(days[lo].day - focus);
    if (a > 0.0001 && a < best) best = a;
  }
  if (hi >= 0) {
    const b = Math.abs(days[hi].day - focus);
    if (b > 0.0001 && b < best) best = b;
  }
  if (best === Infinity) best = Math.max(SIGMA_MIN, state.numDays * 0.1);
  return best;
}

export function sigmaAt(state: EngineState, focus: number): number {
  return clamp(localGap(state, focus) / PHI, SIGMA_MIN, state.sigmaMax);
}

export function opennessFromExp(e: number): number {
  return clamp((e - DEAD) / (1 - DEAD), 0, 1);
}

/**
 * Packs one day's photos into a block centred on the day's x.
 *
 * How open the day is decides how much room the block gets. A closed day keeps
 * a narrow budget and its cards shingle on a square cell, so a distant cluster
 * stays the thin column it has always been. An open day is given a budget of
 * up to `fanOpen` of the plot and cells that reserve each card's own box, so
 * the photos open out across the table and none of them hides another.
 *
 * The arrangement is chosen, not assumed: every column count is tried and the
 * one that makes the cards largest wins. Because the size comes from the cell,
 * the block is guaranteed to fit the budget in both directions — no card can be
 * pushed off its date to make room.
 *
 * `aspect` is how wide the day's widest card is relative to its scale and
 * `vFactor` how tall its tallest is; the cell has to reserve both.
 */
function packDay(
  count: number,
  tn: number,
  aspect: number,
  vFactor: number,
  cfg: CloudConfig,
  geom: Geometry,
): DayBlock {
  const { span, pxPerDay, availH } = geom;
  const spread = smoothstep(tn);

  /* The kernel's scale is the ceiling; the block only ever wants less. */
  const kernel = cfg.minSize + tn * (cfg.maxSize - cfg.minSize);

  const fanClosed = Math.min(
    Math.max(pxPerDay * cfg.fanDays, 2 * kernel),
    span * cfg.fanFrac,
  );
  const fanOpen = span * cfg.fanOpen;
  const fan = fanClosed + (fanOpen - fanClosed) * spread;

  /* How much room one card's cell claims per unit of card size. */
  const cellW = lerp(PITCH_RATIO, aspect / OPEN_OVERLAP_X, spread);
  const cellH = lerp(ROW_RATIO, vFactor / OPEN_OVERLAP_Y, spread);

  const maxCols = Math.min(count, MAX_COLS);
  let size = 0;
  let cols = 1;
  for (let c = 1; c <= maxCols; c++) {
    const rows = Math.ceil(count / c);
    const s = Math.min(kernel, (fan / c) / cellW, (availH / rows) / cellH);
    /* Ties go to the wider block: a day of two photos lying side by side reads
       better than two stacked. */
    if (s >= size) {
      size = s;
      cols = c;
    }
  }

  const rows = Math.ceil(count / cols);
  const pitch = size * cellW;
  const rowH = size * cellH;

  /* The wobble may only spend room the arrangement actually left: the slack
     inside the block's budget, and — so that neighbors cannot close on each
     other — the gap that keeps them this far apart. That second cap is what
     makes the block readable: no card can end up covering another card's
     centre, and a centre is always there to click. */
  const slackX = (fan - ((cols - 1) * pitch + size * aspect)) / 2;
  const slackY = (availH - ((rows - 1) * rowH + size * vFactor)) / 2;
  const gapX = (pitch - MIN_CENTRE_GAP * aspect * size - 2 * MAX_NUDGE_PX) / 2;
  const gapY = (rowH - MIN_CENTRE_GAP * vFactor * size) / 2;

  return {
    tn,
    size,
    cols,
    pitch,
    rowH,
    spread,
    tilt: lerp(MAX_TILT_DEG, OPEN_TILT_DEG, spread),
    jitterX: Math.max(0, Math.min(JITTER_RATIO * size, slackX, gapX)) * spread,
    jitterY: Math.max(0, Math.min(JITTER_RATIO * size * JITTER_Y_RATIO, slackY, gapY)) * spread,
  };
}

/** How wide a card of this aspect comes out relative to its scale. */
function widthFactor(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return clamp(width / height, MIN_SHORT_EDGE_RATIO, MAX_ASPECT_RATIO);
}

/** How tall a card of this aspect comes out relative to its scale. */
function heightFactor(width: number, height: number): number {
  const aspect = widthFactor(width, height);
  return aspect >= 1 ? 1 : 1 / Math.sqrt(aspect);
}

/** Stable 0…1 from an index — no Math.random, so nothing shimmers per frame. */
function pseudoRandom(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function computeLayout(
  state: EngineState,
  focus: number,
  width: number,
  cloudHeight: number,
  cfg: CloudConfig,
  selectedIndex: number | null,
  dpr: number,
): PhotoLayout[] {
  const { days, numDays } = state;
  const pad = 10;
  const span = Math.max(1, width - pad * 2);
  const sigma = sigmaAt(state, focus);
  const geom: Geometry = {
    span,
    pxPerDay: span / numDays,
    baseline: cloudHeight - BOTTOM_INSET,
    availH: cloudHeight - BOTTOM_INSET,
  };

  const layouts: PhotoLayout[] = [];
  const centerX = pad + span / 2;
  const baseline = geom.baseline;

  /* Openness drives both the card scale and its layer: a day nearer the focus
     is bigger and sits in front of every day further away. */
  const blocks: DayBlock[] = [];
  for (let gi = 0; gi < days.length; gi++) {
    const group = days[gi];
    const d = focus - group.day;
    const e = Math.exp(-(d * d) / (2 * sigma * sigma));
    let aspect = 1;
    let vFactor = 1;
    for (const p of group.photos) {
      aspect = Math.max(aspect, widthFactor(p.width, p.height));
      vFactor = Math.max(vFactor, heightFactor(p.width, p.height));
    }
    blocks.push(packDay(group.photos.length, opennessFromExp(e), aspect, vFactor, cfg, geom));
  }

  /* The flattened walk over `days` is the single ordering authority for the
     cloud: layout i belongs to the i-th photo of `days`, so a card's position
     and the photo drawn into it can never come from different arrays. */
  let photoIndex = 0;
  for (let gi = 0; gi < days.length; gi++) {
    const block = blocks[gi];
    const group = days[gi];
    const dayX = pixelAtDay(state, group.day, width);
    const layer = Math.round(block.tn * 2000) * LAYER_STRIDE;

    /* Whole blocks shift at the edges rather than each card, so a day near the
       end of the axis keeps its shape instead of collapsing into a pile. */
    const half = (block.cols - 1) * block.pitch / 2;
    let dx = 0;
    if (dayX - half < pad) dx = pad - (dayX - half);
    else if (dayX + half > pad + span) dx = pad + span - (dayX + half);

    for (let k = 0; k < group.photos.length; k++) {
      const col = k % block.cols;
      const row = Math.floor(k / block.cols);

      /* A deterministic per-photo wobble, so the block reads as a deck thrown
         on a table rather than a grid. Keyed off the stable index, so a card
         never twitches while the focus is animating, and scaled by how open the
         day is: a closed day keeps the hairline nudge it has always had. */
      const lean = (pseudoRandom(photoIndex) - 0.5) * 2 * block.tilt;
      const wanderX = MAX_NUDGE_PX + block.jitterX;
      const jitterX = (pseudoRandom(photoIndex + 0.5) - 0.5) * 2 * wanderX;
      /* Upward only: a card on the ground can lift off it, never sink through. */
      const jitterY = pseudoRandom(photoIndex + 0.25) * block.jitterY;

      const x = dayX + dx + (col - (block.cols - 1) / 2) * block.pitch + jitterX;
      const y = baseline - row * block.rowH - jitterY;

      const photo = group.photos[k];
      const aspect = photo && photo.width > 0 && photo.height > 0
        ? clamp(photo.width / photo.height, MIN_SHORT_EDGE_RATIO, MAX_ASPECT_RATIO)
        : 1;

      /* Area-preserving and aspect-exact: w·h = size², w/h = aspect. */
      const shortEdge = clamp(
        block.size * Math.sqrt(Math.min(aspect, 1)),
        block.size * MIN_SHORT_EDGE_RATIO,
        block.size,
      );
      const longEdge = shortEdge * Math.max(aspect, 1 / aspect);

      let w = aspect >= 1 ? longEdge : shortEdge;
      let h = aspect >= 1 ? shortEdge : longEdge;

      /* Front rows sit in front of the rows behind them, but never in front of
         a day the kernel has opened further. */
      let z = layer + (LAYER_STRIDE - 1 - Math.min(row, LAYER_STRIDE - 1));
      let targetX = x;
      let targetY = y;

      if (selectedIndex === photoIndex) {
        const margin = 24;
        const maxH = cloudHeight - margin * 2;
        const maxW = width - margin * 2;

        if (aspect >= 1) {
          w = maxW;
          h = w / aspect;
          if (h > maxH) {
            h = maxH;
            w = h * aspect;
          }
        } else {
          h = maxH;
          w = h * aspect;
          if (w > maxW) {
            w = maxW;
            h = w / aspect;
          }
        }

        /* Never upscale past the source's own pixels, so the blow-up stays
           sharp: cap at native / dpr (1 image pixel per device pixel). */
        if (photo && photo.width > 0 && photo.height > 0) {
          const scale = Math.min(1, photo.width / dpr / w, photo.height / dpr / h);
          w *= scale;
          h *= scale;
        }

        targetX = centerX;
        targetY = cloudHeight / 2 + h / 2;
        z = SELECTED_Z;
      }

      const cx = clamp(targetX, pad + w / 2, pad + span - w / 2);
      const cy = targetY;

      layouts.push({
        x: cx,
        y: cy,
        w,
        h,
        z,
        o: block.tn,
        day: group.day,
        groupIndex: gi,
        photoIndex: photoIndex++,
        rot: lean,
      });
    }
  }

  return layouts;
}

export function dayAtPixel(state: EngineState, px: number, width: number): number {
  const pad = 10;
  const span = Math.max(1, width - pad * 2);
  const clamped = clamp(px, pad, pad + span);
  return state.minDay + ((clamped - pad) / span) * state.numDays;
}

export function pixelAtDay(state: EngineState, day: number, width: number): number {
  const pad = 10;
  const span = Math.max(1, width - pad * 2);
  return pad + ((day - state.minDay) / state.numDays) * span;
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
