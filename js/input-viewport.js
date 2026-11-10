// iOS keeps the layout viewport behind the keyboard. Fixed sheets must follow
// the visual viewport instead. This also handles Safari's viewport panning.
let installed = false;

function isTextField(element) {
  return element instanceof HTMLElement && element.matches(
    'textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"])'
  );
}

export function installInputViewport() {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let frame = 0;

  function update() {
    frame = 0;
    const height = viewport?.height || window.innerHeight;
    const top = viewport?.offsetTop || 0;
    root.style.setProperty('--input-viewport-height', `${height}px`);
    root.style.setProperty('--input-viewport-top', `${top}px`);
    root.style.setProperty('--keyboard-inset', `${Math.max(0, root.clientHeight - top - height)}px`);
    const field = document.activeElement;
    const editing = isTextField(field);
    const keyboardOpen = editing && (root.clientHeight - height * (viewport?.scale || 1) > 120);
    root.toggleAttribute('data-keyboard-open', keyboardOpen);
    if (!editing) return;

    const panel = field.closest('.sheet, .modal');
    const rect = field.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const dismiss = panel?.querySelector('.input-dismiss');
    const dismissBottom = dismiss?.getClientRects().length ? dismiss.getBoundingClientRect().bottom + 8 : 0;
    const upper = Math.max(top + 12, (panelRect?.top ?? top) + 12, dismissBottom);
    const lower = Math.min(top + height, panelRect?.bottom ?? top + height) - 12;
    const delta = rect.bottom > lower ? rect.bottom - lower : rect.top < upper ? rect.top - upper : 0;
    if (!delta) return;
    if (panel) panel.scrollTop += delta;
    else {
      // Normal screens scroll inside .content, not necessarily the window.
      let remaining = delta;
      for (let parent = field.parentElement; parent && remaining; parent = parent.parentElement) {
        if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue;
        const before = parent.scrollTop;
        parent.scrollTop += remaining;
        remaining -= parent.scrollTop - before;
      }
      if (remaining) window.scrollBy({ top: remaining, behavior: 'instant' });
    }
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('focusin', () => {
    schedule();
    // Some iOS versions report the final viewport after keyboard animation.
    setTimeout(schedule, 350);
    setTimeout(schedule, 700);
  });
  document.addEventListener('focusout', schedule);
  update();
}

export function addInputDismissButton(overlay) {
  const panel = overlay.querySelector('.sheet, .modal');
  if (!panel || !panel.querySelector('input, textarea')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'input-dismiss';
  button.textContent = '入力を終える';
  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    if (isTextField(document.activeElement)) document.activeElement.blur();
  });
  panel.prepend(button);
}
