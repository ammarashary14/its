(() => {
  'use strict';
  const key = 'bts-theme';
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  const requested = new URLSearchParams(window.location.search).get('theme');
  if (requested === 'light' || requested === 'dark') {
    saved = requested;
    try { localStorage.setItem(key, requested); } catch {}
  }
  const hasPreference = saved === 'light' || saved === 'dark';
  function apply(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const dark = theme === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      button.querySelector('.theme-icon').textContent = dark ? '☀' : '☾';
      button.querySelector('.theme-label').textContent = dark ? 'Light' : 'Dark';
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#1e2421' : '#e9dfce';
  }
  apply(hasPreference ? saved : 'light');
  function setup() {
    apply(root.dataset.theme);
    document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(key, next); } catch {}
    }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    const valid = event.newValue === 'light' || event.newValue === 'dark';
    apply(valid ? event.newValue : 'light');
  });
})();
