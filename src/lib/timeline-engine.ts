import type { Dataset, PhotoDay } from './types.js';

export const PHI = 1.2;
export const SIGMA_MIN = 1.4;
export const DEAD = 0.045;
export const SCROLL_GAIN = 0.32;
export const FINE_GAIN = 0.22;

/* Cluster packing. A day owns a block of cards centred on the day's x: the
   block fans out horizontally by at most `fan`, and whatever does not fit
   sideways stacks upward. These two ratios are the only things that decide how
   much a card peeks out from behind its neighbours. */
export const PITCH_RATIO = 0.82;
export const ROW_RATIO = 0.72;
export const BOTTOM_INSET = 4;
export const MIN_SHORT_EDGE_RATIO = 0.45;
/** Past this a "photo" is a panorama; it would be a card wider than the plot. */
export const MAX_ASPECT_RATIO = 1 / MIN_SHORT_EDGE_RATIO;

export interface CloudConfig {
  minSize: number;
  maxSize: number;
  /** Widest a single day's block may get, as a fraction of the plot width. */
  fanFrac: number;
  /** Hard ceiling on the block's half-width, in days. */
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
 * The block fans out sideways only as far as `fan` allows and stacks upward for
 * the rest, so a day with forty photos grows a column directly above its date
 * instead of being scattered along the axis. `fan` is floored at two card
 * widths (small cards need a little room to be told apart) and capped both by
 * a fraction of the plot and by a hard number of days, so a card can never
 * drift so far from its date that it reads as belonging to another one.
 *
 * `vFactor` is how tall the day's tallest card is relative to its scale — the
 * packing has to know it to make the stack fit the plot rather than run off
 * the top of it.
 */
function packDay(count: number, tn: number, vFactor: number, cfg: CloudConfig, geom: Geometry): DayBlock {
  const { span, pxPerDay, availH } = geom;
  const size = cfg.minSize + tn * (cfg.maxSize - cfg.minSize);

  /* Two card widths is the floor — small cards need a little room to be told
     apart — and the plot fraction is the hard ceiling, so a block can never
     grow past its budget no matter how open its day is. */
  const fan = Math.min(Math.max(pxPerDay * cfg.fanDays, 2 * size), span * cfg.fanFrac);

  /* Rows we could ever show at the smallest allowed card. */
  const maxRows = Math.max(1, Math.floor(availH / (cfg.minSize * ROW_RATIO)));
  const colsByFan = Math.max(1, Math.floor(fan / (size * PITCH_RATIO)));

  /* Fan out to use the budget, widening past it only when the height would
     otherwise force an absurd number of rows. */
  const cols = Math.min(count, Math.max(colsByFan, Math.ceil(count / maxRows)));
  const rows = Math.ceil(count / cols);

  const cardH = size * vFactor;
  const pitch = cols > 1 ? Math.min(size * PITCH_RATIO, fan / cols) : 0;
  const rowH = rows > 1
    ? Math.max(0.5, Math.min(size * ROW_RATIO, (availH - cardH) / (rows - 1)))
    : size * ROW_RATIO;

  return { tn, size, cols, pitch, rowH };
}

/** How tall a card of this aspect comes out relative to its scale. */
function heightFactor(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const aspect = clamp(width / height, MIN_SHORT_EDGE_RATIO, MAX_ASPECT_RATIO);
  return aspect >= 1 ? 1 : 1 / Math.sqrt(aspect);
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
    let vFactor = 1;
    for (const p of group.photos) {
      vFactor = Math.max(vFactor, heightFactor(p.width, p.height));
    }
    blocks.push(packDay(group.photos.length, opennessFromExp(e), vFactor, cfg, geom));
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

      const x = dayX + dx + (col - (block.cols - 1) / 2) * block.pitch;
      const y = baseline - row * block.rowH;

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
        rot: 0,
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
