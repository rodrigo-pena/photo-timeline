import type { Dataset, PhotoDay } from './types.js';

export const PHI = 1.2;
export const SIGMA_MIN = 1.4;
export const DEAD = 0.045;
export const SCROLL_GAIN = 0.32;
export const FINE_GAIN = 0.22;

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
): PhotoLayout[] {
  const { days, minDay, numDays } = state;
  const pad = 10;
  const span = Math.max(1, width - pad * 2);
  const sigma = sigmaAt(state, focus);

  const layouts: PhotoLayout[] = [];
  const groupInfos: { e: number; tn: number; size: number; pitch: number; fanHalf: number }[] = [];

  for (let gi = 0; gi < days.length; gi++) {
    const d = focus - days[gi].day;
    const e = Math.exp(-(d * d) / (2 * sigma * sigma));
    const tn = opennessFromExp(e);
    const size = minSize + tn * (maxSize - minSize);
    const pitch = Math.min(1180 / days[gi].photos.length, Math.max(size + 12, 30 + tn * (pitchMax - 30)));
    const fanHalf = ((days[gi].photos.length - 1) / 2) * pitch + size / 2;
    groupInfos.push({ e, tn, size, pitch, fanHalf });
  }

  const fx = pad + ((focus - minDay) / numDays) * span;
  const roomL = Math.max(0, fx - pad - 34);
  const roomR = Math.max(0, pad + span - fx - 34);

  let photoIndex = 0;
  for (let gi = 0; gi < days.length; gi++) {
    const info = groupInfos[gi];
    const group = days[gi];

    for (let k = 0; k < group.photos.length; k++) {
      const d = focus - group.day;
      let x = pad + ((group.day - minDay) / numDays) * span + (k - (group.photos.length - 1) / 2) * info.pitch;

      let pushMag = 0;
      if (Math.abs(d) >= 0.5) {
        pushMag = Math.min(
          (info.fanHalf + 16 + Math.abs(d) * 20) * clamp(info.e / 0.4, 0, 1),
          300,
          roomL,
          roomR,
        );
      }

      x = clamp(x + (d < 0 ? -1 : d > 0 ? 1 : 0) * pushMag, pad + info.size / 2, pad + span - info.size / 2);
      const y = cloudHeight - (4 + (k % 5) * (info.tn < 0.02 ? 58 : 20)) - info.tn * 14;

      layouts.push({
        x,
        y,
        w: info.size,
        h: info.size,
        z: 1 + Math.round(info.tn * 100),
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
