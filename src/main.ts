import { clearPhotos, countPhotos, putPhotos } from './lib/db.js';
import { processFiles } from './lib/exif.js';
import { addSkipped, clearSkipped } from './lib/skip-count.js';
import { initTheme } from './lib/theme.js';
import { hasThumbnails, noteThumbnailsWritten } from './lib/thumb-state.js';

initTheme();

const fileInput = document.getElementById('tl-file') as HTMLInputElement;
const folderInput = document.getElementById('tl-folder') as HTMLInputElement;
const chooseBtn = document.getElementById('tl-choose') as HTMLButtonElement;
const chooseFolderBtn = document.getElementById('tl-choose-folder') as HTMLButtonElement;
const errEl = document.getElementById('tl-err') as HTMLElement;
const statusEl = document.getElementById('tl-status') as HTMLElement;
const footStatus = document.getElementById('tl-foot-status') as HTMLElement;
const skipLink = document.getElementById('tl-skip') as HTMLAnchorElement;
const rethumbEl = document.getElementById('tl-rethumb') as HTMLParagraphElement;
const resetBtn = document.getElementById('tl-reset') as HTMLButtonElement;

let processing = false;

async function handleFiles(files: FileList | File[]): Promise<void> {
  if (processing || files.length === 0) return;
  processing = true;
  errEl.hidden = true;
  statusEl.hidden = false;

  const total = files.length;
  let lastPaint = 0;
  /* An import of 700 photos takes seconds, and the screen used to say
     "Processing 700 files…" and then nothing at all until it finished, which
     reads as a hang. The text is repainted at most every 100ms: progress that
     updates faster than the eye can follow is just extra layout on the main
     thread while the decoder is competing for it. */
  const showProgress = (done: number): void => {
    const now = performance.now();
    if (done < total && now - lastPaint < 100) return;
    lastPaint = now;
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;
    statusEl.textContent = done >= total
      ? `Reading ${total} files…`
      : `Reading ${done} of ${total} files… ${pct}%`;
  };
  showProgress(0);

  try {
    const { photos, skippedCount } = await processFiles(Array.from(files), showProgress);

    if (photos.length === 0) {
      addSkipped(skippedCount);
      statusEl.textContent = skippedCount > 0
        ? `No photos with EXIF date metadata found (${skippedCount} skipped).`
        : 'No valid photos found.';
      processing = false;
      return;
    }

    await putPhotos(photos);
    addSkipped(skippedCount);
    /* Recorded from what was actually written, not from the fact that an import
       ran: a browser with no OffscreenCanvas writes no thumbnails at all, and
       telling that one to re-import would be advice it cannot act on. */
    noteThumbnailsWritten(photos.filter((p) => p.thumb).length);
    rethumbEl.hidden = true;

    const total = await countPhotos();
    footStatus.textContent = `${total} photos stored locally`;

    if (skippedCount > 0) {
      statusEl.textContent = `${photos.length} photos added, ${skippedCount} skipped (no EXIF date).`;
    } else {
      statusEl.textContent = `${photos.length} photos added.`;
    }

    setTimeout(() => {
      window.location.href = 'timeline.html';
    }, 800);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = 'Failed to process photos. Please try again.';
    statusEl.hidden = true;
    processing = false;
  }
}

chooseBtn.addEventListener('click', () => fileInput.click());
chooseFolderBtn.addEventListener('click', () => folderInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files) handleFiles(fileInput.files);
  fileInput.value = '';
});

folderInput.addEventListener('change', () => {
  if (folderInput.files) handleFiles(folderInput.files);
  folderInput.value = '';
});

resetBtn.addEventListener('click', async () => {
  await clearPhotos();
  clearSkipped();
  footStatus.textContent = 'Data privacy: your photos never leave your device';
  skipLink.textContent = 'Skip to the timeline →';
  resetBtn.hidden = true;
  rethumbEl.hidden = true;
});

(async () => {
  try {
    const count = await countPhotos();
    if (count > 0) {
      footStatus.textContent = `${count} photos stored locally`;
      skipLink.textContent = 'Continue to timeline →';
      resetBtn.hidden = false;
      /* An archive stored before thumbnails existed still works, it just draws
         full-resolution originals, and at 700 photos that is about eight seconds
         of decoding spread across the first visit. Worth saying once. */
      if (!hasThumbnails()) {
        rethumbEl.textContent =
          'These photos were stored before thumbnails existed, so the timeline '
          + 'has to decode every full-size original. Re-importing them makes the '
          + 'timeline much faster.';
        rethumbEl.hidden = false;
      }
    }
  } catch {
    // IndexedDB not available
  }
})();
