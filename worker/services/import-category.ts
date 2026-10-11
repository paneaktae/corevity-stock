import categories from '../../shared/product-categories.json';

export function importCategory(value: unknown): string {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return '';
  const category = categories.find(
    (item) => item.toLowerCase() === text.toLowerCase(),
  );
  if (!category)
    throw new Error(
      `Category / หมวดหมู่ "${text.slice(0, 100)}" ไม่อยู่ในรายการ กรุณาเลือกจากไฟล์ตัวอย่าง หรือใช้ Other (choose a category from the template).`,
    );
  return category;
}
