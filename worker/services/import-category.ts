import defaultCategories from '../../shared/product-categories.json';

export function importCategory(
  value: unknown,
  categories: string[] = defaultCategories,
): string {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  const category = categories.find(
    (item) => item.toLowerCase() === text.toLowerCase(),
  );
  if (!category)
    throw new Error(
      `Category / หมวดหมู่ "${text.slice(0, 100)}" ไม่อยู่ในรายการ กรุณาเลือกหมวดหมู่ที่ตั้งค่าไว้ (choose a category configured in Settings).`,
    );
  return category;
}
