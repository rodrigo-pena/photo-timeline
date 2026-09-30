import type { Dataset, PhotoDay } from './types.js';

export const PHI = 1.2;
export const SIGMA_MIN = 1.4;
export const DEAD = 0.045;
export const SCROLL_GAIN = 0.32;
export const FINE_GAIN = 0.22;

const FIXED_OFFSET = 24;

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
}

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

export function computeLayout(
  state: EngineState,
  focus: number,
  width: number,
  cloudHeight: number,
  minSize: number,
  maxSize: number,
  pitchMax: number,
  selectedIndex: number | null,
  dpr: number,
): PhotoLayout[] {
  const { days, minDay, numDays } = state;
  const pad = 10;
  const span = Math.max(1, width - pad * 2);
  const sigma = sigmaAt(state, focus);

  const layouts: PhotoLayout[] = [];
  const groupInfos: { e: number; tn: number; size: number; pitch: number }[] = [];

  for (let gi = 0; gi < days.length; gi++) {
    const d = focus - days[gi].day;
    const e = Math.exp(-(d * d) / (2 * sigma * sigma));
    const tn = opennessFromExp(e);
    const size = minSize + tn * (maxSize - minSize);
    const pitch = Math.min(1180 / days[gi].photos.length, Math.max(size + 12, 30 + tn * (pitchMax - 30)));
    groupInfos.push({ e, tn, size, pitch });
  }

  const centerX = pad + span / 2;

  /* The flattened walk over `days` is the single ordering authority for the
     cloud: layout i belongs to the i-th photo of `days`, so a card's position
     and the photo drawn into it can never come from different arrays. */
  let photoIndex = 0;
  for (let gi = 0; gi < days.length; gi++) {
    const info = groupInfos[gi];
    const group = days[gi];

    for (let k = 0; k < group.photos.length; k++) {
      const d = focus - group.day;
      const baseX = pad + ((group.day - minDay) / numDays) * span + (k - (group.photos.length - 1) / 2) * info.pitch;

      let x = baseX;
      if (Math.abs(d) >= 0.5) {
        const dir = d < 0 ? -1 : 1;
        x = baseX + dir * FIXED_OFFSET;
      }

      const photo = group.photos[k];
      const aspect = photo && photo.width > 0 && photo.height > 0
        ? photo.width / photo.height
        : 1;

      /* Area-preserving and aspect-exact: w·h = size², w/h = aspect. */
      const shortEdge = clamp(info.size * Math.sqrt(Math.min(aspect, 1)), info.size * 0.45, info.size);
      const longEdge = shortEdge * Math.max(aspect, 1 / aspect);

      let w = aspect >= 1 ? longEdge : shortEdge;
      let h = aspect >= 1 ? shortEdge : longEdge;

      let z = 1 + Math.round(info.tn * 100);
      let targetX = x;
      let targetY = cloudHeight - (4 + (k % 5) * (info.tn < 0.02 ? 58 : 20)) - info.tn * 14;

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
        z = 1000;
      }

      x = clamp(targetX, pad + w / 2, pad + span - w / 2);
      const y = targetY;

      layouts.push({
        x,
        y,
        w,
        h,
        z,
        o: info.tn,
        day: group.day,
        groupIndex: gi,
        photoIndex: photoIndex++,
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
