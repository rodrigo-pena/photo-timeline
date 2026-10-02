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

/** How often each file date appears across a whole archive, plus the two facts
 *  every burst needs answered: which day is winning, and by how much. */
interface FileDayTally {
  counts: Map<number, number>;
  /** Distinct dates, ascending. Sorted once here rather than once per burst. */
  daysAsc: number[];
  /** File dates that were actually present; photos with none are in neither
   *  side of the tally, so an archive of mostly-dateless photos cannot invent a
   *  dominant date out of the one file that has one. */
  total: number;
  /** The earliest date holding the most occurrences, and how many that is. */
  topDay: number;
  topCount: number;
}

function tallyFileDays(fileDays: Iterable<number | null>): FileDayTally {
  const counts = new Map<number, number>();
  let total = 0;
  for (const day of fileDays) {
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
    total++;
  }

  const daysAsc = [...counts.keys()].sort((a, b) => a - b);
  /* Strictly greater, walking ascending, so a tie leaves the earliest date
     holding the title and the answer does not depend on the order the photos
     happened to be read in. */
  let topDay = 0;
  let topCount = 0;
  for (const day of daysAsc) {
    const count = counts.get(day) as number;
    if (count > topCount) {
      topDay = day;
      topCount = count;
    }
  }
  return { counts, daysAsc, total, topDay, topCount };
}

/**
 * The one file date covering more than `share` of the tally, or null when no
 * date does -- the same question `elsewhere` was rebuilt to ask, except that
 * the tally is built once for the whole archive and each burst subtracts its own
 * contribution instead of the archive being recounted from scratch.
 *
 * This is the single most important guard here. Copying or syncing a folder
 * rewrites every file's date to the moment of the copy, so in a library that
 * has been copied even once a large share of the photos can carry one file
 * date that says nothing at all about when they were taken. A burst whose
 * photos all carry that date must never be moved by it.
 */
function dominantFromTally(
  tally: FileDayTally,
  removeDay: number | null,
  removeCount: number,
  share: number,
): number | null {
  const total = tally.total - removeCount;
  if (total === 0) return null;

  /* Exactly one day's count moves, and only downward. Unless it was the day
     holding the title, the title cannot change hands -- no other count grew,
     and `topDay` is still the earliest date at the winning count. Answering
     here is the entire point: the alternative walks every distinct date in the
     archive, once per burst. */
  if (tally.topDay !== removeDay) {
    return tally.topCount / total > share ? tally.topDay : null;
  }

  /* The burst's own date is the archive's most common one, which is precisely
     the case the guard exists for and precisely when the tally is small: one
     date dominating the archive is what forces the walk to stay cheap. */
  let best: number | null = null;
  let bestCount = 0;
  for (const day of tally.daysAsc) {
    const count = (tally.counts.get(day) as number) - (day === removeDay ? removeCount : 0);
    if (count > bestCount) {
      best = day;
      bestCount = count;
    }
  }
  return bestCount / total > share ? best : null;
}

/**
 * The one file date covering more than `share` of the given file dates, or null
 * when no date does.
 *
 * Photos with no file date are left out of both the tally and the total, so an
 * archive of mostly-dateless photos cannot invent a dominant date out of the one
 * file that has one.
 */
export function dominantFileDay(
  fileDays: (number | null)[],
  share: number = COPY_DATE_SHARE,
): number | null {
  return dominantFromTally(tallyFileDays(fileDays), null, 0, share);
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

  /* Built at most once for the whole archive, and not at all unless a burst
     gets as far as needing it: each one that does subtracts its own
     contribution rather than making every other photo be recounted. An archive
     where every burst is abandoned at an earlier gate never pays for it. */
  let tally: FileDayTally | null = null;
  const tallyOf = (): FileDayTally => {
    tally ??= tallyFileDays(inputs.map((p) => p.fileDay));
    return tally;
  };

  for (const burst of bursts) {
    const length = burst.end - burst.start + 1;

    /* Every photo has to carry the same file date. One without, or two that
       disagree, and this is not a single shared file event. */
    let fileDay: number | null = null;
    let uniform = true;
    for (let i = burst.start; i <= burst.end; i++) {
      const own = inputs[i].fileDay;
      if (own === null) {
        uniform = false;
        break;
      }
      if (fileDay === null) fileDay = own;
      else if (fileDay !== own) {
        uniform = false;
        break;
      }
    }
    if (!uniform || fileDay === null) continue;

    /* Read straight off the burst rather than through a slice of it. */
    let minExifDay = inputs[burst.start].exifDay;
    const exifDays = new Set<number>();
    for (let i = burst.start; i <= burst.end; i++) {
      const own = inputs[i].exifDay;
      if (own < minExifDay) minExifDay = own;
      exifDays.add(own);
    }

    /* Too small to be evidence about itself, and a one-day burst has to prove
       its size the only way it can. */
    if (length < MIN_BURST_PHOTOS) continue;
    if (exifDays.size < 2 && length < MIN_SINGLE_DAY_PHOTOS) continue;

    /* The earliest file date rather than the median: a file date is always at
       or after the true capture, so the earliest one carries the smallest
       delay and therefore the smallest bias. A shift below MIN_SHIFT_DAYS is
       not a wrong clock at all — it is an ordinary late export, and a negative
       one is a file that predates its own EXIF, which no shift explains. */
    const shiftDays = fileDay - minExifDay;
    if (shiftDays < MIN_SHIFT_DAYS) continue;

    /* The archive's copy date is evidence about the copy, not about any one
       photo, so it is counted over everything *except* this burst. Excluding it
       matters: an archive that is a single burst would otherwise find its own
       file date dominant and refuse to correct the one thing wrong with it.
       That exclusion is the whole reason this is not simply `topDay`: the
       burst contributes `length` copies of its own date, and no more. */
    const copyDay = dominantFromTally(tallyOf(), fileDay, length, COPY_DATE_SHARE);
    if (copyDay !== null && fileDay === copyDay) continue;

    for (let i = burst.start; i <= burst.end; i++) {
      result[i].shiftDays = shiftDays;
    }
  }

  return result;
}
