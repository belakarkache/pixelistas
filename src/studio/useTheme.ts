import { useCallback, useEffect, useState } from 'react';
import { readPref, writePref } from './prefs';

const KEY = 'pixelistas-theme';
type Theme = 'light' | 'dark';

function initial(): Theme {
  const saved = readPref(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePref(KEY, theme);
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return { theme, toggle };
}
