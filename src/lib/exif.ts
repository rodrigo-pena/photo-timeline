import exifr from 'exifr';
import type { PhotoRecord } from './types.js';
import { makeThumbnail } from './thumbnail.js';

const DAY_MS = 86400000;

export interface ProcessResult {
  photos: PhotoRecord[];
  skippedCount: number;
}

export async function processFiles(files: File[]): Promise<ProcessResult> {
  const photos: PhotoRecord[] = [];
  let skippedCount = 0;

  for (const file of files) {
    if (!file.type.startsWith('image/') && !/\.(jpe?g|png|heic|gif|webp|tiff?|bmp|avif)$/i.test(file.name)) {
      continue;
    }

    try {
      const data = await exifr.parse(file, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'Make', 'Model', 'LensModel', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength'],
      });

      const dateMs = data?.DateTimeOriginal?.getTime()
        ?? data?.CreateDate?.getTime()
        ?? data?.ModifyDate?.getTime();

      /* Only EXIF counts as a capture date. The file's own mtime is not a
         capture date — copying, syncing and exporting all rewrite it — so it
         never decides where a photo sits, and a photo without a usable EXIF
         date is skipped rather than misdated. It is still kept, as the one
         timestamp no export rewrites: where EXIF is wrong, it is the only
         thing left that disagrees, and that disagreement is worth having. */
      if (dateMs === undefined || !Number.isFinite(dateMs)) {
        skippedCount++;
        continue;
      }

      const day = Math.floor(dateMs / DAY_MS);

      /* One decode does double duty: the native dimensions the layout needs,
         and the thumbnail the cloud will actually draw. It used to be a bare
         `new Image()` purely to read naturalWidth, which threw away a full
         decode of a multi-megabyte original on every photo. */
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

      photos.push(photo);
    } catch {
      skippedCount++;
    }
  }

  return { photos, skippedCount };
}

/** The file's own date as a day number, or undefined when the browser gave
 *  us nothing usable. Epoch 0 is not a file date any real photo has. */
function fileDay(ms: number): number | undefined {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY_MS) : undefined;
}
