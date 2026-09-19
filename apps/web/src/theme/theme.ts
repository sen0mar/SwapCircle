export type ThemePreference = 'light' | 'dark' | 'system';
const storageKey = 'swapcircle-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

// Also serialized into the document head by Vite: one implementation before paint
// and at runtime. Keep this function self-contained for that bootstrap.
export function initializeTheme() {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('swapcircle-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system')
      preference = saved;
  } catch {
    /* Storage can be unavailable in privacy-restricted browsers. */
  }
  const dark =
    preference === 'dark' ||
    (preference === 'system' &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference;
}

export function applyTheme(preference: ThemePreference, systemDark: boolean) {
  const dark = preference === 'dark' || (preference === 'system' && systemDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference;
}

export function saveTheme(preference: ThemePreference) {
  try {
    localStorage.setItem(storageKey, preference);
  } catch {
    /* Theme still works for this visit. */
  }
}

export function watchSystemTheme(
  preference: ThemePreference,
  media: MediaQueryList,
) {
  const update = () => applyTheme(preference, media.matches);
  update();
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
