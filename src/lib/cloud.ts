import type { PhotoDay, PhotoRecord } from './types.js';
import type { EngineState, PhotoLayout } from './timeline-engine.js';
import { computeLayout } from './timeline-engine.js';

export interface CloudRenderer {
  render(state: EngineState, focus: number): void;
  getElementAt(x: number, y: number): number | null;
  select(index: number): PhotoRecord | null;
  deselect(): void;
  resize(): void;
  updatePhotos(days: PhotoDay[]): void;
}

export function createCloudRenderer(cloudEl: HTMLElement): CloudRenderer {
  let photos: PhotoRecord[] = [];
  let objectUrls: string[] = [];
  let layouts: PhotoLayout[] = [];
  let elements: HTMLElement[] = [];
  let selectedIndex: number | null = null;
  let width = 0;
  let cloudHeight = 0;
  let currentState: EngineState | null = null;
  let currentFocus = 0;

  function measure(): void {
    width = cloudEl.clientWidth;
    cloudHeight = cloudEl.clientHeight;
  }

  function buildElements(): void {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
    cloudEl.innerHTML = '';
    elements = photos.map((photo, i) => {
      const el = document.createElement('div');
      el.className = 'tl-thumb';
      el.dataset.index = String(i);

      const chip = document.createElement('div');
      chip.className = 'tl-chip';
      chip.textContent = formatDate(photo.date);
      el.appendChild(chip);

      const url = URL.createObjectURL(photo.blob);
      objectUrls.push(url);

      const img = document.createElement('img');
      img.src = url;
      img.alt = photo.name;
      img.draggable = false;
      el.appendChild(img);

      cloudEl.appendChild(el);
      return el;
    });
  }

  function render(state: EngineState, focus: number): void {
    measure();
    currentState = state;
    currentFocus = focus;
    layouts = computeLayout(
      state, focus, width, cloudHeight, 20, 190, 186,
      selectedIndex, window.devicePixelRatio || 1,
    );

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const layout = layouts[i];
      if (!layout) continue;

      const s = el.style;
      s.transform = `translate3d(${layout.x.toFixed(1)}px,${layout.y.toFixed(1)}px,0) translate(-50%,-100%)`;
      s.width = `${layout.w.toFixed(1)}px`;
      s.height = `${layout.h.toFixed(1)}px`;
      s.zIndex = String(layout.z);
      s.setProperty('--o', layout.o.toFixed(3));
    }
  }

  function getElementAt(x: number, y: number): number | null {
    let bestIndex: number | null = null;
    let bestZ = -1;

    for (let i = 0; i < layouts.length; i++) {
      const l = layouts[i];
      const centerY = l.y - l.h / 2;
      const padX = Math.max(26 - l.w / 2, 8);
      const padY = Math.max(26 - l.h / 2, 8);

      const withinX = Math.abs(x - l.x) <= l.w / 2 + padX;
      const withinY = Math.abs(y - centerY) <= l.h / 2 + padY;

      if (withinX && withinY && l.z > bestZ) {
        bestZ = l.z;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  /* Returns the photo that was selected, so callers never have to re-derive it
     from an index and risk pairing it with a card drawn somewhere else. */
  function select(index: number): PhotoRecord | null {
    const photo = index >= 0 && index < photos.length ? photos[index] : null;
    deselect();
    if (photo === null) return null;
    selectedIndex = index;
    elements[index].classList.add('is-sel');
    if (currentState) {
      render(currentState, currentFocus);
    }
    return photo;
  }

  function deselect(): void {
    if (selectedIndex !== null && elements[selectedIndex]) {
      elements[selectedIndex].classList.remove('is-sel');
    }
    selectedIndex = null;
    if (currentState) {
      render(currentState, currentFocus);
    }
  }

  function resize(): void {
    measure();
  }

  function updatePhotos(days: PhotoDay[]): void {
    photos = days.flatMap((day) => day.photos);
    buildElements();
  }

  function formatDate(day: number): string {
    const d = new Date(day * 86400000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  return { render, getElementAt, select, deselect, resize, updatePhotos };
}
