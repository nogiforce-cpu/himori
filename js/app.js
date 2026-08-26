import * as home from './render/home.js';
import * as shelves from './render/shelves.js';
import * as check from './render/check.js';
import * as review from './render/review.js';
import * as album from './render/album.js';
import * as settings from './render/settings.js';
import * as calendar from './render/calendar.js';
import { openAddWoodModal, openAddShelfSheet, openWoodTypeCollectionSheet, openWoodTypeDetailSheet, openStoveDetailSheet, openInfoSheet } from './render/sheets.js';
import { seedIfEmpty, getProfile, getShelves, getNotificationHistory } from './store.js';
import { ensureWeatherFresh, maybeNotifyWeather, maybeNotifyChimney, maybeNotifyShelfCheck } from './weather.js';
import { maybeStartOnboarding } from './onboarding.js';
import { go, openMenu, closeMenu, onNavigate } from './ui.js';
import { ensureCurrentShelf, state } from './state.js';

// 各画面のrenderを個別にtry/catchする: 1画面の不具合が他画面の表示まで巻き込んで
// 真っ白にしてしまうことがないようにする(キャッシュ不整合などの想定外に対する保険)
function renderAll() {
  [home, shelves, check, review, album, settings, calendar].forEach((mod) => {
    try {
      mod.render();
    } catch (err) {
      console.error('[himori] render失敗', err);
    }
  });
}

async function refreshWeatherAndNotify() {
  const profile = getProfile();
  const cache = await ensureWeatherFresh(profile);
  if (cache) {
    maybeNotifyWeather(cache.daily, profile.notificationsEnabled);
  }
  maybeNotifyChimney(profile.nextChimneyCleaning, profile.notificationsEnabled);
  maybeNotifyShelfCheck(getShelves(), profile.notificationsEnabled);
  home.render();
  check.render();
}

// カレンダー画面内の「カレンダー / 週次まとめ」切り替え。カレンダーは以前メニューの奥にしか
// 無かったが使用頻度が高いはずなので、下部ナビ「カレンダー」の既定ビューに昇格させた。
function setReviewView(view) {
  state.reviewView = view;
  const calEl = document.getElementById('review-view-calendar');
  const weekEl = document.getElementById('review-view-weekly');
  const titleEl = document.getElementById('review-title');
  if (calEl) calEl.style.display = view === 'calendar' ? '' : 'none';
  if (weekEl) weekEl.style.display = view === 'weekly' ? '' : 'none';
  if (titleEl) titleEl.textContent = view === 'calendar' ? 'カレンダー' : '週次まとめ';
  document.querySelectorAll('#review-view-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'calendar') calendar.render();
  else review.render();
}

const NAV_TABS = [
  { id: 'home', label: 'ホーム', icon: 'i-home' },
  { id: 'shelves', label: '薪棚一覧', icon: 'i-warehouse' },
  { id: 'check', label: '棚チェック', icon: 'i-check' },
  { id: 'review', label: 'カレンダー', icon: 'i-calendar' },
  { id: 'album', label: 'アルバム', icon: 'i-image' },
];

// 1つの要素が見つからないだけでbootの残り全部が止まらないよう、要素が無ければ静かにスキップする
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[himori] #${id} が見つかりません(古いキャッシュが残っている可能性があります)`);
    return;
  }
  el.addEventListener(event, handler);
}

function wireStatic() {
  on('btn-open-menu', 'click', openMenu);
  on('btn-alerts', 'click', () => {
    const history = getNotificationHistory();
    const historyHtml = history.length
      ? `
        <div class="label-sm" style="margin:14px 0 6px">過去のお知らせ</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${history
            .map(
              (n) => `
            <div class="card" style="padding:10px 12px">
              <div class="label-sm">${n.date}</div>
              <div style="font-weight:700;margin-top:2px">${n.title}</div>
              <div style="font-size:calc(12px * var(--font-scale));margin-top:2px">${n.body}</div>
            </div>`
            )
            .join('')}
        </div>`
      : '<div class="label-sm" style="margin-top:14px">まだお知らせは届いていません。</div>';
    openInfoSheet(
      'お知らせについて',
      `<p>通知は「48時間以内の冷え込み・雨・雪」「煙突・触媒清掃の予定日」「薪棚を14日以上チェックしていない」の3種類のみです。設定で通知を許可すると、アプリを開いたタイミングで判定・表示されます(常時のプッシュ通知ではありません)。</p>${historyHtml}`
    );
  });
  on('btn-burn-today', 'click', () => home.handleBurnToday());
  on('btn-go-check', 'click', () => {
    ensureCurrentShelf();
    check.render();
    go('check');
  });
  on('btn-open-add', 'click', () => openAddWoodModal(renderAll));
  on('btn-shelves-add', 'click', () => openAddShelfSheet(renderAll));
  on('btn-home-split-log', 'click', () => home.openSplitLogFromHome());
  on('btn-check-back', 'click', () => go('shelves'));
  on('btn-check-save', 'click', () => check.saveCheck());
  on('btn-week-prev', 'click', () => review.weekPrev());
  on('btn-week-next', 'click', () => review.weekNext());
  on('btn-split-log', 'click', () => review.openSplitLog());
  on('btn-album-info', 'click', () => album.showAlbumInfo());
  on('btn-settings-back', 'click', () => go('home'));
  on('btn-cal-prev', 'click', () => calendar.calPrev());
  on('btn-cal-next', 'click', () => calendar.calNext());
  on('cal-month-picker', 'change', (e) => calendar.pickMonth(e.target.value));

  document.querySelectorAll('#review-view-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => setReviewView(btn.dataset.view));
  });

  // メニューの背景(暗くなった部分)をタップしたら閉じる。これが無いと画面全体を覆う
  // オーバーレイがタップを飲み込み続け、メニュー項目以外どこを押しても反応しなくなる。
  on('menu-overlay', 'click', (e) => {
    if (e.target.id === 'menu-overlay') closeMenu();
  });

  on('menu-settings', 'click', () => {
    closeMenu();
    go('settings');
  });
  on('menu-woodtypes', 'click', () => {
    closeMenu();
    openWoodTypeCollectionSheet();
  });
  on('menu-guide', 'click', () => {
    closeMenu();
    settings.openGuide();
  });

  document.querySelectorAll('#shelf-filters button').forEach((btn) => {
    btn.addEventListener('click', () => shelves.setFilter(btn.dataset.filter));
  });
  document.querySelectorAll('#album-filters button').forEach((btn) => {
    btn.addEventListener('click', () => album.setFilter(btn.dataset.filter));
  });

  const bottomnav = document.getElementById('bottomnav');
  if (bottomnav) {
    bottomnav.innerHTML = NAV_TABS.map(
      (t) => `
      <button class="navitem${t.id === 'home' ? ' active' : ''}" data-tab="${t.id}">
        <svg class="icon" viewBox="0 0 24 24" style="width:19px;height:19px"><use href="#${t.icon}"/></svg>${t.label}
      </button>`
    ).join('');
    bottomnav.querySelectorAll('.navitem').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'check') ensureCurrentShelf();
        go(btn.dataset.tab);
      });
    });
  }
}

const ACTIONS = {
  'open-add-shelf': () => openAddShelfSheet(renderAll),
  'open-woodtypes': () => openWoodTypeCollectionSheet(),
  // 樹種詳細の「戻る」は、開いた場所ごとに軽量な戻り先(returnType/returnDate)を
  // data属性で受け取り、それに応じたコールバックを組み立てる(history.back()は使わない)。
  // returnTypeが無い場合(樹種一覧のカードなど)はopenWoodTypeDetailSheetのデフォルト
  // (樹種一覧へ戻る)にそのまま委ねる。
  'open-woodtype-detail': (el) => {
    const returnType = el.dataset.returnType;
    const onClose =
      returnType === 'home'
        ? () => home.render() // ホーム画面はそのまま残っているが、削除等で樹種数が
          // 変わっている可能性があるので軽く再描画する(タブ移動はしないのでスクロール位置は保たれる)
        : returnType === 'calendar-day'
          ? () => calendar.openCalDay(el.dataset.returnDate)
          : undefined;
    openWoodTypeDetailSheet(el.dataset.name, onClose);
  },
  // 愛機詳細も樹種詳細と同じ軽量な戻り先パターンを再利用する。
  'open-stove-detail': (el) => {
    const returnType = el.dataset.returnType;
    const onClose =
      returnType === 'calendar-day'
        ? () => calendar.openCalDay(el.dataset.returnDate)
        : returnType === 'settings'
          ? () => settings.render()
          // ホームなど: 元の画面はそのまま残っているが、編集で名前・写真・年数などが
          // 変わっている可能性があるので軽く再描画する(タブ移動が無いのでスクロール位置は保たれる)
          : () => home.render();
    openStoveDetailSheet(onClose);
  },
  'toggle-weather-detail': () => home.toggleWeatherDetail(),
  'open-shelf-check': (el) => shelves.openShelfCheck(el.dataset.shelfId),
  'edit-shelf-from-list': (el) => shelves.editShelfFromList(el.dataset.shelfId),
  'pick-shelf': () => check.pickShelf(),
  'edit-shelf': () => check.editShelf(),
  'toggle-check-item': (el) => check.toggleChecklistItem(el.dataset.key),
  'view-photo': (el) => album.viewPhoto(el.dataset.photoId),
  'set-main-shelf': (el) => {
    home.setMainShelf(el.dataset.shelfId);
    shelves.render();
  },
  'pick-main-shelf': () => home.pickMainShelf(),
  'open-main-shelf-check': () => home.openMainShelfCheck(),
  'release-main-shelf': () => {
    home.releaseMainShelf();
    shelves.render();
  },
  'confirm-season-end': () => home.confirmSeasonEnd(),
  'dismiss-season-end-prompt': () => home.dismissSeasonEndPrompt(),
  'open-cal-day': (el) => calendar.openCalDay(el.dataset.date),
  'edit-username': () => settings.editUsername(),
  'edit-stove-photo': (el, e) => {
    e.stopPropagation();
    home.editStovePhoto();
  },
  'edit-safety-line': () => settings.editSafetyLine(),
  'edit-season-target': () => settings.editSeasonTarget(),
  'toggle-notifications': () => settings.toggleNotifications(),
  'toggle-theme': () => settings.toggleTheme(),
  'cycle-text-size': () => settings.cycleTextSize(),
  'edit-location': () => settings.editLocation(),
  'edit-chimney': () => settings.editChimney(),
  'export-data': () => settings.exportData(),
  'import-data': () => settings.importData(),
  'load-demo-data': () => settings.loadDemoData(),
  'reset-demo-data': () => settings.resetDemoData(),
  'open-guide': () => settings.openGuide(),
  'open-faq': () => settings.openFaq(),
  'open-contact': () => settings.openContact(),
};

function wireDelegatedActions() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const handler = ACTIONS[el.dataset.action];
    if (handler) handler(el, e);
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./service-worker.js');
    // 新しいService Workerが有効になったタイミングで、キャッシュの新旧が混ざった状態の
    // まま古いJS/HTMLの組み合わせで動き続けることがないよう、1回だけ自動リロードする。
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  } catch {
    // オフライン対応が効かないだけなので致命的ではない
  }
}

function maybeShowOnboarding() {
  maybeStartOnboarding(() => refreshWeatherAndNotify());
}

function boot() {
  try {
    seedIfEmpty();
    settings.initTheme();
    ensureCurrentShelf();
    wireStatic();
    wireDelegatedActions();
    onNavigate(() => renderAll());
    renderAll();
    setReviewView(state.reviewView);
    if (!location.search.includes('nosw')) registerServiceWorker();
    refreshWeatherAndNotify();
    maybeShowOnboarding();
  } catch (err) {
    console.error('[himori] 起動処理でエラーが発生しました', err);
    const app = document.getElementById('app');
    if (app) {
      app.insertAdjacentHTML(
        'afterbegin',
        '<div style="position:fixed;inset:0;z-index:999;background:#0B0D0A;color:#F2EAD6;padding:24px;font-size:calc(13px * var(--font-scale));line-height:1.7">読み込みに失敗しました。ページを再読み込みしても直らない場合は、ブラウザのサイトデータ(キャッシュ)を削除してから開き直してください。</div>'
      );
    }
  }
}

boot();
