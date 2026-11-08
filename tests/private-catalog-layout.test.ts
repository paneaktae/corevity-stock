import { describe, it, expect } from 'vitest';
import { privateCatalogProduct, privateCatalogMasthead, type PrivateCatalogProduct } from '../worker/private-catalog-layout';
const item: PrivateCatalogProduct = {
  id: 'item', sku: 'SKU-1', product_slug: 'product', brand_snapshot: 'Technogym',
  model_snapshot: 'Skillrow', product_name_snapshot: 'Technogym Skillrow',
  target_body_part: 'Performance rowing', category_snapshot: 'Rowers', condition_snapshot: 'Good',
  status: 'AVAILABLE', description_snapshot: '', catalog_detail: '• LCD console\n• Bluetooth\n\nWeight: 61 kg',
  description_th: '', description_en: 'AI description', short_description: '',
  image_key_snapshot: 'photo.jpg', display_price: 97000,
};
describe('private catalog presentation', () => {
  it('shows the saved catalog price and manual copy with bullets and original paragraph breaks', () => {
    const html = privateCatalogProduct(item, { slug: 'private', language: 'en' });
    expect(html).toContain('<strong>97,000</strong>');
    expect(html).toContain('<li>LCD console</li>');
    expect(html).toContain('<p>Weight: 61 kg</p>');
    expect(html).not.toContain('AI description');
    expect(html).toContain('/media/catalogs/private/item/item');
  });
  it('escapes user-supplied copy, model, and catalog title', () => {
    const html = privateCatalogProduct({ ...item, model_snapshot: '<script>alert(1)</script>', catalog_detail: '<img src=x onerror=alert(1)>' }, { slug: 'private', language: 'en' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(privateCatalogMasthead('<script>', '/?lang=th', '/?lang=en')).toContain('&lt;script&gt;');
  });
  it('shows sold status, missing images and missing prices without inventing product data', () => {
    const html = privateCatalogProduct({ ...item, status: 'SOLD', image_key_snapshot: '', display_price: null }, { slug: 'private', language: 'en' });
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('Photo coming soon');
    expect(html).toContain('Contact us for pricing');
    expect(html).not.toContain('<strong>0</strong>');
    const free = privateCatalogProduct({ ...item, display_price: 0 }, { slug: 'private', language: 'en' });
    expect(free).toContain('<strong>0</strong>');
  });
});
