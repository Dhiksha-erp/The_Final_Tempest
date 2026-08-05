import { useState, useEffect } from 'react';

const STORAGE_KEY = 'tempest-dark-mode';

export function useDarkMode() {
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, isDarkMode ? 'true' : 'false');
  }, [isDarkMode]);

  return [isDarkMode, setIsDarkMode];
}
