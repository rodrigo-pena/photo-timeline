# Photo Timeline

A minimal, local-only photo timeline explorer. Load a folder of photos, and browse
them in date order along an interactive timeline. Photos near the focus date expand
for inspection; everything else collapses to a small thumbnail. A draggable focus
dot moves you through the archive.

## Nothing leaves this machine

Photos are read in the browser and stored in **IndexedDB** on your own device. There
is no server, no upload, no analytics, and no network request after the page loads.
Your photos never leave your computer.

Because the photos persist in IndexedDB between sessions, they also persist if you
close the tab. To wipe them out for good, use the **Reset** control:

- **On the timeline screen** — a `Reset` link at the bottom right of the footer.
- **On the upload screen** — a `Clear all photos` button, shown whenever photos are
  stored.

Either one empties IndexedDB immediately. Note that this is a normal button, not a
"confirm first" dialog, so treat it as the privacy control it is.

## Development

```sh
npm install          # install dependencies
npm run dev          # start the dev server (Vite, hot reload)
npm run build        # type-check and build to dist/
npm run preview      # serve the production build locally
```

The dev server prints a local URL. Open `http://localhost:5173/` to reach the upload
screen, and `/timeline.html` for the timeline itself.

### Tech

- **Vite + TypeScript**, no UI framework. The complexity lives in the timeline math
  and rendering, not in UI state management.
- **exifr** for reading capture dates from photo EXIF metadata.
- **IndexedDB** for local photo storage.
- `npx tsc` runs the type-check on its own; `npm run build` runs it as part of the
  build.

## Deployment

`npm run build` produces a fully static `dist/`. Deploy it to GitHub Pages,
Cloudflare Pages, Vercel, or Netlify as-is. For GitHub Pages served from a
subdirectory, set `base` in `vite.config.ts` to your repo path.

## How the timeline works

Photos are grouped by day and ordered along a date axis. A gaussian kernel centred
on the current focus date decides how "open" each photo is, which drives its size,
vertical jitter, and stacking order. The kernel's width adapts to the spacing
between photo days, so dense clusters open up while long quiet stretches stay
compact.

You can drag anywhere in the stage, scroll, or use the arrow keys (`←` `→` for one
day, `Page Up` / `Page Down` for a week, `Home` / `End` for the archive ends) to
move the focus. Click any photo to select it — it expands and floats to the centre
while the record panel shows its metadata. Click the background or press `Escape`
to deselect. A light/dark toggle sits at the top right and is remembered between
sessions.

The design rationale and the earlier model comparison live in
[`mockup/design-brief.md`](mockup/design-brief.md).
