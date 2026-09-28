# Photo Timeline — Implementation Plan

## Framework

Vite + vanilla TypeScript. No framework — the complexity is in the timeline math
and rendering, not UI state. Vite gives us HMR, a one-command static build, and
zero-config deploy to GitHub Pages / Cloudflare / Vercel / Netlify.

## Architecture

```
photo-timeline/
├── index.html              # Screen 1 — landing / upload / reset
├── timeline.html           # Screen 2 — the explorer
├── src/
│   ├── main.ts             # Screen 1 entry: pickers → EXIF → IndexedDB → navigate
│   ├── timeline.ts         # Screen 2 entry: load from IndexedDB → render
│   ├── lib/
│   │   ├── exif.ts         # exifr wrapper — extract capture date
│   │   ├── db.ts           # IndexedDB wrapper — store blobs + metadata, with reset
│   │   ├── timeline-engine.ts  # Adaptive σ model (ported from mockup)
│   │   ├── cloud.ts        # Photo cloud renderer (DOM-based)
│   │   ├── histogram.ts    # Smoothed histogram renderer
│   │   ├── record-panel.ts # Record panel (metadata only)
│   │   └── theme.ts        # Light/dark theme manager
│   └── styles/
│       └── main.css        # Design tokens + components (ported from mockup)
├── mockup/                 # Existing mockup (reference only)
├── data/test-photos/       # Dev/test photos (gitignored)
└── vite.config.ts
```

## Confirmed decisions

| Decision       | Choice                                            |
| -------------- | ------------------------------------------------- |
| Persistence    | IndexedDB, with reset mechanism for privacy       |
| Record panel   | Metadata only — no photo preview                  |
| File input     | Both file picker and folder picker                |
| Rendering      | DOM-based, optimize later if needed               |
| Reset location | Both Screen 1 (button) and Screen 2 (footer link) |

## Screen 1 — Landing / Upload

- Two buttons side by side: **"Choose Photos"** (file picker, `multiple`) and
  **"Choose Folder"** (`webkitdirectory`)
- On selection: each file is read through `exifr` to extract `DateTimeOriginal`
  (fallbacks: `CreateDate`, `ModifyDate`, then `file.lastModified`)
- Photos **without** a usable date → counted as "failed", shown quietly in footer
- Photos **with** a date → stored as `{ id, blob, name, date, width, height }`
  in IndexedDB
- After processing → navigate to Screen 2
- **Reset**: a "Clear all photos" button (secondary/danger style) that wipes
  IndexedDB and returns to empty state

## Screen 2 — Timeline Explorer

- Loads all photos from IndexedDB on mount
- If empty → redirect back to Screen 1
- Full timeline engine ported from mockup:
    - Adaptive σ model (`localGap`, `σ(f) = clamp(gap/Φ, σmin, σmax)`)
    - DOM-based cloud renderer (bottom-anchored, jittered, z-index by openness)
    - Smoothed histogram (canvas, `[1 2 1]/4` kernel, monotone cubic Hermite)
    - Axis with month ticks, year labels, focus dot, date pill
- Interaction: drag, scroll (shift = fine), arrow keys, Page Up/Down, Home/End,
  click-to-select, Escape to deselect
- Record panel: collapsed 44px rail → open 340px panel with metadata
  (date, filename, dimensions, camera if available)
- Footer: `"N photos · M skipped (no date)"` (M shown only when > 0) + reset link
- Theme toggle (light/dark) in top-right, persisted in localStorage

## Dependencies

| Package      | Purpose              |
| ------------ | -------------------- |
| `exifr`      | EXIF date extraction |
| `vite`       | Dev server + build   |
| `typescript` | Type safety          |

## Implementation phases

**Phase 1 — Scaffold**

- Vite + TS project, `index.html` + `timeline.html`, port CSS design tokens

**Phase 2 — Photo pipeline**

- `exif.ts`, `db.ts` (IndexedDB + reset), Screen 1 pickers → process → store → navigate

**Phase 3 — Timeline engine**

- Port `timeline-engine.ts`, `cloud.ts`, `histogram.ts` from mockup

**Phase 4 — Interaction**

- Drag, scroll, keyboard, click-to-select, lerp animation, reduced-motion

**Phase 5 — Record panel + theme**

- Panel open/close, metadata display, light/dark toggle

**Phase 6 — Polish & deploy**

- Test with `data/test-photos`, responsive layout, `vite build` → `dist/`, deploy configs
