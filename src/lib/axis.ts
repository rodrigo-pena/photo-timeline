import type { EngineState } from './timeline-engine.js';
import { pixelAtDay } from './timeline-engine.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

export interface AxisRenderer {
  render(state: EngineState, focus: number): void;
  /** Points the renderer at a different archive. Reconciliation can move the
   *  first and last photo, so the run of ticks has to be built for whatever
   *  range it is now being asked to draw. */
  setState(state: EngineState): void;
  resize(): void;
}

export function createAxisRenderer(plotEl: HTMLElement, scaleEl: HTMLElement, initial: EngineState): AxisRenderer {
  let state = initial;
  let width = 0;
  let dotEl: HTMLElement | null = null;
  let pillEl: HTMLElement | null = null;
  let xhairEl: HTMLElement | null = null;

  function build(): void {
    plotEl.innerHTML = '';
    scaleEl.innerHTML = '';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    plotEl.appendChild(svg);

    const axisLine = document.createElement('div');
    axisLine.className = 'tl-axis';
    plotEl.appendChild(axisLine);

    xhairEl = document.createElement('div');
    xhairEl.className = 'tl-xhair';
    plotEl.appendChild(xhairEl);

    dotEl = document.createElement('div');
    dotEl.className = 'tl-dot';
    plotEl.appendChild(dotEl);

    pillEl = document.createElement('div');
    pillEl.className = 'tl-pill';
    plotEl.appendChild(pillEl);

    for (let d = state.minDay; d <= state.maxDay; d++) {
      const date = new Date(d * DAY_MS);
      if (date.getUTCDate() !== 1) continue;

      const isYear = date.getUTCMonth() === 0;
      const tick = document.createElement('div');
      tick.className = `tl-tick ${isYear ? 'y' : 'm'}`;
      scaleEl.appendChild(tick);

      if (isYear) {
        const label = document.createElement('div');
        label.className = 'tl-year';
        label.textContent = String(date.getUTCFullYear());
        scaleEl.appendChild(label);
      }
    }
  }

  build();

  function render(state: EngineState, focus: number): void {
    width = plotEl.clientWidth;

    const fx = pixelAtDay(state, focus, width);

    if (dotEl) {
      dotEl.style.transform = `translate3d(${fx.toFixed(1)}px,0,0) translate(-50%,-50%)`;
    }
    if (pillEl) {
      pillEl.style.transform = `translate3d(${fx.toFixed(1)}px,0,0) translateX(-50%)`;
      const date = new Date(focus * DAY_MS);
      pillEl.textContent = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    }
    if (xhairEl) {
      xhairEl.style.transform = `translate3d(${fx.toFixed(1)}px,0,0)`;
    }

    const ticks = scaleEl.querySelectorAll<HTMLElement>('.tl-tick');
    const labels = scaleEl.querySelectorAll<HTMLElement>('.tl-year');
    let labelIdx = 0;

    for (let d = state.minDay; d <= state.maxDay; d++) {
      const date = new Date(d * DAY_MS);
      if (date.getUTCDate() !== 1) continue;

      const x = pixelAtDay(state, d, width);
      const tick = ticks[labelIdx];
      if (tick) tick.style.left = `${x.toFixed(1)}px`;

      if (date.getUTCMonth() === 0) {
        const label = labels[labelIdx];
        if (label) {
          label.style.left = `${x.toFixed(1)}px`;
          label.style.transform = labelIdx === labels.length - 1
            ? 'translateX(calc(-100% - 5px))'
            : 'translateX(5px)';
        }
        labelIdx++;
      }
    }
  }

  function setState(next: EngineState): void {
    state = next;
    build();
  }

  function resize(): void {
    width = plotEl.clientWidth;
  }

  return { render, setState, resize };
}
