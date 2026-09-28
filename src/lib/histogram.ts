import type { PhotoDay } from './types.js';

const BINS = 220;

export interface HistogramData {
  bins: number[];
  maxCount: number;
}

export function computeHistogram(days: PhotoDay[], minDay: number, numDays: number): HistogramData {
  const bins = new Array(BINS).fill(0);

  for (const day of days) {
    const bi = Math.min(BINS - 1, Math.max(0, Math.floor(((day.day - minDay) / numDays) * BINS)));
    bins[bi] += day.photos.length;
  }

  const maxCount = Math.max(...bins, 1);
  return { bins, maxCount };
}

export function smoothHistogram(bins: number[]): number[] {
  const n = bins.length;
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = bins[Math.max(0, i - 1)];
    const curr = bins[i];
    const next = bins[Math.min(n - 1, i + 1)];
    out[i] = (prev + curr * 2 + next) / 4;
  }

  const out2 = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = out[Math.max(0, i - 1)];
    const curr = out[i];
    const next = out[Math.min(n - 1, i + 1)];
    out2[i] = (prev + curr * 2 + next) / 4;
  }

  return out2;
}

export function renderHistogram(
  svg: SVGSVGElement,
  data: HistogramData,
  width: number,
  height: number,
): void {
  const smoothed = smoothHistogram(data.bins);
  const maxVal = Math.max(...smoothed, 1);
  const step = width / BINS;

  let d = `M0,${height}`;
  for (let i = 0; i < BINS; i++) {
    const x = i * step;
    const y = height - (smoothed[i] / maxVal) * (height - 2);
    d += `L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  d += `L${width},${height}Z`;

  svg.innerHTML = `
    <path d="${d}" fill="var(--hist-fill)" stroke="none" />
  `;
}
