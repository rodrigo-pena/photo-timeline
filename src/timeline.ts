import { initTheme } from './lib/theme.js';
import { getAllPhotos, clearPhotos } from './lib/db.js';
import type { Dataset, PhotoDay, PhotoRecord } from './lib/types.js';
import { createEngine } from './lib/timeline-engine.js';
import type { EngineState } from './lib/timeline-engine.js';
import { createCloudRenderer } from './lib/cloud.js';
import { createAxisRenderer } from './lib/axis.js';
import { computeHistogram, renderHistogram } from './lib/histogram.js';
import { initRecordPanel } from './lib/record-panel.js';
import { getSkipped, clearSkipped } from './lib/skip-count.js';
import { reconcileDates } from './lib/reconcile.js';

initTheme();

const DAY_MS = 86400000;

/** The day the file itself was last written. Records stored before
 *  `fileModifiedDay` existed still carry it: IndexedDB's structured clone
 *  keeps a File's lastModified, so an archive imported earlier reconciles
 *  without being re-imported. */
function fileDayOf(photo: PhotoRecord): number | null {
  if (typeof photo.fileModifiedDay === 'number') return photo.fileModifiedDay;
  const ms = (photo.blob as Blob & { lastModified?: number }).lastModified;
  return Number.isFinite(ms) && ms! > 0 ? Math.floor(ms! / DAY_MS) : null;
}

/** Moves any burst whose EXIF clock disagrees with its files, by whole days
 *  and by the same amount for every photo in it, so the burst's own spacing
 *  survives. Returns the photos in date order along with how many moved. */
function applyShifts(photos: PhotoRecord[]): { photos: PhotoRecord[]; shiftedCount: number } {
  const sorted = [...photos].sort((a, b) => a.date - b.date);
  const shifts = reconcileDates(sorted.map((p) => ({ exifDay: p.date, fileDay: fileDayOf(p) }))).map(
    (r) => r.shiftDays,
  );

  let shiftedCount = 0;
  const moved = sorted.map((p, i) => {
    if (shifts[i] === 0) return p;
    shiftedCount++;
    return { ...p, date: p.date + shifts[i], shiftDays: shifts[i] };
  });

  /* Moving a burst reorders the archive, so the order has to be restored
     before anything groups the photos into days. */
  if (shiftedCount > 0) moved.sort((a, b) => a.date - b.date);
  return { photos: moved, shiftedCount };
}

function buildDataset(
  photos: PhotoRecord[],
  skippedCount: number,
  reconcile: boolean,
): Dataset {
  const { photos: dated, shiftedCount } = reconcile
    ? applyShifts(photos)
    : { photos: [...photos].sort((a, b) => a.date - b.date), shiftedCount: 0 };

  const dayMap = new Map<number, PhotoRecord[]>();
  for (const p of dated) {
    const list = dayMap.get(p.date) ?? [];
    list.push(p);
    dayMap.set(p.date, list);
  }

  const days: PhotoDay[] = Array.from(dayMap.entries())
    .map(([day, photos]) => ({ day, photos }))
    .sort((a, b) => a.day - b.day);

  const minDay = days.length > 0 ? days[0].day : 0;
  const maxDay = days.length > 0 ? days[days.length - 1].day : 0;

  return { photos: dated, days, minDay, maxDay, skippedCount, shiftedCount };
}

async function main(): Promise<void> {
  const photos = await getAllPhotos();

  if (photos.length === 0) {
    window.location.href = 'index.html';
    return;
  }

  const stage = document.getElementById('tl-stage') as HTMLElement;
  const cloud = document.getElementById('tl-cloud') as HTMLElement;
  const plot = document.getElementById('tl-plot') as HTMLElement;
  const scale = document.getElementById('tl-scale') as HTMLElement;
  const datasetLabel = document.getElementById('tl-dataset') as HTMLElement;
  const footStatus = document.getElementById('tl-foot-status') as HTMLElement;
  const reconcileLink = document.getElementById('tl-reconcile') as HTMLAnchorElement;
  const resetLink = document.getElementById('tl-reset') as HTMLAnchorElement;

  const cloudRenderer = createCloudRenderer(cloud);
  const recordPanel = initRecordPanel();

  let reconcile = true;
  /* All three are (re)built by loadDataset, which runs before anything reads
     them and again on every toggle. */
  let dataset!: Dataset;
  let engine!: EngineState;
  let histData!: ReturnType<typeof computeHistogram>;
  /* Whether reconciliation finds anything is a property of the archive, not of
     the toggle, so it is measured once and the control is offered only when it
     would actually change something. */
  let reconcileAvailable = 0;

  loadDataset();

  const axisRenderer = createAxisRenderer(plot, scale, engine);
  const svg = plot.querySelector('svg')!;

  function loadDataset(previousFocus?: number): void {
    dataset = buildDataset(photos, getSkipped(), reconcile);
    engine = createEngine(dataset);
    histData = computeHistogram(dataset.days, engine.minDay, engine.numDays);

    /* Toggling should not throw away where the user was looking. A focus that
       no longer exists — because the photos moved out from under it — falls back
       to the nearest end of the archive that does. */
    if (previousFocus !== undefined) {
      engine.focus = Math.max(engine.minDay, Math.min(engine.maxDay, previousFocus));
      engine.target = engine.focus;
    }
    if (reconcile) reconcileAvailable = Math.max(reconcileAvailable, dataset.shiftedCount);
  }

  function updateChrome(): void {
    const y0 = new Date(dataset.minDay * DAY_MS).getUTCFullYear();
    const y1 = new Date(dataset.maxDay * DAY_MS).getUTCFullYear();
    datasetLabel.textContent = `${photos.length} records · ${y0}–${y1}`;

    const parts = [`${photos.length} photos`];
    if (dataset.shiftedCount > 0) parts.push(`${dataset.shiftedCount} reconciled`);
    if (dataset.skippedCount > 0) parts.push(`${dataset.skippedCount} skipped (no EXIF date)`);
    parts.push('local only');
    footStatus.textContent = parts.join(' · ');

    const offered = reconcile ? dataset.shiftedCount : reconcileAvailable;
    reconcileLink.hidden = offered === 0;
    reconcileLink.textContent = reconcile ? 'raw EXIF' : 'reconciled';
  }

  /** Repoints every renderer at the current dataset. The photo order can change
   *  under a toggle, so the cloud's cards are rebuilt rather than repositioned:
   *  a card's index is what maps it to a photo. */
  function showDataset(previousFocus?: number): void {
    loadDataset(previousFocus);
    axisRenderer.setState(engine);
    cloudRenderer.updatePhotos(dataset.days);
    renderHistogram(svg, histData, plot.clientWidth, plot.clientHeight);
    updateChrome();
    kick();
  }

  let raf = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function frame(): void {
    raf = 0;
    const diff = engine.target - engine.focus;
    if (Math.abs(diff) > 0.004) {
      engine.focus += diff * (reduced ? 1 : 0.24);
    } else {
      engine.focus = engine.target;
    }
    cloudRenderer.render(engine, engine.focus);
    axisRenderer.render(engine, engine.focus);
    if (Math.abs(diff) > 0.004) {
      raf = requestAnimationFrame(frame);
    }
  }

  function kick(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function setTarget(day: number): void {
    /* Clamp to maxDay itself, not a hair before it: focusing the last day in
       the archive has to land on it, or the pill names the day before the photo
       that was just selected. */
    engine.target = Math.max(engine.minDay, Math.min(engine.maxDay, day));
    kick();
  }

  stage.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startFocus = engine.target;
    let dragging = false;

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > 5) {
        dragging = true;
      }
      if (dragging) {
        const rect = cloud.getBoundingClientRect();
        const dayDelta = (dx / rect.width) * engine.numDays;
        setTarget(startFocus + dayDelta);
      }
    };

    const onUp = (ev: PointerEvent): void => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);

      if (!dragging) {
        const idx = cloudRenderer.getElementAt(ev.clientX, ev.clientY);
        const photo = idx === null ? null : cloudRenderer.select(idx);
        if (photo) {
          recordPanel.show(photo);
          /* The pill labels the focus, so move the focus onto the selected
             photo — otherwise the tooltip keeps reporting a stale date. */
          setTarget(photo.date);
        } else {
          cloudRenderer.deselect();
          recordPanel.close();
        }
      }
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
  });

  stage.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const gain = e.shiftKey ? 0.22 : 0.32;
    const delta = (e.deltaX + e.deltaY) * gain * (engine.numDays / 100);
    setTarget(engine.target + delta);
  }, { passive: false });

  stage.addEventListener('keydown', (e: KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowRight' ? 1
      : e.key === 'PageUp' ? -7
      : e.key === 'PageDown' ? 7
      : e.key === 'Home' ? engine.minDay - engine.focus
      : e.key === 'End' ? (engine.maxDay - 1) - engine.focus
      : 0;
    if (d !== 0) {
      e.preventDefault();
      setTarget(engine.focus + d);
    } else if (e.key === 'Escape') {
      cloudRenderer.deselect();
      recordPanel.close();
    }
  });

  window.addEventListener('resize', () => {
    axisRenderer.resize();
    cloudRenderer.resize();
    renderHistogram(svg, histData, plot.clientWidth, plot.clientHeight);
    cloudRenderer.render(engine, engine.focus);
    axisRenderer.render(engine, engine.focus);
  });

  reconcileLink.addEventListener('click', (e) => {
    e.preventDefault();
    /* A selected photo belongs to the dataset being shown, and rebuilding the
       cloud replaces every card, so the selection goes with it. */
    cloudRenderer.deselect();
    recordPanel.close();
    const previousFocus = engine.focus;
    reconcile = !reconcile;
    showDataset(previousFocus);
  });

  resetLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await clearPhotos();
    clearSkipped();
    window.location.href = 'index.html';
  });

  showDataset();
}

main();
