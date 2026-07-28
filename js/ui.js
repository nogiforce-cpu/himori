// 画面遷移・トースト・メニュー等、共通UIヘルパー

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
  actions.forEach(({ label, onClick }) => {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = label;
    btn.onclick = () => {
      hideToast();
      onClick();
    };
    el.appendChild(btn);
  });
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
export function openOverlay(html, { sheet = true } = {}) {
  const root = document.getElementById('modal-root');
  const ov = document.createElement('div');
  ov.className = 'overlay active';
  ov.dataset.dynamicOverlay = 'true';
  ov.onclick = (e) => {
    if (e.target === ov) closeOverlay();
  };
  ov.innerHTML = html;
  root.innerHTML = '';
  root.appendChild(ov);
  ov.querySelectorAll('[data-action="close-overlay"]').forEach((btn) => {
    btn.addEventListener('click', () => closeOverlay());
  });
  return ov;
}
export function closeOverlay() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}
