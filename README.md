# Photo Timeline

[![Netlify Status](https://api.netlify.com/api/v1/badges/d5622a93-dbdd-4531-9877-51655a63a592/deploy-status)](https://app.netlify.com/projects/rcgp-photo-timeline/deploys)

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

Each day owns a block of cards standing on its own date, and how open the day is
decides what shape that block takes. A day far from the focus gets a narrow
budget and tiles its cards on a square cell, so a distant cluster stays the thin
column that echoes the histogram. A day near the focus is given up to
`--tl-fan-open` of the plot, and its cells reserve each card's own box, so the
photos open out across the table with none of them hiding another.

The looseness scales the same way. Cards lean up to twelve degrees and wander off
their cell, both hashed from the photo's stable index so nothing twitches while
the focus moves, and both capped so that no card can cover another card's centre
— a centre is always there to click. Hovering lifts a card above its neighbors.

You can drag anywhere in the stage, scroll, or use the arrow keys (`←` `→` for one
day, `Page Up` / `Page Down` for a week, `Home` / `End` for the archive ends) to
move the focus. Click any photo to select it: the thumbnail expands and floats to
the centre while the record panel shows its metadata. Click the background or
press `Escape` to deselect. A light/dark toggle sits at the top right and is
remembered between sessions.

## Dates

A camera whose clock was never reset dates an entire shoot to the wrong year, and
the photos are otherwise perfectly good. Nothing in the metadata admits it: the
capture date, the create date and the modify date all carry the same wrong value,
because the editor that wrote the file preserved the capture date verbatim. The
file's own date is the one timestamp no export rewrites, so it is the only thing
left that disagrees — and it is kept alongside the EXIF date for exactly that
reason. It never decides where a photo sits; a photo with no usable EXIF date is
still skipped rather than misdated.

When a file date contradicts EXIF by years, the whole run of photos moves by one
offset rather than each photo taking its own file date. A mis-set clock is still
running — it reports plausible times of day and advances correctly — so a
shoot's spacing within itself is good and only its epoch is wrong. Shifting by
whole days keeps that spacing, where re-dating each photo would flatten an
occasion into a single spike.

Because copying and syncing a folder rewrite every file's date to the moment of
the copy, a large share of a library often carries one file date that says nothing
at all. So a run only moves when its file dates agree with each other and are not
the date the rest of the archive shares, when it is big enough to be evidence
about itself, and when the gap is longer than any shoot-to-export workflow
plausibly takes. Every one of those has to hold, and when any of them does not,
nothing is touched.

The footer says how many photos were moved, the record panel names the date each
one was moved off, and a `raw EXIF` link beside `reset` puts them all back. The
day a photo lands on is the file's own date rather than the shutter's, so this
corrects the year rather than the day.

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
