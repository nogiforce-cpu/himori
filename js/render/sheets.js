import { openOverlay, closeOverlay, showToast } from '../ui.js';
import {
  getShelves,
  getShelf,
  updateBurnLog,
  addWoodAddition,
  updateShelf,
  addPhoto,
  addSplitLog,
  getWoodAdditions,
  updateProfile,
  getWoodTypeCatalog,
  addWoodTypeToCatalog,
  deleteWoodTypeFromCatalog,
  getMaintenanceLogs,
  addMaintenanceLog,
} from '../store.js';
import { applyWoodAddition, todayIso, daysBetween } from '../derive.js';
import { pickImageFile, fileToResizedDataUrl } from '../photos.js';
import { resolveLocationFromPostal } from '../weather.js';

// ---- 汎用: 複数フィールドの編集シート ----
// fields: [{key,label,type:'text'|'number'|'date',value,placeholder}]
export function openEditSheet({ title, fields, onSave }) {
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
    showToast('先に薪棚を登録してください');
    return;
  }
  const woodTypeOptions = getWoodTypeCatalog();
  const sourceOptions = Array.from(new Set(getWoodAdditions().map((a) => a.source).filter(Boolean)));
  let addedVolume = 0.8;
  let photoDataUrl = null;

  const ov = openOverlay(`
    <div class="modal">
      <div class="row" style="margin-bottom:14px"><span style="font-size:15px;font-weight:700">薪を追加した記録</span><button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button></div>
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
      </div>
      <div class="field">
        <label>入手先(任意)</label>
        <input class="box" id="add-source" list="source-options" placeholder="例: 自伐・購入(◯◯材木店)・知人から">
        <datalist id="source-options">${sourceOptions.map((s) => `<option value="${s}">`).join('')}</datalist>
      </div>
      <div class="field">
        <label>メモ(任意)</label>
        <textarea class="box" id="add-memo" placeholder="週末に薪を補充しました。"></textarea>
      </div>
      <div class="field">
        <label>写真(任意)</label>
        <div class="photo-ph" id="add-photo-ph" style="height:70px;width:70px;border-radius:8px;cursor:pointer"><svg class="icon" viewBox="0 0 24 24" style="width:16px;height:16px"><use href="#i-camera"/></svg></div>
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-ghost" data-action="close-overlay">キャンセル</button>
        <button class="btn-primary" style="flex:1" id="add-save-btn">保存する</button>
      </div>
    </div>
  `);

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
    ov.querySelector('#add-photo-ph').innerHTML = `<img src="${photoDataUrl}" alt="">`;
  });

  ov.querySelector('#add-save-btn').addEventListener('click', () => {
    const shelfId = ov.querySelector('#add-shelf').value;
    const date = ov.querySelector('#add-date').value || todayIso();
    const woodType = ov.querySelector('#add-woodtype').value.trim();
    const source = ov.querySelector('#add-source').value.trim();
    const memo = ov.querySelector('#add-memo').value.trim();
    const shelf = shelves.find((s) => s.id === shelfId);

    let photoId = null;
    if (photoDataUrl) {
      const photo = addPhoto({ category: '薪棚', date, uri: photoDataUrl });
      photoId = photo.id;
      updateShelf(shelfId, { photoIds: [...shelf.photoIds, photoId] });
    }
    addWoodAddition({ shelfId, date, addedVolumeM3: addedVolume, woodType, source, memo, photoId });
    updateShelf(shelfId, applyWoodAddition(shelf, addedVolume));
    if (woodType && !shelf.woodTypes.includes(woodType)) {
      updateShelf(shelfId, { woodTypes: [...shelf.woodTypes, woodType] });
    }
    if (woodType) addWoodTypeToCatalog(woodType);
    closeOverlay();
    showToast('追加記録を保存しました');
    onSaved && onSaved();
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

// ---- 樹種コレクション(追加・削除できるシンプルな図鑑) ----
export function openWoodTypeCollectionSheet() {
  function countFor(name) {
    const shelves = getShelves();
    const additions = getWoodAdditions();
    let count = shelves.filter((s) => s.woodTypes.includes(name)).length;
    count += additions.filter((a) => a.woodType === name).length;
    return count;
  }

  function draw() {
    const catalog = getWoodTypeCatalog();
    const ov = document.querySelector('[data-dynamic-overlay="true"]');
    if (!ov) return;
    ov.querySelector('#woodtype-list').innerHTML = catalog.length
      ? `<div class="collection-grid">${catalog
          .map(
            (name) => `
        <div class="collection-card">
          <div class="row" style="align-items:flex-start">
            <svg class="icon" viewBox="0 0 24 24" style="color:var(--green)"><use href="#i-leaf"/></svg>
            <button class="iconbtn" style="width:24px;height:24px" data-action="delete-woodtype" data-name="${name}"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-x"/></svg></button>
          </div>
          <div style="font-size:13px;font-weight:700">${name}</div>
          <div class="n">${countFor(name)}回記録</div>
          ${WOOD_TRIVIA[name] ? `<div class="label-sm" style="margin-top:2px;line-height:1.5">${WOOD_TRIVIA[name]}</div>` : ''}
        </div>`
          )
          .join('')}</div>`
      : `<div class="empty">まだ樹種が登録されていません。下から追加できます。</div>`;
    ov.querySelectorAll('[data-action="delete-woodtype"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteWoodTypeFromCatalog(btn.dataset.name);
        draw();
      });
    });
  }

  const ov = openOverlay(`
    <div class="sheet">
      <div class="row" style="margin-bottom:10px">
        <span class="sheet-title" style="margin-bottom:0">樹種コレクション</span>
        <button class="iconbtn" data-action="close-overlay"><svg class="icon" viewBox="0 0 24 24"><use href="#i-x"/></svg></button>
      </div>
      <div id="woodtype-list" style="margin-bottom:12px"></div>
      <div class="field" style="display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1">
          <label>樹種を追加</label>
          <input class="box" id="woodtype-new" placeholder="例: クヌギ">
        </div>
        <button class="btn-ghost" style="flex:none;padding:11px 16px" id="woodtype-add-btn">追加</button>
      </div>
    </div>
  `);
  ov.querySelector('#woodtype-add-btn').addEventListener('click', () => {
    const input = ov.querySelector('#woodtype-new');
    const name = input.value.trim();
    if (!name) return;
    addWoodTypeToCatalog(name);
    input.value = '';
    draw();
  });
  draw();
}

// ---- 郵便番号入力(天気連動の初回設定) ----
export function openPostalCodeSheet(onResolved, { skippable = true } = {}) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">郵便番号を登録(天気連動)</div>
      <div style="font-size:12px;color:var(--khaki);line-height:1.7;margin-bottom:10px">
        天気予報を使った運び出しの目安表示のため、7桁の郵便番号を1回だけ入力してください。GPSは使いません。
      </div>
      <div class="field">
        <label>郵便番号(ハイフンなし7桁)</label>
        <input class="box" id="postal-input" inputmode="numeric" maxlength="7" placeholder="0010010">
      </div>
      <div id="postal-error" style="font-size:11px;color:var(--red);margin-bottom:8px"></div>
      <div class="btn-row" style="margin-top:4px">
        ${skippable ? '<button class="btn-ghost" id="postal-skip">あとで</button>' : ''}
        <button class="btn-primary" style="flex:1" id="postal-save">登録する</button>
      </div>
    </div>
  `);
  if (skippable) {
    ov.querySelector('#postal-skip').addEventListener('click', () => {
      localStorage.setItem('himori.onboardingDismissed', '1');
      closeOverlay();
    });
  }
  ov.querySelector('#postal-save').addEventListener('click', async () => {
    const input = ov.querySelector('#postal-input').value;
    const errEl = ov.querySelector('#postal-error');
    errEl.textContent = '';
    try {
      const location = await resolveLocationFromPostal(input);
      updateProfile({ postalCode: input.replace(/[^0-9]/g, ''), location });
      localStorage.setItem('himori.onboardingDismissed', '1');
      closeOverlay();
      showToast('位置情報を登録しました');
      onResolved && onResolved();
    } catch (e) {
      errEl.textContent = e.message || '登録に失敗しました';
    }
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
      <div class="sheet-title">薪割りを記録</div>
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
      <div style="font-size:13px;line-height:1.8;color:var(--cream)">${bodyHtml}</div>
    </div>
  `);
}

// ---- 写真追加(カテゴリ・日付) ----
export function openAddPhotoSheet(dataUrl, onSaved) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">写真を追加</div>
      <div class="photo-ph" style="height:140px;margin-bottom:12px"><img src="${dataUrl}" alt=""></div>
      <div class="field">
        <label>カテゴリ</label>
        <select class="box" id="photo-category">
          <option value="薪棚">薪棚</option>
          <option value="ストーブ">ストーブ</option>
        </select>
      </div>
      <div class="field">
        <label>日付</label>
        <input class="box" id="photo-date" type="date" value="${todayIso()}">
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn-ghost" data-action="close-overlay">キャンセル</button>
        <button class="btn-primary" style="flex:1" id="photo-save-btn">保存する</button>
      </div>
    </div>
  `);
  ov.querySelector('#photo-save-btn').addEventListener('click', () => {
    const category = ov.querySelector('#photo-category').value;
    const date = ov.querySelector('#photo-date').value || todayIso();
    addPhoto({ category, date, uri: dataUrl });
    closeOverlay();
    showToast('写真を保存しました');
    onSaved && onSaved();
  });
}

// ---- 写真プレビュー(削除可) ----
export function openPhotoViewSheet(photo, onDeleted) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="photo-ph" style="height:220px;margin-bottom:10px"><img src="${photo.uri}" alt=""></div>
      <div class="row" style="margin-bottom:12px"><span class="label-sm">${photo.date}・${photo.category}</span></div>
      <div class="btn-row">
        <button class="btn-ghost" data-action="close-overlay">閉じる</button>
        <button class="btn-ghost" style="color:var(--red);border-color:var(--red)" id="photo-delete-btn">削除する</button>
      </div>
    </div>
  `);
  ov.querySelector('#photo-delete-btn').addEventListener('click', () => {
    closeOverlay();
    onDeleted && onDeleted();
  });
}

// ---- 薪棚編集(名前・乾燥状態・乾燥開始日) ----
export function openShelfEditSheet(shelfId, onSaved) {
  const shelf = getShelf(shelfId);
  if (!shelf) return;
  const statuses = ['乾燥済み', '乾燥中', '来季用'];
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
      <button class="btn-primary" id="shelf-edit-save">保存する</button>
    </div>
  `);
  ov.querySelector('#shelf-edit-save').addEventListener('click', () => {
    const name = ov.querySelector('#shelf-edit-name').value.trim() || shelf.name;
    const status = ov.querySelector('#shelf-edit-status').value;
    const dryingStartedAt = ov.querySelector('#shelf-edit-drying').value || null;
    updateShelf(shelfId, { name, status, dryingStartedAt });
    closeOverlay();
    showToast('薪棚を更新しました');
    onSaved && onSaved();
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

export function openMaintenanceSheet(onSaved) {
  function draw() {
    const ov = document.querySelector('[data-dynamic-overlay="true"]');
    if (!ov) return;
    const logs = getMaintenanceLogs();
    ov.querySelector('#maint-history').innerHTML = logs.length
      ? logs
          .slice(0, 10)
          .map(
            (m) =>
              `<div class="history-row"><span>${m.date}(${daysBetween(m.date)}日前)</span><span>${m.type}${m.memo ? `・${m.memo}` : ''}</span></div>`
          )
          .join('')
      : `<div class="empty">まだメンテナンス記録がありません。</div>`;
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
      <div class="field">
        <label>メモ(任意)</label>
        <textarea class="box" id="maint-memo" placeholder="交換部品や気づいたことなど"></textarea>
      </div>
      <button class="btn-primary" id="maint-save-btn">記録する</button>
      <div class="label-sm" style="margin:16px 0 8px;font-weight:700">これまでの記録</div>
      <div class="card" id="maint-history" style="margin-bottom:0"></div>
    </div>
  `);
  ov.querySelector('#maint-save-btn').addEventListener('click', () => {
    const date = ov.querySelector('#maint-date').value || todayIso();
    const type = ov.querySelector('#maint-type').value;
    const memo = ov.querySelector('#maint-memo').value.trim();
    addMaintenanceLog({ date, type, memo });
    ov.querySelector('#maint-memo').value = '';
    showToast('メンテナンス記録を保存しました');
    draw();
    onSaved && onSaved();
  });
  draw();
}
