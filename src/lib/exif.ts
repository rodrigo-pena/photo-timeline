import exifr from 'exifr';
import type { PhotoRecord } from './types.js';
import { makeThumbnail } from './thumbnail.js';

const DAY_MS = 86400000;

/* How many files are worked on at once.
 *
 * Measured on an 18-core M5 Max, 64 full-resolution photos, ms per photo:
 *
 *     1 at a time   21.1   (14.8s for a 700-photo import)
 *     2 at a time   16.2
 *     4 at a time   11.8
 *     8 at a time   10.3   (7.2s)  <- chosen
 *    16 at a time   10.7   (7.5s)
 *
 * Chrome already decodes off-thread, so this does not scale with the core
 * count and it flattens out early: 8 is where the curve ends and 16 is very
 * slightly worse. Going higher would queue work that cannot be scheduled and
 * hold more native bitmaps alive at once, for nothing. */
const CONCURRENCY = 8;

/** Called as each file finishes, successfully or not. */
export type Progress = (done: number, total: number, photo: PhotoRecord | null) => void;

/** What one file turned out to be.
 *
 *  `ignored` and `skipped` are different on purpose. A folder picker hands over
 *  everything in the folder, including `.DS_Store`, `.txt` sidecars and video
 *  files; none of those is a photo that failed, and counting them would inflate
 *  the "skipped (no camera date)" figure on every Mac folder import. */
export type FileOutcome =
  | { kind: 'photo'; photo: PhotoRecord }
  | { kind: 'skipped' }
  | { kind: 'ignored' };

export interface ProcessResult {
  photos: PhotoRecord[];
  skippedCount: number;
}

export async function processFiles(
  files: File[],
  onProgress?: Progress,
): Promise<ProcessResult> {
  const photos: PhotoRecord[] = [];
  let skippedCount = 0;

  /* Each file is an independent unit of async work, so the whole import used
     to be the slowest possible shape: one `await` chain, with the browser's
     decoder idle for all but one file at a time. A fixed pool of workers keeps
     CONCURRENCY files in flight and hands each finished one straight back for
     the next, which is where the 2x is. */
  let next = 0;
  let examined = 0;
  const work = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= files.length) return;

      const outcome = await processOne(files[index]);
      if (outcome.kind === 'photo') photos.push(outcome.photo);
      else if (outcome.kind === 'skipped') skippedCount++;

      /* Counted per file examined, not per photo kept, so `done` reaches
         `total` even when the folder came with files that were never photos.
         A progress bar that stops at 96% looks broken and never finishes. */
      examined++;
      onProgress?.(examined, files.length, outcome.kind === 'photo' ? outcome.photo : null);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, work));
  return { photos, skippedCount };
}

const PHOTO_NAME = /\.(jpe?g|png|heic|gif|webp|tiff?|bmp|avif)$/i;

/** Whether a picked file is a photo worth trying at all.
 *
 *  A folder picker hands over every file in the folder, and browsers disagree
 *  about which types they report: a `.jpg` can arrive with an empty `type`, and
 *  a `.heic` can arrive as `application/octet-stream`. So the extension is
 *  trusted alongside the MIME type rather than instead of it. */
export function isPhotoCandidate(file: { type: string; name: string }): boolean {
  return file.type.startsWith('image/') || PHOTO_NAME.test(file.name);
}

/** One file's outcome. A file that fails is skipped, never fatal to the
 *  import -- one unreadable file in a folder of a thousand should not cost the
 *  user the other 999. */
async function processOne(file: File): Promise<FileOutcome> {
  if (!isPhotoCandidate(file)) return { kind: 'ignored' };

  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'Make', 'Model', 'LensModel', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength'],
    });

    const dateMs = data?.DateTimeOriginal?.getTime()
      ?? data?.CreateDate?.getTime()
      ?? data?.ModifyDate?.getTime();

    /* Only EXIF counts as a capture date. The file's own mtime is not a
     * capture date — copying, syncing and exporting all rewrite it — so it
     * never decides where a photo sits, and a photo without a usable EXIF
     * date is skipped rather than misdated. It is still kept, as the one
     * timestamp no export rewrites: where EXIF is wrong, it is the only
     * thing left that disagrees, and that disagreement is worth having. */
    if (dateMs === undefined || !Number.isFinite(dateMs)) {
      return { kind: 'skipped' };
    }

    const day = Math.floor(dateMs / DAY_MS);

    /* One decode does double duty: the native dimensions the layout needs, and
       the thumbnail the cloud will actually draw. It used to be a bare
       `new Image()` purely to read naturalWidth, which threw away a full decode
       of a multi-megabyte original on every photo. */
    const image = await makeThumbnail(file);

    const photo: PhotoRecord = {
      id: crypto.randomUUID(),
      blob: file,
      name: file.name,
      date: day,
      fileModifiedDay: fileDay(file.lastModified),
      width: image.width,
      height: image.height,
      thumb: image.thumb ?? undefined,
      camera: data?.Make && data?.Model ? `${data.Make} ${data.Model}` : undefined,
      lens: data?.LensModel,
      exposure: data?.ExposureTime ? `1/${Math.round(1 / data.ExposureTime)}s` : undefined,
      fNumber: data?.FNumber,
      iso: data?.ISO,
      focalLength: data?.FocalLength,
    };
    return { kind: 'photo', photo };
  } catch {
    return { kind: 'skipped' };
  }
}

/** The file's own date as a day number, or undefined when the browser gave
 *  us nothing usable. Epoch 0 is not a file date any real photo has. */
function fileDay(ms: number): number | undefined {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY_MS) : undefined;
}
