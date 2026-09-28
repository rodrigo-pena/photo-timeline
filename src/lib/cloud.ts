import type { PhotoRecord } from './types.js';
import type { EngineState, PhotoLayout } from './timeline-engine.js';
import { computeLayout } from './timeline-engine.js';

export interface CloudRenderer {
  render(state: EngineState, focus: number): void;
  getElementAt(x: number, y: number): number | null;
  select(index: number): void;
  deselect(): void;
  resize(): void;
  updatePhotos(photos: PhotoRecord[]): void;
}

export function createCloudRenderer(cloudEl: HTMLElement): CloudRenderer {
  let photos: PhotoRecord[] = [];
  let layouts: PhotoLayout[] = [];
  let elements: HTMLElement[] = [];
  let selectedIndex: number | null = null;
  let width = 0;
  let cloudHeight = 0;

  function measure(): void {
    width = cloudEl.clientWidth;
    cloudHeight = cloudEl.clientHeight;
  }

  function buildElements(): void {
    cloudEl.innerHTML = '';
    elements = photos.map((photo, i) => {
      const el = document.createElement('div');
      el.className = 'tl-thumb';
      el.dataset.index = String(i);

      const chip = document.createElement('div');
      chip.className = 'tl-chip';
      chip.textContent = formatDate(photo.date);
      el.appendChild(chip);

      const img = document.createElement('img');
      img.src = URL.createObjectURL(photo.blob);
      img.alt = photo.name;
      img.draggable = false;
      el.appendChild(img);

      cloudEl.appendChild(el);
      return el;
    });
  }

  function render(state: EngineState, focus: number): void {
    measure();
    layouts = computeLayout(state, focus, width, cloudHeight, 20, 190, 186);

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
      const dx = Math.abs(x - l.x);
      const dy = Math.abs(y - l.y);
      const radius = Math.max(26, l.w / 2);

      if (dx < radius && dy < radius && l.z > bestZ) {
        bestZ = l.z;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  function select(index: number): void {
    deselect();
    selectedIndex = index;
    if (elements[index]) {
      elements[index].classList.add('is-sel');
    }
  }

  function deselect(): void {
    if (selectedIndex !== null && elements[selectedIndex]) {
      elements[selectedIndex].classList.remove('is-sel');
    }
    selectedIndex = null;
  }

  function resize(): void {
    measure();
  }

  function updatePhotos(newPhotos: PhotoRecord[]): void {
    photos = newPhotos;
    buildElements();
  }

  function formatDate(day: number): string {
    const d = new Date(day * 86400000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  return { render, getElementAt, select, deselect, resize, updatePhotos };
}
