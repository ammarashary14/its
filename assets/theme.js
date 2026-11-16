(() => {
  'use strict';
  const key = 'bts-theme';
  const root = document.documentElement;
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  let saved = null;
  try { saved = localStorage.getItem(key); } catch {}
  let manual = saved === 'light' || saved === 'dark';
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
    if (meta) meta.content = dark ? '#211f1b' : '#f6f1e9';
  }
  apply(manual ? saved : system?.matches ? 'dark' : 'light');
  function setup() {
    apply(root.dataset.theme);
    document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      manual = true;
      apply(next);
      try { localStorage.setItem(key, next); } catch {}
    }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
  system?.addEventListener?.('change', event => { if (!manual) apply(event.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    manual = event.newValue === 'light' || event.newValue === 'dark';
    apply(manual ? event.newValue : system?.matches ? 'dark' : 'light');
  });
})();
