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

  it('is deterministic', () => {
    expect(layoutFor(BASE + 700)).toEqual(layoutFor(BASE + 700));
  });

  it('tilt every card a little, and never too much', () => {
    const tilts = layoutFor(BASE).map((l) => l.rot);
    expect(Math.max(...tilts.map(Math.abs))).toBeLessThanOrEqual(2.001);
    expect(new Set(tilts).size).toBeGreaterThan(1);
  });
});