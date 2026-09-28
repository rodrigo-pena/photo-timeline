import exifr from 'exifr';
import type { PhotoRecord } from './types.js';

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
         capture date — copying, syncing and exporting all rewrite it — so a
         photo without a usable EXIF date is skipped rather than misdated. */
      if (dateMs === undefined || !Number.isFinite(dateMs)) {
        skippedCount++;
        continue;
      }

      const day = Math.floor(dateMs / DAY_MS);

      const dims = await getImageDimensions(file);

      const photo: PhotoRecord = {
        id: crypto.randomUUID(),
        blob: file,
        name: file.name,
        date: day,
        width: dims.width,
        height: dims.height,
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

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
