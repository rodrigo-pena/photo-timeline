import { clearPhotos, countPhotos, putPhotos } from './lib/db.js';
import { processFiles } from './lib/exif.js';
import { addSkipped, clearSkipped } from './lib/skip-count.js';
import { initTheme } from './lib/theme.js';

initTheme();

const fileInput = document.getElementById('tl-file') as HTMLInputElement;
const folderInput = document.getElementById('tl-folder') as HTMLInputElement;
const chooseBtn = document.getElementById('tl-choose') as HTMLButtonElement;
const chooseFolderBtn = document.getElementById('tl-choose-folder') as HTMLButtonElement;
const errEl = document.getElementById('tl-err') as HTMLElement;
const statusEl = document.getElementById('tl-status') as HTMLElement;
const footStatus = document.getElementById('tl-foot-status') as HTMLElement;
const skipLink = document.getElementById('tl-skip') as HTMLAnchorElement;
const resetBtn = document.getElementById('tl-reset') as HTMLButtonElement;

let processing = false;

async function handleFiles(files: FileList | File[]): Promise<void> {
  if (processing || files.length === 0) return;
  processing = true;
  errEl.hidden = true;
  statusEl.hidden = false;
  statusEl.textContent = `Processing ${files.length} files…`;

  try {
    const { photos, skippedCount } = await processFiles(Array.from(files));

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
  footStatus.textContent = 'Data privacy: nothing leaves your machine';
  skipLink.textContent = 'Skip to the timeline →';
  resetBtn.hidden = true;
});

(async () => {
  try {
    const count = await countPhotos();
    if (count > 0) {
      footStatus.textContent = `${count} photos stored locally`;
      skipLink.textContent = 'Continue to timeline →';
      resetBtn.hidden = false;
    }
  } catch {
    // IndexedDB not available
  }
})();
