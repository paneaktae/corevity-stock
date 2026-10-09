import { writeFileSync } from 'node:fs';
const now = new Date();
const at = (days) => new Date(now.getTime() + days * 86400000).toISOString();
const quote = (v) =>
  v === null
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
const rows = (table, cols, values) =>
  `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES\n${values.map((r) => `(${r.map(quote).join(',')})`).join(',\n')};\n`;
let sql = '-- Development demo data only.\n';
const equipment = [
  [
    'life',
    'Life Fitness',
    '95T Elevation',
    'Treadmill',
    'Good',
    65000,
    95000,
    'AVAILABLE',
  ],
  [
    'cybex',
    'Cybex',
    'Arc Trainer 770AT',
    'Cross Trainer',
    'Excellent',
    48000,
    72000,
    'AVAILABLE',
  ],
  [
    'matrix',
    'Matrix',
    'G3 Chest Press',
    'Strength',
    'Good',
    25000,
    39000,
    'AVAILABLE',
  ],
  [
    'techno',
    'Technogym',
    'Excite Bike',
    'Bike',
    'Fair',
    22000,
    35000,
    'AVAILABLE',
  ],
  [
    'precor',
    'Precor',
    'EFX 885',
    'Cross Trainer',
    'Good',
    42000,
    68000,
    'SOLD',
  ],
  [
    'hammer',
    'Hammer Strength',
    'Iso-Lateral Row',
    'Strength',
    'Needs Repair',
    18000,
    29000,
    'AVAILABLE',
  ],
];
sql += rows(
  'products',
  [
    'id',
    'sku',
    'brand',
    'model',
    'category',
    'condition',
    'purchase_cost',
    'selling_price',
    'status',
    'location',
    'notes',
    'created_at',
    'updated_at',
    'sold_at',
  ],
  equipment.map(([id, ...p], i) => [
    `demo-${id}`,
    `EQ-DEMO-000${i + 1}`,
    ...p,
    `Bangkok · ${i < 4 ? 'A' : 'B'}${i + 1}`,
    'Fictional demo item. Verify condition and specifications before sale.',
    at(-i),
    at(0),
    p[6] === 'SOLD' ? at(0) : null,
  ]),
);
sql += rows(
  'customers',
  [
    'id',
    'name',
    'company_name',
    'phone',
    'email',
    'budget',
    'interested_in',
    'notes',
    'created_at',
    'updated_at',
  ],
  [
    ['1', 'Narin Demo', 'Motion Studio (Demo)', 150000, 'Cardio equipment'],
    ['2', 'Mali Demo', 'Everyday Strength (Demo)', 80000, 'Strength equipment'],
    ['3', 'Pim Demo', 'Home Gym (Demo)', 70000, 'Cross trainer'],
  ].map(([id, name, company, budget, interest]) => [
    `demo-customer-${id}`,
    name,
    company,
    `000-000-000${id}`,
    `demo${id}@example.test`,
    budget,
    interest,
    'Fictional customer for development.',
    at(-5),
    at(0),
  ]),
);
sql += rows(
  'leads',
  [
    'id',
    'customer_id',
    'title',
    'status',
    'estimated_value',
    'last_contact_at',
    'next_follow_up_at',
    'notes',
    'created_at',
    'updated_at',
  ],
  [
    ['1', '1', 'Cardio corner for new studio', 'QUOTED', 72000, -1],
    ['2', '2', 'Strength floor expansion', 'INTERESTED', 68000, 0],
    ['3', '3', 'Home cardio setup', 'WON', 68000, null],
    ['4', '1', 'Second treadmill enquiry', 'NEW', 95000, 2],
  ].map(([id, customer, title, status, value, due]) => [
    `demo-lead-${id}`,
    `demo-customer-${customer}`,
    title,
    status,
    value,
    at(-2),
    due === null ? null : at(due),
    'Confirm inspection time and send condition photos.',
    at(-4),
    at(0),
  ]),
);
sql += rows(
  'lead_products',
  ['lead_id', 'product_id'],
  [
    ['1', 'cybex'],
    ['1', 'techno'],
    ['2', 'matrix'],
    ['2', 'hammer'],
    ['3', 'precor'],
    ['4', 'life'],
  ].map(([l, p]) => [`demo-lead-${l}`, `demo-${p}`]),
);
sql += `INSERT OR IGNORE INTO reservations(id,product_id,customer_id,lead_id,reserved_at,expires_at,notes) SELECT 'demo-reservation','demo-cybex','demo-customer-1','demo-lead-1',${quote(at(0))},${quote(at(3))},'Demo hold pending inspection' WHERE NOT EXISTS(SELECT 1 FROM reservations WHERE product_id='demo-cybex') AND EXISTS(SELECT 1 FROM products WHERE id='demo-cybex' AND status='AVAILABLE');\n`;
sql += rows(
  'activities',
  [
    'id',
    'entity_type',
    'entity_id',
    'action',
    'description',
    'user_email',
    'created_at',
  ],
  [
    [
      'demo-activity',
      'product',
      'demo-life',
      'created',
      'Demo equipment added',
      'demo@example.test',
      at(0),
    ],
  ],
);
writeFileSync(new URL('../drizzle/seed.sql', import.meta.url), sql);
