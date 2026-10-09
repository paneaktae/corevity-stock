import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe('language preference', () => {
  it('persists Thai, formats dates and money, and leaves arbitrary data intact', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.stubGlobal('document', { documentElement: { lang: 'en' } });
    const { t, setLanguage } = await import('../src/i18n');
    const { date, money, label } = await import('../src/lib');
    expect(t('Inventory')).toBe('Inventory');
    setLanguage('th');
    expect(t('Inventory')).toBe('คลังสินค้า');
    expect(t('Technogym Test01')).toBe('Technogym Test01');
    expect(label('AVAILABLE')).toBe('พร้อมขาย');
    expect(money(1234.5)).toContain('1,234.50');
    expect(date('2026-10-10T00:00:00Z')).toContain('2569');
    expect(document.documentElement.lang).toBe('th');
    vi.resetModules();
    expect((await import('../src/i18n')).getLanguage()).toBe('th');
  });
  it('supports switching when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    vi.stubGlobal('navigator', { language: 'th-TH' });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    const { getLanguage, setLanguage, t } = await import('../src/i18n');
    expect(getLanguage()).toBe('th');
    setLanguage('en');
    expect(t('Inventory')).toBe('Inventory');
  });
});
