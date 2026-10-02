/* Thumbnails.
 *
 * This is the whole reason the timeline feels like anything at all, so the
 * numbers belong here rather than in a commit message. Measured in Chrome on an
 * M5 Max, per photo:
 *
 *                     decode      bytes
 *   4000x3000 JPEG    11.6 ms     400 KB
 *   480px thumbnail    0.04 ms     13 KB
 *
 * That is 308x to decode and 31x less to hold, and it is the difference
 * between 8.15 seconds of decode for a 700-photo archive and 28 milliseconds.
 * Decoding 700 originals cannot be avoided at import -- one decode per photo is
 * how the thumbnail gets made -- but it only ever has to happen once, instead of
 * on every visit and every eviction.
 *
 * The resize is done by `drawImage` off a native `ImageBitmap` rather than by
 * `createImageBitmap`'s own resize options. Sizing the resize needs the native
 * dimensions, and getting those cheaply needs either a second decode or a
 * second look at EXIF, which can be absent or wrong. Decoding once and letting
 * the canvas scale is one pass and no new failure mode. */

import { PREVIEW_MAX_EDGE, PREVIEW_QUALITY, THUMB_MAX_EDGE, THUMB_QUALITY } from './thumbnail-config.js';

export interface SourceImage {
  /** Native pixel dimensions, or 0x0 when the file could not be decoded. */
  width: number;
  height: number;
  /** A downscaled JPEG for the cloud, or null when one could not be made. A
   *  null here is never fatal: the cloud falls back to the original. */
  thumb: Blob | null;
}

/**
 * The thumbnail's pixel dimensions: the longest edge capped at
 * `THUMB_MAX_EDGE`, aspect preserved, and never upscaled. A photo already
 * smaller than the cap is stored at its own size, because enlarging it would
 * cost bytes and invent detail that is not in the file.
 */
export function thumbnailSize(width: number, height: number): { width: number; height: number } {
  return scaledSize(width, height, THUMB_MAX_EDGE);
}

/** The same rule with the cap supplied, which is all the difference between a
 *  thumbnail and a preview. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };

  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };

  const scale = maxEdge / longEdge;
  return {
    /* At least 1px: a very extreme aspect ratio can otherwise round a short
       edge to zero, and a 0px canvas encodes to an empty blob. */
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decodes `source` once for its dimensions and, from that same decode, writes
 * the thumbnail. The bitmap is always closed, including on the failure paths:
 * a native 12-megapixel bitmap is ~48 MB of RGBA, and holding a few hundred of
 * them is how an import takes down the tab.
 *
 * Returns 0x0 and a null thumb for anything the browser will not decode, which
 * is what the old `Image` probe did and what the layout already copes with.
 */
export async function makeThumbnail(source: Blob): Promise<SourceImage> {
  const bitmap = await decode(source);
  if (!bitmap) return { width: 0, height: 0, thumb: null };

  const { width, height } = bitmap;
  try {
    const thumb = await encodeScaled(bitmap, width, height, THUMB_MAX_EDGE, THUMB_QUALITY);
    return { width, height, thumb };
  } finally {
    bitmap.close();
  }
}

/**
 * A larger JPEG for the selected card, made from the retained original on
 * demand. The thumbnail is sized for a card at `--tl-max` (190 CSS px, so 380
 * device px on a retina display); the selected card fills the stage instead,
 * and stretching a 480px thumbnail across ~1300px is visibly soft.
 *
 * Null means "no preview", never "no photo": the selected card stays sharp
 * enough to read, it is just not sharp. Making one costs one native decode plus
 * an encode, measured at 20-30ms off the main thread, which is why this is
 * generated on selection rather than for every photo at import.
 */
export async function makePreview(source: Blob): Promise<Blob | null> {
  const bitmap = await decode(source);
  if (!bitmap) return null;

  const { width, height } = bitmap;
  try {
    return await encodeScaled(bitmap, width, height, PREVIEW_MAX_EDGE, PREVIEW_QUALITY);
  } finally {
    bitmap.close();
  }
}

async function decode(source: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(source);
  } catch {
    /* An undecodable file, or a codec this browser will not read. The layout
       already copes with 0x0, so this is not worth surfacing. */
    return null;
  }
}

async function encodeScaled(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  const size = scaledSize(width, height, maxEdge);
  if (size.width === 0 || size.height === 0) return null;
  if (typeof OffscreenCanvas === 'undefined') return null;

  try {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } catch {
    return null;
  }
}
