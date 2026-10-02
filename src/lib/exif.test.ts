import { describe, expect, it } from 'vitest';
import { isPhotoCandidate } from './exif.js';

/* A folder picker hands over every file in the folder, so this predicate is the
   difference between "3 photos had no camera date" and "3 photos plus the
   .DS_Store and the .txt sidecars had no camera date". Browsers disagree about
   which MIME types they report for a given file, so both signals are trusted
   and either one is enough. */

function file(type: string, name: string): { type: string; name: string } {
  return { type, name };
}

describe('isPhotoCandidate', () => {
  it('accepts an image by its MIME type alone', () => {
    expect(isPhotoCandidate(file('image/jpeg', 'IMG_0001.jpg'))).toBe(true);
    expect(isPhotoCandidate(file('image/png', 'screenshot'))).toBe(true);
    expect(isPhotoCandidate(file('image/heic', 'IMG_1'))).toBe(true);
    /* A camera file with no extension at all, still declared as an image. */
    expect(isPhotoCandidate(file('image/x-canon-cr3', 'CR3_0001'))).toBe(true);
  });

  it('accepts a photo extension when the browser reported no useful type', () => {
    /* What macOS and Windows actually hand over often enough to matter: a
       .jpg with an empty type is still a photo and must not be dropped. */
    expect(isPhotoCandidate(file('', 'IMG_0002.HEIC'))).toBe(true);
    expect(isPhotoCandidate(file('application/octet-stream', 'IMG_0003.JPG'))).toBe(true);
    expect(isPhotoCandidate(file('', 'scan.TIF'))).toBe(true);
    expect(isPhotoCandidate(file('', 'shot.webp'))).toBe(true);
  });

  it('rejects camera RAW, which is not in the supported list', () => {
    /* Not a change made here, just pinned: the extension list has never covered
       RAW, and quietly widening it would mean decoding formats this app has
       never been able to show. */
    expect(isPhotoCandidate(file('', 'DSC_0042.NEF'))).toBe(false);
    expect(isPhotoCandidate(file('', 'DSC_0042.CR3'))).toBe(false);
    expect(isPhotoCandidate(file('', 'DSC_0042.ARW'))).toBe(false);
  });

  it('rejects the folder detritus that is not a photo', () => {
    expect(isPhotoCandidate(file('', '.DS_Store'))).toBe(false);
    expect(isPhotoCandidate(file('', 'Thumbs.db'))).toBe(false);
    expect(isPhotoCandidate(file('text/plain', 'notes.txt'))).toBe(false);
    expect(isPhotoCandidate(file('application/pdf', 'scan.pdf'))).toBe(false);
    expect(isPhotoCandidate(file('', ''))).toBe(false);
  });

  it('rejects video, which shares a folder with photos and is not one', () => {
    expect(isPhotoCandidate(file('video/quicktime', 'clip.mov'))).toBe(false);
    expect(isPhotoCandidate(file('video/mp4', 'clip.mp4'))).toBe(false);
    expect(isPhotoCandidate(file('', 'clip.m4v'))).toBe(false);
  });

  it('does not mistake a photo-named document for a photo', () => {
    /* ".jpg" in the middle of a name is not an extension. */
    expect(isPhotoCandidate(file('text/plain', 'notes-about.jpg.txt'))).toBe(false);
    expect(isPhotoCandidate(file('', 'my.jpg.backup'))).toBe(false);
  });

  it('is case-insensitive, matching the pattern it replaces', () => {
    const supported = ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'avif'];
    for (const ext of supported) {
      expect(isPhotoCandidate(file('', `PHOTO.${ext.toUpperCase()}`))).toBe(true);
      expect(isPhotoCandidate(file('', `photo.${ext}`))).toBe(true);
    }
  });
});