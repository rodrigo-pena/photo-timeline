import { initTheme } from './lib/theme.js';
import { getAllPhotos, clearPhotos } from './lib/db.js';
import type { Dataset, PhotoDay, PhotoRecord } from './lib/types.js';
import { createEngine } from './lib/timeline-engine.js';
import { createCloudRenderer } from './lib/cloud.js';
import { createAxisRenderer } from './lib/axis.js';
import { computeHistogram, renderHistogram } from './lib/histogram.js';
import { initRecordPanel } from './lib/record-panel.js';
import { getSkipped, clearSkipped } from './lib/skip-count.js';

initTheme();

const DAY_MS = 86400000;

function buildDataset(photos: PhotoRecord[], skippedCount: number): Dataset {
  const sorted = [...photos].sort((a, b) => a.date - b.date);

  const dayMap = new Map<number, PhotoRecord[]>();
  for (const p of sorted) {
    const list = dayMap.get(p.date) ?? [];
    list.push(p);
    dayMap.set(p.date, list);
  }

  const days: PhotoDay[] = Array.from(dayMap.entries())
    .map(([day, photos]) => ({ day, photos }))
    .sort((a, b) => a.day - b.day);

  const minDay = days.length > 0 ? days[0].day : 0;
  const maxDay = days.length > 0 ? days[days.length - 1].day : 0;

  return { photos: sorted, days, minDay, maxDay, skippedCount };
}

async function main(): Promise<void> {
  const photos = await getAllPhotos();

  if (photos.length === 0) {
    window.location.href = 'index.html';
    return;
  }

  const dataset = buildDataset(photos, getSkipped());
  const engine = createEngine(dataset);

  const stage = document.getElementById('tl-stage') as HTMLElement;
  const cloud = document.getElementById('tl-cloud') as HTMLElement;
  const plot = document.getElementById('tl-plot') as HTMLElement;
  const scale = document.getElementById('tl-scale') as HTMLElement;
  const datasetLabel = document.getElementById('tl-dataset') as HTMLElement;
  const footStatus = document.getElementById('tl-foot-status') as HTMLElement;
  const resetLink = document.getElementById('tl-reset') as HTMLAnchorElement;

  const cloudRenderer = createCloudRenderer(cloud);
  const axisRenderer = createAxisRenderer(plot, scale, engine);
  const recordPanel = initRecordPanel();

  cloudRenderer.updatePhotos(dataset.days);

  const y0 = new Date(dataset.minDay * DAY_MS).getUTCFullYear();
  const y1 = new Date(dataset.maxDay * DAY_MS).getUTCFullYear();
  datasetLabel.textContent = `${photos.length} records · ${y0}–${y1}`;
  footStatus.textContent = dataset.skippedCount > 0
    ? `${photos.length} photos · ${dataset.skippedCount} skipped (no EXIF date) · local only`
    : `${photos.length} photos · local only`;

  const histData = computeHistogram(dataset.days, engine.minDay, engine.numDays);
  const svg = plot.querySelector('svg')!;
  renderHistogram(svg, histData, plot.clientWidth, plot.clientHeight);

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
    engine.target = Math.max(engine.minDay, Math.min(engine.maxDay - 0.001, day));
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
        const rect = cloud.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const idx = cloudRenderer.getElementAt(x, y);
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

  resetLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await clearPhotos();
    clearSkipped();
    window.location.href = 'index.html';
  });

  cloudRenderer.render(engine, engine.focus);
  axisRenderer.render(engine, engine.focus);
}

main();
