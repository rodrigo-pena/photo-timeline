import { initTheme } from './lib/theme.js';
import { processFiles } from './lib/exif.js';
import { putPhotos, countPhotos, clearPhotos } from './lib/db.js';

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
    const { photos, failedCount } = await processFiles(Array.from(files));

    if (photos.length === 0) {
      statusEl.textContent = failedCount > 0
        ? `No photos with date metadata found (${failedCount} skipped).`
        : 'No valid photos found.';
      processing = false;
      return;
    }

    await putPhotos(photos);

    const total = await countPhotos();
    footStatus.textContent = `${total} photos stored locally`;

    if (failedCount > 0) {
      statusEl.textContent = `${photos.length} photos added, ${failedCount} skipped (no date metadata).`;
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
  footStatus.textContent = 'Nothing leaves this machine.';
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
