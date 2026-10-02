import type { PhotoRecord } from './types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

export interface RecordPanel {
  show(photo: PhotoRecord): void;
  close(): void;
  isOpen(): boolean;
  toggle(): void;
}

function formatDay(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function initRecordPanel(): RecordPanel {
  const info = document.getElementById('tl-info')!;
  const tab = document.getElementById('tl-info-tab') as HTMLButtonElement;
  const panel = document.getElementById('tl-info-panel')!;
  const closeBtn = document.getElementById('tl-info-close') as HTMLButtonElement;
  const body = document.getElementById('tl-info-body')!;
  const body_el = document.getElementById('tl-body')!;

  let open = false;

  function setOpen(v: boolean): void {
    open = v;
    info.setAttribute('data-has-sel', String(v));
    body_el.setAttribute('data-info', v ? 'open' : 'closed');
    tab.setAttribute('aria-expanded', String(v));
    panel.hidden = !v;
  }

  function show(photo: PhotoRecord): void {
    const shiftDays = photo.shiftDays ?? 0;

    const fields: [string, string][] = [
      ['Date', formatDay(photo.date)],
      ['File', photo.name],
      ['Size', photo.width && photo.height ? `${photo.width} × ${photo.height}` : '—'],
    ];

    /* A reconciled date is a correction, not a capture time, and naming the
       date it was moved off is what keeps the panel from passing it off as
       one. It sits with the other fields rather than as a note underneath, so
       it reads as part of the record. */
    if (shiftDays !== 0) {
      fields.splice(1, 0, ['Was', formatDay(photo.date - shiftDays)]);
    }

    if (photo.camera) fields.push(['Camera', photo.camera]);
    if (photo.lens) fields.push(['Lens', photo.lens]);
    if (photo.exposure) fields.push(['Exposure', photo.exposure]);
    if (photo.fNumber) fields.push(['Aperture', `f/${photo.fNumber}`]);
    if (photo.iso) fields.push(['ISO', String(photo.iso)]);
    if (photo.focalLength) fields.push(['Focal length', `${photo.focalLength}mm`]);

    body.innerHTML = `
      <span class="tl-source">sample record</span>
      <dl class="tl-fields">
        ${fields.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}
      </dl>
    `;

    setOpen(true);
  }

  function close(): void {
    setOpen(false);
  }

  function toggle(): void {
    setOpen(!open);
  }

  tab.addEventListener('click', toggle);
  closeBtn.addEventListener('click', close);

  return { show, close, isOpen: () => open, toggle };
}
