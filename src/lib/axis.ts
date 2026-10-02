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

  /* Built once per archive rather than rediscovered every frame.
   *
   * `render` used to call querySelectorAll twice and walk every calendar day
   * from the archive's first date to its last, allocating a Date for each. That
   * is about 3,650 Dates and two full subtree queries per frame on a ten-year
   * archive, every frame, to move a hundred-odd tick marks that only move when
   * the archive or the width changes.
   *
   * So the ticks and year labels are collected as they are created, and the
   * days that get one are recorded alongside them. Which days those are
   * depends only on `minDay`/`maxDay`, both fixed for the life of a dataset,
   * so the list is built in `build` and reused until `setState` rebuilds it. */
  let tickEls: HTMLElement[] = [];
  let labelEls: HTMLElement[] = [];
  /** The days that get a tick, ascending, paired with whether that tick is a
   *  year boundary. */
  let tickDays: number[] = [];
  let tickIsYear: boolean[] = [];

  function build(): void {
    plotEl.innerHTML = '';
    scaleEl.innerHTML = '';
    tickEls = [];
    labelEls = [];
    tickDays = [];
    tickIsYear = [];

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
      tickEls.push(tick);
      tickDays.push(d);
      tickIsYear.push(isYear);

      if (isYear) {
        const label = document.createElement('div');
        label.className = 'tl-year';
        label.textContent = String(date.getUTCFullYear());
        scaleEl.appendChild(label);
        labelEls.push(label);
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

    let labelIdx = 0;
    for (let i = 0; i < tickDays.length; i++) {
      const x = pixelAtDay(state, tickDays[i], width);
      tickEls[i].style.left = `${x.toFixed(1)}px`;

      if (!tickIsYear[i]) continue;
      const label = labelEls[labelIdx];
      if (label) {
        label.style.left = `${x.toFixed(1)}px`;
        /* The last year sits flush to the right edge rather than hanging off
           it, which is why the count of labels -- not of ticks -- decides. */
        label.style.transform = labelIdx === labelEls.length - 1
          ? 'translateX(calc(-100% - 5px))'
          : 'translateX(5px)';
      }
      labelIdx++;
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
