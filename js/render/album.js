import { getPhotos, deletePhoto } from '../store.js';
import { pickImageFile, fileToResizedDataUrl } from '../photos.js';
import { openAddPhotoSheet, openPhotoViewSheet } from './sheets.js';
import { state } from '../state.js';

function monthLabel(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function render() {
  document.querySelectorAll('#album-filters button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === state.albumFilter);
  });

  const photos = getPhotos()
    .filter((p) => state.albumFilter === 'all' || p.category === state.albumFilter)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const el = document.getElementById('album-content');
  if (photos.length === 0) {
    el.innerHTML = `<div class="empty">まだ写真がありません。右上の＋から追加できます。</div>`;
    return;
  }

  const groups = new Map();
  photos.forEach((p) => {
    const label = monthLabel(p.date);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(p);
  });

  el.innerHTML = Array.from(groups.entries())
    .map(
      ([label, items]) => `
      <div class="month-label">${label}</div>
      <div class="album-grid">
        ${items
          .map(
            (p) => `<div class="photo-ph" data-action="view-photo" data-photo-id="${p.id}"><img src="${p.uri}" alt=""></div>`
          )
          .join('')}
      </div>
    `
    )
    .join('');
}

export function setFilter(filter) {
  state.albumFilter = filter;
  render();
}

export function viewPhoto(photoId) {
  const photo = getPhotos().find((p) => p.id === photoId);
  if (!photo) return;
  openPhotoViewSheet(photo, () => {
    deletePhoto(photoId);
    render();
  });
}

export async function addPhotoFlow() {
  const file = await pickImageFile();
  if (!file) return;
  const dataUrl = await fileToResizedDataUrl(file);
  openAddPhotoSheet(dataUrl, () => render());
}
