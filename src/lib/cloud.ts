import { putPhoto } from './db.js';
import type { CloudConfig, EngineState, PhotoLayout } from './timeline-engine.js';
import { computeLayout } from './timeline-engine.js';
import { makePreview } from './thumbnail.js';
import type { PhotoDay, PhotoRecord } from './types.js';

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
  /* Preview URLs, by card index, so a card that has been sharpened once keeps
     its own object URL and never leaks the previous one. Cleared with
     `objectUrls` whenever the cards themselves are rebuilt. */
  let previewUrls: (string | null)[] = [];
  /** Previews being made right now, by photo id. Opening the same photo twice
     *  while its first preview is still encoding must not start a second. */
  const previewsInFlight = new Set<string>();
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
    for (const url of previewUrls) if (url) URL.revokeObjectURL(url);
    objectUrls = [];
    previewUrls = [];
    cloudEl.innerHTML = '';
    elements = photos.map((photo, i) => {
      const el = document.createElement('div');
      el.className = 'tl-thumb';
      el.dataset.index = String(i);

      /* The thumbnail when the archive has one, the original when it does not.
         An archive imported before thumbnails existed has no `thumb` on any
         record and simply draws its originals, exactly as it always did. */
      const url = URL.createObjectURL(photo.thumb ?? photo.blob);
      objectUrls.push(url);

      const img = document.createElement('img');
      img.src = url;
      img.alt = photo.name;
      img.draggable = false;
      /* Asynchronous decode, so a card never waits on the main thread for its
         own pixels. `loading="lazy"` is deliberately not set: every card sits
         inside the cloud by construction, so there is nothing off-screen for it
         to defer, and it would only add a pop-in as cards scroll past. */
      img.decoding = 'async';
      el.appendChild(img);

      cloudEl.appendChild(el);
      previewUrls[i] = null;
      return el;
    });
  }

  /* Sharpen the selected card.
   *
   * A thumbnail is sized for a 190px card, and the selected card fills the
   * stage, so the thumbnail is stretched roughly three times and reads as soft
   * -- the exact complaint the thumbnail was meant to answer, one scale down.
   * The original is kept for this and nothing else, so the larger image is made
   * here rather than for every photo at import.
   *
   * The card is shown with its thumbnail immediately and upgraded when the
   * encode lands, so nothing ever opens blank. The preview is cached onto the
   * record and written back, so the second visit to the same photo is free.
   *
   * There is deliberately no hover prefetch: a preview decode is ~3ms, so there
   * is nothing to hide, and guessing from the pointer would start encodes for
   * photos the user never opens.
   */
  function loadPreview(index: number, photo: PhotoRecord): void {
    const img = elements[index]?.firstElementChild;
    if (!(img instanceof HTMLImageElement)) return;

    const apply = (blob: Blob): void => {
      /* The cards may have been rebuilt by a reconcile toggle while the encode
         was in flight, in which case this index is a different photo now. */
      if (!elements[index] || photos[index]?.id !== photo.id) return;
      const previous = previewUrls[index];
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(blob);
      previewUrls[index] = url;
      img.src = url;
    };

    if (photo.preview) {
      if (previewUrls[index]) return;
      apply(photo.preview);
      return;
    }

    if (previewsInFlight.has(photo.id)) return;
    previewsInFlight.add(photo.id);
    void makePreview(photo.blob).then(async (preview) => {
      previewsInFlight.delete(photo.id);
      if (!preview) return;
      photo.preview = preview;
      apply(preview);
      /* Best effort: a failed write only costs a second encode next time. */
      try {
        await putPhoto(photo);
      } catch {
        /* ignore */
      }
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

  /* Lifts the card under the cursor above its neighbors, so a photo buried in
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
    return getElementAt(e.clientX, e.clientY);
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

  /* Let the browser answer "what is under the cursor". It already knows: the
     cards are transformed and stacked, and while the cloud is animating to a
     new focus they are somewhere between the old and the new layout, so a hit
     test against the layout would pick a different photo than the one under
     the pointer. */
  function getElementAt(clientX: number, clientY: number): number | null {
    const hit = document.elementFromPoint(clientX, clientY);
    const thumb = hit ? hit.closest<HTMLElement>('.tl-thumb') : null;
    if (!thumb) return null;
    const index = Number(thumb.dataset.index);
    return Number.isInteger(index) ? index : null;
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
    loadPreview(index, photo);
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

  return { render, getElementAt, select, deselect, resize, updatePhotos };
}
