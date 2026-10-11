import { describe, it, expect } from 'vitest';
import categories from '../shared/product-categories.json';
import { importCategory } from '../worker/services/import-category';
describe('Excel categories', () => {
  it('accepts all dropdown options and normalizes case and whitespace', () => {
    for (const category of categories)
      expect(importCategory(category)).toBe(category);
    expect(importCategory('  upright   BIKE ')).toBe('Upright Bike');
    expect(importCategory('station/cable/smith')).toBe('Station/Cable/Smith');
    expect(importCategory('dumbbell+rack')).toBe('Dumbbell+Rack');
    expect(importCategory(null)).toBe('');
  });
  it('rejects unknown categories instead of silently assigning Other', () => {
    expect(() => importCategory('ลู่วิ่ง')).toThrow('Category');
    expect(() => importCategory('Unknown')).toThrow('Other');
  });
});
