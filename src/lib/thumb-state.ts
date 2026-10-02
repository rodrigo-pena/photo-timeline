/* Whether this browser's archive has ever held a thumbnail.
 *
 * Thumbnails are only written by an import that happened after they existed, so
 * an archive that predates them keeps drawing full-resolution originals. That is
 * not an error and needs no migration -- the cloud falls back to the original --
 * but it is dramatically slower, and nothing on screen would otherwise say so.
 *
 * This is a flag rather than a query because asking is expensive: reading a
 * record to see whether it has a thumbnail deserialises its multi-megabyte
 * original along with it, so a check would have to pull the whole archive
 * through just to decide whether to mention speed. A localStorage flag costs
 * one read.
 *
 * It is set only once an import has actually produced thumbnails, so a browser
 * without OffscreenCanvas -- where the cloud permanently falls back to
 * originals -- is never told to re-import for a speedup it cannot have. */

const KEY = 'photo-timeline:thumbs';

/** Called after an import that wrote at least one thumbnail. */
export function noteThumbnailsWritten(count: number): void {
  if (count <= 0) return;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // localStorage unavailable — the flag is only ever a hint
  }
}

/** True once any import has written a thumbnail. False for an archive that
 *  predates them, and for a browser that has never imported anything. */
export function hasThumbnails(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Without localStorage we cannot tell, so assume the better case rather
    // than telling someone to re-import a 700-photo archive on no evidence.
    return true;
  }
}