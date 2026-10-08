import { Select } from '../ui/select';
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
    const syncPreference = () => {
      const value = document.documentElement.dataset.themePreference;

      if (isThemePreference(value)) setPreference(value);
    };

    window.addEventListener('swapcircle:theme', syncPreference);

    return () => window.removeEventListener('swapcircle:theme', syncPreference);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    return watchSystemTheme(preference, media);
  }, [preference]);

  return (
    <label className="theme-picker">
      <span>Theme</span>
      <Select
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
            window.dispatchEvent(new Event('swapcircle:theme'));
          }
        }}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </Select>
    </label>
  );
}
