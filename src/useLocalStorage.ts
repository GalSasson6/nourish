import { useEffect, useState } from 'react';

export function useLocalStorage<T>(key: string, fallback: T, toStorageValue: (value: T) => unknown = (value) => value) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) as T : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(toStorageValue(value)));
    } catch (error) {
      // Storage can be unavailable or full (notably on iOS). The in-memory value
      // should remain usable instead of letting an effect error unmount the app.
      console.warn(`Could not persist ${key} to local storage.`, error);
    }
  }, [key, toStorageValue, value]);

  return [value, setValue] as const;
}
