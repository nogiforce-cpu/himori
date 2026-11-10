// 画面遷移・トースト・メニュー等、共通UIヘルパー
import { addInputDismissButton } from './input-viewport.js';

const listeners = { onNavigate: [] };

export function onNavigate(fn) {
  listeners.onNavigate.push(fn);
}

export function go(tabId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const target = document.querySelector(`.screen[data-tab="${tabId}"]`);
  if (target) target.classList.add('active');
  closeMenu();
  updateBottomNavActive(tabId);
  listeners.onNavigate.forEach((fn) => fn(tabId));
}

function updateBottomNavActive(tabId) {
  document.querySelectorAll('#bottomnav .navitem').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
}

export function currentTab() {
  return document.querySelector('.screen.active')?.dataset.tab || 'home';
}

let toastTimer = null;
// actions: [{label, onClick}, ...] (0個以上、通常は最大2個程度を想定)
export function showToast(message, actions = [], { duration } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = '';
  const msg = document.createElement('span');
  msg.textContent = message;
  el.appendChild(msg);
  if (actions.length) {
    const actionsRow = document.createElement('div');
    actionsRow.className = 'toast-actions';
    actions.forEach(({ label, onClick }) => {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = label;
      btn.onclick = () => {
        hideToast();
        onClick();
      };
      actionsRow.appendChild(btn);
    });
    el.appendChild(actionsRow);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration ?? (actions.length ? 6000 : 2200));
}
export function hideToast() {
  document.getElementById('toast').classList.remove('show');
}

export function openMenu() {
  document.getElementById('menu-overlay').classList.add('active');
}
export function closeMenu() {
  document.getElementById('menu-overlay').classList.remove('active');
}

// 汎用オーバーレイ(モーダル/シート)を#modal-rootに描画する
export function openOverlay(html, { sheet = true, restoreOnCancel = false, onCancel } = {}) {
  const root = document.getElementById('modal-root');
  const previous = restoreOnCancel ? Array.from(root.childNodes) : [];
  const cancel = () => { root.replaceChildren(...previous); onCancel?.(); };
  const ov = document.createElement('div');
  ov.className = 'overlay active';
  ov.dataset.dynamicOverlay = 'true';
  ov.onclick = (e) => {
    if (e.target === ov) cancel();
  };
  ov.innerHTML = html;
  addInputDismissButton(ov);
  root.innerHTML = '';
  root.appendChild(ov);
  ov.querySelectorAll('[data-action="close-overlay"]').forEach((btn) => {
    btn.addEventListener('click', cancel);
  });
  return ov;
}
export function closeOverlay() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}

// window.confirm()はブラウザ標準のダイアログが前触れなく出て、アプリの見た目と合わず
// 唐突に感じられる(誤ってキャンセルすると何も起きなかったように見えて紛らわしい)。
// アプリ内のシートで同じ確認体験を提供する。
export function openConfirmSheet({ title, message, confirmLabel = '実行する', cancelLabel = 'キャンセル', onConfirm }) {
  const ov = openOverlay(`
    <div class="sheet">
      <div class="sheet-title">${title}</div>
      <div style="font-size:calc(13px * var(--font-scale));line-height:1.7;color:var(--cream);margin-bottom:16px">${message}</div>
      <button class="btn-primary" id="confirm-sheet-ok" style="margin-bottom:8px">${confirmLabel}</button>
      <button class="btn-ghost" data-action="close-overlay" style="width:100%">${cancelLabel}</button>
    </div>
  `, { restoreOnCancel: true });
  ov.querySelector('#confirm-sheet-ok').addEventListener('click', () => {
    onConfirm();
    if (ov.isConnected) closeOverlay();
  });
}

// A failed save must leave the form available for retry.
export function installActionErrorBoundary() {
  window.addEventListener("error", (event) => {
    if (!event.error) return;
    console.error('[himori] 操作を完了できませんでした', event.error);
    showToast(event.error.message || "保存できませんでした。入力を確認して、もう一度お試しください", [], { duration: 6000 });
    event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error('[himori] 非同期処理を完了できませんでした', event.reason);
    showToast("処理を完了できませんでした。入力を確認して、もう一度お試しください", [], { duration: 6000 });
    event.preventDefault();
  });
}
