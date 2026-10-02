import { describe, expect, it } from 'vitest';
import {
  BURST_GAP_DAYS,
  MIN_BURST_PHOTOS,
  MIN_SHIFT_DAYS,
  MIN_SINGLE_DAY_PHOTOS,
  detectBursts,
  dominantFileDay,
  reconcileDates,
} from './reconcile.js';
import type { ReconcileInput } from './reconcile.js';

const DAY = 86400000;
/** Day number for a UTC calendar date, the same numbering the app buckets by. */
function day(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m, d) / DAY);
}

/** `count` photos on one day, all carrying `fileDay`. */
function onDay(exifDay: number, count: number, fileDay: number | null): ReconcileInput[] {
  return Array.from({ length: count }, () => ({ exifDay, fileDay }));
}

function shifts(inputs: ReconcileInput[]): number[] {
  return reconcileDates(inputs).map((r) => r.shiftDays);
}

/** ReconcileDates groups bursts by contiguity, so it takes its input in date
 *  order. Fixtures list bursts out of order for readability; this puts them
 *  back. */
function sorted(inputs: ReconcileInput[]): ReconcileInput[] {
  return [...inputs].sort((a, b) => a.exifDay - b.exifDay);
}

describe('detectBursts', () => {
  it('runs days together while the gap holds', () => {
    const bursts = detectBursts([0, 0, 1, 2, 10, 11]);
    expect(bursts).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it('splits on the first photo and keeps every photo of a day together', () => {
    const days = [0, 0, 0, 4, 8, 8];
    const bursts = detectBursts(days);
    expect(bursts).toHaveLength(3);
    expect(bursts[0]).toEqual({ start: 0, end: 2 });
    expect(bursts[1]).toEqual({ start: 3, end: 3 });
    expect(bursts[2]).toEqual({ start: 4, end: 5 });
  });

  it('treats a gap one day over the threshold as a new burst', () => {
    expect(detectBursts([0, BURST_GAP_DAYS])).toHaveLength(1);
    expect(detectBursts([0, BURST_GAP_DAYS + 1])).toHaveLength(2);
  });

  it('returns nothing for no photos', () => {
    expect(detectBursts([])).toEqual([]);
  });
});

describe('dominantFileDay', () => {
  const COPY_DAY = day(2021, 1, 5);
  const WEDDING_FILE = day(2017, 9, 8);

  it('names the date that covers more than a quarter of the archive', () => {
    const days = [
      ...new Array<number | null>(100).fill(COPY_DAY),
      ...new Array<number | null>(40).fill(WEDDING_FILE),
    ];
    expect(dominantFileDay(days)).toBe(COPY_DAY);
  });

  it('declines when no date is common enough to be a copy date', () => {
    /* One date in four is a coincidence, not a copy. */
    expect(dominantFileDay([WEDDING_FILE, day(2019, 3, 1), COPY_DAY, day(2023, 6, 2)])).toBeNull();
  });

  it('leaves photos with no file date out of the tally and the total', () => {
    /* The one known date is the only one there is, so it dominates what is
       actually known — but it is not a date most of the archive shares. */
    expect(dominantFileDay([null, null, WEDDING_FILE, null, null])).toBe(WEDDING_FILE);
    /* With nothing known at all there is nothing to name. */
    expect(dominantFileDay([null, null, null])).toBeNull();
    expect(dominantFileDay([])).toBeNull();
  });

  it('prefers the earliest date when counts tie, so order cannot change it', () => {
    const late = day(2023, 6, 2);
    expect(dominantFileDay([WEDDING_FILE, late, WEDDING_FILE, late])).toBe(WEDDING_FILE);
  });
});

describe('reconcileDates', () => {
  /* The case that motivated this: forty-four photos from a Canon body whose
     clock had never been reset, all landing on one wrong day, all exported in
     a single session four years and seven months later. */
  const WEDDING_EXIF = day(2013, 0, 20);
  const WEDDING_FILE = day(2017, 9, 8);
  const WEDDING_SHIFT = WEDDING_FILE - WEDDING_EXIF;

  it('shifts a misdated burst onto its file date and keeps its spacing', () => {
    const inputs: ReconcileInput[] = [];
    for (let i = 0; i < 44; i++) inputs.push({ exifDay: WEDDING_EXIF, fileDay: WEDDING_FILE });
    expect(shifts(inputs)).toEqual(new Array(44).fill(WEDDING_SHIFT));
    expect(WEDDING_SHIFT).toBe(1722);
  });

  it('moves a multi-day burst by one offset rather than re-dating it', () => {
    /* A burst spread over four days, all shifted by the same amount, so the
       days between its first and last photo survive untouched. */
    const inputs: ReconcileInput[] = [];
    for (let i = 0; i < 12; i++) {
      inputs.push({ exifDay: WEDDING_EXIF + (i % 4), fileDay: WEDDING_FILE });
    }
    const result = reconcileDates(inputs);
    const moved = inputs.map((p, i) => p.exifDay + result[i].shiftDays);

    expect(new Set(result.map((r) => r.shiftDays))).toEqual(new Set([WEDDING_SHIFT]));
    expect(Math.min(...moved)).toBe(WEDDING_FILE);
    /* The span is what a re-dating would have destroyed. */
    expect(Math.max(...moved) - Math.min(...moved)).toBe(3);
  });

  it('reports the file date that justified a shift', () => {
    const result = reconcileDates(onDay(WEDDING_EXIF, 44, WEDDING_FILE));
    expect(result[0].fileDay).toBe(WEDDING_FILE);
  });

  it('leaves a correctly dated archive exactly as it found it', () => {
    const inputs: ReconcileInput[] = [];
    for (let i = 0; i < 30; i++) {
      const d = day(2023, 5, 1) + i * 40;
      inputs.push({ exifDay: d, fileDay: d });
    }
    expect(shifts(inputs)).toEqual(new Array(30).fill(0));
  });

  /* Every gate below has to hold on its own, because each one is the only
     thing standing between a copy date and a moved photograph. */
  it('abstains when the file date is the archive copy date', () => {
    const copyDay = day(2021, 1, 5);
    /* A library where a bulk copy gave two thirds of the photos the same file
       date, including a misdated burst wearing that date — which is what a
       wholesale copy of a folder full of wrong dates looks like. */
    const copied: ReconcileInput[] = [];
    for (let i = 0; i < 212; i++) {
      copied.push({ exifDay: day(2015, 0, 1) + i * 30, fileDay: copyDay });
    }
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 44, copyDay),
      ...copied,
    ]);
    expect(shifts(inputs)).toEqual(new Array(256).fill(0));
  });

  it('abstains when the file dates inside the burst disagree', () => {
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 22, WEDDING_FILE),
      ...onDay(WEDDING_EXIF, 22, WEDDING_FILE + 5),
    ]);
    expect(shifts(inputs)).toEqual(new Array(44).fill(0));
  });

  it('abstains when a photo in the burst has no file date', () => {
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 21, WEDDING_FILE),
      ...onDay(WEDDING_EXIF, 23, null),
    ]);
    expect(shifts(inputs)).toEqual(new Array(44).fill(0));
  });

  it('abstains on a burst too small to be evidence about itself', () => {
    /* Three photos over two days: enough to look like a burst, not enough to
       show that their file dates were a shared session. */
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 2, WEDDING_FILE),
      ...onDay(WEDDING_EXIF + 1, 1, WEDDING_FILE),
    ]);
    expect(shifts(inputs)).toEqual(new Array(MIN_BURST_PHOTOS - 1).fill(0));
  });

  it('abstains on a one-day burst that is too small to carry its own weight', () => {
    /* Past the size floor but on a single day, so nothing in it shows a span. */
    const inputs = onDay(WEDDING_EXIF, MIN_SINGLE_DAY_PHOTOS - 1, WEDDING_FILE);
    expect(shifts(inputs)).toEqual(new Array(MIN_SINGLE_DAY_PHOTOS - 1).fill(0));
  });

  it('abstains on a delay an ordinary late export explains', () => {
    /* Four months: well within what processing a shoot takes, so this is a
       late export rather than a wrong clock. */
    const late = WEDDING_EXIF + 120;
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 12, late),
      ...onDay(WEDDING_EXIF + 2, 12, late),
    ]);
    expect(shifts(inputs)).toEqual(new Array(24).fill(0));
  });

  it('abstains on a delay just under the threshold', () => {
    const justUnder = WEDDING_EXIF + MIN_SHIFT_DAYS - 1;
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 12, justUnder),
      ...onDay(WEDDING_EXIF + 2, 12, justUnder),
    ]);
    expect(shifts(inputs)).toEqual(new Array(24).fill(0));
  });

  it('shifts at exactly the threshold', () => {
    const exact = WEDDING_EXIF + MIN_SHIFT_DAYS;
    const inputs = sorted([
      ...onDay(WEDDING_EXIF, 12, exact),
      ...onDay(WEDDING_EXIF + 2, 12, exact),
    ]);
    expect(shifts(inputs)).toEqual(new Array(24).fill(MIN_SHIFT_DAYS));
  });

  it('abstains on a file that predates its own EXIF', () => {
    const inputs = sorted([
      ...onDay(day(2023, 5, 1), 12, day(2019, 0, 1)),
      ...onDay(day(2023, 5, 2), 12, day(2019, 0, 1)),
    ]);
    expect(shifts(inputs)).toEqual(new Array(24).fill(0));
  });

  it('moves only the burst that qualifies and nothing around it', () => {
    /* Both healthy bursts are internally uniform with no delay at all, so
       they clear every gate but the last one. */
    const early = day(2011, 5, 1);
    const late = day(2024, 2, 3);
    const inputs = sorted([
      ...onDay(early, 24, early),
      ...onDay(WEDDING_EXIF, 44, WEDDING_FILE),
      ...onDay(late, 24, late),
    ]);
    expect(shifts(inputs)).toEqual([
      ...new Array(24).fill(0),
      ...new Array(44).fill(WEDDING_SHIFT),
      ...new Array(24).fill(0),
    ]);
  });

  it('handles no photos at all', () => {
    expect(reconcileDates([])).toEqual([]);
  });
});
