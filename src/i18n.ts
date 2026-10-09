import { useSyncExternalStore } from 'react';
import thai from './th.json';
export type Language = 'th' | 'en';
const listeners = new Set<() => void>();
function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem('corevity-language');
    if (saved === 'th' || saved === 'en') return saved;
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
  return typeof navigator !== 'undefined' && navigator.language.startsWith('th')
    ? 'th'
    : 'en';
}
let language = initialLanguage();
export const getLanguage = () => language;
export function setLanguage(next: Language) {
  language = next;
  try {
    localStorage.setItem('corevity-language', next);
  } catch {
    /* Keep the current session preference. */
  }
  document.documentElement.lang = next;
  listeners.forEach((notify) => notify());
}
export function useLanguage() {
  return useSyncExternalStore((notify) => {
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, getLanguage);
}
export function t(text: string): string {
  if (language === 'th') {
    const size = text.match(/^Each photo must be under (\d+) MB\.$/);
    if (size) return `รูปแต่ละรูปต้องมีขนาดต่ำกว่า ${size[1]} เมกะไบต์`;
    const minimum = text.match(
      /^Too small: expected (string|number) to have >=(\d+) characters$/,
    );
    if (minimum) return `กรุณากรอกอย่างน้อย ${minimum[2]} ตัวอักษร`;
  }
  return language === 'th'
    ? ((thai as Record<string, string>)[text] ?? text)
    : text;
}
export function localized(en: string, th: string) {
  return language === 'th' ? th : en;
}
