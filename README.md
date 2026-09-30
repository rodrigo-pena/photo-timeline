# Photo Timeline

A minimal, local-only photo timeline explorer. Load a folder of photos, and browse
them in date order along an interactive timeline.

## How the timeline works

Photos are grouped by day and ordered along a date axis. The days themselves are
the only ordering the layout knows about, so a card's position and the photo drawn
into it always come from the same record.

A kernel centred on the current focus date decides how "open" each day is, which
drives its card size and how far forward it sits. The kernel's width adapts to
the spacing between photo days, so dense clusters open up while long quiet
stretches stay compact.

Each day owns a block of cards standing on its own date. The block fans out
sideways only as far as a budget allows — two card widths at minimum, a fraction
of the plot and a hard number of days at most — and stacks upward for the rest,
so a bump in the histogram grows a column right above it and no card ever drifts
so far from its date that it reads as belonging to another one. Cards tilt a
couple of degrees, deterministically, so a block looks like a deck thrown on a
table rather than a grid.

You can drag anywhere in the stage, scroll, or use the arrow keys (`←` `→` for one
day, `Page Up` / `Page Down` for a week, `Home` / `End` for the archive ends) to
move the focus. Click any photo to select it: the thumbnail expands and floats to
the centre while the record panel shows its metadata. Click the background or
press `Escape` to deselect. A light/dark toggle sits at the top right and is
remembered between sessions.

`npm test` checks the layout invariants: that a card belongs to its own date, that
the drift and stacking stay inside their budgets, and that the layout is
deterministic.

## Nothing leaves your machine

Photos are read in the browser and stored in **IndexedDB** on your own device. There
is no server, no upload, no analytics, and no network request after the page loads.
Your photos never leave your computer.

Because the photos persist in IndexedDB between sessions, they also persist if you
close the tab. To wipe them out for good, use the **Reset** control:

- **On the timeline screen** — a `Reset` link at the bottom right of the footer.
- **On the upload screen** — a `Clear all photos` button, shown whenever photos are
  stored.

Either one empties IndexedDB immediately.

## Development

```sh
npm install          # install dependencies
npm run dev          # start the dev server (Vite, hot reload)
npm run build        # type-check and build to dist/
npm run preview      # serve the production build locally
npm test             # run the layout invariant tests
```

The dev server prints a local URL. Open `http://localhost:5173/` to reach the upload
screen, and `/timeline.html` for the timeline itself.

### Tech

- **Vite + TypeScript**, no UI framework.
- **exifr** for reading capture dates from photo EXIF metadata.
- **IndexedDB** for local photo storage.
- **Vitest** for the layout invariants.
- `npx tsc` runs the type-check on its own (`npm run build` runs it as part of the
  build).

### Deployment

`npm run build` produces a fully static `dist/`. Deploy it to GitHub Pages,
Cloudflare Pages, Vercel, or Netlify as-is. For GitHub Pages served from a
subdirectory, set `base` in `vite.config.ts` to your repo path.
