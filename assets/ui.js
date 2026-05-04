'use strict';

const PortfolioUI = (() => {
  let toastHost = null;
  let dialogHost = null;

  function ensureToastHost() {
    if (toastHost) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'pui-toast-host';
    document.body.appendChild(toastHost);
    return toastHost;
  }

  function toast(message, opts = {}) {
    const type = opts.type || 'info';
    const duration = opts.duration ?? 2800;
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'pui-toast pui-toast-' + type;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('pui-toast-in'));
    const remove = () => {
      el.classList.remove('pui-toast-in');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);
    };
    setTimeout(remove, duration);
    el.addEventListener('click', remove);
  }

  function confirm(message, opts = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'pui-dialog-overlay';
      overlay.innerHTML =
        '<div class="pui-dialog" role="dialog" aria-modal="true">' +
          '<p class="pui-dialog-msg"></p>' +
          '<div class="pui-dialog-actions">' +
            '<button class="pui-dialog-cancel"></button>' +
            '<button class="pui-dialog-ok"></button>' +
          '</div>' +
        '</div>';
      overlay.querySelector('.pui-dialog-msg').textContent = message;
      const okBtn = overlay.querySelector('.pui-dialog-ok');
      const cancelBtn = overlay.querySelector('.pui-dialog-cancel');
      okBtn.textContent = opts.okText || 'Confirm';
      cancelBtn.textContent = opts.cancelText || 'Cancel';
      if (opts.danger) okBtn.classList.add('pui-danger');

      function close(result) {
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('pui-dialog-in');
        setTimeout(() => overlay.remove(), 180);
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); close(true); }
      }
      okBtn.addEventListener('click', () => close(true));
      cancelBtn.addEventListener('click', () => close(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('pui-dialog-in'));
      okBtn.focus();
    });
  }

  function alert(message, opts = {}) {
    return new Promise(resolve => {
      confirm(message, { okText: opts.okText || 'OK', cancelText: '\u00a0' }).then(resolve);
    });
  }

  return { toast, confirm, alert };
})();
