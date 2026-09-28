const KEY = 'photo-timeline:skipped';

/* The skipped count is produced on the upload screen but reported on the
   timeline screen, so it has to outlive the navigation between them. */
export function addSkipped(n: number): void {
  if (n <= 0) return;
  try {
    localStorage.setItem(KEY, String(getSkipped() + n));
  } catch {
    // localStorage unavailable — the count is a nicety, not a requirement
  }
}

export function getSkipped(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

export function clearSkipped(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
