/*
 * Synthetic archive for measuring the timeline screen in a real browser.
 *
 * Injected before any page script runs, so it replaces the real IndexedDB with
 * an in-memory store. Load it with:
 *
 *   await page.addInitScript({ path: 'bench/timeline-fixture.js' })
 *   await page.goto('/timeline.html?bench=700')
 *
 * Why fake IndexedDB rather than seeding the real one: the app's archive lives
 * in the browser profile, and seeding 700 multi-megabyte originals would
 * overwrite the user's real photos and write gigabytes to disk. Nothing here
 * touches storage, and no photo ever leaves memory.
 *
 * Photo bytes are a pool of distinct full-resolution JPEGs shared across
 * records, because generating one unique original per photo costs minutes and
 * gigabytes. Decode cost per card is therefore realistic -- real JPEG, real
 * dimensions -- but Chrome can dedupe the decoded bitmap across records that
 * share bytes, so this UNDERSTATES the image memory pressure of an archive of
 * genuinely unique files. Read decode and image-cache numbers as a floor.
 *
 * The layout shape is a real archive's shape, not an even scatter: uneven
 * shoots over years. The span is constant across `?bench=` values so 10000
 * measures the same geometry as 320 and only the photo count varies.
 *
 * ?bench=<photoCount>   number of photos to synthesise (default 700)
 * ?pool=<count>         distinct JPEGs to cycle through (default 24)
 * ?recd=<ms>            record a load-phase timeline into __LOAD__
 */
(() => {
  const params = new URLSearchParams(location.search);
  const N = Number(params.get('bench')) || 700;
  const POOL_SIZE = Number(params.get('pool')) || 24;
  const RECORD_LOAD = Number(params.get('recd')) || 0;

  const SHOOTS = 140;
  const SPAN_DAYS = 2000;
  const START_DAY = Math.floor(Date.UTC(2015, 0, 1) / 86400000);
  const SHAPES = [
    [4000, 3000], [3000, 4000], [5472, 3648], [4000, 4000],
    [2560, 1080], [4032, 3024], [2000, 3000], [3648, 5472],
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Distinct, non-trivial JPEG content. Flat gradients compress to almost
     nothing, which would make decode look far cheaper than a real photo. */
  async function makePool() {
    const pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const [w, h] = SHAPES[i % SHAPES.length];
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const rnd = mulberry32(1000 + i);
      const hue = Math.floor(rnd() * 360);

      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `hsl(${hue} 65% ${15 + rnd() * 45}%)`);
      grad.addColorStop(1, `hsl(${(hue + 150) % 360} 65% ${15 + rnd() * 45}%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (let k = 0; k < 90; k++) {
        ctx.fillStyle = `hsla(${(hue + rnd() * 300) | 0} 80% ${30 + rnd() * 50}% / ${0.15 + rnd() * 0.5})`;
        const r = 40 + rnd() * Math.min(w, h) * 0.22;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));

      /* The same 480px thumbnail the import pipeline writes, so the fixture
         measures the timeline the app actually builds rather than one still
         drawing full-resolution originals. */
      const t = document.createElement('canvas');
      const long = Math.max(w, h);
      const s = long > 480 ? 480 / long : 1;
      t.width = Math.max(1, Math.round(w * s));
      t.height = Math.max(1, Math.round(h * s));
      t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
      const thumb = await new Promise((res) => t.toBlob(res, 'image/jpeg', 0.72));
      t.width = 1;
      t.height = 1;

      pool.push({ blob, thumb, w, h });
      /* Drop the backing store immediately: 24 live 4000x3000 canvases is
         ~1GB of RGBA and Chrome will start evicting the wrong things. */
      canvas.width = 1;
      canvas.height = 1;
    }
    return pool;
  }

  function buildRecords(pool) {
    const rnd = mulberry32(7);
    const weights = Array.from({ length: SHOOTS }, () => 0.3 + rnd() * rnd() * 3);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const counts = weights.map((w) => Math.max(1, Math.round((N * w) / weightSum)));

    let total = counts.reduce((a, b) => a + b, 0);
    while (total > N) {
      let big = 0;
      for (let i = 1; i < counts.length; i++) if (counts[i] > counts[big]) big = i;
      counts[big]--; total--;
    }
    while (total < N) { counts[(rnd() * counts.length) | 0]++; total++; }

    const shootDays = Array.from({ length: SHOOTS }, () => (rnd() * SPAN_DAYS) | 0).sort((a, b) => a - b);

    const records = [];
    let made = 0;
    for (let s = 0; s < SHOOTS; s++) {
      const day = START_DAY + shootDays[s];
      for (let i = 0; i < counts[s]; i++) {
        const img = pool[made % pool.length];
        records.push({
          id: `p${made}`,
          blob: img.blob,
          thumb: img.thumb,
          name: `IMG_${String(made).padStart(5, '0')}.jpg`,
          date: day,
          fileModifiedDay: day,
          width: img.w,
          height: img.h,
          camera: 'Bench Camera',
          lens: 'Bench 24-70mm',
        });
        made++;
      }
    }
    return records;
  }

  let store = null;
  const t_start = performance.now();
  const ready = makePool().then((pool) => {
    store = buildRecords(pool);
    window.__BENCH_READY__ = {
      count: store.length,
      blobBytes: store.reduce((a, r) => a + (r.blob.size || 0), 0),
      thumbBytes: store.reduce((a, r) => a + (r.thumb ? r.thumb.size : 0), 0),
    };
  });

  /* Load-phase timeline. The jank people report is mostly not steady-state
     panning -- it is the first seconds, while 700 object URLs are created and
     their originals are fetched and decoded. Polls cheaply and records the
     milestones so they can be read back after the fact. */
  if (RECORD_LOAD) {
    window.__LOAD__ = { t0: t_start, marks: [], samples: [] };
    const mark = (name) => window.__LOAD__.marks.push({ name, at: Math.round(performance.now() - t_start) });

    addEventListener('load', () => mark('window.load'));
    addEventListener('DOMContentLoaded', () => mark('DOMContentLoaded'));

    const poll = setInterval(() => {
      const imgs = document.querySelectorAll('.tl-thumb img');
      if (!imgs.length) return;
      let complete = 0, natural = 0;
      for (const im of imgs) {
        if (im.complete) complete++;
        if (im.naturalWidth > 0) natural++;
      }
      const cards = document.querySelectorAll('.tl-thumb').length;
      window.__LOAD__.samples.push({
        at: Math.round(performance.now() - t_start),
        cards,
        complete,
        natural,
        painted: cards > 0 && complete > 0,
      });
      if (complete === imgs.length && imgs.length > 0) {
        mark('all images complete');
        clearInterval(poll);
      }
      if (performance.now() - t_start > RECORD_LOAD) clearInterval(poll);
    }, 50);
  }

  const realOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = function fakeOpen(name, version) {
    if (name !== 'photo-timeline') return realOpen(name, version);

    const request = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({}),
      close() {},
      transaction() {
        const tx = { oncomplete: null, onerror: null, error: null };
        const objectStore = {
          getAll() {
            const req = { onsuccess: null, onerror: null, result: null };
            Promise.resolve(ready).then(() => {
              req.result = store.slice();
              if (req.onsuccess) req.onsuccess({ target: req });
            });
            return req;
          },
          get(key) {
            const req = { onsuccess: null, onerror: null, result: null };
            Promise.resolve(ready).then(() => {
              req.result = store.find((r) => r.id === key);
              if (req.onsuccess) req.onsuccess({ target: req });
            });
            return req;
          },
          put(value) { store.push(value); },
          clear() { store.length = 0; },
          count() {
            const req = { onsuccess: null, onerror: null, result: null };
            Promise.resolve(ready).then(() => {
              req.result = store.length;
              if (req.onsuccess) req.onsuccess({ target: req });
            });
            return req;
          },
        };
        tx.objectStore = () => objectStore;
        /* putPhotos resolves on tx.oncomplete; fire it once the sync put loop
           has drained. */
        queueMicrotask(() => queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete({ target: tx }); }));
        return tx;
      },
    };
    request.result = db;
    Promise.resolve().then(() => { if (request.onsuccess) request.onsuccess({ target: request }); });
    return request;
  };
})();