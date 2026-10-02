/* Thumbnail and preview geometry, in one place so the numbers that decide how
 * much the browser has to decode can be read together, tested, and changed
 * without hunting.
 *
 * The cloud draws a card at up to `--tl-max` (190px), and a retina display
 * asks for two device pixels per CSS pixel, so the largest on-screen use of a
 * card is 380px. 480 leaves headroom for that plus the fractional layout
 * rounding, at 13 KB a photo. Raising it costs decode linearly and bytes
 * quadratically; 640 is the point where thumbnails stop being free. */

/** Longest edge of a stored thumbnail, in pixels. Never upscaled past this. */
export const THUMB_MAX_EDGE = 480;

/** Longest edge of the preview made on demand for the selected card.
 *
 *  Derived, not guessed. The engine refuses to draw the selected card larger
 *  than `photo.width / dpr` in CSS pixels — one image pixel per device pixel —
 *  so a preview has to be at least that wide or it gets stretched, which is
 *  exactly the softness this is meant to remove. The widest the card can get is
 *  the stage, `--tl-stage-max` (1360px), less its padding and the engine's
 *  24px margin; at `devicePixelRatio` 2 that is roughly 2400 device pixels.
 *
 *  2560 covers that with headroom, and a 4000x3000 source still comes down to
 *  about a third of its pixels, which is where the saving is. */
export const PREVIEW_MAX_EDGE = 2560;

/** JPEG quality. High enough that a card at 380 device pixels shows no
 *  artefacts, low enough that 700 thumbnails stay around 9 MB. */
export const THUMB_QUALITY = 0.72;
export const PREVIEW_QUALITY = 0.82;