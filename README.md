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

The footer says how many dates were corrected, the record panel names the date each
one was moved off, and a `use camera dates` link beside `reset` puts them all back. The
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
npm test             # run the tests
npm run bench        # run the benchmarks
```

The dev server prints a local URL. Open `http://localhost:5173/` to reach the upload
screen, and `/timeline.html` for the timeline itself.

## Where the time goes

Measured in Chrome on an M5 Max, 700 photos, 1440×900 at DPR 2. These are the
numbers behind the design, kept here because they are the only reason several
odd-looking decisions exist.

**Decoding, not layout.** A whole `render()` — measure, layout, and writing all
700 cards — is **1.29 ms**, and a pan runs at the display's full refresh rate. The
arithmetic was never the problem:

| `computeLayout`, focus sweeping | ms/frame |
|---|---|
| 320 photos | 0.007 |
| 700 photos | 0.013 |
| 2 000 photos | 0.034 |
| 10 000 photos | 0.167 |

Decoding images was. A 4000×3000 JPEG costs **11.6 ms** to decode and 400 KB to
hold; the 480 px thumbnail the cloud actually draws costs **0.04 ms** and 13 KB.
That is **308× to decode and 31× less to hold**, and it is the whole difference
between 8.15 s of decode for a 700-photo archive and 319 ms.

Seven hundred twelve-megapixel originals want roughly 33 GB resident, which no
browser holds, so it evicts and re-decodes on demand. Cards arrive as
placeholders or stale low-res rasters — which is what "images that don't load,
or load blurry" actually is — and the decode competes with the compositor for the
first several seconds of browsing, which is the freezing.

So the originals are kept but no longer drawn. A thumbnail is made once at
import, from a decode the import already had to do. The selected card needs more
than a thumbnail, so a 2560 px preview is made on demand the first time a photo
is opened and cached afterwards (52 ms from click to sharp).

**Archives stored before thumbnails existed still work.** They simply draw their
originals, exactly as before, and the upload screen says so once. Re-importing is
worth doing for the speed; nothing breaks if you never do.

**Reconciliation used to be quadratic.** Each burst asked whether its file date
was the archive's copy date by recounting every *other* photo in the archive, so
the pass cost O(N × bursts) on every load and every toggle of the corrected-dates
control — 128 ms for 2 000 photos, and growing. The file dates are now tallied
once for the archive and each burst subtracts its own contribution. The gates
that reject a burst outright are also checked first, so a burst that was going to
be abandoned anyway costs a predicate instead of a walk.

**Measured and left alone.** `will-change: transform` on `.tl-thumb` looked like
704 pinned compositor layers. It is not: a controlled A/B put `UpdateLayer` at
145 per frame either way — Chrome promotes the cards that have an active
transition regardless — and removing it made paint, layout and style
recalculation *worse*, 1.27 → 2.12 ms/frame. It stayed.

### Benchmarks

`npm run bench` covers the two pure passes: `computeLayout` at 320 / 700 / 2 000 /
10 000 photos, and `reconcileDates` across the archive shapes that decide how
expensive reconciliation is. The reconcile cases are named by photos-per-shoot
rather than by burst count, because that — not the burst count — decides whether
a burst can clear the gates at all.

The engine benchmark runs in Node and needs nothing. For the browser-side costs
(style recalc, layout, paint, image decode) use `bench/timeline-fixture.js`, which
serves a synthetic archive in place of IndexedDB:

```js
await page.addInitScript({ path: 'bench/timeline-fixture.js' })
await page.goto('/timeline.html?bench=700')   // ?bench=N, ?pool=N, ?recd=MS
```

It writes nothing to disk and cannot touch a real archive. Its image bytes are a
pool shared across records, so decode and image-cache numbers from it are a floor
rather than a ceiling.

### Tech

- **Vite + TypeScript**, no UI framework.
- **exifr** for reading capture dates from photo EXIF metadata.
- **IndexedDB** for local photo storage.
- **Vitest** for the tests and benchmarks.
- `npx tsc` runs the type-check on its own (`npm run build` runs it as part of the
  build).

### Deployment

`npm run build` produces a fully static `dist/`. Deploy it to GitHub Pages,
Cloudflare Pages, Vercel, or Netlify as-is. For GitHub Pages served from a
subdirectory, set `base` in `vite.config.ts` to your repo path.
