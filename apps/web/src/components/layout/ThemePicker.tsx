import { useEffect, useState } from 'react';
import {
  applyTheme,
  isThemePreference,
  saveTheme,
  watchSystemTheme,
  type ThemePreference,
} from '../../theme/theme';

export function ThemePicker() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const value =
      typeof document === 'undefined'
        ? 'system'
        : document.documentElement.dataset.themePreference;
    return isThemePreference(value) ? value : 'system';
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    return watchSystemTheme(preference, media);
  }, [preference]);

  return (
    <label className="theme-picker">
      <span>Theme</span>
      <select
        value={preference}
        onChange={(event) => {
          const value = event.target.value;
          if (isThemePreference(value)) {
            applyTheme(
              value,
              window.matchMedia('(prefers-color-scheme: dark)').matches,
            );
            saveTheme(value);
            setPreference(value);
          }
        }}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
