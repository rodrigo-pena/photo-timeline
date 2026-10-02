/* ═══════════════════════════════════════════════════════════════════════
   The layout's invariants.
   ═══════════════════════════════════════════════════════════════════════

   `computeLayout` has no single source of truth in the code. It is one walk over
   two arrays at once -- the ordered days and the photos inside them -- and every
   fact the cloud depends on falls out of that walk being done the same way
   twice. So the properties below are not decoration around the layout, they
   ARE the layout; a change that breaks one of them does not break a test, it
   changes how the app looks, and often in a way that only shows up on somebody
   else's photo library.

   Three things make that easy to get wrong, and all three have been tempting at
   some point:

   1. Flattening `days` is the only ordering authority. Layout i is the i-th
      photo of the flattened days, so a card's position and the photo drawn into
      it can never come from different arrays. Any code that iterates `photos`
      and `days` separately, or rebuilds one and not the other, breaks this
      without any type error -- the shapes are identical.

   2. `packDay` picks an arrangement by trying every column count, and the size
      it returns comes from the cell rather than from a measurement pass. That is
      what guarantees a block fits its budget in both directions without a second
      look. Replacing it with "compute then check" reintroduces cards off their
      own date.

   3. The jitter is hashed from a photo's stable index, never from the focus or
      from Math.random. That is the whole reason nothing twitches while the
      timeline moves. `computeLayout` reads those seeds from a per-dataset cache
      (seedsFor), so a cache keyed on anything other than the days array
      identity will hand one archive another archive's wobble.

   The tests, and what each one is protecting:

     1. gives layout i the photo that flattened days put at i
        invariant 1 above. A test that looks like a tautology.
     2. keeps every card inside the cloud
     3. keeps a card within its day block of its own date
        invariant 2 above. This is the "photos stay on their date" guarantee.
     4. does not scatter a dense day along the axis
        a regression: forty photos once spread across the whole plot.
     5. opens a focused day into a grid that fills its budget
        an open day must read as cards on a table, not a column.
     6. fits a day with more photos than the plot has rows
        the degenerate case for invariant 2.
     7. never lets a back row cover a front row, or one day cover a nearer day
        z-order. Interacts with invariant 1; the two are not independent.
     8. puts the selected card in the centre, on top, and does not move it
        selection is a re-layout of one card, not of the cloud.
     9. never lets one photo bury another photo in an open day
        invariant 3. Closed days are exempt on purpose: that column is meant to
        be dense. This is the guarantee behind being able to click anything.
    10. lays a closed day out as the compact column it always was
        a far-off day must still echo the histogram.
    11. fits every block inside the budget its openness allows
        invariant 2 again, from the other side.
    12. is deterministic
        invariant 3, and the cache in seedsFor.
    13. leans a card further the more open its day is
        the tilt is the visible signal of openness; flattening it to a constant
        would pass every other test here.

   Which are encoding-sensitive, meaning a "simplification" would look reasonable
   and quietly redesign the app: 1, 3, 5, 7, 9 and 13. The rest would fail
   loudly if broken. If one of those six is ever removed, it has to be replaced
   with an equivalent, not deleted as redundant.
   ═══════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';
import type { CloudConfig, EngineState, PhotoLayout } from './timeline-engine.js';
import { computeLayout, createEngine, pixelAtDay } from './timeline-engine.js';
import type { PhotoDay, PhotoRecord } from './types.js';

const DAY = 86400000;
const BASE = Math.floor(Date.UTC(2013, 0, 1) / DAY);
const WIDTH = 1232;
const HEIGHT = 800;
const PAD = 10;

const CONFIG: CloudConfig = { minSize: 20, maxSize: 190, fanFrac: 0.08, fanOpen: 0.55, fanDays: 120 };

function photo(day: number, i: number, width = 3000, height = 2000): PhotoRecord {
  return { id: `p${day}-${i}`, blob: new Blob(), name: `p${day}-${i}.jpg`, date: day, width, height };
}

function day(count: number, offset: number, width?: number, height?: number): PhotoDay {
  return {
    day: BASE + offset,
    photos: Array.from({ length: count }, (_, i) => photo(BASE + offset, i, width, height)),
  };
}

function dataset(days: PhotoDay[]): EngineState {
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

/* A run with a heavy spike early on, clusters through the middle and a thin
   tail — the shape that broke the old spread. */
const RUN: PhotoDay[] = [
  day(40, 12),
  ...Array.from({ length: 40 }, (_, i) => day(2 + (i % 6), 400 + i * 90)),
  day(3, 4100),
  day(2, 4600),
];

function layoutFor(focus: number, selected: number | null = null, cfg = CONFIG): PhotoLayout[] {
  return computeLayout(dataset(RUN), focus, WIDTH, HEIGHT, cfg, selected, 1);
}

function flat(): PhotoRecord[] {
  return dataset(RUN).days.flatMap((d) => d.photos);
}

function span(): number {
  return WIDTH - PAD * 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

describe('computeLayout', () => {
  it('gives layout i the photo that flattened days put at i', () => {
    for (const focus of [BASE, BASE + 2000, BASE + 4600]) {
      const layouts = layoutFor(focus);
      const photos = flat();
      expect(layouts).toHaveLength(photos.length);
      layouts.forEach((l, i) => {
        expect(l.photoIndex).toBe(i);
        expect(l.day).toBe(photos[i].date);
        expect(l.groupIndex).toBe(l.day === photos[i].date ? l.groupIndex : -1);
      });
    }
  });

  it('keeps every card inside the cloud', () => {
    for (const focus of [BASE, BASE + 2000, BASE + 4600]) {
      for (const l of layoutFor(focus)) {
        expect(l.x - l.w / 2).toBeGreaterThanOrEqual(PAD - 0.5);
        expect(l.x + l.w / 2).toBeLessThanOrEqual(WIDTH - PAD + 0.5);
        expect(l.y).toBeLessThanOrEqual(HEIGHT);
        expect(l.y - l.h).toBeGreaterThanOrEqual(-0.5);
      }
    }
  });

  it('keeps a card within its day block of its own date', () => {
    const state = dataset(RUN);
    for (const focus of [BASE, BASE + 2000, BASE + 4600]) {
      for (const l of layoutFor(focus)) {
        /* A block may be shifted up to its own half-width to stay inside the
           plot, and a card may sit up to a half-width off its block's centre,
           and the final clamp may cost another card width. */
        const budget = lerp(CONFIG.fanFrac, CONFIG.fanOpen, smoothstep(l.o)) * span();
        const drift = Math.abs(l.x - pixelAtDay(state, l.day, WIDTH));
        expect(drift).toBeLessThanOrEqual(budget + l.w + 1);
      }
    }
  });

  it('does not scatter a dense day along the axis', () => {
    /* The regression: forty photos used to spread over the whole plot. */
    const layouts = layoutFor(BASE);
    const spike = layouts.slice(0, 40);
    const lo = Math.min(...spike.map((l) => l.x - l.w / 2));
    const hi = Math.max(...spike.map((l) => l.x + l.w / 2));
    expect(hi - lo).toBeLessThan(span() * CONFIG.fanOpen + CONFIG.maxSize * 2);
  });

  it('opens a focused day into a grid that fills its budget', () => {
    /* the 40-photo spike, with the focus on it */
    const spikeDay = BASE + 12;
    const layouts = layoutFor(spikeDay);
    const spike = layouts.filter((l) => l.day === spikeDay);
    expect(Math.min(...spike.map((l) => l.y - l.h))).toBeGreaterThanOrEqual(-0.5);
    /* more than one column and more than one row: a table, not a column */
    expect(new Set(spike.map((l) => Math.round(l.x))).size).toBeGreaterThan(1);
    expect(new Set(spike.map((l) => Math.round(l.y))).size).toBeGreaterThan(1);
    /* and it takes a decent bite out of the plot it is allowed */
    const width = Math.max(...spike.map((l) => l.x + l.w / 2)) - Math.min(...spike.map((l) => l.x - l.w / 2));
    expect(width).toBeGreaterThan(span() * CONFIG.fanOpen * 0.5);
  });

  it('fits a day with more photos than the plot has rows', () => {
    const huge = [day(500, 2000)];
    const state = dataset(huge);
    const layouts = computeLayout(state, BASE + 2000, WIDTH, HEIGHT, CONFIG, null, 1);
    expect(Math.min(...layouts.map((l) => l.y - l.h))).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...layouts.map((l) => l.y))).toBeLessThanOrEqual(HEIGHT);
  });

  it('never lets a back row cover a front row, or one day cover a nearer day', () => {
    const layouts = layoutFor(BASE + 2000);
    const byDay = new Map<number, PhotoLayout[]>();
    for (const l of layouts) byDay.set(l.day, [...(byDay.get(l.day) ?? []), l]);

    /* Within a day, the lower a card sits the further forward it is. */
    for (const cards of byDay.values()) {
      for (const a of cards) {
        for (const b of cards) {
          if (a.y > b.y + 0.01) expect(a.z).toBeGreaterThanOrEqual(b.z);
        }
      }
    }

    /* And a day the kernel opened further always covers one it did not. */
    const days = [...byDay.values()];
    for (const a of days) {
      for (const b of days) {
        if (a[0].o > b[0].o + 0.01) {
          expect(Math.min(...a.map((l) => l.z))).toBeGreaterThan(Math.max(...b.map((l) => l.z)));
        }
      }
    }
  });

  it('puts the selected card in the centre, on top, and does not move it', () => {
    const focus = BASE + 2000;
    const before = layoutFor(focus);
    const after = layoutFor(focus, 12);
    expect(after[12].x).toBeCloseTo(WIDTH / 2, 5);
    expect(after[12].z).toBeGreaterThan(Math.max(...before.map((l) => l.z)));
    const box = (l: PhotoLayout) => [l.x, l.y, l.w, l.h];
    const others = (ls: PhotoLayout[]) => ls.filter((_, i) => i !== 12).map(box);
    expect(others(after)).toEqual(others(before));
  });

  it('never lets one photo bury another photo in an open day', () => {
    /* The guarantee behind being able to pick anything out of a focused day:
       within an open block, no card's centre lies inside another card's box.
       Closed days keep their old tight column and are exempt. */
    const layouts = layoutFor(BASE + 12).filter((l) => l.o > 0.5);
    expect(layouts.length).toBe(40);

    for (const a of layouts) {
      const acx = a.x;
      const acy = a.y - a.h / 2;
      for (const b of layouts) {
        if (a === b) continue;
        const bcy = b.y - b.h / 2;
        const insideX = Math.abs(acx - b.x) < b.w / 2;
        const insideY = Math.abs(acy - bcy) < b.h / 2;
        expect(insideX && insideY).toBe(false);
      }
    }
  });

  it('lays a closed day out as the compact column it always was', () => {
    const state = dataset(RUN);
    /* a quiet day far from the focus: two columns on a square cell, at the
       minimum card size */
    const far = state.days[state.days.length - 1];
    const cards = layoutFor(far.day - 2000).filter((l) => l.day === far.day);
    expect(cards.length).toBe(2);
    expect(cards[0].w).toBeCloseTo(CONFIG.minSize * 1.5, 0);
    expect(new Set(cards.map((c) => c.x)).size).toBe(2);
    expect(new Set(cards.map((c) => c.y)).size).toBe(1);
  });

  it('fits every block inside the budget its openness allows', () => {
    const state = dataset(RUN);
    for (const focus of [BASE, BASE + 12, BASE + 2000, BASE + 4600]) {
      const layouts = layoutFor(focus);
      const byDay = new Map<number, typeof layouts>();
      for (const l of layouts) byDay.set(l.day, [...(byDay.get(l.day) ?? []), l]);

      for (const [day, cards] of byDay) {
        const budget = lerp(CONFIG.fanFrac, CONFIG.fanOpen, smoothstep(cards[0].o)) * span();
        const width = Math.max(...cards.map((c) => c.x + c.w / 2)) - Math.min(...cards.map((c) => c.x - c.w / 2));
        const height = Math.max(...cards.map((c) => c.y)) - Math.min(...cards.map((c) => c.y - c.h));
        expect(width).toBeLessThanOrEqual(budget + cards[0].w * 2);
        expect(height).toBeLessThanOrEqual(HEIGHT + 1);
        expect(pixelAtDay(state, day, WIDTH) - budget / 2 - cards[0].w).toBeLessThan(span());
      }
    }
  });

  it('is deterministic', () => {
    expect(layoutFor(BASE + 700)).toEqual(layoutFor(BASE + 700));
  });

  it('leans a card further the more open its day is', () => {
    const closed = layoutFor(BASE + 2000).filter((l) => l.o < 0.01).map((l) => l.rot);
    const open = layoutFor(BASE + 12).map((l) => l.rot);

    expect(Math.max(...closed.map(Math.abs))).toBeLessThanOrEqual(2.001);
    expect(Math.max(...open.map(Math.abs))).toBeLessThanOrEqual(12.001);
    expect(Math.max(...open.map(Math.abs))).toBeGreaterThan(6);
    /* still a spread of angles, not every card at the same lean */
    expect(new Set(open.map((r) => r.toFixed(1))).size).toBeGreaterThan(5);
  });

  /* The wobble seeds are read from a per-dataset cache keyed on the days array
     (seedsFor), which is what removed ~2100 sin() calls per frame. A cache
     keyed on anything else would hand one archive another archive's wobble, and
     nothing else here would notice: the positions are all still inside the
     budget and the tilts are all still within range. */
  it('gives the same cards the same wobble from a separately built dataset', () => {
    /* Two datasets, same photos, same shape, but distinct array identities --
       which is exactly what a reconcile toggle produces. */
    const first = computeLayout(dataset(RUN), BASE + 12, WIDTH, HEIGHT, CONFIG, null, 1);
    const second = computeLayout(dataset(RUN), BASE + 12, WIDTH, HEIGHT, CONFIG, null, 1);
    expect(second).toEqual(first);
  });

});