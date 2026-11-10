import { t, getLanguage } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
export class ApiError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string[]> = {},
    public code = '',
    public conflicts: Array<{ eventId: string; title: string; startsAt: string; endsAt: string | null; attendeeEmail: string; attendeeName: string }> = [],
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const data = (await response.json().catch(() => ({
    error: {
      message:
        'The server did not return data. Check your sign-in and connection.',
    },
  }))) as { error?: {
    message?: string; fields?: Record<string, string[]>; code?: string;
    conflicts?: Array<{ eventId: string; title: string; startsAt: string; endsAt: string | null; attendeeEmail: string; attendeeName: string }>;
  } };
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? 'Request failed',
      data.error?.fields,
      data.error?.code,
      data.error?.conflicts,
    );
  return data as T;
}
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const quiet = useRef(false);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Background refresh: keeps the current data on screen and ignores transient errors.
  const refresh = useCallback(() => {
    quiet.current = true;
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) {
      setError('');
      setData(undefined);
    }
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        setData(value);
        if (silent) setError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError' && !silent) setError(e.message);
      });
    return () => controller.abort();
  }, [path, version]);
  return { data, error, reload, refresh };
}
export function useDebounce(value: string) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return result;
}
export const money = (n: number) =>
  new Intl.NumberFormat(getLanguage() === 'th' ? 'th-TH' : 'en-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(n);
export const date = (s: string | null | undefined) =>
  s
    ? new Intl.DateTimeFormat(getLanguage() === 'th' ? 'th-TH' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Bangkok',
      }).format(new Date(s))
    : t('Not set');
export const label = (s: string) =>
  t(
    s
      .toLowerCase()
      .replaceAll('_', ' ')
      .replace(/^./, (s) => s.toUpperCase()),
  );
export function localDate(s: string | null) {
  if (!s) return '';
  const d = new Date(s);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
export const toISO = (s: string) => (s ? new Date(s).toISOString() : null);
