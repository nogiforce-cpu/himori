import { getShelves, getPhotos, getProfile, getChecksForShelf, getWoodAdditions } from '../store.js';
import { daysBetween, monthDayLabel, shelfStatusLabel, shelfStatusNote, shelfStatusBadgeColor } from '../derive.js';
import { go } from '../ui.js';
import { state } from '../state.js';
import { noPhotoPlaceholderHtml } from '../photos.js';
import { openShelfEditSheet } from './sheets.js';

function shelfPhotoThumbHtml(shelf, photos) {
  const photoId = shelf.photoIds[shelf.photoIds.length - 1];
  const photo = photoId ? photos.find((p) => p.id === photoId) : null;
  if (!photo) return noPhotoPlaceholderHtml();
  return `<div class="photo-ph"><img src="${photo.uri}" alt=""></div>`;
}

// 「残量75%減った」ではなく、直近の変化を中立的な事実として一言添える(前回チェックとの
// 差分、または直近の薪追加のどちらか新しい方)。増減どちらであっても煽った言い回しには
// しない。
function recentChangeNote(shelf) {
  const checks = getChecksForShelf(shelf.id);
  const additions = getWoodAdditions().filter((a) => a.shelfId === shelf.id);
  const latestAddition = additions.length ? additions.reduce((a, b) => (a.date > b.date ? a : b)) : null;
  if (latestAddition && (!checks[1] || latestAddition.date >= checks[1].date)) {
    return `${monthDayLabel(latestAddition.date)}に${latestAddition.addedVolumeM3}m³追加`;
  }
  if (checks.length >= 2) {
    const diff = Math.round((checks[0].usableVolumeM3 - checks[1].usableVolumeM3) * 100) / 100;
    if (diff < 0) return `前回から${Math.abs(diff)}m³使用`;
    if (diff > 0) return `前回から${diff}m³増加`;
  }
  return '';
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
            <div style="font-size:calc(13px * var(--font-scale));font-weight:700;margin-top:6px">乾燥中 1.5m³</div>
            <div class="label-sm">次の冬へ準備中</div>
          </div>
        </div>
        <div class="label-sm" style="text-align:center;margin:12px 0">最初の薪棚を登録しましょう。サイズと写真を登録すると、薪の記録を始められます。</div>
        <button class="btn-primary" data-action="open-add-shelf" style="width:100%">＋ 最初の薪棚を登録する</button>
      `
        : `<div class="empty">該当する薪棚がありません。</div>`;
    return;
  }
  const photos = getPhotos();
  const profile = getProfile();
  listEl.innerHTML = shelves
    .map((s) => {
      const isMain = profile.mainShelfId === s.id;
      const statusNote = shelfStatusNote(s.status);
      const changeNote = recentChangeNote(s);
      const lastCheckText = s.lastCheckedAt ? monthDayLabel(s.lastCheckedAt) : 'まだ記録がありません';
      return `
      <div class="shelf-card" data-action="open-shelf-check" data-shelf-id="${s.id}">
        ${shelfPhotoThumbHtml(s, photos)}
        <div class="info">
          <div class="shelf-name">${s.name}${isMain ? '<span class="main-tag">いつもの薪棚</span>' : ''}</div>
          <div class="row" style="margin-top:6px;align-items:baseline">
            <span style="font-size:calc(13px * var(--font-scale));font-weight:700">${shelfStatusLabel(s.status)} ${s.usableVolumeM3}m³</span>
          </div>
          ${statusNote ? `<div class="label-sm">${statusNote}</div>` : ''}
          <div class="label-sm" style="margin-top:5px">最終チェック ${lastCheckText}</div>
          ${changeNote ? `<div class="label-sm">${changeNote}</div>` : ''}
          ${s.woodTypes?.length ? `<div class="label-sm">樹種:${s.woodTypes.join('・')}</div>` : ''}
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
