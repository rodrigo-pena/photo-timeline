/* ═══════════════════════════════════════════════════════════════════════
   The wobble seed cache, in a file of its own on purpose.
   ═══════════════════════════════════════════════════════════════════════

   A card's lean and its two jitters are a function of its own flat index and
   nothing else -- not the focus, not its day, not Math.random. That is the
   reason nothing twitches while the timeline moves, and it is the invariant in
   timeline-engine.test.ts that a refactor can break without failing anything
   else: the tilts stay inside MAX_TILT and the positions stay inside budget
   either way.

   `seedsFor` in the engine computes those three numbers once per dataset into a
   Float64Array, in a WeakMap keyed on the days array, which is what removed
   about 2,100 sin() calls per frame at 700 photos. This file pins that cache
   against the closed form it stands in for.

   Why a separate file, and not more tests in timeline-engine.test.ts:

   these tests only work from a *cold* cache. Every test in a file shares one
   module instance, so the first `computeLayout` to run builds the table and
   every later dataset reads it. Put them alongside the layout tests and the
   first dataset to run is the 221-photo one, so by the time these get their
   turn a wrongly-keyed cache is holding exactly the right-sized table and they
   pass anyway. Verified: a deliberately mis-keyed cache passes every test in
   timeline-engine.test.ts except the unrelated 500-photo one that happens to
   overflow.

   Vitest isolates files from each other, so here the cache really does start
   empty and the ordering below is the assertion.
   ═══════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';
import type { CloudConfig } from './timeline-engine.js';
import { MAX_TILT_DEG, computeLayout, createEngine, pseudoRandom } from './timeline-engine.js';
import type { PhotoDay, PhotoRecord } from './types.js';

const DAY = 86400000;
const BASE = Math.floor(Date.UTC(2013, 0, 1) / DAY);
const WIDTH = 1232;
const HEIGHT = 800;

const CONFIG: CloudConfig = { minSize: 20, maxSize: 190, fanFrac: 0.08, fanOpen: 0.55, fanDays: 120 };

function photo(day: number, i: number): PhotoRecord {
  return { id: `p${day}-${i}`, blob: new Blob(), name: `p${day}-${i}.jpg`, date: day, width: 3000, height: 2000 };
}

function day(count: number, offset: number): PhotoDay {
  return {
    day: BASE + offset,
    photos: Array.from({ length: count }, (_, i) => photo(BASE + offset, i)),
  };
}

function dataset(days: PhotoDay[]) {
  const sorted = [...days].sort((a, b) => a.day - b.day);
  return createEngine({
    photos: sorted.flatMap((d) => d.photos),
    days: sorted,
    minDay: sorted[0].day,
    maxDay: sorted[sorted.length - 1].day,
    skippedCount: 0,
    shiftedCount: 0,
  });
}

function countOf(state: ReturnType<typeof dataset>): number {
  return state.days.reduce((n, d) => n + d.photos.length, 0);
}

/** What a closed card's lean must be, from the index alone. A closed day has
 *  spread 0, which zeroes jitterX and jitterY and pins the tilt at MAX_TILT_DEG,
 *  so the lean is the only thing that can be wrong and it has one right answer. */
function expectedLean(index: number): number {
  return (pseudoRandom(index) - 0.5) * 2 * MAX_TILT_DEG;
}

describe('the wobble seed cache', () => {
  it('lays out a dataset larger than one laid out before it', () => {
    /* The seed table is sized from the days array it was built for, so the
       failure a wrongly-keyed or stale table produces is reading past the end
       of it -- not a subtly different angle. Small archive first, large second,
       so a table shared between them is caught.

       This is the test that cannot live in timeline-engine.test.ts: there, the
       221-photo RUN is always laid out first, so a shared table is already the
       right size by the time anything smaller arrives. */
    const small = dataset([day(3, 4100), day(2, 4600)]);
    expect(countOf(small)).toBe(5);
    computeLayout(small, small.minDay - 2000, WIDTH, HEIGHT, CONFIG, null, 1);

    const large = dataset([day(40, 12), ...Array.from({ length: 40 }, (_, i) => day(2 + (i % 6), 400 + i * 90)), day(3, 4100), day(2, 4600)]);
    expect(countOf(large)).toBeGreaterThan(countOf(small) * 10);

    const layouts = computeLayout(large, large.minDay - 2000, WIDTH, HEIGHT, CONFIG, null, 1);
    expect(layouts).toHaveLength(countOf(large));
    /* Every card closed, so the lean is the whole story. */
    expect(layouts.every((l) => l.o < 0.01)).toBe(true);

    /* Index 0 is exactly where a mis-keyed table would still agree with the
       right answer, so check the far end too -- that is the overflow. */
    for (const i of [0, 1, 7, layouts.length - 2, layouts.length - 1]) {
      expect(layouts[i].rot).toBeCloseTo(expectedLean(i), 10);
    }
  });

  it('gives every card the lean its own index implies', () => {
    const state = dataset([day(9, 200), day(6, 900)]);
    const layouts = computeLayout(state, state.minDay - 2000, WIDTH, HEIGHT, CONFIG, null, 1);
    expect(layouts).toHaveLength(15);
    layouts.forEach((l, i) => {
      expect(l.rot).toBeCloseTo(expectedLean(i), 10);
    });
  });

  it('does not let one archive lean where another does', () => {
    /* Two archives, laid out alternately, each checked against the same closed
       form. If the table were keyed on anything but the days array -- on the
       engine, on the photo count, on nothing at all -- one of these two would
       be reading the other's angles. */
    const a = dataset([day(9, 200)]);
    const b = dataset([day(7, 700), day(4, 1300)]);

    const aFirst = computeLayout(a, a.minDay - 2000, WIDTH, HEIGHT, CONFIG, null, 1);
    computeLayout(b, b.minDay - 2000, WIDTH, HEIGHT, CONFIG, null, 1);
    const aSecond = computeLayout(a, a.minDay - 2000, WIDTH, HEIGHT, CONFIG, null, 1);

    expect(countOf(a)).toBe(9);
    expect(countOf(b)).toBe(11);

    aFirst.forEach((l, i) => expect(l.rot).toBeCloseTo(expectedLean(i), 10));
    aSecond.forEach((l, i) => expect(l.rot).toBeCloseTo(expectedLean(i), 10));
    expect(aSecond).toEqual(aFirst);
  });
});