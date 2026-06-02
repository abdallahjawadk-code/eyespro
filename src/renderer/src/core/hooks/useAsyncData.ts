import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from '../api';

type State<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/** Standard async data hook for domain screens — wraps eyespro IPC calls */
export function useAsyncData<T>(
  fetcher: () => Promise<ApiResult<T>>,
  deps: unknown[] = [],
) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    const res = await fetcher().catch(() => ({ ok: false as const, error: 'Network error' }));
    if (res.ok && res.data !== undefined) {
      setState({ data: res.data, loading: false, error: null });
    } else {
      setState({ data: null, loading: false, error: res.error ?? 'Failed to load' });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void reload(); }, [reload]);

  return { ...state, reload };
}
