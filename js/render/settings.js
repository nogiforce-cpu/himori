import { getProfile, updateProfile, exportAllData, importAllData, getBurnLogs, getShelves, getCurrentSeason } from '../store.js';
import { requestNotificationPermission, GEO_SOURCE_NOTICE } from '../weather.js';
import { showToast, go } from '../ui.js';
import { openEditSheet, openPostalCodeSheet, openInfoSheet, openMaintenanceSheet } from './sheets.js';
import { daysBetween, isBelowSafetyLine, shouldPromptSeasonEnd } from '../derive.js';

const LAST_EXPORT_KEY = 'himori.lastExportDate';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

export function initTheme() {
  applyTheme(getProfile().theme);
}

export function render() {
  const profile = getProfile();
  applyTheme(profile.theme);

  document.getElementById('settings-profile').innerHTML = `
    <div class="settings-row" data-action="edit-username" style="border-bottom-color:rgba(242,234,214,.14)"><span>ユーザー名</span><span class="v">${profile.userName} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-stove" style="border-bottom-color:rgba(242,234,214,.14)"><span>愛機ストーブ</span><span class="v slab">${profile.stove.name} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-purchase-date"><span>購入日</span><span class="v">${profile.stove.purchaseDate ?? '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-catalyst"><span>触媒交換時期</span><span class="v">${profile.stove.catalystReplacedAt ?? '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
  `;

  document.getElementById('settings-basic').innerHTML = `
    <div class="settings-row"><span>単位設定</span><span class="v">m³(立方メートル)</span></div>
    <div class="settings-row" data-action="edit-season-target"><span>今シーズン想定使用量</span><span class="v">${profile.seasonTargetM3}m³ <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-safety-line"><span>安心ライン設定</span><span class="v">${profile.safetyLineM3}m³ <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="toggle-notifications"><span>通知設定</span><span class="v"><button class="switch ${profile.notificationsEnabled ? 'on' : ''}"></button></span></div>
    <div class="settings-row" data-action="toggle-theme"><span>テーマ設定</span><span class="v">${profile.theme === 'light' ? 'ライト' : 'ダーク'}<button class="switch ${profile.theme === 'light' ? 'on' : ''}"></button></span></div>
    <div class="settings-row" data-action="edit-postal"><span>郵便番号(天気連動)</span><span class="v">${profile.postalCode ?? '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-chimney"><span>次回煙突掃除予定日</span><span class="v">${profile.nextChimneyCleaning ?? '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="open-maintenance"><span>メンテナンス記録</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="export-data"><span>データ・エクスポート</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-download"/></svg></span></div>
    <div class="settings-row" data-action="import-data"><span>データ・インポート</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
  `;

  document.getElementById('settings-support').innerHTML = `
    <div class="settings-row" data-action="open-guide"><span>使い方ガイド</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="open-faq"><span>よくあるご質問</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="open-contact"><span>お問い合わせ</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
  `;

  const backupNoticeEl = document.getElementById('settings-backup-notice');
  const backupNoticeWrap = document.getElementById('settings-backup-notice-wrap');
  if (backupNoticeEl && backupNoticeWrap) {
    const notice = backupReminderText();
    backupNoticeWrap.style.display = notice ? '' : 'none';
    backupNoticeEl.innerHTML = notice
      ? `<div class="settings-row" data-action="export-data" style="color:var(--ember)"><span>${notice}</span><span class="v">今すぐ書き出す <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>`
      : '';
  }

  document.getElementById('settings-source-notice').textContent = profile.location ? GEO_SOURCE_NOTICE : '';

  updateAppBadge();
}

function backupReminderText() {
  const hasData = getBurnLogs().length > 0;
  if (!hasData) return '';
  const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
  if (!lastExport) return 'まだバックアップを書き出したことがありません';
  const days = daysBetween(lastExport);
  if (days >= 30) return `最後のバックアップから${days}日経っています`;
  return '';
}

function updateAppBadge() {
  if (!('setAppBadge' in navigator)) return;
  try {
    const profile = getProfile();
    const shelves = getShelves();
    const burnLogs = getBurnLogs();
    let count = 0;
    if (isBelowSafetyLine(shelves, profile.safetyLineM3)) count += 1;
    if (shouldPromptSeasonEnd(getCurrentSeason(), burnLogs)) count += 1;
    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
  } catch {
    // badge API unsupported/unavailable — ignore
  }
}

export function editUsername() {
  const profile = getProfile();
  openEditSheet({
    title: 'ユーザー名',
    fields: [{ key: 'userName', label: 'ユーザー名', type: 'text', value: profile.userName }],
    onSave: (v) => {
      updateProfile({ userName: v.userName || 'ゲスト' });
      render();
    },
  });
}

export function editStove() {
  const profile = getProfile();
  openEditSheet({
    title: '愛機ストーブ',
    fields: [{ key: 'name', label: 'ストーブ名', type: 'text', value: profile.stove.name }],
    onSave: (v) => {
      updateProfile({ stove: { ...profile.stove, name: v.name || profile.stove.name } });
      render();
    },
  });
}

export function editPurchaseDate() {
  const profile = getProfile();
  openEditSheet({
    title: '購入日',
    fields: [{ key: 'date', label: '購入日', type: 'date', value: profile.stove.purchaseDate }],
    onSave: (v) => {
      updateProfile({ stove: { ...profile.stove, purchaseDate: v.date || null } });
      render();
    },
  });
}

export function editCatalyst() {
  const profile = getProfile();
  openEditSheet({
    title: '触媒交換時期',
    fields: [{ key: 'date', label: '交換日', type: 'date', value: profile.stove.catalystReplacedAt }],
    onSave: (v) => {
      updateProfile({ stove: { ...profile.stove, catalystReplacedAt: v.date || null } });
      render();
    },
  });
}

export function editSafetyLine() {
  const profile = getProfile();
  openEditSheet({
    title: '安心ライン設定',
    fields: [{ key: 'safetyLineM3', label: '安心ラインの残量(m³)', type: 'number', value: profile.safetyLineM3 }],
    onSave: (v) => {
      updateProfile({ safetyLineM3: v.safetyLineM3 ?? profile.safetyLineM3 });
      render();
    },
  });
}

export function editSeasonTarget() {
  const profile = getProfile();
  openEditSheet({
    title: '今シーズン想定使用量',
    fields: [
      { key: 'seasonTargetM3', label: 'このシーズンに使う見込みの量(m³)', type: 'number', value: profile.seasonTargetM3 },
    ],
    onSave: (v) => {
      updateProfile({ seasonTargetM3: v.seasonTargetM3 ?? profile.seasonTargetM3 });
      render();
    },
  });
}

export function openMaintenance() {
  openMaintenanceSheet(() => render());
}

export async function toggleNotifications() {
  const profile = getProfile();
  if (!profile.notificationsEnabled) {
    const perm = await requestNotificationPermission();
    if (perm !== 'granted') {
      showToast('通知が許可されませんでした');
      return;
    }
  }
  updateProfile({ notificationsEnabled: !profile.notificationsEnabled });
  render();
}

export function toggleTheme() {
  const profile = getProfile();
  const next = profile.theme === 'light' ? 'dark' : 'light';
  updateProfile({ theme: next });
  applyTheme(next);
  render();
}

export function editPostal() {
  openPostalCodeSheet(() => render(), { skippable: false });
}

export function editChimney() {
  const profile = getProfile();
  openEditSheet({
    title: '次回煙突掃除予定日',
    fields: [{ key: 'date', label: '予定日', type: 'date', value: profile.nextChimneyCleaning }],
    onSave: (v) => {
      updateProfile({ nextChimneyCleaning: v.date || null });
      render();
    },
  });
}

export function exportData() {
  const data = exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `himori-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString().slice(0, 10));
  showToast('バックアップを書き出しました');
  render();
}

export function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      importAllData(data);
      showToast('データを読み込みました');
      go('home');
      location.reload();
    } catch {
      showToast('読み込みに失敗しました');
    }
  };
  input.click();
}

export function openGuide() {
  openInfoSheet(
    '使い方ガイド',
    `
    <p>毎日は「今日、焚いた」をワンタップするだけでOKです。</p>
    <p>週末など気が向いたときに「薪棚チェック」(乾燥状態・虫カビ・雨漏り湿気・通気風通し・薪の崩れ)で状態を記録しておくと、乾燥具合の目安やレギュラー薪棚選びの参考になります。</p>
    <p>薪を補充したら「薪を追加」で記録してください。入手先メモを残しておくと、次のシーズンにどこで買ったか思い出せて便利です。</p>
    <p>「レギュラー薪棚」は今シーズンいちばん使う棚のことです。ホーム上部のカードから直接チェック画面に進めます。未設定のときはアプリが自動でおすすめを出しますが、あくまで参考です。</p>
    <p>薪割りをしたら「薪割り記録」(斧アイコン)で記録できます。量がまだ分からないときは「量はまだ分からない」を選べば、あとから正確な数字が無くても記録だけ残せます。</p>
    <p>振り返りタブの「カレンダー」では、日ごとの記録がアイコンで一覧できます。同じ日付をタップすると、去年の同じ日に何をしていたかも確認できます。</p>
    <p>ストーブのカード(ホーム下部)をタップすると、煙突掃除やガスケット交換などのメンテナンス記録画面に進めます。</p>
    <p>データはこの端末にしか保存されないので、「データ・エクスポート」で定期的にバックアップを書き出しておくと安心です。</p>
    `
  );
}
export function openFaq() {
  openInfoSheet(
    'よくあるご質問',
    `
    <p><b>Q. 天気通知が届きません</b><br>設定で通知を許可し、郵便番号を登録してください。アプリを開いた時にのみ判定するため、常時のプッシュ通知ではありません。</p>
    <p><b>Q. データはどこに保存されますか</b><br>この端末のブラウザ内(localStorage)にのみ保存されます。機種変更時やブラウザのデータ削除の前には「データ・エクスポート」でバックアップしてください。</p>
    <p><b>Q. 含水計を持っていません。含水率は必須ですか</b><br>いいえ、任意です。実測値が無い場合は、薪棚チェックの「乾燥状態」項目(良好/要確認)を代わりに表示します。</p>
    <p><b>Q. 薪の残量はどうやって記録しますか</b><br>「満タン写真」を基準にした見た目の割合と、数値での手入力(%)のどちらか、もしくは両方を使って記録できます。写真からの自動判定ではないので、ご自身の感覚で調整してください。</p>
    <p><b>Q. シーズンオフの間はどうなりますか</b><br>約1ヶ月焚いていない状態が続くと、シーズン終了を確認するお知らせが出ます。次に焚いた日から自動的に新しいシーズンが始まります。</p>
    <p><b>Q. 記録を間違えて登録してしまいました</b><br>「今日、焚いた」の直後はトーストの「元に戻す」で取り消せます。それ以外の記録は、対象の薪棚・カレンダーの日付から編集・削除してください。</p>
    <p><b>Q. 他の端末と記録を共有できますか</b><br>現在は端末ごとの保存のみです。「データ・エクスポート」で書き出したファイルを「データ・インポート」で別端末に読み込むことで移行できます。</p>
    `
  );
}
export function openContact() {
  location.href = 'mailto:?subject=' + encodeURIComponent('火守/HIMORIについて');
}
