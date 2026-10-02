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

/** Longest edge of the preview made on demand for the selected card. The
 *  selected card fills the stage, so this has to cover a large display: at
 *  1360px of stage on a 2x screen the sharpest useful image is ~2720px, and
 *  the engine additionally refuses to blow a photo up past its own pixels. */
export const PREVIEW_MAX_EDGE = 2048;

/** JPEG quality. High enough that a card at 380 device pixels shows no
 *  artefacts, low enough that 700 thumbnails stay around 9 MB. */
export const THUMB_QUALITY = 0.72;
export const PREVIEW_QUALITY = 0.82;