const KEY = 'photo-timeline:theme';

export function initTheme(): void {
  const root = document.documentElement;
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-theme-set]');

  function apply(theme: string): void {
    root.setAttribute('data-theme', theme);
    buttons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeSet === theme));
    });
  }

  const stored = localStorage.getItem(KEY);
  const initial = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  apply(initial);

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.themeSet!;
      localStorage.setItem(KEY, theme);
      apply(theme);
    });
  });
}
