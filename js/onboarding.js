// 初回起動時の案内(iOSの初期設定のように、1画面1テーマずつ「なぜ聞くか」を説明しながら
// 設定する/しない/あとでを選べるようにする)。マニュアルを読まなくても一通り設定が終わる
// ことを狙っている。既存ユーザーには出さない(store.jsのPROFILE_DEFAULTSを参照)。
import { getProfile, updateProfile, loadDemoSeason } from './store.js';
import { openOverlay, closeOverlay } from './ui.js';
import { resolveLocationFromCity, requestNotificationPermission } from './weather.js';
import { locationPickerFieldsHtml, wireLocationPicker } from './render/sheets.js';

function shell({ step, total, title, body, contentHtml, primaryLabel, secondaryLabel }) {
  const dots = Array.from({ length: total }, (_, i) => `<span class="ob-dot${i === step - 1 ? ' on' : ''}"></span>`).join('');
  return openOverlay(`
    <div class="sheet ob-sheet">
      <div class="ob-dots">${dots}</div>
      <div class="ob-title">${title}</div>
      <div class="ob-body">${body}</div>
      ${contentHtml || ''}
      <button class="btn-primary" id="ob-primary" style="margin-top:14px">${primaryLabel}</button>
      ${secondaryLabel ? `<button class="btn-ghost" id="ob-secondary" style="width:100%;margin-top:8px">${secondaryLabel}</button>` : ''}
    </div>
  `);
}

export function maybeStartOnboarding(onDone) {
  const profile = getProfile();
  if (profile.onboardingCompleted) return;
  showWelcome(onDone);
}

function finish(onDone) {
  updateProfile({ onboardingCompleted: true });
  closeOverlay();
  onDone && onDone();
}

function showWelcome(onDone) {
  const ov = shell({
    step: 1,
    total: 6,
    title: '🔥 火守 / HIMORIへようこそ',
    body: '薪ストーブの残量管理・乾燥チェック・季節の振り返りができるノートです。使い始める前に、いくつか質問させてください(すべて後からでも変更・スキップできます)。',
    primaryLabel: 'はじめる',
  });
  ov.querySelector('#ob-primary').addEventListener('click', () => showUsername(onDone));
}

function showUsername(onDone) {
  const profile = getProfile();
  const ov = shell({
    step: 2,
    total: 6,
    title: 'お名前(呼び方)は?',
    body: 'ホームの「今日のひとこと」などに使います。呼ばれたい名前があれば入力してください。',
    contentHtml: `<div class="field"><input class="box" id="ob-username" placeholder="ゲスト" value="${profile.userName === 'ゲスト' ? '' : profile.userName}"></div>`,
    primaryLabel: '次へ',
    secondaryLabel: 'スキップ',
  });
  ov.querySelector('#ob-primary').addEventListener('click', () => {
    const v = ov.querySelector('#ob-username').value.trim();
    if (v) updateProfile({ userName: v });
    showStove(onDone);
  });
  ov.querySelector('#ob-secondary').addEventListener('click', () => showStove(onDone));
}

function showStove(onDone) {
  const profile = getProfile();
  const ov = shell({
    step: 3,
    total: 6,
    title: 'お使いのストーブは?',
    body: 'メンテナンス記録などで表示される、愛機の名前です(任意)。',
    contentHtml: `<div class="field"><input class="box" id="ob-stove" placeholder="例: Jøtul F 400" value="${profile.stove.name}"></div>`,
    primaryLabel: '次へ',
    secondaryLabel: 'スキップ',
  });
  ov.querySelector('#ob-primary').addEventListener('click', () => {
    const v = ov.querySelector('#ob-stove').value.trim();
    if (v) updateProfile({ stove: { ...profile.stove, name: v } });
    showPostal(onDone);
  });
  ov.querySelector('#ob-secondary').addEventListener('click', () => showPostal(onDone));
}

function showPostal(onDone) {
  const ov = shell({
    step: 4,
    total: 6,
    title: '天気予報と連動しますか?',
    body: '都道府県と市区町村を選ぶと、ホーム画面に地域の気温・降水確率や「冷え込み・雨の前に薪を運んでおく」目安が表示されます。番地までは特定しません。',
    contentHtml: `
      ${locationPickerFieldsHtml('ob-prefecture', 'ob-city')}
      <div id="ob-postal-error" style="font-size:calc(11px * var(--font-scale));color:var(--red);margin-bottom:4px"></div>
    `,
    primaryLabel: '登録する',
    secondaryLabel: 'あとで',
  });
  wireLocationPicker(ov, 'ob-prefecture', 'ob-city');
  ov.querySelector('#ob-primary').addEventListener('click', async () => {
    const prefecture = ov.querySelector('#ob-prefecture').value;
    const city = ov.querySelector('#ob-city').value;
    const errEl = ov.querySelector('#ob-postal-error');
    errEl.textContent = '';
    try {
      const location = await resolveLocationFromCity(prefecture, city);
      updateProfile({ location });
      showNotifications(onDone);
    } catch (e) {
      errEl.textContent = e.message || '登録に失敗しました';
    }
  });
  ov.querySelector('#ob-secondary').addEventListener('click', () => showNotifications(onDone));
}

function showNotifications(onDone) {
  const ov = shell({
    step: 5,
    total: 6,
    title: 'お知らせを受け取りますか?',
    body: '「48時間以内の冷え込み・雨・雪」「煙突・触媒清掃の予定日」「薪棚を14日以上チェックしていない」の3種類だけをお知らせします。アプリを開いたタイミングで判定するので、常時のプッシュ通知ではありません。',
    primaryLabel: '許可する',
    secondaryLabel: 'あとで',
  });
  ov.querySelector('#ob-primary').addEventListener('click', async () => {
    const perm = await requestNotificationPermission();
    updateProfile({ notificationsEnabled: perm === 'granted' });
    showSeasonTarget(onDone);
  });
  ov.querySelector('#ob-secondary').addEventListener('click', () => showSeasonTarget(onDone));
}

// 初心者ほど「今シーズン何m³使うか」を正確な数字で答えるのは難しい。熟練者向けの
// 精密な数値入力ではなく、大まかな3択にして「わからなくて当然」を前提にする。
// 実際に使った量は季節が終わるたびに記録されていくので、精度は使いながら上げていける。
// 「少なめ/普通/多め」という評価ラベルは、選ばなかった側に「普通じゃない」という
// 印象を与えかねず、しかも「普通」の基準は人によって違う。使い方の描写だけで
// 選べるようにし、優劣を感じさせる言葉は使わない。
const SEASON_TARGET_TIERS = [
  { key: 'low', desc: '週末だけ・補助暖房として使う', value: 3 },
  { key: 'mid', desc: '冬の間、よく使う', value: 4.6 },
  { key: 'high', desc: 'ほぼ毎日、主暖房として使う', value: 6 },
];

function showSeasonTarget(onDone) {
  const profile = getProfile();
  const ov = shell({
    step: 6,
    total: 6,
    title: '今シーズン、薪はどれくらい使う見込みですか?',
    body: '正確な数字はまだ分からなくて大丈夫です。近いものを選んでください。実際に使った量に応じて、あとからいつでも調整できます。',
    contentHtml: `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${SEASON_TARGET_TIERS.map(
          (t) => `
          <button type="button" class="ob-tier-btn" data-value="${t.value}" style="text-align:left;padding:12px;border-radius:10px;border:1.5px solid var(--leather-line);background:transparent;color:inherit;cursor:pointer">
            <div style="font-weight:700">${t.desc}</div>
            <div class="label-sm" style="margin-top:2px">目安${t.value}m³</div>
          </button>`
        ).join('')}
      </div>
    `,
    primaryLabel: 'この内容で始める(自分の薪棚を登録する)',
    secondaryLabel: '先にサンプルデータで使用感を試す',
  });
  let selected = SEASON_TARGET_TIERS.find((t) => t.value === profile.seasonTargetM3)?.value ?? SEASON_TARGET_TIERS[1].value;
  const tierButtons = ov.querySelectorAll('.ob-tier-btn');
  const highlight = () => {
    tierButtons.forEach((b) => {
      b.style.borderColor = Number(b.dataset.value) === selected ? 'var(--ember)' : 'var(--leather-line)';
    });
  };
  tierButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selected = Number(btn.dataset.value);
      highlight();
    });
  });
  highlight();
  ov.querySelector('#ob-primary').addEventListener('click', () => {
    updateProfile({ seasonTargetM3: selected });
    finish(onDone);
  });
  // 「自分の薪棚がまだ無い状態でいきなり空の画面を見せる」のではなく、使用感を
  // 先に試したい人にはその場でサンプルデータを読み込む選択肢も用意する
  // (設定画面からいつでも同じ操作で戻せることは、この後もアプリ内で案内される)。
  ov.querySelector('#ob-secondary').addEventListener('click', () => {
    updateProfile({ seasonTargetM3: selected });
    loadDemoSeason();
    finish(onDone);
  });
}
