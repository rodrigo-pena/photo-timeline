export interface PhotoRecord {
  id: string;
  blob: Blob;
  name: string;
  date: number;
  width: number;
  height: number;
  /** The day the file itself was last written, as `date` is a day number.
   *  Never a capture date — kept as the one timestamp no export rewrites,
   *  which is what says so when EXIF is wrong. Absent on records written
   *  before it was stored, where `blob.lastModified` stands in for it. */
  fileModifiedDay?: number;
  camera?: string;
  lens?: string;
  exposure?: string;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
}

export interface PhotoDay {
  day: number;
  photos: PhotoRecord[];
}

export interface Dataset {
  photos: PhotoRecord[];
  days: PhotoDay[];
  minDay: number;
  maxDay: number;
  skippedCount: number;
}
