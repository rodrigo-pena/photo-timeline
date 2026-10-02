/* Throughput of the layout pass alone, with no DOM in the way. This isolates
 * what the engine costs per frame so a change to it can be judged on its own.
 * The browser-side costs — style recalc, layout, paint, image decode — need a
 * real trace and are deliberately not measured here.
 *
 * Every benchmark body is exactly one `computeLayout` call, so vitest's
 * reported hz is frames per second of layout work and nothing else. */

import { bench, describe } from 'vitest';
import { BENCH_SIZES, focusSweep, makeArchive } from './archive-fixture.js';
import type { CloudConfig, EngineState } from './timeline-engine.js';
import { computeLayout, createEngine } from './timeline-engine.js';

const WIDTH = 1232;
const HEIGHT = 800;
const DPR = 2;

const CONFIG: CloudConfig = {
  minSize: 20,
  maxSize: 190,
  fanFrac: 0.08,
  fanOpen: 0.55,
  fanDays: 120,
};

/** Runs one `computeLayout` per benchmark iteration, stepping through `focuses`
 *  so `sigma` varies the way it does while the user pans. A fixed focus would
 *  let a change hide behind a constant kernel width. */
function frameSweep(state: EngineState, selectedIndex: number | null) {
  const focuses = focusSweep(state.minDay, state.maxDay);
  let i = 0;
  return () => {
    const focus = focuses[i % focuses.length];
    i++;
    computeLayout(state, focus, WIDTH, HEIGHT, CONFIG, selectedIndex, DPR);
  };
}

describe('computeLayout', () => {
  for (const size of BENCH_SIZES) {
    const frame = frameSweep(createEngine(makeArchive(size)), null);
    bench(`${size} photos, focus sweeping the archive`, frame);
  }

  /* A selected card takes a different branch, and its day has to stay in the
     walked set however the fast path later decides which days to visit. */
  bench('700 photos, focus sweeping, one card selected', frameSweep(createEngine(makeArchive(700)), 350));

  /* The pathological day: every photo on one date, so one `packDay` block is
     the whole archive and `MAX_COLS` is the only bound on its column search. */
  const burst = makeArchive(700);
  const single = createEngine({
    ...burst,
    days: [{ day: burst.minDay, photos: burst.photos }],
    maxDay: burst.minDay,
  });
  bench('700 photos in a single day, focus on it', () => {
    computeLayout(single, single.minDay, WIDTH, HEIGHT, CONFIG, null, DPR);
  });
});