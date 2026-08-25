import { getPhotos, getShelves, getWoodAdditions, deletePhoto } from '../store.js';
import { monthDayLabel, resolvePhotoShelfId } from '../derive.js';
import { openPhotoViewSheet, openInfoSheet } from './sheets.js';
import { state } from '../state.js';

function monthLabel(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// 写真1枚の見出し(薪棚名、なければカテゴリ)と日付。「いつ・どの薪棚か」だけを添えて、
// 出来事の詳細はタップ後の写真シート・カレンダーの日別詳細に譲る(アルバムは写真が主役)。
function photoCaption(photo, shelves, woodAdditions) {
  const shelfId = resolvePhotoShelfId(photo.id, shelves, woodAdditions);
  const shelf = shelfId ? shelves.find((s) => s.id === shelfId) : null;
  return { name: shelf ? shelf.name : photo.category, date: monthDayLabel(photo.date) };
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
    el.innerHTML = `<div class="empty">まだ写真がありません。薪棚を記録すると、季節の変化がここに残っていきます。</div>`;
    return;
  }

  const shelves = getShelves();
  const woodAdditions = getWoodAdditions();
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
      <div class="album-feed">
        ${items
          .map((p) => {
            const cap = photoCaption(p, shelves, woodAdditions);
            return `
            <div class="photo-card" data-action="view-photo" data-photo-id="${p.id}">
              <div class="photo-ph"><img src="${p.uri}" alt=""></div>
              <div class="cap"><div class="name">${cap.name}</div><div class="label-sm">${cap.date}</div></div>
            </div>`;
          })
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

export function showAlbumInfo() {
  openInfoSheet(
    '写真について',
    '<p>写真はこのアルバムから直接追加することはできません。薪棚・薪ストーブ・メンテナンス記録・樹種コレクションそれぞれの編集画面から写真を登録すると、自動的にここに集まって振り返れるようになります。</p>'
  );
}
