import { getShelves, getPhotos, getProfile, getChecksForShelf } from '../store.js';
import { barColor, daysBetween, shouldShowDryAdvisory, moistureDisplayText } from '../derive.js';
import { go } from '../ui.js';
import { state } from '../state.js';

function statusBadgeColor(status) {
  if (status === '乾燥済み') return 'green';
  if (status === '来季用') return 'khaki';
  return 'amber';
}

function shelfPhotoThumbHtml(shelf, photos) {
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  const src = photo ? photo.uri : 'assets/sample-woodshelf-1.jpg';
  return `<div class="photo-ph"><img src="${src}" alt=""></div>`;
}

export function render() {
  const filtersEl = document.getElementById('shelf-filters');
  filtersEl.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === state.shelfFilter);
  });

  const shelves = getShelves().filter(
    (s) => state.shelfFilter === 'all' || s.status === state.shelfFilter
  );

  const listEl = document.getElementById('shelf-list');
  if (shelves.length === 0) {
    listEl.innerHTML = `<div class="empty">該当する薪棚がありません。</div>`;
    return;
  }
  const photos = getPhotos();
  const profile = getProfile();
  listEl.innerHTML = shelves
    .map((s) => {
      const lastDays = daysBetween(s.lastCheckedAt);
      const dryingDays = s.dryingStartedAt ? daysBetween(s.dryingStartedAt) : null;
      const isMain = profile.mainShelfId === s.id;
      const latestCheck = getChecksForShelf(s.id)[0] || null;
      const advisory = shouldShowDryAdvisory(s, latestCheck)
        ? `<div class="dry-advisory" style="margin-top:5px">そろそろ乾燥薪かもしれません</div>`
        : '';
      const moistureText = moistureDisplayText(latestCheck);
      return `
      <div class="shelf-card" data-action="open-shelf-check" data-shelf-id="${s.id}">
        ${shelfPhotoThumbHtml(s, photos)}
        <div class="info">
          <div class="shelf-name">${s.name}${isMain ? '<span class="main-tag">レギュラー</span>' : ''}</div>
          <span class="badge ${statusBadgeColor(s.status)}">${s.status}</span>
          <div class="row" style="margin-top:6px"><span class="label-sm">残量${s.remainingPercent}%・約${s.usableVolumeM3}m³</span></div>
          <div class="progress"><div style="width:${s.remainingPercent}%;background:${barColor(s.remainingPercent)}"></div></div>
          <div class="label-sm" style="margin-top:5px">最終チェック:${lastDays}日前${dryingDays != null ? `・乾燥経過${dryingDays}日` : ''}</div>
          ${moistureText ? `<div class="label-sm">${moistureText}</div>` : ''}
          ${advisory}
          ${isMain ? '' : `<button class="link-btn" style="padding:6px 0 0" data-action="set-main-shelf" data-shelf-id="${s.id}">レギュラーにする</button>`}
        </div>
        <span class="chev"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-chevright"/></svg></span>
      </div>`;
    })
    .join('');
}

export function setFilter(filter) {
  state.shelfFilter = filter;
  render();
}

export function openShelfCheck(shelfId) {
  state.currentShelfId = shelfId;
  go('check');
}
