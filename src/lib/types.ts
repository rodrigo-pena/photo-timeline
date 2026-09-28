export interface PhotoRecord {
  id: string;
  blob: Blob;
  name: string;
  date: number;
  width: number;
  height: number;
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
