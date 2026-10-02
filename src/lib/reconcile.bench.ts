/* Throughput of date reconciliation, which runs on every timeline load and
 * again on every toggle of the corrected-dates control.
 *
 * The cost is not driven by the burst count but by the number of bursts that
 * get *past* the uniformity check, because only those reach the per-burst tally
 * over the rest of the archive. A burst whose photos disagree about their file
 * date is abandoned immediately, which is why a benchmark that just varies the
 * burst count mostly measures how many bursts happened to bail out early.
 *
 * So `uniformShare` sets the fraction of bursts that are deliberately uniform
 * and therefore all reach the expensive path. Two shapes matter:
 *
 *   - a synced library, where most photos carry one shared copy date, and
 *   - a mis-dated library, where whole shoots are uniform because a camera
 *     clock was never reset.
 *
 * Both are the archives the copy-date guard was written against, and both make
 * it do real work rather than return `null` immediately. */

import { bench, describe } from 'vitest';
import type { ReconcileInput } from './reconcile.js';
import { MIN_SHIFT_DAYS, reconcileDates } from './reconcile.js';

const DAY = 86400000;

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
 * `photoCount` photos in `bursts` shoots, each shoot on its own EXIF day and
 * spaced far enough apart that no two merge into one burst. `uniformShare` of
 * the shoots have every photo on a single file date -- the ones that get past
 * the uniformity check.
 *
 * A uniform shoot's file date is always late enough to clear MIN_SHIFT_DAYS, so
 * it clears every cheap gate and reaches the expensive tally. That is
 * deliberate: a benchmark where the uniform shoots quietly fail a size or shift
 * gate would measure the bail-out path and call it the work. The expensive shape
 * is a library whose shoots were each exported separately, so each carries its
 * own uniform late file date -- which is exactly what makes the copy-date guard
 * do real work rather than return `null` at once.
 */
function archive(
  photoCount: number,
  perBurst: number,
  uniformShare: number,
  uniformSpanDays = 1,
  seed = 3,
): ReconcileInput[] {
  const rnd = mulberry32(seed);
  const startDay = Math.floor(Date.UTC(2015, 0, 1) / DAY);
  const bursts = Math.floor(photoCount / perBurst);
  /* Far enough apart that BURST_GAP_DAYS (3) never merges two shoots, so the
     burst count is exactly what was asked for. */
  const spacing = Math.max(uniformSpanDays + 1, Math.ceil((photoCount * 6) / bursts));

  const inputs: ReconcileInput[] = [];
  let made = 0;
  for (let b = 0; b < bursts && made < photoCount; b++) {
    const exifDay = startDay + b * spacing;
    const n = Math.max(1, Math.min(perBurst, photoCount - made));
    const uniform = rnd() < uniformShare;

    for (let i = 0; i < n; i++) {
      /* A uniform shoot shares one file date; a varied one gives each photo
         its own, plus an occasional date-less file. */
      const fileDay = uniform
        ? exifDay + MIN_SHIFT_DAYS + 60 + b
        : (rnd() < 0.1 ? null : startDay + Math.floor(rnd() * spacing * bursts));
      /* Spreading a uniform shoot over several EXIF days is what lets it clear
         the "a one-day burst must prove its size" gate as well, which is the
         only way to reach the per-burst tally over the archive at all. */
      const day = uniformSpanDays > 1 ? exifDay + (i % uniformSpanDays) : exifDay;
      inputs.push({ exifDay: day, fileDay });
      made++;
    }
  }
  return inputs;
}

/* What decides whether a burst ever reaches the expensive per-burst tally is
 * the burst's own shape, so the cases are named by it:
 *
 *   perBurst 1   too small for MIN_BURST_PHOTOS, bails on size
 *   perBurst 2   same
 *   perBurst 5, one EXIF day   big enough, but a single day below
 *                              MIN_SINGLE_DAY_PHOTOS, bails on size
 *   perBurst 5, three EXIF days  clears every gate -> reaches the tally
 *
 * Only the last row is the shape worth optimising, and it is the one a library
 * of separately exported multi-day shoots actually has. */
const CASES: ReadonlyArray<readonly [string, ReconcileInput[]]> = [
  ['700 photos, 5/shoot, mixed file dates (bails: not uniform)', archive(700, 5, 0)],
  ['700 photos, 5/shoot, uniform, one EXIF day (bails: size)', archive(700, 5, 1, 1)],
  ['700 photos, 5/shoot, uniform, three EXIF days (reaches tally)', archive(700, 5, 1, 3)],
  ['700 photos, 2/shoot, uniform, three EXIF days (bails: size)', archive(700, 2, 1, 3)],
  ['700 photos, 1/shoot, uniform (bails: size)', archive(700, 1, 1, 1)],
  ['2000 photos, 5/shoot, uniform, three EXIF days (reaches tally)', archive(2000, 5, 1, 3)],
  ['2000 photos, 10/shoot, uniform, three EXIF days (reaches tally)', archive(2000, 10, 1, 3)],
  ['2000 photos, 5/shoot, uniform, three EXIF days, half uniform', archive(2000, 5, 0.5, 3)],
];

describe('reconcileDates', () => {
  for (const [label, inputs] of CASES) {
    bench(label, () => {
      reconcileDates(inputs);
    });
  }
});