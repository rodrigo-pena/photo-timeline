/** A photo's two candidate dates, as day numbers. */
export interface ReconcileInput {
  /** The day EXIF claims the photo was taken, or null when it has no date. */
  exifDay: number;
  /** The day the file itself was last written, or null when unknown. */
  fileDay: number | null;
}

export interface Reconciled {
  /** Whole days to add to `exifDay`. Zero when the photo was left alone. */
  shiftDays: number;
  /** The file date that justified the shift, when one did. */
  fileDay: number | null;
}

/** What counts as one occasion. A wedding runs over days; a holiday does not
 *  split into two clusters because someone recharged a battery overnight. */
export const BURST_GAP_DAYS = 3;
/** A burst too small to be evidence about itself: a single photo's file date is
 *  one sample, and a sample cannot show the file dates were a shared session. */
export const MIN_BURST_PHOTOS = 4;
/** A burst on one day has to be large to qualify, since it cannot show a span. */
export const MIN_SINGLE_DAY_PHOTOS = 8;
/** Eighteen months. Longer than any shoot-to-export workflow plausibly takes,
 *  so a longer gap means the camera's clock was wrong rather than the file
 *  being copied late. */
export const MIN_SHIFT_DAYS = 548;
/** A file date this common is a copy or sync date, not a photograph's. */
export const COPY_DATE_SHARE = 0.25;

/** A run of photos close enough in time to have been one occasion, as index
 *  ranges into the photo list. */
export interface Burst {
  start: number;
  end: number;
}

/**
 * Groups a list sorted by EXIF day into bursts: maximal runs whose gaps
 * between consecutive days stay within `gap` days. A day holding fifty photos
 * is one burst; a gap longer than `gap` ends one and starts another.
 */
export function detectBursts(days: number[], gap: number = BURST_GAP_DAYS): Burst[] {
  const bursts: Burst[] = [];
  for (let i = 0; i < days.length; i++) {
    const last = bursts[bursts.length - 1];
    if (i > 0 && days[i] - days[i - 1] <= gap && last) {
      last.end = i;
    } else {
      bursts.push({ start: i, end: i });
    }
  }
  return bursts;
}

/**
 * The one file date covering more than `share` of the given file dates, or
 * null when no date does. Photos with no file date are left out of both the
 * tally and the total, so an archive of mostly-dateless photos cannot invent a
 * dominant date out of the one file that has one.
 *
 * This is the single most important guard here. Copying or syncing a folder
 * rewrites every file's date to the moment of the copy, so in a library that
 * has been copied even once a large share of the photos can carry one file
 * date that says nothing at all about when they were taken. A burst whose
 * photos all carry that date must never be moved by it.
 */
export function dominantFileDay(fileDays: (number | null)[], share: number = COPY_DATE_SHARE): number | null {
  const counts = new Map<number, number>();
  let total = 0;
  for (const day of fileDays) {
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
    total++;
  }
  if (total === 0) return null;

  let best: number | null = null;
  let bestCount = 0;
  /* Ties go to the earliest date, so the result does not depend on the order
     the photos happened to be read in. */
  for (const day of [...counts.keys()].sort((a, b) => a - b)) {
    const count = counts.get(day)!;
    if (count > bestCount) {
      best = day;
      bestCount = count;
    }
  }
  return bestCount / total > share ? best : null;
}

/**
 * Decides, per photo, how far its date should move so that a burst whose EXIF
 * clock was wrong lands where the files say it belongs.
 *
 * The move is a shift, never a re-dating. A camera whose clock was never reset
 * is still running: it reports plausible times of day and advances correctly,
 * so a burst's spacing within itself is good and only its epoch is bad.
 * Shifting by whole days keeps that spacing, where giving each photo its own
 * file date would flatten an occasion into a single spike.
 *
 * `inputs` must be sorted by `exifDay`, which is what lets a burst be a
 * contiguous run. Every photo is left alone unless its whole burst clears all
 * four gates: the file dates agree with each other and are not the archive's
 * copy date, the burst is big enough to be evidence about itself, and the
 * implied delay is longer than a copy would explain.
 */
export function reconcileDates(inputs: ReconcileInput[]): Reconciled[] {
  const result: Reconciled[] = inputs.map((p) => ({ shiftDays: 0, fileDay: p.fileDay }));
  if (inputs.length === 0) return result;

  const bursts = detectBursts(inputs.map((p) => p.exifDay));

  for (const burst of bursts) {
    const slice = inputs.slice(burst.start, burst.end + 1);

    /* Every photo has to carry the same file date. One without, or two that
       disagree, and this is not a single shared file event. */
    let fileDay: number | null = null;
    let uniform = true;
    for (const photo of slice) {
      if (photo.fileDay === null) {
        uniform = false;
        break;
      }
      if (fileDay === null) fileDay = photo.fileDay;
      else if (fileDay !== photo.fileDay) {
        uniform = false;
        break;
      }
    }
    if (!uniform || fileDay === null) continue;

    const exifDays = slice.map((p) => p.exifDay);
    const minExifDay = Math.min(...exifDays);
    const distinctExifDays = new Set(exifDays).size;

    /* Too small to be evidence about itself, and a one-day burst has to prove
       its size the only way it can. */
    if (slice.length < MIN_BURST_PHOTOS) continue;
    if (distinctExifDays < 2 && slice.length < MIN_SINGLE_DAY_PHOTOS) continue;

    /* The earliest file date rather than the median: a file date is always at
       or after the true capture, so the earliest one carries the smallest
       delay and therefore the smallest bias. A shift below MIN_SHIFT_DAYS is
       not a wrong clock at all — it is an ordinary late export, and a negative
       one is a file that predates its own EXIF, which no shift explains. */
    const shiftDays = fileDay - minExifDay;
    if (shiftDays < MIN_SHIFT_DAYS) continue;

    /* The archive's copy date is evidence about the copy, not about any one
       photo, so it is counted over everything *except* this burst. Excluding
       it matters: an archive that is a single burst would otherwise find its
       own file date dominant and refuse to correct the one thing wrong with
       it.
       *
       * This is the most expensive step in the whole pass -- it walks every
       * other photo in the archive -- and it is asked last on purpose. Every
       * gate above is a pure predicate over this burst alone and costs nothing,
       * so a burst that is too small, or whose implied delay is ordinary, is
       * dropped before it can cost a walk of the archive. */
    const elsewhere: (number | null)[] = [];
    for (let i = 0; i < inputs.length; i++) {
      if (i < burst.start || i > burst.end) elsewhere.push(inputs[i].fileDay);
    }
    const copyDay = dominantFileDay(elsewhere);
    if (copyDay !== null && fileDay === copyDay) continue;

    for (let i = burst.start; i <= burst.end; i++) {
      result[i].shiftDays = shiftDays;
    }
  }

  return result;
}
