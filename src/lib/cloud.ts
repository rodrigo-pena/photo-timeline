import type { PhotoDay, PhotoRecord } from './types.js';
import type { CloudConfig, EngineState, PhotoLayout } from './timeline-engine.js';
import { computeLayout } from './timeline-engine.js';

export interface CloudRenderer {
  render(state: EngineState, focus: number): void;
  getElementAt(x: number, y: number): number | null;
  select(index: number): PhotoRecord | null;
  deselect(): void;
  resize(): void;
  updatePhotos(days: PhotoDay[]): void;
}

/* How far a hovered card rises, and where it sits in the stacking order: above
   every layer the layout produces, below the selected card. */
const HOVER_LIFT = 7;
const HOVER_Z = 500000;

/* The cloud's scale lives in CSS so the responsive overrides in main.css apply
   to the layout as well as to the chrome. */
const FALLBACK_CONFIG: CloudConfig = {
  minSize: 20,
  maxSize: 190,
  fanFrac: 0.08,
  fanOpen: 0.55,
  fanDays: 120,
};

function readConfig(el: HTMLElement): CloudConfig {
  const style = getComputedStyle(el);
  const num = (name: string, fallback: number): number => {
    const raw = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(raw) ? raw : fallback;
  };
  return {
    minSize: num('--tl-min', FALLBACK_CONFIG.minSize),
    maxSize: num('--tl-max', FALLBACK_CONFIG.maxSize),
    fanFrac: num('--tl-fan-frac', FALLBACK_CONFIG.fanFrac),
    fanOpen: num('--tl-fan-open', FALLBACK_CONFIG.fanOpen),
    fanDays: FALLBACK_CONFIG.fanDays,
  };
}

export function createCloudRenderer(cloudEl: HTMLElement): CloudRenderer {
  let photos: PhotoRecord[] = [];
  let objectUrls: string[] = [];
  let layouts: PhotoLayout[] = [];
  let elements: HTMLElement[] = [];
  let selectedIndex: number | null = null;
  let hoverIndex: number | null = null;
  let width = 0;
  let cloudHeight = 0;
  let currentState: EngineState | null = null;
  let currentFocus = 0;
  let config = FALLBACK_CONFIG;

  function measure(): void {
    width = cloudEl.clientWidth;
    cloudHeight = cloudEl.clientHeight;
    config = readConfig(cloudEl);
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

  function paint(el: HTMLElement, layout: PhotoLayout, hovered: boolean): void {
    const s = el.style;
    const tilt = layout.rot !== 0 ? ` rotate(${layout.rot.toFixed(2)}deg)` : '';
    const y = layout.y - (hovered ? HOVER_LIFT : 0);
    s.transform = `translate3d(${layout.x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)${tilt}`;
    s.width = `${layout.w.toFixed(1)}px`;
    s.height = `${layout.h.toFixed(1)}px`;
    s.zIndex = String(hovered ? HOVER_Z : layout.z);
    s.setProperty('--o', layout.o.toFixed(3));
  }

  function render(state: EngineState, focus: number): void {
    measure();
    currentState = state;
    currentFocus = focus;
    layouts = computeLayout(
      state, focus, width, cloudHeight, config,
      selectedIndex, window.devicePixelRatio || 1,
    );

    for (let i = 0; i < elements.length; i++) {
      const layout = layouts[i];
      if (layout) paint(elements[i], layout, i === hoverIndex);
    }
  }

  /* Lifts the card under the cursor above its neighbours, so a photo buried in
     a busy day is still one click away. Painted straight onto the two cards
     that changed rather than re-rendering the cloud on every pointer move. */
  function setHover(index: number | null): void {
    const next = index !== null && elements[index] ? index : null;
    if (next === hoverIndex) return;

    const prev = hoverIndex;
    hoverIndex = next;

    if (prev !== null && elements[prev] && layouts[prev]) {
      elements[prev].classList.remove('is-hover');
      paint(elements[prev], layouts[prev], false);
    }
    if (next !== null && layouts[next]) {
      elements[next].classList.add('is-hover');
      paint(elements[next], layouts[next], true);
    }
  }

  function hitFromEvent(e: PointerEvent): number | null {
    const rect = cloudEl.getBoundingClientRect();
    return getElementAt(e.clientX - rect.left, e.clientY - rect.top);
  }

  let pointerDown = false;
  cloudEl.addEventListener('pointermove', (e: PointerEvent) => {
    if (pointerDown) return;
    setHover(hitFromEvent(e));
  });
  cloudEl.addEventListener('pointerleave', () => setHover(null));
  cloudEl.addEventListener('pointerdown', () => {
    pointerDown = true;
    setHover(null);
  });
  window.addEventListener('pointerup', () => {
    pointerDown = false;
  });

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
    setHover(null);
    selectedIndex = index;
    elements[index].classList.add('is-sel');
    if (currentState) {
      render(currentState, currentFocus);
    }
    return photo;
  }

  function deselect(): void {
    setHover(null);
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
    setHover(null);
  }

  function updatePhotos(days: PhotoDay[]): void {
    photos = days.flatMap((day) => day.photos);
    hoverIndex = null;
    buildElements();
  }

  function formatDate(day: number): string {
    const d = new Date(day * 86400000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  return { render, getElementAt, select, deselect, resize, updatePhotos };
}
