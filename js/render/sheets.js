import { openOverlay, closeOverlay, showToast, openConfirmSheet, go } from '../ui.js';
import {
  getShelves,
  getShelf,
  updateBurnLog,
  addWoodAddition,
  updateShelf,
  addShelf,
  deleteShelf,
  addPhoto,
  deletePhoto,
  getPhotos,
  addSplitLog,
  getWoodAdditions,
  getProfile,
  updateProfile,
  getWoodTypeCatalog,
  addWoodTypeToCatalog,
  deleteWoodTypeFromCatalog,
  getWoodTypeDetail,
  updateWoodTypeDetail,
  getMaintenanceLogs,
  addMaintenanceLog,
  updateMaintenanceLog,
  getChecks,
  updateCheck,
  deleteCheck,
} from '../store.js';
import {
  applyWoodAddition,
  todayIso,
  daysBetween,
  CHECKLIST_ITEMS,
  CHECK_STATE_LABELS,
  nextCheckState,
  resolvePhotoShelfId,
  monthDayLabel,
  firstWoodTypeDates,
} from '../derive.js';
import { localIsoDate } from '../date-utils.js';
import { pickImageFile, fileToResizedDataUrl } from '../photos.js';
import { resolveLocationFromCity, fetchCitiesForPrefecture, PREFECTURES } from '../weather.js';
import { listRegionsForOffice } from '../jma.js';
import { state } from '../state.js';
import { focusOnDate } from './calendar.js';
import { eventRowHtml } from './event-row.js';

// ---- 汎用: 写真1枚の登録・差し替えフィールド ----
// 薪棚・薪ストーブ・メンテ記録など、写真を持つあらゆる記録の編集シートから
// 同じ操作感(タップして選ぶ→その場でプレビュー→保存時に反映)で使えるようにする。
// state.uri: null="未変更(既存のまま)"、''="削除"、それ以外="新しい写真"。
// 空欄がカメラアイコンだけだと、初めて見た人には「これは何?」と伝わりにくい。
// 点線枠+短いラベルを添えて、タップして追加できる場所だとひと目で分かるようにする。
const EMPTY_PHOTO_INNER = `<svg class="icon" viewBox="0 0 24 24"><use href="#i-camera"/></svg><span>タップして追加</span>`;

function photoFieldHtml(id, existingUri) {
  const inner = existingUri ? `<img src="${existingUri}" alt="">` : EMPTY_PHOTO_INNER;
  const emptyClass = existingUri ? '' : ' empty';
  return `
    <div class="field">
      <label>写真(任意)</label>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="photo-ph${emptyClass}" id="${id}" style="height:70px;width:70px;border-radius:8px;cursor:pointer">${inner}</div>
        ${existingUri ? `<button type="button" class="link-btn" id="${id}-remove">写真を削除</button>` : ''}
      </div>
    </div>`;
}

function wirePhotoField(ov, id, existingUri) {
  const state = { uri: null }; // null=未変更、''=削除、それ以外=新しい写真のdataURL
  const box = ov.querySelector(`#${id}`);
  box.addEventListener('click', async () => {
    const file = await pickImageFile();
    if (!file) return;
    state.uri = await fileToResizedDataUrl(file);
    box.classList.remove('empty');
    box.innerHTML = `<img src="${state.uri}" alt="">`;
    ov.querySelector(`#${id}-remove`)?.remove();
  });
  ov.querySelector(`#${id}-remove`)?.addEventListener('click', () => {
    state.uri = '';
    box.classList.add('empty');
    box.innerHTML = EMPTY_PHOTO_INNER;
    ov.querySelector(`#${id}-remove`)?.remove();
  });
  return state;
}

// ---- 汎用: 0〜100%のスライダー入力 ----
// 「残量」「今どれくらい入っているか」のような0〜100%の値は、キーボードでの自由入力より
// スライダーを指でなぞる方が速く直感的なため、%を扱う入力欄はこれに統一する。
export function percentSliderHtml(id, value = 0, labelText = null) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return `
    ${labelText ? `<label>${labelText}</label>` : ''}
    <div class="pct-slider-row">
      <input type="range" min="0" max="100" step="1" value="${v}" id="${id}" class="pct-slider">
      <div class="pct-slider-readout" id="${id}-readout">${v}%</div>
    </div>`;
}

export function wirePercentSlider(root, id) {
  const input = root.querySelector(`#${id}`);
  const readout = root.querySelector(`#${id}-readout`);
  const paint = () => {
    input.style.background = `linear-gradient(to right, var(--ember) ${input.value}%, var(--gunmetal) ${input.value}%)`;
    if (readout) readout.textContent = `${input.value}%`;
  };
  input.addEventListener('input', paint);
  paint();
  return input;
}

// ---- 汎用: 写真を拡大して見るだけ(差し替え・削除はしない) ----
// 満タン写真と今の薪棚を見比べる時など、「タップしたら差し替わってしまう」事故を避けつつ
// 大きく見たいだけの場面で使う軽量シート。
export function openPhotoZoomSheet(uri) {
  openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px"><span class="sheet-title" style="margin-bottom:0">写真を見る</span><button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button></div>
      <div class="photo-ph" style="height:min(70vh,420px)"><img src="${uri}" alt="" style="width:100%;height:100%;object-fit:contain"></div>
    </div>
  `);
}

// ---- 汎用: 薪棚の総容量入力(直接入力 or 寸法から自動計算) ----
// 「総容量を何m³で入力してください」は、薪ストーブに慣れていない人ほど答えにくい
// 質問になりがち。薪の取引で昔からある「幅×高さ×奥行き」の考え方をそのまま使えるように、
// メジャーで測った寸法(cm)からm³を自動計算できる補助を添える。
function totalVolumeFieldHtml(id, value = 1) {
  return `
    <div class="field">
      <label>総容量(満タン時の量、m³)</label>
      <input class="box" id="${id}" type="number" step="0.1" min="0.1" value="${value}">
      <button type="button" class="link-btn" id="${id}-dim-toggle" style="padding:4px 0 0">寸法(幅・高さ・奥行き)から計算する</button>
      <div id="${id}-dim-panel" style="display:none;margin-top:8px;padding:10px;background:var(--surface);border-radius:8px">
        <div class="label-sm" style="margin-bottom:6px;line-height:1.6">単位はcm。iPhoneの「計測」アプリを使うと、メジャーが無くても測れます。</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="box" id="${id}-dim-w" type="number" min="1" placeholder="幅" style="flex:1;min-width:0">
          <input class="box" id="${id}-dim-h" type="number" min="1" placeholder="高さ" style="flex:1;min-width:0">
          <input class="box" id="${id}-dim-d" type="number" min="1" placeholder="奥行き" style="flex:1;min-width:0">
        </div>
        <button type="button" class="btn-ghost" id="${id}-dim-apply" style="width:100%;margin-top:8px">計算してこの欄に反映</button>
      </div>
    </div>`;
}

function wireTotalVolumeField(root, id) {
  const toggle = root.querySelector(`#${id}-dim-toggle`);
  const panel = root.querySelector(`#${id}-dim-panel`);
  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });
  root.querySelector(`#${id}-dim-apply`).addEventListener('click', () => {
    const w = Number(root.querySelector(`#${id}-dim-w`).value);
    const h = Number(root.querySelector(`#${id}-dim-h`).value);
    const d = Number(root.querySelector(`#${id}-dim-d`).value);
    if (!(w > 0 && h > 0 && d > 0)) {
      showToast('幅・高さ・奥行きをすべて入力してください');
      return;
    }
    const m3 = Math.round((w / 100) * (h / 100) * (d / 100) * 100) / 100;
    root.querySelector(`#${id}`).value = m3;
    showToast(`約${m3}m³として反映しました`);
  });
}

// ---- 汎用: 複数フィールドの編集シート ----
// fields: [{key,label,type:'text'|'number'|'date',value,placeholder}]
export function openEditSheet({ title, description, fields, onSave }) {
  const fieldsHtml = fields
    .map(
      (f) => `
      <div class="field">
        <label>${f.label}</label>
        <input class="box" id="edit-${f.key}" type="${f.type}" value="${f.value ?? ''}" placeholder="${f.placeholder ?? ''}">
      </div>`
    )
    .join('');
  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">${title}</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      ${description ? `<div style="font-size:calc(12px * var(--font-scale));color:var(--khaki);line-height:1.7;margin-bottom:10px">${description}</div>` : ''}
      ${fieldsHtml}
      <button class="btn-primary" id="edit-save-btn">保存する</button>
    </div>
  `);
  ov.querySelector('#edit-save-btn').addEventListener('click', () => {
    const values = {};
    fields.forEach((f) => {
      const el = ov.querySelector(`#edit-${f.key}`);
      values[f.key] = f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    });
    onSave(values);
    closeOverlay();
  });
}

// ---- 薪棚選択シート ----
export function openShelfPickerSheet(currentId, onPick) {
  const shelves = getShelves();
  openOverlay(`
    <div class="sheet">
      <div class="sheet-title">薪棚を選ぶ</div>
      ${shelves
        .map(
          (s) => `
        <div class="sheet-item" data-action="pick-shelf-item" data-shelf-id="${s.id}">
          <svg class="icon" viewBox="0 0 24 24"><use href="#i-warehouse"/></svg>
          <span style="flex:1">${s.name}</span>
          ${s.id === currentId ? '<svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px;color:var(--green)"><use href="#i-check"/></svg>' : ''}
        </div>`
        )
        .join('')}
    </div>
  `);
  document.querySelectorAll('[data-action="pick-shelf-item"]').forEach((el) => {
    el.addEventListener('click', () => {
      onPick(el.dataset.shelfId);
      closeOverlay();
    });
  });
}

// ---- 今日焚いた:五感メモ追記シート ----
export function openSenseNoteSheet(burnLogId, onSaved) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">ひとことを追加(任意)</div>
      <div class="field">
        <label>炎の様子・香り・誰と焚いたかなど</label>
        <textarea class="box" id="sense-note" placeholder="よく燃えた。薪の香りが良い。"></textarea>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-ghost" data-action="close-overlay">キャンセル</button>
        <button class="btn-primary" style="flex:1" id="sense-note-save">保存する</button>
      </div>
    </div>
  `);
  ov.querySelector('#sense-note-save').addEventListener('click', () => {
    const note = ov.querySelector('#sense-note').value.trim();
    updateBurnLog(burnLogId, { note });
    closeOverlay();
    showToast('ひとことを保存しました');
    onSaved && onSaved();
  });
}

// ---- 薪を追加した記録モーダル ----
export function openAddWoodModal(onSaved) {
  const shelves = getShelves();
  if (shelves.length === 0) {
    showToast('先に「薪棚一覧」の＋から薪棚を登録してください');
    return;
  }
  const woodTypeOptions = getWoodTypeCatalog();
  const sourceOptions = Array.from(new Set(getWoodAdditions().map((a) => a.source).filter(Boolean)));
  let addedVolume = 0.8;
  let photoDataUrl = null;

  const ov = openOverlay(`
    <div class="modal">
      <div class="row" style="margin-bottom:14px"><span style="font-size:calc(15px * var(--font-scale));font-weight:700">薪を追加した記録</span><button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button></div>
      <div class="leather" id="add-shelf-preview" style="border-radius:var(--radius);padding:10px;display:flex;align-items:center;gap:10px;margin-bottom:14px"></div>
      <div class="field">
        <label>追加した薪棚</label>
        <select class="box" id="add-shelf">
          ${shelves.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>追加日</label>
        <input class="box" id="add-date" type="date" value="${todayIso()}">
      </div>
      <div class="field">
        <label>追加量</label>
        <div class="stepper">
          <button type="button" id="add-vol-minus">-</button>
          <span style="font-weight:700" id="add-vol-label">0.80 m³</span>
          <button type="button" id="add-vol-plus">+</button>
        </div>
      </div>
      <div class="field">
        <label>薪の種類(任意)</label>
        <input class="box" id="add-woodtype" list="woodtype-options" placeholder="例: 広葉樹(ミックス)">
        <datalist id="woodtype-options">${woodTypeOptions.map((w) => `<option value="${w}">`).join('')}</datalist>
        <button type="button" class="link-btn" style="padding:4px 0 0" id="add-woodtype-new-toggle">+ 新しい樹種を登録</button>
        <div id="add-woodtype-new-row" style="display:none;gap:8px;margin-top:6px">
          <input class="box" id="add-woodtype-new-input" placeholder="例: クヌギ" style="flex:1">
          <button type="button" class="btn-ghost" style="flex:none;padding:11px 16px" id="add-woodtype-new-save">追加</button>
        </div>
      </div>
      <div class="field">
        <label>入手先(任意)</label>
        <input class="box" id="add-source" list="source-options" placeholder="例: 自分で伐採・購入(◯◯材木店)・知人から">
        <datalist id="source-options">${sourceOptions.map((s) => `<option value="${s}">`).join('')}</datalist>
      </div>
      <div class="field">
        <label>価格(任意)</label>
        <input class="box" id="add-price" type="number" min="0" step="1" placeholder="例: 3000(自分で伐った分は空欄でOK)">
      </div>
      <div class="field">
        <label>メモ(任意)</label>
        <textarea class="box" id="add-memo" placeholder="週末に薪を補充しました。"></textarea>
      </div>
      <div class="field">
        <label>写真(任意・伐採や薪割りの様子でも)</label>
        <div class="photo-ph empty" id="add-photo-ph" style="height:70px;width:70px;border-radius:8px;cursor:pointer">${EMPTY_PHOTO_INNER}</div>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-ghost" data-action="close-overlay">キャンセル</button>
        <button class="btn-primary" style="flex:1" id="add-save-btn">保存する</button>
      </div>
    </div>
  `);

  const shelfSelect = ov.querySelector('#add-shelf');
  const shelfPreview = ov.querySelector('#add-shelf-preview');
  const updateShelfPreview = () => {
    const s = shelves.find((x) => x.id === shelfSelect.value);
    if (!s) return;
    const photo = s.photoIds.length ? getPhotos().find((p) => p.id === s.photoIds[s.photoIds.length - 1]) : null;
    const thumbHtml = photo
      ? `<img src="${photo.uri}" alt="" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0">`
      : `<div style="width:52px;height:52px;border-radius:8px;background:rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg class="icon" viewBox="0 0 24 24" style="width:20px;height:20px;color:var(--leather-text)"><use href="#i-camera"/></svg></div>`;
    shelfPreview.innerHTML = `
      ${thumbHtml}
      <div>
        <div class="slab" style="font-weight:700">${s.name}</div>
        <div class="label-sm" style="color:var(--leather-text)">残量${s.remainingPercent}%・約${s.usableVolumeM3}m³ / ${s.totalVolumeM3}m³</div>
      </div>
    `;
  };
  shelfSelect.addEventListener('change', updateShelfPreview);
  updateShelfPreview();

  // 樹種の登録は、実際には「薪を追加していて、この樹種まだ登録してないな」と
  // 気づいた時が多いはずなので、その場ですぐ新しい樹種を登録できるようにする
  const woodtypeInput = ov.querySelector('#add-woodtype');
  const woodtypeNewRow = ov.querySelector('#add-woodtype-new-row');
  const woodtypeNewInput = ov.querySelector('#add-woodtype-new-input');
  ov.querySelector('#add-woodtype-new-toggle').addEventListener('click', () => {
    woodtypeNewRow.style.display = 'flex';
    woodtypeNewInput.focus();
  });
  ov.querySelector('#add-woodtype-new-save').addEventListener('click', () => {
    const name = woodtypeNewInput.value.trim();
    if (!name) return;
    addWoodTypeToCatalog(name);
    const datalist = ov.querySelector('#woodtype-options');
    if (![...datalist.options].some((o) => o.value === name)) {
      datalist.insertAdjacentHTML('beforeend', `<option value="${name}">`);
    }
    woodtypeInput.value = name;
    woodtypeNewInput.value = '';
    woodtypeNewRow.style.display = 'none';
  });

  const volLabel = ov.querySelector('#add-vol-label');
  ov.querySelector('#add-vol-minus').addEventListener('click', () => {
    addedVolume = Math.max(0.1, Math.round((addedVolume - 0.1) * 10) / 10);
    volLabel.textContent = addedVolume.toFixed(2) + ' m³';
  });
  ov.querySelector('#add-vol-plus').addEventListener('click', () => {
    addedVolume = Math.round((addedVolume + 0.1) * 10) / 10;
    volLabel.textContent = addedVolume.toFixed(2) + ' m³';
  });
  ov.querySelector('#add-photo-ph').addEventListener('click', async () => {
    const file = await pickImageFile();
    if (!file) return;
    photoDataUrl = await fileToResizedDataUrl(file);
    const box = ov.querySelector('#add-photo-ph');
    box.classList.remove('empty');
    box.innerHTML = `<img src="${photoDataUrl}" alt="">`;
  });

  ov.querySelector('#add-save-btn').addEventListener('click', () => {
    const shelfId = ov.querySelector('#add-shelf').value;
    const date = ov.querySelector('#add-date').value || todayIso();
    const woodType = ov.querySelector('#add-woodtype').value.trim();
    const source = ov.querySelector('#add-source').value.trim();
    const priceRaw = ov.querySelector('#add-price').value;
    const price = priceRaw === '' ? null : Math.max(0, Number(priceRaw));
    const memo = ov.querySelector('#add-memo').value.trim();
    const shelf = shelves.find((s) => s.id === shelfId);

    try {
      let photoId = null;
      if (photoDataUrl) {
        const photo = addPhoto({ category: '薪棚', date, uri: photoDataUrl });
        photoId = photo.id;
        updateShelf(shelfId, { photoIds: [...shelf.photoIds, photoId] });
      }
      addWoodAddition({ shelfId, date, addedVolumeM3: addedVolume, woodType, source, price, memo, photoId });
      const { patch, overflowM3 } = applyWoodAddition(shelf, addedVolume);
      updateShelf(shelfId, patch);
      if (woodType && !shelf.woodTypes.includes(woodType)) {
        updateShelf(shelfId, { woodTypes: [...shelf.woodTypes, woodType] });
      }
      if (woodType) addWoodTypeToCatalog(woodType);
      closeOverlay();
      showToast(
        overflowM3 > 0
          ? `薪棚の容量を超えるため、${overflowM3}m³分は反映されませんでした`
          : '追加記録を保存しました'
      );
      onSaved && onSaved();
    } catch (e) {
      showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
    }
  });
}

// 樹種図鑑の豆知識(代表的な薪材のみ。完全な網羅ではなく、記録を眺めて楽しむための一言)
const WOOD_TRIVIA = {
  'クヌギ': '火持ちが良く、薪の定番。どんぐりの木としても知られる。',
  'コナラ': 'クヌギと並ぶ代表的な薪材。よく乾けば火持ちも良い。',
  'ナラ': '火力・火持ちのバランスが良い広葉樹。',
  'カシ': '非常に硬く火持ちが良いが、乾燥に時間がかかる。',
  'サクラ': '燃やすとほのかに甘い香りがする。',
  'クリ': '燃やすとパチパチ跳ねやすいので焚き口の扱いに注意。',
  'ケヤキ': '火持ちが良い高級材。割るのがやや大変。',
  'スギ': '着火は良いが火持ちは短め。焚き付けに向く。',
  'ヒノキ': '香りが良く着火性も良いが、油分でパチパチ跳ねやすい。',
  'マツ': '油分が多く火力は強いが、煙突にススが付きやすい。',
  '広葉樹(ミックス)': '広葉樹は総じて火持ちが良く、薪ストーブに向いている。',
  '針葉樹': '着火性が良く焚き付けに向くが、火持ちは広葉樹より短め。',
};

// 樹種名はカタカナで統一して管理しているが、実際には「杉」「すぎ」のように漢字や
// ひらがなで入力する人も多い(木の名前は普段どちらかで書くことの方が多いくらい)。
// カタカナに限定させるのではなく、入力はそのまま活かしつつ豆知識の検索だけ表記ゆれを
// 吸収する。ひらがな→カタカナは機械的に変換できるが、漢字は変換規則が無いため
// 代表的な樹種だけ個別に対応表を用意する。
const WOOD_NAME_KANJI_ALIASES = {
  '杉': 'スギ',
  '檜': 'ヒノキ',
  '桧': 'ヒノキ',
  '松': 'マツ',
  '桜': 'サクラ',
  '栗': 'クリ',
  '欅': 'ケヤキ',
  '樫': 'カシ',
  '楢': 'ナラ',
  '小楢': 'コナラ',
  '櫟': 'クヌギ',
  '椚': 'クヌギ',
};
function hiraganaToKatakana(str) {
  return str.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}
function normalizeWoodName(name) {
  const trimmed = name.trim();
  if (WOOD_TRIVIA[trimmed]) return trimmed;
  const kata = hiraganaToKatakana(trimmed);
  if (WOOD_TRIVIA[kata]) return kata;
  return WOOD_NAME_KANJI_ALIASES[trimmed] || trimmed;
}

// ---- 樹種コレクション(「自分だけの薪図鑑」。一般情報 + 自分の記録・メモ・任意評価) ----

function countFor(name) {
  const shelves = getShelves();
  const additions = getWoodAdditions();
  let count = shelves.filter((s) => s.woodTypes.includes(name)).length;
  count += additions.filter((a) => a.woodType === name).length;
  return count;
}

// 代表写真: 直接登録した樹種写真があればそれを優先し、無ければその樹種を追加した記録・
// その樹種を含む薪棚の写真を代表写真として拝借する(伐採・薪割りの様子の写真もここに活きる)。
function photoFor(name) {
  const photos = getPhotos();
  const direct = photos.filter((p) => p.category === '樹種' && p.woodType === name).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (direct) return direct;
  const addition = getWoodAdditions().find((a) => a.woodType === name && a.photoId);
  if (addition) {
    const photo = photos.find((p) => p.id === addition.photoId);
    if (photo) return photo;
  }
  const shelf = getShelves().find((s) => s.woodTypes.includes(name) && s.photoIds.length);
  if (shelf) {
    const photo = photos.find((p) => p.id === shelf.photoIds[shelf.photoIds.length - 1]);
    if (photo) return photo;
  }
  return null;
}

function yearMonthLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

// 「最近出会った樹種順」: 初めて記録した日が新しい順。まだ一度も使っていない
// (薪追加・写真のどちらも無い)樹種は末尾へ回す。
function sortedCatalogNames(catalog, firstDates) {
  return catalog.slice().sort((a, b) => {
    const da = firstDates.get(a);
    const db = firstDates.get(b);
    if (da && db) return da < db ? 1 : da > db ? -1 : 0;
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

// 自分の評価は「割りやすさ・火付き・火持ち」の3項目だけに絞り、★5評価のような
// レビューサイト風UIにはしない。いずれも任意で、未設定を「未評価」と表示しない。
const RATING_FIELDS = [
  { key: 'splitEase', label: '割りやすさ', options: ['割りやすい', 'ふつう', '割りにくい'] },
  { key: 'catchability', label: '火付き', options: ['良い', 'ふつう', 'イマイチ'] },
  { key: 'burnDuration', label: '火持ち', options: ['良い', 'ふつう', '短め'] },
];
function ratingRowHtml(field, currentValue) {
  return `
    <div class="field">
      <label>${field.label}(任意)</label>
      <div class="filter-tabs" data-rating-key="${field.key}" style="margin-bottom:0">
        ${field.options
          .map((opt) => `<button type="button" class="${currentValue === opt ? 'active' : ''}" data-value="${opt}">${opt}</button>`)
          .join('')}
      </div>
    </div>
  `;
}
// 選択済みの値をもう一度タップすると未設定に戻せる(「必ず何か選ぶ」フォームにしない)。
function wireRatingRow(root, key, onChange) {
  const row = root.querySelector(`[data-rating-key="${key}"]`);
  if (!row) return;
  row.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      row.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      if (!wasActive) btn.classList.add('active');
      onChange(wasActive ? null : btn.dataset.value);
    });
  });
}

// 樹種コレクション一覧: 「登録件数」ではなく「出会った樹種」の感覚を大切にし、写真を
// 主役に据える。カード自体をタップすると詳細(一般情報+自分の記録)へ進む(削除などの
// 操作はカードから外し、詳細画面の設定領域へ集約している)。
// 樹種詳細を見て戻ってきた時にスクロール位置が先頭へ戻ってしまわないよう、直近の
// スクロール位置をセッション内だけ覚えておく(大掛かりな状態管理は不要な範囲の対応)。
let collectionScrollTop = 0;
export function openWoodTypeCollectionSheet() {
  function draw() {
    const catalog = getWoodTypeCatalog();
    const ov = document.querySelector('[data-dynamic-overlay="true"]');
    if (!ov) return;
    const countEl = ov.querySelector('#woodtype-count');
    if (countEl) countEl.textContent = `出会った樹種 ${catalog.length}種`;
    const firstDates = firstWoodTypeDates(getWoodAdditions(), getPhotos());
    ov.querySelector('#woodtype-list').innerHTML = catalog.length
      ? `<div class="collection-grid">${sortedCatalogNames(catalog, firstDates)
          .map((name) => {
            const photo = photoFor(name);
            const emptyClass = photo ? '' : ' empty';
            const inner = photo ? `<img src="${photo.uri}" alt="">` : EMPTY_PHOTO_INNER;
            const firstDate = firstDates.get(name);
            const detail = getWoodTypeDetail(name);
            return `
        <div class="collection-card" data-action="open-woodtype-detail" data-name="${name}" style="cursor:pointer">
          <div class="photo-ph${emptyClass}" style="height:90px;margin-bottom:2px">${inner}</div>
          <div style="font-size:calc(13px * var(--font-scale));font-weight:700">${name}</div>
          ${firstDate ? `<div class="label-sm">初めて記録:${yearMonthLabel(firstDate)}</div>` : ''}
          ${detail.memo ? `<div class="label-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${detail.memo}</div>` : ''}
          <div class="n">${countFor(name)}回記録</div>
        </div>`;
          })
          .join('')}</div>`
      : `
        <div class="empty">まだ樹種の記録がありません。薪を追加したり、ここから記録すると、出会った樹種が並んでいきます。</div>
        <button class="btn-primary" id="woodtype-empty-cta">＋ 最初の樹種を記録する</button>
      `;
    ov.querySelector('#woodtype-empty-cta')?.addEventListener('click', () => {
      openAddWoodTypeSheet(() => openWoodTypeCollectionSheet());
    });
    // 内容を描き終えてからでないと、スクロール可能な高さが確定せず正しい位置に
    // 戻せないため、restoreは必ずinnerHTMLの反映後に行う。
    const sheetEl = ov.querySelector('.sheet');
    if (sheetEl) sheetEl.scrollTop = collectionScrollTop;
  }

  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:2px">
        <span class="sheet-title" style="margin-bottom:0">樹種コレクション</span>
        <div style="display:flex;gap:6px">
          <button class="iconbtn" id="woodtype-add-open-btn"><svg class="icon" viewBox="0 0 24 24"><use href="#i-plus"/></svg></button>
          <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
        </div>
      </div>
      <div class="label-sm" id="woodtype-count" style="margin-bottom:12px"></div>
      <div id="woodtype-list" style="margin-bottom:12px"></div>
    </div>
  `);
  ov.querySelector('#woodtype-add-open-btn').addEventListener('click', () => {
    openAddWoodTypeSheet(() => openWoodTypeCollectionSheet());
  });
  ov.querySelector('.sheet').addEventListener('scroll', (e) => {
    collectionScrollTop = e.target.scrollTop;
  });
  draw();
}

// 樹種を記録する: 「写真→樹種名→保存」の最短フローを基本にし、メモは任意で
// 折りたたんでおく(登録は数十秒で終わることを最優先する。割りやすさ等の評価は、
// 実際に使ってみてからの方が書けることが多いため、この時点では扱わず詳細画面に譲る)。
export function openAddWoodTypeSheet(onSaved) {
  let photoDataUrl = null;
  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">樹種を記録する</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="photo-ph empty" id="newwt-photo-ph" style="height:150px;margin-bottom:12px;cursor:pointer">${EMPTY_PHOTO_INNER}</div>
      <div class="field">
        <label>樹種名</label>
        <input class="box" id="newwt-name" placeholder="例: クヌギ">
      </div>
      <button class="link-btn" id="newwt-toggle-detail" style="padding:0 0 10px">詳しく記録する(任意)</button>
      <div class="field" id="newwt-detail" style="display:none">
        <label>メモ</label>
        <textarea class="box" id="newwt-memo" placeholder="例: 割った時に香りが強かった"></textarea>
      </div>
      <button class="btn-primary" id="newwt-save-btn">保存する</button>
    </div>
  `);
  ov.querySelector('#newwt-photo-ph').addEventListener('click', async () => {
    const file = await pickImageFile();
    if (!file) return;
    photoDataUrl = await fileToResizedDataUrl(file);
    const box = ov.querySelector('#newwt-photo-ph');
    box.classList.remove('empty');
    box.innerHTML = `<img src="${photoDataUrl}" alt="">`;
  });
  ov.querySelector('#newwt-toggle-detail').addEventListener('click', () => {
    const el = ov.querySelector('#newwt-detail');
    el.style.display = el.style.display === 'none' ? '' : 'none';
  });
  const save = () => {
    const name = ov.querySelector('#newwt-name').value.trim();
    if (!name) {
      showToast('樹種名を入力してください');
      return;
    }
    const isNew = !getWoodTypeCatalog().includes(name);
    const memo = ov.querySelector('#newwt-memo').value.trim();
    addWoodTypeToCatalog(name);
    if (memo) updateWoodTypeDetail(name, { memo });
    try {
      if (photoDataUrl) addPhoto({ category: '樹種', date: todayIso(), uri: photoDataUrl, woodType: name });
    } catch {
      showToast('写真の保存に失敗しました。保存容量が上限に近づいている可能性があります');
    }
    closeOverlay();
    showToast(isNew ? `${name}を初めて記録しました` : `${name}の記録を更新しました`);
    onSaved && onSaved();
  };
  ov.querySelector('#newwt-save-btn').addEventListener('click', save);
  // スマホのキーボードで「完了/Go」を押した時にも保存できるようにする
  ov.querySelector('#newwt-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
}

// 樹種詳細: 「一般情報を見る場所」+「自分の経験を振り返る場所」。上から代表写真→
// 初めて記録した時期→一般的な特徴(既存のWOOD_TRIVIAのみ、新しい一般情報は増やさない)→
// 自分の記録(薪追加の履歴)→写真→自分のメモ・評価、という順で並べ、削除だけ最下部の
// 設定領域に分離する(見る/操作の分離。薪棚チェック画面と同じ考え方)。
//
// onClose: 「戻る」で呼ぶコールバック。呼び出し元(樹種一覧のカード/ホームの
// event-row/カレンダー日別詳細のevent-row・バナー/写真詳細の「この樹種を見る」)ごとに
// 「元いた場所を再現する」ための関数をそのまま渡してもらう(history.back()は使わず、
// HIMORI側で明示的に戻り先を管理する)。省略時(=戻り先情報が無い場合)は樹種一覧へ。
export function openWoodTypeDetailSheet(name, onClose = () => openWoodTypeCollectionSheet()) {
  function draw() {
    const ov = document.querySelector('[data-dynamic-overlay="true"]');
    if (!ov) return;
    const detail = getWoodTypeDetail(name);
    const allPhotos = getPhotos();
    const speciesPhotos = allPhotos.filter((p) => p.category === '樹種' && p.woodType === name);
    const additions = getWoodAdditions()
      .filter((a) => a.woodType === name)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const shelves = getShelves();
    const shelfName = (id) => shelves.find((s) => s.id === id)?.name ?? '薪棚';
    const firstDate = firstWoodTypeDates(getWoodAdditions(), getPhotos()).get(name);
    const trivia = WOOD_TRIVIA[normalizeWoodName(name)];
    const repPhoto = photoFor(name);

    const additionsHtml = additions.length
      ? additions
          .map((a) => {
            const photo = a.photoId ? allPhotos.find((p) => p.id === a.photoId) : null;
            return eventRowHtml(
              { icon: '#i-plus', iconColor: 'var(--green)', photo, text: `${shelfName(a.shelfId)}に${a.addedVolumeM3}m³追加` },
              monthDayLabel(a.date)
            );
          })
          .join('')
      : `<div class="empty" style="padding:10px 4px">まだ薪追加の記録はありません。</div>`;

    const photosHtml = speciesPhotos.length
      ? `<div class="album-grid">${speciesPhotos.map((p) => `<div class="photo-ph" data-species-photo-id="${p.id}" style="cursor:pointer"><img src="${p.uri}" alt=""></div>`).join('')}</div>`
      : `<div class="empty" style="padding:10px 4px">まだ写真がありません。</div>`;

    ov.querySelector('.sheet').innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">${name}</span>
        <button class="iconbtn" id="wt-detail-close"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="photo-ph${repPhoto ? '' : ' empty'}" id="wt-detail-photo" style="height:180px;margin-bottom:10px;cursor:pointer">
        ${repPhoto ? `<img src="${repPhoto.uri}" alt="">` : EMPTY_PHOTO_INNER}
      </div>
      ${firstDate ? `<div class="label-sm" style="margin-bottom:14px">初めて記録:${yearMonthLabel(firstDate)}</div>` : ''}

      ${trivia ? `<div class="label-sm" style="font-weight:700;margin-bottom:2px">一般的な特徴</div><div class="label-sm" style="line-height:1.6;margin-bottom:16px">${trivia}</div>` : ''}

      <div class="label-sm" style="font-weight:700;margin-bottom:2px">自分の記録(${countFor(name)}回)</div>
      <div style="margin-bottom:16px">${additionsHtml}</div>

      <div class="label-sm" style="font-weight:700;margin-bottom:6px">写真</div>
      <div style="margin-bottom:8px">${photosHtml}</div>
      <button class="link-btn" id="wt-add-photo-btn" style="padding:0 0 16px">＋ 写真を追加</button>

      <div class="label-sm" style="font-weight:700;margin-bottom:6px">自分のメモ・評価</div>
      <div class="field">
        <label>メモ(任意)</label>
        <textarea class="box" id="wt-memo" placeholder="例: 割った時に香りが強かった">${detail.memo || ''}</textarea>
      </div>
      ${RATING_FIELDS.map((f) => ratingRowHtml(f, detail[f.key])).join('')}
      <button class="btn-ghost" id="wt-save-memo-btn" style="width:100%;margin-top:6px">この記録を保存する</button>

      <div style="margin-top:22px;padding-top:14px;border-top:1px solid #262922">
        <button class="link-btn" style="color:var(--red)" id="wt-delete-btn">この樹種を削除する</button>
      </div>
    `;

    ov.querySelector('#wt-detail-close').addEventListener('click', () => {
      closeOverlay();
      onClose();
    });
    ov.querySelector('#wt-detail-photo').addEventListener('click', async () => {
      const file = await pickImageFile();
      if (!file) return;
      const uri = await fileToResizedDataUrl(file);
      try {
        addPhoto({ category: '樹種', date: todayIso(), uri, woodType: name });
        draw();
      } catch {
        showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
      }
    });
    ov.querySelector('#wt-add-photo-btn').addEventListener('click', () => ov.querySelector('#wt-detail-photo').click());
    ov.querySelectorAll('[data-species-photo-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const photo = getPhotos().find((p) => p.id === el.dataset.speciesPhotoId);
        if (!photo) return;
        openPhotoViewSheet(photo, () => {
          deletePhoto(photo.id);
          // 削除後もこの樹種詳細に戻ってくるので、開いた時のonClose(元の戻り先)を
          // そのまま引き継ぐ(削除のたびに戻り先が樹種一覧へリセットされないように)。
          openWoodTypeDetailSheet(name, onClose);
        });
      });
    });
    RATING_FIELDS.forEach((f) => {
      wireRatingRow(ov, f.key, (val) => updateWoodTypeDetail(name, { [f.key]: val }));
    });
    ov.querySelector('#wt-save-memo-btn').addEventListener('click', () => {
      const memo = ov.querySelector('#wt-memo').value.trim();
      updateWoodTypeDetail(name, { memo });
      showToast('記録を保存しました');
    });
    ov.querySelector('#wt-delete-btn').addEventListener('click', () => {
      openConfirmSheet({
        title: '樹種を削除しますか?',
        message: `「${name}」をコレクションから削除します。薪追加などの過去の記録は残りますが、この樹種のメモ・評価は削除されます。`,
        confirmLabel: '削除する',
        onConfirm: () => {
          deleteWoodTypeFromCatalog(name);
          closeOverlay();
          openWoodTypeCollectionSheet();
        },
      });
    });
  }

  openOverlay(`<div class="sheet"></div>`);
  draw();
}

// ---- 汎用: 都道府県→市区町村の2段階選択(番地までは特定しない位置情報登録) ----
// 郵便番号のように「番地まで特定できそうな情報」を入力させておきながら、実際に得られる
// 天気予報の精度は市区町村程度でしかない、という不誠実な印象を避けるため、入力してもらう
// 情報も実際の精度に合わせて「市区町村を選ぶだけ」にしている。
export function locationPickerFieldsHtml(prefectureId, cityId) {
  return `
    <div class="field">
      <label>都道府県</label>
      <select class="box" id="${prefectureId}">
        <option value="">選択してください</option>
        ${PREFECTURES.map((p) => `<option value="${p}">${p}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>市区町村</label>
      <select class="box" id="${cityId}" disabled>
        <option value="">先に都道府県を選んでください</option>
      </select>
    </div>`;
}

export function wireLocationPicker(root, prefectureId, cityId) {
  const prefectureEl = root.querySelector(`#${prefectureId}`);
  const cityEl = root.querySelector(`#${cityId}`);
  prefectureEl.addEventListener('change', async () => {
    const prefecture = prefectureEl.value;
    if (!prefecture) {
      cityEl.innerHTML = '<option value="">先に都道府県を選んでください</option>';
      cityEl.disabled = true;
      return;
    }
    cityEl.innerHTML = '<option value="">読み込み中...</option>';
    cityEl.disabled = true;
    try {
      const cities = await fetchCitiesForPrefecture(prefecture);
      cityEl.innerHTML = `<option value="">選択してください</option>${cities.map((c) => `<option value="${c}">${c}</option>`).join('')}`;
      cityEl.disabled = false;
    } catch {
      cityEl.innerHTML = '<option value="">取得に失敗しました</option>';
    }
  });
}

// ---- 位置情報の登録(天気連動の初回設定) ----
export function openLocationSheet(onResolved, { skippable = true } = {}) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">お住まいの地域を登録(天気連動)</div>
      <div style="font-size:calc(12px * var(--font-scale));color:var(--khaki);line-height:1.7;margin-bottom:10px">
        天気予報を使った運び出しの目安表示のため、都道府県と市区町村を選んでください。番地までは特定しません。
      </div>
      ${locationPickerFieldsHtml('loc-prefecture', 'loc-city')}
      <div id="loc-error" style="font-size:calc(11px * var(--font-scale));color:var(--red);margin-bottom:8px"></div>
      <div class="btn-row" style="margin-top:4px">
        ${skippable ? '<button class="btn-ghost" id="loc-skip">あとで</button>' : ''}
        <button class="btn-primary" style="flex:1" id="loc-save">登録する</button>
      </div>
    </div>
  `);
  wireLocationPicker(ov, 'loc-prefecture', 'loc-city');
  if (skippable) {
    ov.querySelector('#loc-skip').addEventListener('click', () => {
      localStorage.setItem('himori.onboardingDismissed', '1');
      closeOverlay();
    });
  }
  ov.querySelector('#loc-save').addEventListener('click', async () => {
    const prefecture = ov.querySelector('#loc-prefecture').value;
    const city = ov.querySelector('#loc-city').value;
    const errEl = ov.querySelector('#loc-error');
    errEl.textContent = '';
    try {
      const location = await resolveLocationFromCity(prefecture, city);
      await maybeShowRegionPicker(location, (finalLocation) => {
        updateProfile({ location: finalLocation });
        localStorage.setItem('himori.onboardingDismissed', '1');
        closeOverlay();
        showToast('位置情報を登録しました');
        onResolved && onResolved();
      });
    } catch (e) {
      errEl.textContent = e.message || '登録に失敗しました';
    }
  });
}

// 気象庁の行政区分(南部/北部など)は、必ずしも実際の気候と一致しない(山間部の町が
// 平野部と同じ区分にまとめられている等)。自動で選ばれた区分を見せた上で、体感と
// 違う場合はその場で選び直せるようにする(区分が1つしか無い府県ではこの画面自体を省く)。
async function maybeShowRegionPicker(location, onDone) {
  if (!location.jma?.officeCode) {
    onDone(location);
    return;
  }
  const regions = await listRegionsForOffice(location.jma.officeCode).catch(() => []);
  if (regions.length <= 1) {
    onDone(location);
    return;
  }
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">天気予報の地域区分</div>
      <div style="font-size:calc(12px * var(--font-scale));color:var(--khaki);line-height:1.7;margin-bottom:10px">
        気象庁の区分では「${location.jma.regionName}」が自動で選ばれました。山間部などでは実際の気候が別の区分に近いこともあるので、体感と違う場合はここで選び直せます(あとから設定画面でも変更できます)。
      </div>
      <div class="field">
        <select class="box" id="region-select">
          ${regions.map((r) => `<option value="${r.code}" ${r.code === location.jma.class10Code ? 'selected' : ''}>${r.name}</option>`).join('')}
        </select>
      </div>
      <button class="btn-primary" id="region-save">この内容で登録する</button>
    </div>
  `);
  ov.querySelector('#region-save').addEventListener('click', () => {
    const code = ov.querySelector('#region-select').value;
    const region = regions.find((r) => r.code === code);
    onDone({
      ...location,
      jma: { ...location.jma, class10Code: code, regionName: region?.name || location.jma.regionName, class15Code: null },
    });
  });
}

// ---- 薪割り記録 ----
// 割った直後はすぐに積まず、量が分からないことも多いため、量の入力は任意にしてある。
// 「量はまだ分からない」を選ぶと回数だけを記録し、量はnullで保存する。
export function openSplitLogSheet(onSaved) {
  let volume = 0.2;
  let volumeKnown = true;
  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:14px"><span class="sheet-title" style="margin-bottom:0">薪割りを記録</span><button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button></div>
      <div class="field">
        <label>日付</label>
        <input class="box" id="split-date" type="date" value="${todayIso()}">
      </div>
      <div class="row" style="margin-bottom:8px">
        <span class="label-sm">量はまだ分からない(あとで積んでから確認)</span>
        <button class="switch" id="split-unknown-toggle"></button>
      </div>
      <div class="field" id="split-volume-field">
        <label>割った量</label>
        <div class="stepper">
          <button type="button" id="split-minus">-</button>
          <span style="font-weight:700" id="split-label">0.20 m³</span>
          <button type="button" id="split-plus">+</button>
        </div>
      </div>
      <button class="btn-primary" id="split-save">保存する</button>
    </div>
  `);
  const label = ov.querySelector('#split-label');
  const volumeField = ov.querySelector('#split-volume-field');
  const unknownToggle = ov.querySelector('#split-unknown-toggle');
  ov.querySelector('#split-minus').addEventListener('click', () => {
    volume = Math.max(0.1, Math.round((volume - 0.1) * 10) / 10);
    label.textContent = volume.toFixed(2) + ' m³';
  });
  ov.querySelector('#split-plus').addEventListener('click', () => {
    volume = Math.round((volume + 0.1) * 10) / 10;
    label.textContent = volume.toFixed(2) + ' m³';
  });
  unknownToggle.addEventListener('click', () => {
    volumeKnown = !volumeKnown;
    unknownToggle.classList.toggle('on', !volumeKnown);
    volumeField.style.display = volumeKnown ? '' : 'none';
  });
  ov.querySelector('#split-save').addEventListener('click', () => {
    const date = ov.querySelector('#split-date').value || todayIso();
    addSplitLog({ date, volumeM3: volumeKnown ? volume : null });
    closeOverlay();
    showToast('薪割り記録を保存しました');
    onSaved && onSaved();
  });
}

// ---- 静的な案内シート(使い方ガイド/FAQ/カレンダー準備中) ----
export function openInfoSheet(title, bodyHtml) {
  openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">${title}</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div style="font-size:calc(13px * var(--font-scale));line-height:1.8;color:var(--cream)">${bodyHtml}</div>
    </div>
  `);
}

// ---- 写真追加(カテゴリ・日付) ----
// ---- 写真プレビュー(削除可) ----
// 「この木は何の樹種?」となった時、アプリの中でAIに画像を送る仕組みは作らない
// (サーバー・API費用が必要になり、無料・サーバーレスという設計方針と矛盾する)。
// 代わりにOS標準の共有機能で、ユーザーが普段使っているアプリ(Googleアプリのレンズ機能や
// AIチャットアプリなど)にその場で写真を手渡せるようにする。
async function shareImageForLookup(uri) {
  if (!navigator.share || !navigator.canShare) {
    showToast('この端末では共有機能が使えません');
    return;
  }
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    const file = new File([blob], 'himori-photo.jpg', { type: blob.type || 'image/jpeg' });
    if (!navigator.canShare({ files: [file] })) {
      showToast('この端末では画像の共有ができません');
      return;
    }
    await navigator.share({ files: [file], title: 'この写真で調べる' });
  } catch (e) {
    if (e.name !== 'AbortError') showToast('共有に失敗しました');
  }
}

// 写真をアルバム/カレンダーから見返した時、「この薪棚を見る」「この樹種を見る」
// 「この日の記録を見る」で写真から他の画面へ自然に行き来できるようにする(薪棚IDの
// 新しい永続フィールドは増やさず、resolvePhotoShelfIdでその場に逆引きするだけ。
// 樹種は写真自身が持つcategory/woodTypeをそのまま使う)。
export function openPhotoViewSheet(photo, onDeleted) {
  const canShare = typeof navigator.share === 'function';
  const shelves = getShelves();
  const shelfId = resolvePhotoShelfId(photo.id, shelves, getWoodAdditions());
  const shelf = shelfId ? shelves.find((s) => s.id === shelfId) : null;
  const woodType = photo.category === '樹種' ? photo.woodType : null;
  const captionName = woodType || (shelf ? shelf.name : photo.category);
  const ov = openOverlay(`
    <div class="sheet">
      <div class="photo-ph" style="height:240px;margin-bottom:10px"><img src="${photo.uri}" alt=""></div>
      <div class="row" style="margin-bottom:8px"><span class="label-sm">${monthDayLabel(photo.date)}・${captionName}</span></div>
      <div class="row" style="margin-bottom:12px;gap:16px;justify-content:flex-start;flex-wrap:wrap">
        ${shelf ? `<button class="link-btn" style="padding:0" id="photo-goto-shelf">この薪棚を見る</button>` : ''}
        ${woodType ? `<button class="link-btn" style="padding:0" id="photo-goto-woodtype">この樹種を見る</button>` : ''}
        <button class="link-btn" style="padding:0" id="photo-goto-day">この日の記録を見る</button>
      </div>
      ${canShare ? `<button class="btn-ghost" id="photo-share-btn" style="width:100%;margin-bottom:8px">この写真で調べる(樹種など)</button>` : ''}
      <div class="btn-row">
        <button class="btn-ghost" data-action="close-overlay">閉じる</button>
        <button class="btn-ghost" style="color:var(--red);border-color:var(--red)" id="photo-delete-btn">削除する</button>
      </div>
    </div>
  `);
  ov.querySelector('#photo-share-btn')?.addEventListener('click', () => shareImageForLookup(photo.uri));
  ov.querySelector('#photo-goto-shelf')?.addEventListener('click', () => {
    closeOverlay();
    state.currentShelfId = shelf.id;
    go('check');
  });
  ov.querySelector('#photo-goto-woodtype')?.addEventListener('click', () => {
    closeOverlay();
    // 樹種詳細を閉じたら、この同じ写真シートへそのまま戻れるようにする
    // (アルバムから開いた場合、一覧へは飛ばさず元の写真詳細を再現する)。
    openWoodTypeDetailSheet(woodType, () => openPhotoViewSheet(photo, onDeleted));
  });
  ov.querySelector('#photo-goto-day').addEventListener('click', () => {
    closeOverlay();
    go('review');
    focusOnDate(photo.date);
  });
  ov.querySelector('#photo-delete-btn').addEventListener('click', () => {
    closeOverlay();
    onDeleted && onDeleted();
  });
}

// ---- 薪棚チェック記録の編集・削除 ----
// 記録は間違えることもあるので、後から直したり消したりできるようにする
// (これが無いと、押し間違いや古い記録がずっと履歴に残ってしまう)。
export function openCheckEditSheet(checkId, onSaved) {
  const check = getChecks().find((c) => c.id === checkId);
  if (!check) return;
  const items = { ...check.items };

  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">チェック記録を編集</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="field">
        <label>日付</label>
        <input class="box" id="check-edit-date" type="date" value="${check.date}">
      </div>
      <div id="check-edit-items" style="margin-bottom:6px"></div>
      <div class="field">
        ${percentSliderHtml('check-edit-pct', check.remainingPercent, '残量(%)')}
      </div>
      <div class="field">
        <label>含水率(%・任意)</label>
        <input class="box" id="check-edit-moisture" type="number" min="0" max="60" value="${check.moisturePercent ?? ''}">
      </div>
      <div class="field">
        <label>メモ</label>
        <textarea class="box" id="check-edit-memo">${check.memo || ''}</textarea>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-ghost" style="color:var(--red);border-color:var(--red)" id="check-edit-delete">削除する</button>
        <button class="btn-primary" style="flex:1" id="check-edit-save">保存する</button>
      </div>
    </div>
  `);
  wirePercentSlider(ov, 'check-edit-pct');

  function drawItems() {
    ov.querySelector('#check-edit-items').innerHTML = CHECKLIST_ITEMS.map((item) => {
      const val = items[item.key];
      return `
        <div class="checklist-item">
          <span class="name">${item.label}</span>
          <button class="toggle-pill ${val}" type="button" data-key="${item.key}">
            ${CHECK_STATE_LABELS[val]}
          </button>
        </div>`;
    }).join('');
    ov.querySelectorAll('#check-edit-items .toggle-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        items[btn.dataset.key] = nextCheckState(items[btn.dataset.key]);
        drawItems();
      });
    });
  }
  drawItems();

  ov.querySelector('#check-edit-save').addEventListener('click', () => {
    const date = ov.querySelector('#check-edit-date').value || check.date;
    const pct = Math.max(0, Math.min(100, Number(ov.querySelector('#check-edit-pct').value) || 0));
    const shelf = getShelf(check.shelfId);
    const usableVolumeM3 = shelf ? Math.round(((shelf.totalVolumeM3 * pct) / 100) * 100) / 100 : check.usableVolumeM3;
    const moistureRaw = ov.querySelector('#check-edit-moisture').value;
    const moisturePercent = moistureRaw === '' ? null : Math.max(0, Math.min(60, Number(moistureRaw)));
    const memo = ov.querySelector('#check-edit-memo').value.trim();
    updateCheck(checkId, { date, remainingPercent: pct, usableVolumeM3, items, moisturePercent, memo });
    closeOverlay();
    showToast('チェック記録を更新しました');
    onSaved && onSaved();
  });

  ov.querySelector('#check-edit-delete').addEventListener('click', () => {
    openConfirmSheet({
      title: 'チェック記録を削除',
      message: `${check.date}のチェック記録を削除します。この操作は元に戻せません。よろしいですか?`,
      confirmLabel: '削除する',
      onConfirm: () => {
        deleteCheck(checkId);
        closeOverlay();
        showToast('チェック記録を削除しました');
        onSaved && onSaved();
      },
    });
  });
}

// ---- 薪棚編集(名前・乾燥状態・乾燥開始日) ----
export function openShelfEditSheet(shelfId, onSaved) {
  const shelf = getShelf(shelfId);
  if (!shelf) return;
  const statuses = ['乾燥済み', '乾燥中', '来季用'];
  // レギュラー薪棚の設定・解除は、以前は薪棚一覧のカード上に常時表示していたが、
  // 「見る場所」と「設定する場所」を分ける方針にしたため、他の設定項目と同じく
  // この編集シートに集約する。
  const wasMain = getProfile().mainShelfId === shelfId;
  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">薪棚を編集</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="field">
        <label>薪棚の名前</label>
        <input class="box" id="shelf-edit-name" type="text" value="${shelf.name}">
      </div>
      ${totalVolumeFieldHtml('shelf-edit-total', shelf.totalVolumeM3)}
      <div class="field">
        <label>乾燥状態(ご自身の判断で選んでください)</label>
        <select class="box" id="shelf-edit-status">
          ${statuses.map((s) => `<option value="${s}" ${s === shelf.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>乾燥を始めた日</label>
        <input class="box" id="shelf-edit-drying" type="date" value="${shelf.dryingStartedAt ?? ''}">
      </div>
      ${photoFieldHtml('shelf-edit-photo', getPhotos().find((p) => p.id === shelf.photoIds[shelf.photoIds.length - 1])?.uri || null)}
      <div class="field" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="shelf-edit-is-main" ${wasMain ? 'checked' : ''} style="width:18px;height:18px;flex-shrink:0">
        <label for="shelf-edit-is-main" style="margin:0">いつもの薪棚にする</label>
      </div>
      <button class="btn-primary" id="shelf-edit-save">保存する</button>
      <button class="btn-ghost" id="shelf-edit-delete" style="width:100%;margin-top:8px;color:var(--red)">この薪棚を削除</button>
    </div>
  `);
  const photo = wirePhotoField(ov, 'shelf-edit-photo', getPhotos().find((p) => p.id === shelf.photoIds[shelf.photoIds.length - 1])?.uri || null);
  wireTotalVolumeField(ov, 'shelf-edit-total');
  ov.querySelector('#shelf-edit-save').addEventListener('click', () => {
    const name = ov.querySelector('#shelf-edit-name').value.trim() || shelf.name;
    const status = ov.querySelector('#shelf-edit-status').value;
    const dryingStartedAt = ov.querySelector('#shelf-edit-drying').value || null;
    const totalRaw = Number(ov.querySelector('#shelf-edit-total').value);
    const totalVolumeM3 = totalRaw > 0 ? totalRaw : shelf.totalVolumeM3;
    // 総容量を減らして今の使用量がそれを上回ってしまう場合は、使える量も総容量に合わせて丸める
    const usableVolumeM3 = Math.min(shelf.usableVolumeM3, totalVolumeM3);
    const remainingPercent = Math.round((usableVolumeM3 / totalVolumeM3) * 100);
    try {
      let photoIds = shelf.photoIds;
      if (photo.uri === '') {
        photoIds = [];
      } else if (photo.uri) {
        photoIds = [...shelf.photoIds, addPhoto({ category: '薪棚', date: todayIso(), uri: photo.uri }).id];
      }
      updateShelf(shelfId, { name, status, dryingStartedAt, totalVolumeM3, usableVolumeM3, remainingPercent, photoIds });
      const isMainNow = ov.querySelector('#shelf-edit-is-main').checked;
      if (isMainNow && !wasMain) updateProfile({ mainShelfId: shelfId });
      else if (!isMainNow && wasMain) updateProfile({ mainShelfId: null });
      closeOverlay();
      showToast('薪棚を更新しました');
      onSaved && onSaved();
    } catch {
      showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
    }
  });
  ov.querySelector('#shelf-edit-delete').addEventListener('click', () => {
    openConfirmSheet({
      title: '薪棚を削除',
      message: `「${shelf.name}」を削除します。これまでのチェック履歴などの記録は残りますが、薪棚一覧には表示されなくなります。よろしいですか?`,
      confirmLabel: '削除する',
      onConfirm: () => {
        deleteShelf(shelfId);
        closeOverlay();
        showToast('薪棚を削除しました');
        onSaved && onSaved();
      },
    });
  });
}

// ---- 新しい薪棚を登録 ----
export function openAddShelfSheet(onSaved) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">新しい薪棚を登録</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="field">
        <label>薪棚の名前</label>
        <input class="box" id="new-shelf-name" type="text" placeholder="例: 東側薪棚">
      </div>
      ${totalVolumeFieldHtml('new-shelf-total', 1)}
      <div class="field">
        ${percentSliderHtml('new-shelf-pct', 0, '今、どれくらい入っていますか(%)')}
      </div>
      <div class="field">
        <label>乾燥状態</label>
        <select class="box" id="new-shelf-status">
          <option value="乾燥中">乾燥中</option>
          <option value="乾燥済み">乾燥済み</option>
          <option value="来季用">来季用</option>
        </select>
      </div>
      <div class="field" id="new-shelf-drying-field">
        <label>乾燥を始めたのはいつ頃?</label>
        <div class="filter-tabs" id="drying-presets" style="flex-wrap:wrap">
          <button type="button" data-days="0" class="active">今日から</button>
          <button type="button" data-days="30">1ヶ月前</button>
          <button type="button" data-days="90">3ヶ月前</button>
          <button type="button" data-days="180">半年前</button>
          <button type="button" data-days="365">1年以上前</button>
        </div>
        <button class="link-btn" style="padding:6px 0 0" id="drying-exact-toggle">正確な日付が分かる場合はこちら</button>
        <input class="box" id="new-shelf-drying-date" type="date" style="display:none;margin-top:6px" max="${todayIso()}">
      </div>
      ${photoFieldHtml('new-shelf-photo', null)}
      <button class="btn-primary" id="new-shelf-save">登録する</button>
    </div>
  `);
  const photo = wirePhotoField(ov, 'new-shelf-photo', null);
  wireTotalVolumeField(ov, 'new-shelf-total');
  wirePercentSlider(ov, 'new-shelf-pct');

  const dryingField = ov.querySelector('#new-shelf-drying-field');
  const presetButtons = ov.querySelectorAll('#drying-presets button');
  const dryingDateInput = ov.querySelector('#new-shelf-drying-date');
  const statusSelect = ov.querySelector('#new-shelf-status');

  const updateDryingFieldVisibility = () => {
    dryingField.style.display = statusSelect.value === '来季用' ? 'none' : '';
  };
  statusSelect.addEventListener('change', updateDryingFieldVisibility);
  updateDryingFieldVisibility();

  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      dryingDateInput.value = '';
      dryingDateInput.style.display = 'none';
    });
  });
  ov.querySelector('#drying-exact-toggle').addEventListener('click', () => {
    presetButtons.forEach((b) => b.classList.remove('active'));
    dryingDateInput.style.display = '';
    dryingDateInput.focus();
  });

  ov.querySelector('#new-shelf-save').addEventListener('click', () => {
    const name = ov.querySelector('#new-shelf-name').value.trim() || '新しい薪棚';
    const totalVolumeM3 = Math.max(0.1, Number(ov.querySelector('#new-shelf-total').value) || 1);
    const pct = Math.max(0, Math.min(100, Number(ov.querySelector('#new-shelf-pct').value) || 0));
    const status = ov.querySelector('#new-shelf-status').value;
    const usableVolumeM3 = Math.round(totalVolumeM3 * (pct / 100) * 100) / 100;

    let dryingStartedAt = null;
    if (status !== '来季用') {
      if (dryingDateInput.value) {
        dryingStartedAt = dryingDateInput.value;
      } else {
        const activeBtn = ov.querySelector('#drying-presets button.active');
        const daysAgo = Number(activeBtn?.dataset.days ?? 0);
        dryingStartedAt = daysAgo === 0 ? todayIso() : localIsoDate(new Date(Date.now() - daysAgo * 86400000));
      }
    }

    try {
      const photoIds = [];
      if (photo.uri) photoIds.push(addPhoto({ category: '薪棚', date: todayIso(), uri: photo.uri }).id);
      addShelf({
        name,
        status,
        totalVolumeM3,
        usableVolumeM3,
        remainingPercent: pct,
        dryingStartedAt,
        photoIds,
      });
      closeOverlay();
      showToast('薪棚を登録しました');
      onSaved && onSaved();
    } catch {
      showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
    }
  });
}

// ---- 薪ストーブ情報の編集(名前・購入日・触媒交換時期・写真) ----
export function openStoveEditSheet(onSaved) {
  const profile = getProfile();
  const stove = profile.stove;
  const existingUri = stove.photoId ? getPhotos().find((p) => p.id === stove.photoId)?.uri || null : null;
  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">薪ストーブ情報</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="field">
        <label>ストーブ名</label>
        <input class="box" id="stove-edit-name" type="text" value="${stove.name}">
      </div>
      <div class="field">
        <label>購入日</label>
        <input class="box" id="stove-edit-purchase" type="date" value="${stove.purchaseDate ?? ''}">
      </div>
      <div class="field">
        <label>触媒交換時期</label>
        <input class="box" id="stove-edit-catalyst" type="date" value="${stove.catalystReplacedAt ?? ''}" ${stove.hasCatalyst === false ? 'disabled' : ''}>
        <label style="display:flex;align-items:center;gap:7px;margin-top:8px;font-weight:400">
          <input type="checkbox" id="stove-edit-no-catalyst" ${stove.hasCatalyst === false ? 'checked' : ''} style="width:16px;height:16px">
          この機種には触媒がない
        </label>
      </div>
      ${photoFieldHtml('stove-edit-photo', existingUri)}
      <button class="btn-primary" id="stove-edit-save">保存する</button>
    </div>
  `);
  const photo = wirePhotoField(ov, 'stove-edit-photo', existingUri);
  const catalystInput = ov.querySelector('#stove-edit-catalyst');
  const noCatalystBox = ov.querySelector('#stove-edit-no-catalyst');
  noCatalystBox.addEventListener('change', () => {
    catalystInput.disabled = noCatalystBox.checked;
    if (noCatalystBox.checked) catalystInput.value = '';
  });
  ov.querySelector('#stove-edit-save').addEventListener('click', () => {
    const name = ov.querySelector('#stove-edit-name').value.trim() || stove.name;
    const purchaseDate = ov.querySelector('#stove-edit-purchase').value || null;
    const hasCatalyst = !noCatalystBox.checked;
    const catalystReplacedAt = hasCatalyst ? catalystInput.value || null : null;
    try {
      let photoId = stove.photoId ?? null;
      if (photo.uri === '') {
        photoId = null;
      } else if (photo.uri) {
        photoId = addPhoto({ category: 'ストーブ', date: todayIso(), uri: photo.uri }).id;
      }
      updateProfile({ stove: { ...stove, name, purchaseDate, catalystReplacedAt, hasCatalyst, photoId } });
      closeOverlay();
      showToast('薪ストーブ情報を保存しました');
      onSaved && onSaved();
    } catch {
      showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
    }
  });
}

// ---- メンテナンス記録(煙突掃除・ガスケット交換・触媒交換・サビ取りなど) ----
// 薪ストーブの定番メンテナンス項目(年1回程度が目安とされるもの中心に選定)
const MAINTENANCE_TYPES = [
  '煙突掃除',
  'ガスケット(ドアパッキン)交換',
  '触媒清掃・交換',
  '灰処理・灰受け清掃',
  '耐火レンガ点検',
  '蝶番・留め具の点検注油',
  '空気取入れ口・ダンパー確認',
  '本体のサビ取り・塗装補修',
  'シーズン前の試し焚き点検',
  'その他',
];

// 種類ごとにまとめて「このパーツを最後にいつ手入れしたか」が一目で分かるようにする。
// 代表的な項目(MAINTENANCE_TYPES)は記録が無くても「まだ記録がありません」として枠を
// 出しておき、薪ストーブの保守管理チェックリストとして機能させる。「その他」で入力した
// 自由記述はそのまま新しい種類名として扱われ、以後は独立したセクションとして積み上がる
// (種類を追加する専用画面を作らずに、記録するだけで自然に項目が増える仕組み)。
function maintenanceHistoryHtml() {
  const logs = getMaintenanceLogs();
  const byType = new Map();
  logs.forEach((m) => {
    if (!byType.has(m.type)) byType.set(m.type, []);
    byType.get(m.type).push(m);
  });

  const customTypes = Array.from(byType.keys()).filter((t) => !MAINTENANCE_TYPES.includes(t));
  const orderedTypes = [...MAINTENANCE_TYPES.filter((t) => t !== 'その他'), ...customTypes];

  return orderedTypes
    .map((type) => {
      const entries = byType.get(type) || [];
      if (entries.length === 0) {
        return `<div class="maint-group"><div class="maint-group-title">${type}</div><div class="empty" style="padding:8px 0">まだ記録がありません</div></div>`;
      }
      const shown = entries.slice(0, 4);
      const rest = entries.length - shown.length;
      const photos = getPhotos();
      return `
        <div class="maint-group">
          <div class="maint-group-title">${type}<span class="label-sm">最終:${entries[0].date}(${daysBetween(entries[0].date)}日前)</span></div>
          ${shown
            .map((m) => {
              const photo = m.photoId ? photos.find((p) => p.id === m.photoId) : null;
              const thumb = photo
                ? `<div class="photo-ph" data-action="view-photo" data-photo-id="${photo.id}" style="width:28px;height:28px;border-radius:5px;flex-shrink:0"><img src="${photo.uri}" alt=""></div>`
                : '';
              return `<div class="history-row"><span>${m.date}(${daysBetween(m.date)}日前)</span><span style="display:flex;align-items:center;gap:6px;justify-content:flex-end">${m.memo || ''}${thumb}</span></div>`;
            })
            .join('')}
          ${rest > 0 ? `<div class="label-sm" style="padding:4px 0">他${rest}件</div>` : ''}
        </div>`;
    })
    .join('');
}

// 薪棚チェックと同じ考え方: 同じ日・同じ種類の記録が既にある時、黙って上書き・黙って
// 追加のどちらもせず選んでもらう(連打による無意味な重複と、別の記録が消える事故の両方を防ぐ)。
function openSameDayMaintChoiceSheet({ onOverwrite, onAddNew }) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">この種類は今日すでに記録があります</div>
      <div style="font-size:calc(13px * var(--font-scale));line-height:1.7;color:var(--cream);margin-bottom:16px">今日の記録を書き換えますか?それとも別の記録として追加しますか?</div>
      <button class="btn-primary" id="maint-same-day-overwrite" style="margin-bottom:8px">上書きする</button>
      <button class="btn-ghost" id="maint-same-day-add" style="width:100%;margin-bottom:8px">別の記録として追加</button>
      <button class="btn-ghost" data-action="close-overlay" style="width:100%">キャンセル</button>
    </div>
  `);
  ov.querySelector('#maint-same-day-overwrite').addEventListener('click', () => {
    closeOverlay();
    onOverwrite();
  });
  ov.querySelector('#maint-same-day-add').addEventListener('click', () => {
    closeOverlay();
    onAddNew();
  });
}

export function openMaintenanceSheet(onSaved) {
  function draw() {
    const ov = document.querySelector('[data-dynamic-overlay="true"]');
    if (!ov) return;
    ov.querySelector('#maint-history').innerHTML = maintenanceHistoryHtml();
  }

  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">メンテナンス記録</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div class="field">
        <label>実施日</label>
        <input class="box" id="maint-date" type="date" value="${todayIso()}">
      </div>
      <div class="field">
        <label>種類</label>
        <select class="box" id="maint-type">
          ${MAINTENANCE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="maint-custom-field" style="display:none">
        <label>種類(自由入力)</label>
        <input class="box" id="maint-custom-type" placeholder="例: 灰かき棒の交換">
      </div>
      <div class="field">
        <label>メモ(任意)</label>
        <textarea class="box" id="maint-memo" placeholder="交換部品や気づいたことなど"></textarea>
      </div>
      ${photoFieldHtml('maint-photo', null)}
      <button class="btn-primary" id="maint-save-btn">記録する</button>
      <div class="label-sm" style="margin:16px 0 8px;font-weight:700">これまでの記録</div>
      <div id="maint-history"></div>
    </div>
  `);
  const typeSelect = ov.querySelector('#maint-type');
  const customField = ov.querySelector('#maint-custom-field');
  typeSelect.addEventListener('change', () => {
    customField.style.display = typeSelect.value === 'その他' ? '' : 'none';
  });
  const photo = wirePhotoField(ov, 'maint-photo', null);

  function resetForm() {
    ov.querySelector('#maint-memo').value = '';
    ov.querySelector('#maint-custom-type').value = '';
    photo.uri = null;
    ov.querySelector('#maint-photo').innerHTML = `<svg class="icon" viewBox="0 0 24 24" style="width:18px;height:18px"><use href="#i-camera"/></svg>`;
  }

  ov.querySelector('#maint-save-btn').addEventListener('click', () => {
    const date = ov.querySelector('#maint-date').value || todayIso();
    const selected = typeSelect.value;
    const customType = ov.querySelector('#maint-custom-type').value.trim();
    const type = selected === 'その他' && customType ? customType : selected;
    const memo = ov.querySelector('#maint-memo').value.trim();
    let photoId = null;
    try {
      photoId = photo.uri ? addPhoto({ category: 'メンテ', date, uri: photo.uri }).id : null;
    } catch {
      showToast('保存に失敗しました。写真の保存容量が上限に近づいている可能性があります');
      return;
    }
    const payload = { date, type, memo, photoId };

    const finish = (message) => {
      resetForm();
      showToast(message);
      draw();
      onSaved && onSaved();
    };

    // 同じ日・同じ種類の記録が既にある時は、連打でそのまま重複が増えないよう
    // 薪棚チェックと同じ考え方で確認する(別の種類のメンテを同じ日にした場合は別記録として扱う)。
    const existing = getMaintenanceLogs().find((m) => m.date === date && m.type === type);
    if (existing) {
      const same = existing.memo === memo && existing.photoId === photoId;
      if (same) {
        showToast('変更がないため、記録はそのままです');
        return;
      }
      openSameDayMaintChoiceSheet({
        onOverwrite: () => {
          updateMaintenanceLog(existing.id, payload);
          finish('メンテナンス記録を更新しました');
        },
        onAddNew: () => {
          addMaintenanceLog(payload);
          finish('メンテナンス記録を保存しました');
        },
      });
      return;
    }

    addMaintenanceLog(payload);
    finish('メンテナンス記録を保存しました');
  });
  draw();
}
