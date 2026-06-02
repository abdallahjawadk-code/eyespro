import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** URL ?tab= state shared by all domain hubs */
export function useTabParam<T extends string>(
  parse: (raw: string | null) => T,
  param = 'tab',
): [T, (next: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parse(searchParams.get(param));

  const setTab = useCallback(
    (next: T) => {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        p.set(param, next);
        return p;
      });
    },
    [setSearchParams, param],
  );

  return [tab, setTab];
}

export function parseEnumTab<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}
