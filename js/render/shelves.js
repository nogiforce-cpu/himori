import { getShelves, getPhotos, getProfile, getChecksForShelf } from '../store.js';
import { barColor, daysBetween, shouldShowDryAdvisory, moistureDisplayText } from '../derive.js';
import { go } from '../ui.js';
import { state } from '../state.js';
import { noPhotoPlaceholderHtml } from '../photos.js';
import { openShelfEditSheet } from './sheets.js';

function statusBadgeColor(status) {
  if (status === '乾燥済み') return 'green';
  if (status === '来季用') return 'khaki';
  return 'amber';
}

function shelfPhotoThumbHtml(shelf, photos) {
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  if (!photo) return noPhotoPlaceholderHtml();
  return `<div class="photo-ph"><img src="${photo.uri}" alt=""></div>`;
}

export function render() {
  const filtersEl = document.getElementById('shelf-filters');
  filtersEl.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === state.shelfFilter);
  });

  const allShelves = getShelves();
  const shelves = allShelves.filter((s) => state.shelfFilter === 'all' || s.status === state.shelfFilter);

  const listEl = document.getElementById('shelf-list');
  if (shelves.length === 0) {
    // 薪棚が1つも無い場合は、実際のカードと同じ形の見本を薄く表示する。レイアウトが
    // 先に伝わることで「登録するとこう並ぶんだ」がわかり、空欄を埋めたくなる効果を狙う
    // (フィルタで該当が無いだけの場合は、この見本を出す必要が無いので分けている)。
    listEl.innerHTML =
      allShelves.length === 0
        ? `
        <div class="shelf-card" style="opacity:.45;pointer-events:none">
          ${noPhotoPlaceholderHtml()}
          <div class="info">
            <div class="shelf-name">薪棚の名前</div>
            <span class="badge khaki">乾燥中</span>
            <div class="row" style="margin-top:6px"><span class="label-sm">残量70%・約1.5m³</span></div>
            <div class="progress"><div style="width:70%;background:var(--khaki)"></div></div>
          </div>
        </div>
        <button class="btn-primary" data-action="open-add-shelf" style="width:100%;margin-top:14px">＋ 最初の薪棚を登録する</button>
      `
        : `<div class="empty">該当する薪棚がありません。</div>`;
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
        ? `<div class="dry-advisory" style="margin-top:5px">そろそろ乾燥が進んでいるかもしれません</div>`
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
          ${s.woodTypes?.length ? `<div class="label-sm">樹種:${s.woodTypes.join('・')}</div>` : ''}
          ${moistureText ? `<div class="label-sm">${moistureText}</div>` : ''}
          ${advisory}
          ${isMain ? `<button class="link-btn" style="padding:6px 0 0" data-action="release-main-shelf">レギュラーを解除</button>` : s.status === '来季用' ? '' : `<button class="link-btn" style="padding:6px 0 0" data-action="set-main-shelf" data-shelf-id="${s.id}">レギュラーにする</button>`}
        </div>
        <button class="iconbtn" data-action="edit-shelf-from-list" data-shelf-id="${s.id}" style="flex-shrink:0"><svg class="icon" viewBox="0 0 24 24" style="width:17px;height:17px"><use href="#i-edit"/></svg></button>
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

// 薪棚一覧のカードから直接、乾燥状態(乾燥中/乾燥済み/来季用)などを編集できるようにする。
// 以前はチェック画面の鉛筆アイコンからしか編集できず、特にステータスの手動変更(翌シーズンに
// 再利用する薪棚の状態を戻すなど)にたどり着きにくかったため、一覧からも直接開けるようにする。
export function editShelfFromList(shelfId) {
  openShelfEditSheet(shelfId, () => render());
}
