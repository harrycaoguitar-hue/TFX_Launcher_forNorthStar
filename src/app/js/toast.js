/* Toast transitions have one owner, independent of global page animations. */
const activeToasts = new Map();
let toastSequence = 0;
function Toast(properties = {}) {
  const toast = {timeout: 3000, callback() {}, title: '', description: '', ...properties};
  const host = document.getElementById('toasts');
  if (!host) return;
  if (toast.key) {
    for (const node of [...host.children]) {
      if (node.dataset.toastKey === toast.key) dismissToast(node.id, true);
    }
  }
  const el = document.createElement('div');
  el.id = 'tfx-toast-' + (++toastSequence);el.className = 'toast';
  el.dataset.scheme = toast.scheme || 'info';
  if (toast.key) el.dataset.toastKey = toast.key;
  if (toast.variant === 'skin-complete') el.classList.add('skin-complete-toast');
  el.setAttribute('role', toast.scheme === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-atomic', 'true');
  if (toast.variant === 'skin-complete') {
    const symbol = document.createElement('span');symbol.className = 'toast-success-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 3 3 5-6"></path></svg>';
    el.append(symbol);
  }
  const body = document.createElement('div');body.className = 'toast-body';
  for (const [name, text] of [['title', toast.title], ['description', toast.description]]) {
    if (!text) continue;
    const line = document.createElement('div');line.className = name;line.textContent = text;body.append(line);
  }
  el.append(body);
  const close = document.createElement('button');close.type = 'button';close.className = 'toast-close';close.textContent = '×';
  close.setAttribute('aria-label', window.I18n?.t('skinImport.dismiss') || 'Dismiss');
  close.addEventListener('click', event => {event.stopPropagation();dismissToast(el.id);});el.append(close);
  el.addEventListener('click', () => {dismissToast(el.id);toast.callback();});host.append(el);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const animation = el.animate?.(reduced ? [{opacity: 0}, {opacity: 1}] : [
    {opacity: 0, transform: 'translate3d(24px,12px,0) scale(.96)'},
    {opacity: 1, transform: 'translate3d(0,0,0) scale(1)'}
  ], {duration: reduced ? 120 : 420, easing: 'cubic-bezier(.18,.8,.24,1)'});
  const timer = setTimeout(() => dismissToast(el.id), Math.max(0, Number(toast.timeout) || 3000));
  activeToasts.set(el.id, {timer, animation, reduced, closing: false});
  while (host.children.length > 3) dismissToast(host.firstElementChild.id, true);
  return el;
}
function dismissToast(id, immediate = false) {
  const el = document.getElementById(id), record = activeToasts.get(String(id));
  if (!el) return;
  if (record?.closing && !immediate) return;
  if (record) {clearTimeout(record.timer);record.animation?.cancel();record.closing = true;}
  const remove = () => {el.remove();activeToasts.delete(String(id));};
  if (immediate || !el.animate) {remove();return;}
  el.style.pointerEvents = 'none';
  const animation = el.animate(record?.reduced ? [{opacity: 1}, {opacity: 0}] : [
    {opacity: 1, transform: 'translate3d(0,0,0) scale(1)'},
    {opacity: 0, transform: 'translate3d(18px,0,0) scale(.98)'}
  ], {duration: record?.reduced ? 100 : 220, easing: 'cubic-bezier(.4,0,.8,.2)', fill: 'forwards'});
  animation.finished.then(remove, remove);
}
