# Photo Timeline — design brief

**Status:** mockup, wireframe fidelity. Two screens, settled interaction model.
**Last updated:** for the next agent picking this up.

---

## 1. What this is

A local-only photo browser. You point it at a folder, it lays every photo out in
time order, and a draggable focus dot moves you through the archive. Photos near
the focus date expand for inspection; everything else collapses to a small square.

Nothing is uploaded. The whole app is three HTML files, one stylesheet and one script.

---

## 2. Files

| File | What it is |
| --- | --- |
| `index.html` | Launcher / overview. Links the two screens. |
| `screen-1-choose-photos.html` | Screen 1 — empty state, one centred "Choose Photos" button. |
| `screen-2-timeline.html` | Screen 2 — the application shell. The real design. |
| `assets/photo-timeline.css` | Tokens (light + dark) and every component. Single source of truth for the visual system. |
| `assets/photo-timeline.js` | Dataset generation, the expansion model, rendering, all input handling. |
| `timeline-harness.js` | Headless DOM-shim test for the module. Run it after touching `assets/photo-timeline.js`. |
| `design-brief.md` | This file. |
| `photo-timeline-options.html` | **Superseded.** The three-way comparison that produced the decision below. Kept for reference — do not edit. |

Both screens are plain static pages and link each other. Open `index.html`.

---

## 3. The design decision that was made

We compared three ways to turn "days away from the focus" into "how big is this
thumbnail". Option B was chosen. The reasoning matters, so it is recorded here.

### The problem with a fixed σ

A gaussian with a fixed width of σ = 1.4 days is exactly right *inside a trip* —
several photos a day, you want to read one day against its neighbours. But a
typical archive is mostly silence.

Measured on the placeholder set (219 records, 123 photo-days, 2230 days), the
gap between consecutive photo-days is bimodal: p50 = 2 days inside clusters, but
p75 = 28, p90 = 58 and max = 80. A 1.4-day kernel covers well under one percent
of that range. Sweeping the axis in one-day steps, **78% of it has no open photo
at all** — the dot moves and the cloud does not. The histogram spikes; the space
between the spikes is dead.

The root cause is a unit mismatch. σ is measured in **days**, but the axis is
wildly non-uniform: a five-day trip and a two-month gap occupy the same "one
notch of the scroll wheel".

### The chosen model — adaptive σ, one bell

```
gap(f)  = distance from focus day f to the nearest OTHER day that has photos
σ(f)    = clamp( gap(f) / Φ ,  σmin ,  σmax )
e(t, f) = exp( −(t − f)² / (2 σ(f)²) )
openness = clamp( (e − DEAD) / (1 − DEAD), 0, 1 )
size      = 20px + openness · (190px − 20px)      // desktop
aspect    = 1 + openness/3                        // 1:1 → 4:3
z-index   = 1 + openness · 100                    // → foreground
```

Still one bell, still centred on the focus. Only its width is now a function of
the archive instead of a constant.

- Inside a cluster, `gap ≈ 0–1` so σ collapses to `σmin` and the behaviour is
  identical to the fixed model. Nothing about the good case changes.
- Halfway between two clusters, `gap` is half the quiet stretch, so σ widens until
  both neighbours are at the valley depth you asked for.

The result is a continuous landscape: **peaks on the data, troughs in the
silence.** Re-measured on the same sweep, the adaptive kernel leaves **0%** of
the axis dead.

One consequence worth knowing: because `localGap` is a *nearest-neighbour*
distance, a single isolated photo sitting in the middle of a void holds σ down
for the whole neighbourhood around it. The landscape is therefore lumpy at the
scale of individual records, not just at the scale of clusters. That is correct
behaviour — it is a statement about how alone the nearest thing is — but it means
the cloud does not undulate as smoothly as a hand-drawn curve would suggest.

### Why Φ is the only knob, and what it means

For a focus-centred kernel, the openness of the flanking clusters when the focus
sits exactly between them is

```
valley = exp( −Φ² / 2 )
```

Φ = 1.2 (the shipped default) puts the valley at **49 %** — the two clusters are
about half open, so you can see they are there without mistaking either for the
focus. Lower Φ lifts the floor toward 85 % and everything stays open (orientation,
not inspection). Higher Φ digs the trough toward 0 and the landscape undulates
hard. There is no other free parameter, which is why the model is cheap.

### Why not a mixture / overlapping gaussians

Tried and rejected, for a reason worth keeping. A mixture of bells whose *shape is
fixed in time* — whether you take the max or the sum — produces a landscape that
does not move when the focus moves. The picture is beautiful and completely
static. Something has to depend on the focus or there is no interaction.

The version that does work is to make σ a property of each **photo** rather than
of the focus: `e(t,f) = exp(−(t−f)²/2σ_t²)` with σ_t from that day's own
nearest-neighbour spacing. It is a real superposition and it does respond. It was
panel C in the options file. It was **not** chosen because the landscape goes
asymmetric in a way that is hard to predict — a lonely photo throws a wide bell
that opens long before you reach it, while a dense cluster keeps a narrow one and
only wakes when the dot is on top of it. Interesting, but the user loses the
ability to reason about what they are looking at. Worth revisiting if the goal ever
shifts from inspection to orientation.

### Shipped parameters

| Parameter | Value | Where |
| --- | --- | --- |
| `PHI` | `1.2` | `assets/photo-timeline.js`, top of file |
| `SIGMA_MIN` | `1.4` days | same |
| `DEAD` | `0.045` | same — below this a photo is a plain square |
| `SIGMA_MAX` | `clamp(0.03 × range, 25, 400)` days | derived, scales with the archive |
| `SCROLL_GAIN` | `0.32` | wheel → days, as a fraction of axis width |
| `FINE_GAIN` | `0.22` | shift + wheel |

---

## 4. Interaction model

| Input | Effect |
| --- | --- |
| **Drag** anywhere in the stage | Moves the focus continuously. |
| **Scroll / trackpad** | Moves the focus. Horizontal and vertical both work. Shift for fine. |
| **Arrow keys** | ±1 day. **Page Up/Down** ±7 days. **Home/End** archive ends. |
| **Click** a photo | Selects it, opens the record panel. Does *not* move the focus. The photo expands toward the centre of the cloud and floats above the rest. |
| **Click** empty space | Deselects and closes the panel. |
| **Click** the rail tab | Toggles the record panel. |
| **Escape** | Deselects and closes the panel. |
| **Light / Dark** | Segmented control, top right of every screen. Persisted in `localStorage`. |

Click and drag are separated by a 5 px threshold, so a click never nudges the
timeline. Collapsed squares are 20 px, well under the 44 px touch minimum, so
picking uses a 26 px forgiveness radius around each thumbnail's centre and
resolves to the topmost by z-index.

Screen 2 is a fixed `100svh` shell with `overflow: hidden`. The page itself never
scrolls — the timeline is the scroll surface. That is what makes wheel-to-timeline
unambiguous.

---

## 5. Reading screen 2

Top to bottom, inside the stage:

1. **Cloud band** — `1fr`, fills the leftover height. Thumbnails anchored by
   their bottom edge, jittered vertically, expanded ones in front.
2. **Histogram** — one smooth grey area sitting on the axis. Photo counts in
   ~220 pixel-bins (day-resolution bars would be 0.5 px wide on a six-year axis
   and merge into a block), smoothed with two passes of a `[1 2 1]/4` kernel and
   drawn as a monotone cubic Hermite curve so it never overshoots. Static: it
   does not react to the focus — the dot and the cloud already show that.
3. **Axis** — month ticks, labelled years, the draggable focus dot, and a date
   pill floating above it.

Right edge: the **record rail**, 44 px collapsed, 340 px open. Collapsed it shows
a vertical "Record" label and a dot that lights up when something is selected.

The expansion model is deliberately invisible. Nothing in the chrome shows σ, a
kernel, or an influence band — the user sees photos, one grey histogram, and a
dot. The status line that used to read focus / σ / open is gone; the foot line
is the same quiet shared line as screen 1.

---

## 6. Visual system

Design system **Minimal**. `assets/photo-timeline.css` starts with `tokens.css`
pasted verbatim into `:root`, then adds component scale. **Do not introduce new
colour values outside those two blocks** — derive with `color-mix()`.

One accent (`--accent`, the near-black / near-white of the theme) carries the
primary button and headings. One **signal** colour (`--signal`, DESIGN.md
Secondary) carries exactly one concept: *where you are*. Dot, crosshair,
selection ring, active theme pill. Nothing else uses it.

**The dark theme is a derivation, not a brand.** The Minimal package defines no
dark palette, so `:root[data-theme="dark"]` inverts the same neutral ramp and
lifts the signal hue for contrast on near-black. It is a judgement call, not a
spec — revisit it if a real dark palette arrives.

Motion is one 0.24 exponential lerp toward the target focus, so nothing in the
cloud ever jumps; `prefers-reduced-motion` collapses it to instant. Transitions
elsewhere run 140–220 ms on `--ease-standard`.

---

## 7. The data, honestly

**Screen 2 loads a synthetic placeholder set** — 219 records on 123 distinct days,
in 32 date clusters plus 34 scattered singles across 2014–2019, generated from a
fixed seed so it is identical on every load. The scattered singles are
deliberate: they make `localGap` irregular, which is the harder case. The record
panel's camera, lens, exposure and file size are **illustrative fabrications** and
are labelled "sample record" in the panel itself. Do not present them as real.

"Choose Photos" on screen 1 opens a real directory picker. On screen 2 there is
no picker button yet — see open question 3.

Real-file dates come from `file.lastModified`. **EXIF is not read.** A real
implementation needs `exifr` or `exifreader` to get capture dates, which will
change the dataset's shape and may well change the model parameters.

---

## 8. Open questions — what we are deciding next

1. **What earns screen space — resolved.** The σ landscape, the histogram
   influence band and the focus/σ/open status line are removed; the histogram
   is a single smooth grey area. The crosshair, date pill and record rail
   survive. If the model ever needs explaining again, the σ landscape is the
   first thing to bring back.
2. **What the record panel should actually contain.** It is currently a metadata
   list. It could instead be a preview, a filmstrip of the same day, or actions.
3. **Where folder loading lives.** The picker is on screen 1 but its result
   cannot cross a page boundary in a static mockup, so screen 1 navigates to
   screen 2 and screen 2 loads placeholders anyway. Either merge the two screens
   into one document, or move the picker into the screen 2 header.
4. **Whether scrolling should zoom.** Currently scroll = travel. An alternative
   is scroll = zoom the time axis, with a separate mechanism for travel.
5. **Thumbnail aspect.** Open photos resolve to 4:3 because the source format is
   unknown. With real files, per-photo aspect ratios become available and the
   cloud will look more varied.
6. **Large libraries.** 1500 records render fine. Beyond that the per-frame style
   writes need to move to a canvas or a spatial index.

---

## 9. Conventions for the next agent

- No build step, no framework, no dependencies. Plain ES2018 in one IIFE.
- Colour and spacing live only in `assets/photo-timeline.css`. No inline hex.
- `data-od-id` is on each screen region, the button, the topbar, the stage and
  the record panel.
- The screens link each other with plain relative paths.
- `localStorage` key for the theme: `photo-timeline:theme`.
- Touch targets: 44 px minimum for anything clickable. The collapsed thumbnails
  are the deliberate exception, handled by the pick radius.
