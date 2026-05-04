'use strict';

const PortfolioTheme = (() => {
  const STORAGE_KEY = 'portfolio_theme';
  const DEFAULT_THEME = 'light';

  function get() {
    return localStorage.getItem(STORAGE_KEY) || localStorage.getItem('ft_theme') || DEFAULT_THEME;
  }

  function set(theme, onChange) {
    document.body.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.checked = theme === 'light';
    if (onChange) onChange(theme);
  }

  function init(options = {}) {
    const onChange = options.onChange;
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('change', () => set(toggle.checked ? 'light' : 'dark', onChange));
    }
    set(get(), onChange);
  }

  return { get, set, init };
})();
