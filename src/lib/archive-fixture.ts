/* Test-only synthetic archives. Not imported by either bundle entry point —
   `main.ts` and `timeline.ts` never reach this file, so it ships in neither
   build; it exists so a benchmark and a correctness test can argue about the
   same archive.

   The shape matters more than the exact numbers. A real library is shoots, not
   an even scatter: a few days hold a dozen photos, most days hold nothing, and
   the archive runs across years. Even scatter would make `packDay` cheap and
   flatter every block, so the fixture keeps the day-count distribution uneven
   and mixes aspect ratios rather than assuming 3:2 throughout — the clamped
   aspect and `heightFactor` both behave differently for portraits, squares and
   panoramas, and a benchmark that only ever sees landscapes would miss it. */

import type { Dataset, PhotoDay, PhotoRecord } from './types.js';

const DAY = 86400000;
const START_DAY = Math.floor(Date.UTC(2015, 0, 1) / DAY);
/** ~5.5 years. Held constant across sizes so a benchmark at 10 000 photos
 *  measures the same geometry as one at 320 and only the photo count varies. */
const SPAN_DAYS = 2000;
/** Shoots rather than photos: the unit a real archive clusters into. */
const SHOOTS = 140;

/** Landscape, portrait, square and one mild panorama, at plausible camera
 *  resolutions. `aspect` is clamped by the engine at 0.45 and 1/0.45, so the
 *  entries below cover both ends of that range without exceeding it. */
const SHAPES: ReadonlyArray<readonly [number, number]> = [
  [4000, 3000],
  [3000, 2000],
  [4032, 3024],
  [2000, 3000],
  [3000, 4000],
  [5472, 3648],
  [3648, 5472],
  [4000, 4000],
  [1080, 1080],
  [2560, 1080],
];

/** Deterministic PRNG, so two runs of the benchmark are comparable and a
 *  failure is reproducible. Not `Math.random`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds an archive of exactly `photoCount` photos across `SHOOTS` shoots
 * spread over `SPAN_DAYS`. Shoot sizes are uneven — weighted toward small
 * shoots with a long tail of big ones — and shoot days are scattered rather
 * than evenly spaced, so clustering and quiet stretches both appear.
 */
export function makeArchive(photoCount: number, seed = 1): Dataset {
  const rnd = mulberry32(seed);

  const weights = Array.from({ length: SHOOTS }, () => 0.3 + rnd() * rnd() * 3);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(1, Math.round((photoCount * w) / weightSum)));

  /* Land on exactly `photoCount`. Adjusting the largest first keeps the tail of
     uneven sizes instead of flattening them all to the mean. */
  let total = counts.reduce((a, b) => a + b, 0);
  while (total > photoCount) {
    let big = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] > counts[big]) big = i;
    counts[big]--;
    total--;
  }
  while (total < photoCount) {
    counts[(rnd() * counts.length) | 0]++;
    total++;
  }

  const shootDays = Array.from({ length: SHOOTS }, () => (rnd() * SPAN_DAYS) | 0).sort((a, b) => a - b);

  const days: PhotoDay[] = [];
  const photos: PhotoRecord[] = [];
  let made = 0;

  for (let s = 0; s < SHOOTS; s++) {
    const n = counts[s];
    const day = START_DAY + shootDays[s];
    const group: PhotoRecord[] = [];
    for (let i = 0; i < n; i++) {
      const shape = SHAPES[(rnd() * SHAPES.length) | 0];
      const photo: PhotoRecord = {
        id: `p${made}`,
        blob: new Blob(),
        name: `IMG_${String(made).padStart(5, '0')}.jpg`,
        date: day,
        width: shape[0],
        height: shape[1],
      };
      group.push(photo);
      photos.push(photo);
      made++;
    }
    days.push({ day, photos: group });
  }

  return {
    photos,
    days,
    minDay: days[0].day,
    maxDay: days[days.length - 1].day,
    skippedCount: 0,
    shiftedCount: 0,
  };
}

/** The sizes the timeline was reported sluggish at, plus headroom, so a
 *  regression shows up as a number rather than a feeling. */
export const BENCH_SIZES = [320, 700, 2000, 10000] as const;

/** Focus values walking the archive end to end. A benchmark that only ever
 *  measured one focus would miss everything that varies with `sigma`. */
export function focusSweep(minDay: number, maxDay: number, steps = 48): number[] {
  return Array.from({ length: steps }, (_, i) => minDay + ((maxDay - minDay) * i) / (steps - 1));
}