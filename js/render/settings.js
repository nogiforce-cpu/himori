import {
  getProfile,
  updateProfile,
  exportAllData,
  importAllData,
  getBurnLogs,
  getShelves,
  getCurrentSeason,
  isDemoActive,
  loadDemoSeason,
  resetDemoSeason,
} from '../store.js';
import { requestNotificationPermission } from '../weather.js';
import { showToast, go, openConfirmSheet } from '../ui.js';
import { openEditSheet, openLocationSheet, openFireSiteSheet, openAmedasStationSheet, openInfoSheet } from './sheets.js';
import { daysBetween, isBelowSafetyLine, shouldPromptSeasonEnd } from '../derive.js';
import { localIsoDate } from '../date-utils.js';
import { WEATHER_V2_ENABLED } from '../weather-v2-flag.js';

const LAST_EXPORT_KEY = 'himori.lastExportDate';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

const TEXT_SIZE_ORDER = ['normal', 'large', 'xlarge'];
const TEXT_SIZE_LABELS = { normal: '標準', large: '大', xlarge: '特大' };
function applyTextSize(size) {
  document.documentElement.setAttribute('data-text-size', size);
}

export function initTheme() {
  applyTheme(getProfile().theme);
  applyTextSize(getProfile().textSize || 'normal');
}

// 設定行タップのたびに 標準→大→特大→標準 と巡回させる(老眼など読みづらさへの配慮。
// 全画面の文字サイズはCSSの--font-scale変数1つで一括制御しているので、ここではその値の
// 元になるdata-text-size属性を切り替えるだけでよい)
export function cycleTextSize() {
  const profile = getProfile();
  const idx = TEXT_SIZE_ORDER.indexOf(profile.textSize || 'normal');
  const next = TEXT_SIZE_ORDER[(idx + 1) % TEXT_SIZE_ORDER.length];
  updateProfile({ textSize: next });
  applyTextSize(next);
  render();
  showToast(`文字サイズ: ${TEXT_SIZE_LABELS[next]}`);
}

export function render() {
  const profile = getProfile();
  applyTheme(profile.theme);
  applyTextSize(profile.textSize || 'normal');

  document.getElementById('settings-profile').innerHTML = `
    <div class="settings-row" data-action="edit-username" style="border-bottom-color:rgba(242,234,214,.14)"><span>ユーザー名</span><span class="v">${profile.userName} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
  `;

  document.getElementById('settings-stove').innerHTML = `
    <div class="settings-row" data-action="open-stove-detail" data-return-type="settings"><span>愛機</span><span class="v slab">${profile.stove.name} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-chimney"><span>次回煙突掃除予定日</span><span class="v">${profile.nextChimneyCleaning ?? '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
  `;

  document.getElementById('settings-basic').innerHTML = `
    <div class="settings-row"><span>単位設定</span><span class="v">m³(立方メートル)</span></div>
    <div class="settings-row" data-action="edit-season-target"><span>今シーズン想定使用量</span><span class="v">${profile.seasonTargetM3}m³ <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-safety-line"><span>安心ライン設定</span><span class="v">${profile.safetyLineM3}m³ <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="toggle-notifications"><span>通知設定</span><span class="v"><button class="switch ${profile.notificationsEnabled ? 'on' : ''}"></button></span></div>
    <div class="settings-row" data-action="toggle-theme"><span>テーマ設定</span><span class="v">${profile.theme === 'light' ? 'ライト' : 'ダーク'}<button class="switch ${profile.theme === 'light' ? 'on' : ''}"></button></span></div>
    <div class="settings-row" data-action="cycle-text-size"><span>文字サイズ</span><span class="v">${TEXT_SIZE_LABELS[profile.textSize || 'normal']} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="edit-location"><span>${WEATHER_V2_ENABLED ? '火のある場所' : 'お住まいの地域(天気連動)'}</span><span class="v">${profile.location ? `${profile.location.prefecture}${profile.location.city}${profile.location.town ?? ''}` : '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    ${
      WEATHER_V2_ENABLED
        ? `<div class="settings-row" data-action="edit-amedas-station"><span>季節の記録に使う観測点</span><span class="v">${profile.amedasStation ? `${profile.amedasStation.name}(気象庁)` : '未設定'} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>`
        : ''
    }
  `;

  const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
  document.getElementById('settings-backup').innerHTML = `
    <div class="settings-row" data-action="export-data"><span>バックアップを作成</span><span class="v">${lastExport ? `${lastExport}に作成` : ''} <svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-download"/></svg></span></div>
    <div class="settings-row" data-action="import-data"><span>バックアップから復元</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-upload"/></svg></span></div>
  `;

  document.getElementById('settings-support').innerHTML = `
    <div class="settings-row" data-action="open-guide"><span>使い方ガイド</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="open-faq"><span>よくあるご質問</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
    <div class="settings-row" data-action="open-contact"><span>お問い合わせ</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>
  `;

  const demoActive = isDemoActive();
  document.getElementById('settings-demo').innerHTML = demoActive
    ? `<div class="settings-row" style="color:var(--ember)"><span>デモデータを表示中です</span></div>
       <div class="settings-row" data-action="reset-demo-data"><span>デモデータをリセット</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>`
    : `<div class="settings-row" data-action="load-demo-data"><span>デモデータを試す(1シーズン分)</span><span class="v"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px"><use href="#i-chevright"/></svg></span></div>`;

  const backupDescEl = document.getElementById('settings-backup-desc');
  if (backupDescEl) {
    const notice = backupReminderText();
    if (notice) {
      backupDescEl.textContent = `${notice}。今のうちに作成しておくと安心です。`;
      backupDescEl.style.color = 'var(--ember)';
    } else {
      backupDescEl.textContent = 'データはこの端末にしか保存されません。機種変更やブラウザのデータ削除の前に、バックアップを作成しておくと安心です。';
      backupDescEl.style.color = '';
    }
  }

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

export function editSafetyLine() {
  const profile = getProfile();
  openEditSheet({
    title: '安心ライン設定',
    description: '使える薪の合計がこの量を下回ったら、ホーム画面で注意を表示します。そろそろ補充を考えるタイミング、という目安にしてください。',
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

export function editLocation() {
  if (WEATHER_V2_ENABLED) {
    openFireSiteSheet(() => render(), { skippable: false });
  } else {
    openLocationSheet(() => render(), { skippable: false });
  }
}

export function editAmedasStation() {
  openAmedasStationSheet(() => render());
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

export function loadDemoData() {
  openConfirmSheet({
    title: 'デモデータを試す',
    message: '1シーズン分のデモデータ(記録・チェック・メンテナンス履歴など)を読み込みます。現在のデータは自動的に退避され、あとから「デモデータをリセット」でいつでも元に戻せます。よろしいですか?',
    confirmLabel: '読み込む',
    onConfirm: () => {
      loadDemoSeason();
      showToast('デモデータを読み込みました');
      go('home');
      location.reload();
    },
  });
}

export function resetDemoData() {
  openConfirmSheet({
    title: 'デモデータをリセット',
    message: 'デモデータをやめて、元のデータに戻しますか?',
    confirmLabel: '元に戻す',
    onConfirm: () => {
      resetDemoSeason();
      showToast('元のデータに戻しました');
      go('home');
      location.reload();
    },
  });
}

export function exportData() {
  const data = exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `himori-backup-${localIsoDate()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_EXPORT_KEY, localIsoDate());
  showToast('バックアップを作成しました');
  render();
}

// 復元は今の端末のデータを丸ごと置き換える(部分マージではない)取り消せない操作なので、
// ファイルを選ぶ前に必ず確認を挟む。うっかり別のバックアップファイルを選んで
// 今のデータを消してしまう事故を防ぐため。
export function importData() {
  openConfirmSheet({
    title: 'バックアップから復元',
    message: 'バックアップファイルを選ぶと、今この端末にあるデータは全て復元した内容に置き換わります。この操作は元に戻せません。よろしいですか?',
    confirmLabel: 'ファイルを選ぶ',
    onConfirm: () => {
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
          showToast('バックアップから復元しました');
          go('home');
          location.reload();
        } catch {
          showToast('復元に失敗しました(ファイルの形式をご確認ください)');
        }
      };
      input.click();
    },
  });
}

// アイコン+太字タイトル+説明、というホーム画面の「樹種コレクションを見る」カードと
// 同じ見た目のリスト行を作るヘルパー。見出しも無く7つの段落が並ぶだけだった旧デザインが
// 「ガイドというより豆知識の羅列」と感じられたため、意味のあるまとまりごとに区切り、
// アイコンで視覚的にも辿りやすくした。
function guideRow(icon, title, body, isImg) {
  const iconHtml = isImg
    ? `<img src="${icon}" alt="" style="width:20px;height:20px;object-fit:contain">`
    : `<svg class="icon" viewBox="0 0 24 24" style="width:20px;height:20px;color:var(--ember)"><use href="${icon}"/></svg>`;
  return `
    <div style="display:flex;gap:12px;padding:12px 2px;border-bottom:1px solid #262922">
      <div style="width:36px;height:36px;border-radius:8px;background:rgba(154,196,106,.14);display:flex;align-items:center;justify-content:center;flex-shrink:0">${iconHtml}</div>
      <div style="flex:1">
        <div style="font-weight:700">${title}</div>
        <div style="font-size:calc(12px * var(--font-scale));margin-top:2px;color:var(--khaki);line-height:1.6">${body}</div>
      </div>
    </div>
  `;
}
function guideSection(title, rowsHtml) {
  return `
    <div class="label-sm" style="margin:16px 0 6px 2px">${title}</div>
    <div class="card" style="padding:2px 12px;margin-bottom:0">${rowsHtml}</div>
  `;
}
export function openGuide() {
  openInfoSheet(
    '使い方ガイド',
    `
    <p style="margin-top:0">火のある暮らしを育てる、HIMORIの基本のリズムです。</p>
    ${guideSection(
      '毎日〜週末に使う',
      guideRow('#i-flame', '今日、焚いた', '毎日はワンタップするだけでOKです。') +
        guideRow('#i-check', '薪棚チェック', '乾燥状態・虫カビ・雨漏り湿気・通気風通し・薪の崩れを記録します。週末など気が向いたときで十分です。') +
        guideRow('#i-plus', '薪を追加', '薪を補充したら記録してください。入手先メモを残しておくと、次のシーズンに思い出せて便利です。') +
        guideRow('assets/icon-axe.png', '薪割り記録', '薪割りをしたら記録できます。量がまだ分からないときは「量はまだ分からない」を選べば、記録だけ残せます。', true)
    )}
    ${guideSection(
      'あとから振り返る',
      guideRow('#i-warehouse', 'いつもの薪棚', '今シーズンいちばん使う棚のことです。ホーム上部のカードから直接チェック画面に進めます。未設定でもアプリが自動でおすすめを出しますが、薪棚一覧の鉛筆アイコンからいつでも設定・解除できます。') +
        guideRow('#i-calendar', 'カレンダー', '日ごとの記録がアイコンで一覧できます。同じ日付をタップすると、去年の同じ日に何をしていたかも確認できます。') +
        guideRow('#i-image', 'アルバム', '薪棚・愛機・メンテナンス・樹種の写真が、撮るたびに自動でここへ集まり、月ごとに振り返れます。') +
        guideRow('assets/icon-woodtype.png', '樹種コレクション', '使ってきた樹種が自然と集まっていく、自分だけの薪図鑑です。メモや割りやすさなどの気づきも残せます。', true)
    )}
    ${guideSection(
      '愛機とデータを守る',
      guideRow('#i-wrench', '愛機', 'ホームの愛機カード(または設定の「愛機」)から詳細画面が開き、メンテナンス記録・写真・自分のメモを残せます。編集は鉛筆アイコンからどうぞ。') +
        guideRow('#i-download', 'バックアップ', 'データはこの端末にしか保存されません。設定画面の「バックアップを作成」で定期的に書き出しておくと安心です。')
    )}
    `
  );
}
export function openFaq() {
  openInfoSheet(
    'よくあるご質問',
    `
    <p><b>Q. 天気通知が届きません</b><br>設定で通知を許可し、お住まいの地域を登録してください。アプリを開いた時にのみ判定するため、常時のプッシュ通知ではありません。</p>
    <p><b>Q. データはどこに保存されますか</b><br>この端末のブラウザ内(localStorage)にのみ保存されます。機種変更時やブラウザのデータ削除の前には「バックアップを作成」で必ずバックアップしてください。</p>
    <p><b>Q. 含水計を持っていません。含水率は必須ですか</b><br>いいえ、任意です。実測値が無い場合は、薪棚チェックの「乾燥状態」項目(良好/要注意/異常あり)を代わりに表示します。</p>
    <p><b>Q. 薪の残量はどうやって記録しますか</b><br>「満タン写真」を基準にした見た目の割合を、スライダーで直感的に合わせて記録できます。写真からの自動判定ではないので、ご自身の感覚で調整してください。</p>
    <p><b>Q. シーズンオフの間はどうなりますか</b><br>約1ヶ月焚いていない状態が続くと、シーズン終了を確認するお知らせが出ます。次に焚いた日から自動的に新しいシーズンが始まります。</p>
    <p><b>Q. 記録を間違えて登録してしまいました</b><br>「今日、焚いた」の直後はトーストの「元に戻す」で取り消せます。それ以外の記録は、対象の薪棚・カレンダーの日付から編集・削除してください。</p>
    <p><b>Q. 他の端末と記録を共有できますか</b><br>現在は端末ごとの保存のみです。「バックアップを作成」で書き出したファイルを、別端末の「バックアップから復元」で読み込むことで移行できます。</p>
    `
  );
}
// お問い合わせ内容を書く欄の下に、状況把握に役立つ端末情報を控えめに添えておく。
// あくまでメールアプリの下書きを開くだけで、送信前にユーザー自身が内容を確認・編集・
// 削除できる(このアプリが勝手に何かを収集・送信するわけではない)。
export function openContact() {
  const body = `\n\n---\n${navigator.userAgent}`;
  location.href =
    'mailto:?subject=' + encodeURIComponent('火守/HIMORIについて') + '&body=' + encodeURIComponent(body);
}
