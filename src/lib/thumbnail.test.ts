import { describe, expect, it } from 'vitest';
import { PREVIEW_MAX_EDGE, THUMB_MAX_EDGE } from './thumbnail-config.js';
import { scaledSize, thumbnailSize } from './thumbnail.js';

/* `thumbnailSize` is the part of the thumbnail path that can be reasoned about
   without a browser, and it is where the mistakes live: an aspect ratio that
   silently flips, an edge that rounds to zero, or an upscale that invents
   detail the file never had. `makeThumbnail` itself needs a real decoder and is
   covered by the browser fixture instead. */

describe('thumbnailSize', () => {
  it('caps the longest edge and keeps the aspect ratio', () => {
    expect(thumbnailSize(4000, 3000)).toEqual({ width: THUMB_MAX_EDGE, height: 360 });
    expect(thumbnailSize(3000, 4000)).toEqual({ width: 360, height: THUMB_MAX_EDGE });
  });

  it('caps a panorama on its long edge, not its width', () => {
    expect(thumbnailSize(5472, 3648)).toEqual({
      width: THUMB_MAX_EDGE,
      height: Math.round((THUMB_MAX_EDGE * 3648) / 5472),
    });
    /* A tall thin image is capped on its height, not its width. */
    expect(thumbnailSize(1000, 8000)).toEqual({
      width: Math.round((THUMB_MAX_EDGE * 1000) / 8000),
      height: THUMB_MAX_EDGE,
    });
  });

  it('keeps the ratio within a pixel on every supported shape', () => {
    const shapes = [
      [4000, 3000], [3000, 4000], [5472, 3648], [3648, 5472],
      [4000, 4000], [1080, 1080], [2560, 1080], [4032, 3024],
    ];
    for (const [w, h] of shapes) {
      const size = thumbnailSize(w, h);
      expect(Math.max(size.width, size.height)).toBe(THUMB_MAX_EDGE);
      /* Rounding two edges independently can only cost half a pixel each. */
      expect(size.width / size.height).toBeCloseTo(w / h, 1);
    }
  });

  it('never upscales a photo that is already small enough', () => {
    expect(thumbnailSize(320, 240)).toEqual({ width: 320, height: 240 });
    expect(thumbnailSize(THUMB_MAX_EDGE, THUMB_MAX_EDGE)).toEqual({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
    });
    expect(thumbnailSize(THUMB_MAX_EDGE + 1, 100)).toEqual({ width: THUMB_MAX_EDGE, height: 100 });
  });

  it('reports nothing for an undecodable file rather than throwing', () => {
    expect(thumbnailSize(0, 0)).toEqual({ width: 0, height: 0 });
    expect(thumbnailSize(4000, 0)).toEqual({ width: 0, height: 0 });
    expect(thumbnailSize(Number.NaN, 3000)).toEqual({ width: 0, height: 0 });
  });

  it('never rounds a short edge down to nothing', () => {
    /* 1000:1 is far past the engine's own aspect clamp, but a thumbnail is
       written before the layout ever sees the photo, so it has to survive one.
       Without the floor this encodes a 480x0 canvas, which is an empty blob. */
    const size = thumbnailSize(THUMB_MAX_EDGE * 1000, THUMB_MAX_EDGE);
    expect(size.width).toBe(THUMB_MAX_EDGE);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('scaledSize', () => {
  /* The preview shares the rule with the thumbnail and differs only in the cap,
     so it only needs the properties a cap change could break. */
  it('caps on whichever edge is longer, for either cap', () => {
    for (const cap of [THUMB_MAX_EDGE, PREVIEW_MAX_EDGE]) {
      expect(scaledSize(4000, 3000, cap)).toEqual({ width: cap, height: Math.round((cap * 3) / 4) });
      expect(scaledSize(3000, 4000, cap)).toEqual({ width: Math.round((cap * 3) / 4), height: cap });
      expect(scaledSize(cap, cap, cap)).toEqual({ width: cap, height: cap });
    }
  });

  it('never upscales, at either cap', () => {
    expect(scaledSize(200, 100, PREVIEW_MAX_EDGE)).toEqual({ width: 200, height: 100 });
    expect(scaledSize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE)).toEqual({
      width: PREVIEW_MAX_EDGE,
      height: PREVIEW_MAX_EDGE,
    });
  });

  it('gives the selected card more pixels than a thumbnail does', () => {
    /* The whole reason a preview exists: it has to out-resolve the thumbnail it
       replaces, or it is not worth generating. */
    const thumb = scaledSize(4000, 3000, THUMB_MAX_EDGE);
    const preview = scaledSize(4000, 3000, PREVIEW_MAX_EDGE);
    expect(preview.width * preview.height).toBeGreaterThan(thumb.width * thumb.height * 10);
  });

  it('is wide enough that the engine never has to stretch it on a retina display', () => {
    /* The engine caps the selected card at `photo.width / dpr` CSS px so the
       blow-up stays at one image pixel per device pixel. If a preview were
       narrower than the widest card times dpr, the engine's own promise would
       be quietly broken and the card would look soft for a different reason.
       The widest card is the stage: --tl-stage-max, less padding and margin. */
    const stageMax = 1360;
    const widestCardCssPx = stageMax - 64 - 48;
    const preview = scaledSize(4000, 3000, PREVIEW_MAX_EDGE);
    expect(preview.width).toBeGreaterThanOrEqual(widestCardCssPx * 2);
  });
});