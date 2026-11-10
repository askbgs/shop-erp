// End-to-end smoke test for Phase 1. Runs against a live API with a real database.
//   API_URL=http://localhost:3000 ADMIN_API_KEY=... node scripts/smoke.mjs
// It registers fresh shops each run, so it is safe to repeat. It also leaves a
// working demo shop behind (login printed at the end).

const API = (process.env.API_URL ?? 'http://localhost:3000') + '/api/v1';
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'local-admin-key-for-testing-123';
const run = Date.now().toString(36);

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
}

async function call(method, path, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  if (!raw) { try { data = JSON.parse(text); } catch { /* keep text */ } }
  return { status: res.status, data };
}

// 1x1 PNG and JPEG test images
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function upload(path, token, bytes, name, type) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(API + path, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, data };
}

async function getBytes(url, token) {
  const res = await fetch(API.replace('/api/v1', '') + url, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Builds a valid 15-digit IMEI from a 14-digit body (Luhn check digit). */
function imei(body14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body14[13 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return body14 + ((10 - (sum % 10)) % 10);
}
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const phone = () => '+9477' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Smoke test against ${API}\n`);

  // ── 1. Sign-up & auth ──
  console.log('Platform');
  const ownerEmail = `owner-${run}@demo.lk`;
  const ownerPass = 'Owner@12345';
  let r = await call('POST', '/auth/register', {
    body: { shopName: `Trinco Mobile ${run}`, businessType: 'MIXED', ownerName: 'Shop Owner', email: ownerEmail, phone: phone(), password: ownerPass, branchName: 'Trincomalee Main', branchCode: 'TRI', district: 'Trincomalee' },
  });
  check('register new shop', r.status === 201 && r.data.accessToken, r.data);
  let owner = r.data.accessToken;
  const ownerRefresh = r.data.refreshToken;

  r = await call('POST', '/auth/register', { body: { shopName: 'x', businessType: 'PHONE', ownerName: 'x', email: ownerEmail, phone: '0771234567', password: 'short', branchName: 'x', branchCode: 'tri' } });
  check('register validates input', r.status === 400, r.data);

  r = await call('GET', '/auth/me', { token: owner });
  check('me returns owner with all permissions', r.status === 200 && r.data.role.name === 'Owner' && r.data.permissions.includes('sales.void'), r.data);
  const branchId = r.data.branches[0].id;

  r = await call('POST', '/auth/refresh', { body: { refreshToken: ownerRefresh } });
  check('refresh rotates tokens', r.status === 200 && r.data.refreshToken !== ownerRefresh, r.data);
  owner = r.data.accessToken;
  const rotated = r.data.refreshToken;
  r = await call('POST', '/auth/refresh', { body: { refreshToken: ownerRefresh } });
  check('reused refresh token is rejected', r.status === 401, r.data);
  r = await call('POST', '/auth/refresh', { body: { refreshToken: rotated } });
  check('reuse detection signs out every session', r.status === 401, r.data);
  r = await call('POST', '/auth/login', { body: { email: ownerEmail, password: ownerPass } });
  owner = r.data.accessToken;
  check('login', r.status === 200 && owner, r.data);
  r = await call('POST', '/auth/login', { body: { email: ownerEmail, password: 'wrong-password' } });
  check('wrong password rejected', r.status === 401);
  r = await call('GET', '/branches');
  check('protected routes need a token', r.status === 401);

  r = await call('GET', '/roles', { token: owner });
  const roles = Object.fromEntries(r.data.map((x) => [x.name, x.id]));
  check('default roles created', ['Owner', 'Branch Manager', 'Cashier', 'Technician', 'Storekeeper', 'Accountant'].every((n) => roles[n]), Object.keys(roles));

  const cashierEmail = `cashier-${run}@demo.lk`;
  r = await call('POST', '/users', { token: owner, body: { name: 'Kumar Cashier', email: cashierEmail, password: 'Cashier@123', roleId: roles.Cashier, branchIds: [branchId], pin: '4321' } });
  check('create cashier with PIN', r.status === 201, r.data);
  const cashierId = r.data.id;
  r = await call('POST', '/users', { token: owner, body: { name: 'Ravi Tech', email: `tech-${run}@demo.lk`, password: 'Tech@12345', roleId: roles.Technician, branchIds: [branchId], isTechnician: true } });
  check('create technician', r.status === 201, r.data);
  const techId = r.data.id;
  const cashier = (await call('POST', '/auth/login', { body: { email: cashierEmail, password: 'Cashier@123' } })).data.accessToken;
  const tech = (await call('POST', '/auth/login', { body: { email: `tech-${run}@demo.lk`, password: 'Tech@12345' } })).data.accessToken;
  r = await call('POST', '/auth/pin-switch', { token: owner, body: { userId: cashierId, pin: '4321' } });
  check('PIN quick-switch to cashier', r.status === 200 && r.data.accessToken, r.data);
  r = await call('POST', '/auth/pin-switch', { token: owner, body: { userId: cashierId, pin: '0000' } });
  check('wrong PIN rejected', r.status === 401);
  r = await call('POST', '/users', { token: cashier, body: { name: 'x', email: `x-${run}@demo.lk`, password: 'xxxxxxxx', roleId: roles.Cashier, branchIds: [branchId] } });
  check('cashier cannot create users (permission)', r.status === 403, r.data);

  r = await call('PATCH', '/tenant/settings', { token: owner, body: { vatRateBp: 1800, pricesIncludeVat: true } });
  check('update tenant settings', r.status === 200 && r.data.vatRateBp === 1800, r.data);

  // ── 2. Catalog & stock ──
  console.log('\nCatalog & serialized stock');
  const cat = (await call('POST', '/catalog/categories', { token: owner, body: { name: 'Phones' } })).data;
  const brand = (await call('POST', '/catalog/brands', { token: owner, body: { name: 'Apple' } })).data;
  r = await call('POST', '/catalog/products', {
    token: owner,
    body: { name: 'iPhone 13', model: 'A2633', categoryId: cat.id, brandId: brand.id, trackingType: 'SERIAL', hasDualImei: true, warrantyDays: 365,
      variants: [{ sku: `IP13-128-BLK-${run}`, name: '128GB Midnight', priceCents: 185_000_00, minPriceCents: 175_000_00, attributes: { storage: '128GB', color: 'Midnight' } }] },
  });
  check('create serial product (iPhone 13)', r.status === 201, r.data);
  const iphone = r.data.variants[0];
  const iphoneProductId = r.data.id;
  const glass = (await call('POST', '/catalog/products', { token: owner, body: { name: 'Tempered glass', trackingType: 'QUANTITY', variants: [{ sku: `TG-IP13-${run}`, barcode: `479${rnd()}0001`, name: 'iPhone 13', priceCents: 1_500_00, reorderLevel: 10 }] } })).data.variants[0];
  const screen = (await call('POST', '/catalog/products', { token: owner, body: { name: 'iPhone 13 screen (OLED)', trackingType: 'QUANTITY', variants: [{ sku: `SCR-IP13-${run}`, name: 'Spare part', priceCents: 28_000_00, reorderLevel: 2 }] } })).data.variants[0];
  const service = (await call('POST', '/catalog/products', { token: owner, body: { name: 'Data transfer service', trackingType: 'SERVICE', variants: [{ sku: `SVC-DT-${run}`, name: 'Standard', priceCents: 1_000_00 }] } })).data.variants[0];
  check('create quantity, part and service products', glass && screen && service);

  const imeiA = imei(`35${rnd()}${rnd()}`);
  const imeiA2 = imei(`35${rnd()}${rnd()}`);
  const imeiB = imei(`35${rnd()}${rnd()}`);
  const imeiB2 = imei(`35${rnd()}${rnd()}`);
  r = await call('POST', '/stock/receipts', { token: owner, body: { branchId, supplierName: 'Bad Supplier', lines: [{ variantId: iphone.id, qty: 1, unitCostCents: 160_000_00, units: [{ imei1: '123456789012345', imei2: imeiA2 }] }] } });
  check('invalid IMEI (check digit) rejected', r.status === 400, r.data);
  r = await call('POST', '/stock/receipts', { token: owner, body: { branchId, lines: [{ variantId: iphone.id, qty: 2, unitCostCents: 160_000_00, units: [{ imei1: imeiA, imei2: imeiA2 }] }] } });
  check('unit count must match qty', r.status === 400, r.data);
  r = await call('POST', '/stock/receipts', {
    token: owner,
    body: { branchId, supplierName: 'Colombo Distributor', reference: 'DN-7781', lines: [
      { variantId: iphone.id, qty: 2, unitCostCents: 160_000_00, units: [{ imei1: imeiA, imei2: imeiA2 }, { imei1: imeiB, imei2: imeiB2 }] },
      { variantId: glass.id, qty: 50, unitCostCents: 300_00 },
      { variantId: screen.id, qty: 5, unitCostCents: 20_000_00 },
    ] },
  });
  check('goods receipt with IMEIs', r.status === 201 && r.data.unitsCreated === 2 && r.data.number === 'TRI-GRN-000001', r.data);
  r = await call('POST', '/stock/receipts', { token: owner, body: { branchId, lines: [{ variantId: iphone.id, qty: 1, unitCostCents: 1, units: [{ imei1: imeiB2, imei2: imei(`35${rnd()}${rnd()}`) }] }] } });
  check('duplicate IMEI (even as 2nd IMEI) rejected', r.status === 409, r.data);

  r = await call('GET', `/catalog/lookup?code=${imeiA2}&branchId=${branchId}`, { token: cashier });
  check('POS lookup by second IMEI finds the unit', r.data.match === 'UNIT' && r.data.sellable === true && r.data.unit.costCents === undefined, r.data);
  r = await call('GET', `/catalog/lookup?code=${glass.barcode}`, { token: cashier });
  check('POS lookup by barcode finds the variant', r.data.match === 'VARIANT' && r.data.variant.id === glass.id, r.data);
  r = await call('GET', `/stock/balances?branchId=${branchId}`, { token: owner });
  const bal = (id) => r.data.items.find((b) => b.variantId === id);
  check('balances: 2 phones, 50 glass, 5 screens', bal(iphone.id)?.qtyOnHand === 2 && bal(glass.id)?.qtyOnHand === 50 && bal(screen.id)?.qtyOnHand === 5, r.data.items?.map((b) => [b.variant.sku, b.qtyOnHand]));

  // ── 2b. Product images ──
  console.log('\nProduct images');
  r = await upload(`/catalog/products/${iphoneProductId}/images`, owner, PNG, 'front.png', 'image/png');
  check('upload a PNG photo', r.status === 201 && r.data.url?.startsWith('/api/v1/files/'), r.data);
  const img1 = r.data;
  let f = await getBytes(img1.url, cashier);
  check('photo is served back byte for byte to shop staff', f.status === 200 && f.type === 'image/png' && f.bytes.equals(PNG), { status: f.status, type: f.type, len: f.bytes.length });
  r = await upload(`/catalog/products/${iphoneProductId}/images`, owner, JPG, 'back.jpg', 'image/jpeg');
  const img2 = r.data;
  check('upload a JPEG photo', r.status === 201, r.data);
  r = await upload(`/catalog/products/${iphoneProductId}/images`, owner, Buffer.from('<?php echo 1; ?>'), 'evil.png', 'image/png');
  check('a non-image disguised as PNG is rejected', r.status === 400, r.data);
  r = await upload(`/catalog/products/${iphoneProductId}/images`, cashier, PNG, 'x.png', 'image/png');
  check('cashier cannot add product photos', r.status === 403, r.data);
  r = await call('GET', `/catalog/products/${iphoneProductId}`, { token: cashier });
  check('product lists its photos, first upload is the cover', r.data.images?.length === 2 && r.data.images[0].id === img1.id, r.data.images);
  r = await call('POST', `/catalog/products/${iphoneProductId}/images/${img2.id}/cover`, { token: owner });
  r = await call('GET', `/catalog/products?q=iPhone`, { token: cashier });
  check('set another photo as cover', r.data.items[0].images[0].id === img2.id, r.data.items[0].images);
  for (let n = 0; n < 2; n++) await upload(`/catalog/products/${iphoneProductId}/images`, owner, PNG, `p${n}.png`, 'image/png');
  r = await upload(`/catalog/products/${iphoneProductId}/images`, owner, PNG, 'p5.png', 'image/png');
  check('limit of 4 photos per product', r.status === 400, r.data);
  r = await call('GET', `/catalog/lookup?code=${imeiA}&branchId=${branchId}`, { token: cashier });
  check('POS scan returns the cover photo', r.data.imageUrl === `/api/v1/files/${(await call('GET', `/catalog/products/${iphoneProductId}`, { token: owner })).data.images[0].url.split('/').pop()}`, r.data.imageUrl);
  r = await call('DELETE', `/catalog/products/${iphoneProductId}/images/${img1.id}`, { token: owner });
  f = await getBytes(img1.url, owner);
  check('deleting a photo removes the file', r.status === 204 && f.status === 404, { del: r.status, get: f.status });

  // ── 3. Sales ──
  console.log('\nPOS & sales');
  const custPhone = phone();
  const sale1 = {
    branchId,
    customer: { name: 'Nimal Perera', phone: custPhone },
    lines: [{ imei: imeiA, qty: 1 }, { variantId: glass.id, qty: 2 }],
    payments: [{ method: 'CARD', amountCents: 100_000_00, reference: 'APP123' }, { method: 'CASH', amountCents: 90_000_00 }],
    clientRef: `pos-${run}-0001`,
  };
  r = await call('POST', '/sales/invoices', { token: cashier, body: sale1 });
  const inv1 = r.data;
  // 185,000 + 2 × 1,500 = 188,000 incl. 18% VAT → VAT = 188,000 × 18/118 = 28,677.97
  check('sale: phone by IMEI + accessories, split payment', r.status === 201 && inv1.number === 'TRI-INV-000001', r.data);
  check('totals: Rs 188,000 incl. VAT 28,677.97', inv1.totalCents === 188_000_00 && inv1.taxCents === 28_677_97, { total: inv1.totalCents, tax: inv1.taxCents });
  check('cash over-tender gives Rs 2,000 change', inv1.changeCents === 2_000_00 && inv1.paidCents === 188_000_00 && inv1.balanceCents === 0, inv1);
  check('warranty 365 days on the phone line', inv1.lines?.find((l) => l.stockUnitId)?.warrantyDays === 365, inv1.lines);
  check('loyalty points earned (1 per Rs 100)', inv1.pointsEarned === 1880, inv1.pointsEarned);
  r = await call('POST', '/sales/invoices', { token: cashier, body: sale1 });
  check('same clientRef returns the same invoice (offline sync idempotency)', r.data.id === inv1.id && r.data.duplicate === true, r.data);
  r = await call('POST', '/sales/invoices', { token: cashier, body: { ...sale1, clientRef: undefined, lines: [{ imei: imeiA, qty: 1 }] } });
  check('a sold IMEI cannot be sold again', r.status === 400, r.data);
  r = await call('GET', `/stock/units?q=${imeiA}`, { token: owner });
  const unitA = r.data.items[0];
  check('unit status is SOLD', unitA?.status === 'SOLD', unitA);
  r = await call('GET', `/stock/units/${unitA.id}`, { token: owner });
  check('unit history: receipt + sale + active warranty', r.data.movements.length === 2 && r.data.warranty?.active === true, r.data);

  r = await call('POST', '/sales/invoices', { token: cashier, body: { branchId, lines: [{ imei: imeiB, qty: 1, discountCents: 18_500_00 }], payments: [{ method: 'CASH', amountCents: 166_500_00 }] } });
  check('cashier discount above 5% limit is blocked', r.status === 403, r.data);
  r = await call('POST', '/sales/invoices', { token: owner, body: { branchId, lines: [{ imei: imeiB, qty: 1, unitPriceCents: 170_000_00 }], payments: [{ method: 'CASH', amountCents: 170_000_00 }] } });
  check('owner can sell below minimum price (override)', r.status === 201, r.data);
  const inv2 = r.data;
  r = await call('POST', '/sales/invoices', { token: cashier, body: { branchId, lines: [{ variantId: glass.id, qty: 1 }], payments: [] } });
  check('credit sale without customer is blocked', r.status === 400, r.data);
  r = await call('POST', '/sales/invoices', { token: owner, body: { branchId, customer: { name: 'Nimal Perera', phone: custPhone }, lines: [{ variantId: glass.id, qty: 4 }, { variantId: service.id, qty: 1 }], payments: [{ method: 'CASH', amountCents: 3_000_00 }] } });
  check('credit sale with customer leaves a balance', r.status === 201 && r.data.balanceCents === 4_000_00, r.data);
  const inv3 = r.data;
  r = await call('POST', '/payments', { token: cashier, body: { invoiceId: inv3.id, method: 'BANK_TRANSFER', amountCents: 5_000_00 } });
  check('cannot over-collect a balance', r.status === 400, r.data);
  r = await call('POST', '/payments', { token: cashier, body: { invoiceId: inv3.id, method: 'LANKAQR', amountCents: 4_000_00 } });
  check('collect the balance later', r.status === 201, r.data);
  r = await call('GET', `/sales/invoices/${inv3.id}`, { token: owner });
  check('invoice balance now zero', r.data.balanceCents === 0 && r.data.paidCents === 7_000_00, r.data);

  r = await call('GET', `/customers?q=${encodeURIComponent(custPhone)}`, { token: cashier });
  const customer = r.data.items[0];
  check('customer quick-added once and reused', r.data.total === 1, r.data);
  r = await call('GET', `/customers/${customer.id}`, { token: owner });
  check('customer 360: device by IMEI, 2 invoices, loyalty', r.data.devices.length === 1 && r.data.devices[0].imei === imeiA && r.data.invoices.length === 2 && r.data.loyaltyPoints > 1880, r.data);

  r = await call('POST', '/sales/invoices', { token: owner, body: { branchId, customerId: customer.id, lines: [{ variantId: glass.id, qty: 1 }], payments: [{ method: 'LOYALTY_POINTS', amountCents: 1_500_00 }] } });
  check('pay with loyalty points', r.status === 201 && r.data.paidCents === 1_500_00, r.data);

  r = await call('POST', `/sales/invoices/${inv2.id}/void`, { token: cashier, body: { reason: 'test' } });
  check('cashier cannot void', r.status === 403, r.data);
  r = await call('POST', `/sales/invoices/${inv2.id}/void`, { token: owner, body: { reason: 'Customer changed mind' } });
  check('owner voids same-day invoice', r.status === 200 && r.data.status === 'VOIDED', r.data);
  r = await call('GET', `/catalog/lookup?code=${imeiB}&branchId=${branchId}`, { token: cashier });
  check('voided phone is back in stock', r.data.sellable === true, r.data);

  r = await call('GET', `/sales/invoices/${inv1.id}/receipt`, { token: cashier, raw: true });
  check('printable receipt', r.status === 200 && r.data.includes('TRI-INV-000001') && r.data.includes('Warranty 365 days'), String(r.data).slice(0, 200));

  r = await call('POST', '/sales/held', { token: cashier, body: { branchId, label: 'Customer went to ATM', payload: { lines: [{ variantId: glass.id, qty: 3 }] } } });
  check('hold a bill', r.status === 201, r.data);
  r = await call('GET', `/sales/held?branchId=${branchId}`, { token: cashier });
  check('list held bills', r.data.length === 1, r.data);

  // ── 4. Repairs ──
  console.log('\nRepairs');
  const repairPhone = phone();
  r = await call('POST', '/repairs', {
    token: cashier,
    body: { branchId, customer: { name: 'Fathima Rizwan', phone: repairPhone }, deviceBrand: 'Apple', deviceModel: 'iPhone 13', imei: imeiA, color: 'Midnight',
      reportedFault: 'Screen cracked, touch not working', accessories: ['SIM tray', 'Back cover'], conditionNotes: 'Scratch on back', powersOn: true, passcode: '1478',
      advance: [{ method: 'CASH', amountCents: 5_000_00 }] },
  });
  check('job card intake with advance', r.status === 201 && r.data.number === 'TRI-JOB-000001' && r.data.paidCents === 5_000_00 && r.data.passcodeEnc === undefined, r.data);
  const job = r.data;
  r = await call('POST', `/repairs/${job.id}/assign`, { token: cashier, body: { technicianId: techId } });
  check('cashier cannot assign technicians', r.status === 403);
  r = await call('POST', `/repairs/${job.id}/assign`, { token: owner, body: { technicianId: techId } });
  check('owner assigns technician', r.status === 200 && r.data.technicianId === techId, r.data);
  r = await call('GET', '/repairs/my-queue', { token: tech });
  check("job is in the technician's queue", r.data.some((j) => j.id === job.id), r.data);
  r = await call('GET', `/repairs/${job.id}/passcode`, { token: tech });
  check('assigned technician sees the passcode', r.data.passcode === '1478', r.data);
  r = await call('GET', `/repairs/${job.id}/passcode`, { token: cashier });
  check('cashier cannot see the passcode', r.status === 403);
  r = await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'READY' } });
  check('invalid status jump is blocked', r.status === 400, r.data);
  await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'DIAGNOSING' } });
  r = await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'WAITING_APPROVAL' } });
  check('approval needs an estimate first', r.status === 400, r.data);
  await call('PATCH', `/repairs/${job.id}`, { token: tech, body: { diagnosis: 'Display assembly broken', estimateCents: 33_000_00, labourCents: 5_000_00 } });
  r = await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'WAITING_APPROVAL' } });
  check('estimate sent for approval', r.status === 200 && r.data.status === 'WAITING_APPROVAL', r.data);
  r = await call('GET', `/public/repairs/track?code=${job.trackCode}&phone=${encodeURIComponent(repairPhone)}`);
  check('public tracking shows estimate', r.status === 200 && r.data.estimateCents === 33_000_00 && r.data.statusLabel === 'Waiting for your approval', r.data);
  r = await call('GET', `/public/repairs/track?code=${job.trackCode}&phone=%2B94770000000`);
  check('public tracking needs the right phone', r.status === 404);
  r = await call('GET', `/public/repairs/track?code=${job.number}&phone=${encodeURIComponent(repairPhone)}`);
  check('job number alone cannot be used to track (numbers repeat across shops)', r.status === 404 || r.status === 400);
  check('tracking code is 10 unambiguous characters', /^[A-HJ-NP-Z2-9]{10}$/.test(job.trackCode), job.trackCode);
  r = await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'IN_REPAIR', note: 'Customer approved on WhatsApp' } });
  check('customer approval moves job to repair', r.data.status === 'IN_REPAIR' && r.data.approvedAt, r.data);
  r = await call('POST', `/repairs/${job.id}/parts`, { token: tech, body: { variantId: screen.id, qty: 1 } });
  check('spare part issued from stock', r.status === 201 && r.data.unitPriceCents === 28_000_00, r.data);
  r = await call('GET', `/stock/balances?branchId=${branchId}`, { token: owner });
  check('screen stock 5 → 4', r.data.items.find((b) => b.variantId === screen.id)?.qtyOnHand === 4);
  r = await call('POST', `/repairs/${job.id}/deliver`, { token: cashier, body: { payments: [] } });
  check('cannot deliver before READY', r.status === 400, r.data);
  await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'QUALITY_CHECK' } });
  r = await call('POST', `/repairs/${job.id}/status`, { token: tech, body: { status: 'READY' } });
  check('job ready for pickup', r.data.status === 'READY', r.data);
  r = await call('POST', `/repairs/${job.id}/deliver`, { token: cashier, body: { payments: [{ method: 'CASH', amountCents: 30_000_00 }] } });
  // total = 5,000 labour + 28,000 part = 33,000; advance 5,000 → due 28,000; cash 30,000 → change 2,000
  check('deliver: final bill, change, 30-day repair warranty', r.status === 200 && r.data.status === 'DELIVERED' && r.data.totalCents === 33_000_00 && r.data.changeCents === 2_000_00 && r.data.balanceCents === 0 && r.data.warrantyDays === 30, r.data);
  r = await call('POST', `/repairs/${job.id}/status`, { token: owner, body: { status: 'IN_REPAIR' } });
  check('delivered job is closed', r.status === 400);
  r = await call('GET', `/repairs/${job.id}/job-card`, { token: cashier, raw: true });
  check('printable job card', r.status === 200 && r.data.includes(job.number), String(r.data).slice(0, 120));

  r = await call('POST', '/repairs', { token: cashier, body: { branchId, customer: { name: 'Walk-in', phone: phone() }, deviceModel: 'Galaxy A54', reportedFault: 'Does not charge', advance: [{ method: 'CASH', amountCents: 2_000_00 }] } });
  const job2 = r.data;
  await call('POST', `/repairs/${job2.id}/status`, { token: owner, body: { status: 'DIAGNOSING' } });
  await call('PATCH', `/repairs/${job2.id}`, { token: owner, body: { estimateCents: 9_500_00 } });
  await call('POST', `/repairs/${job2.id}/status`, { token: owner, body: { status: 'WAITING_APPROVAL' } });
  await call('POST', `/repairs/${job2.id}/status`, { token: owner, body: { status: 'REJECTED' } });
  r = await call('POST', `/repairs/${job2.id}/deliver`, { token: owner, body: { labourCents: 500_00, payments: [] } });
  check('declined estimate: Rs 500 diagnosis fee, Rs 1,500 advance refunded', r.status === 200 && r.data.refundCents === 1_500_00 && r.data.totalCents === 500_00 && r.data.warrantyDays === null, r.data);

  // ── 5. Adjustments, audit, dashboard, notifications ──
  console.log('\nAudit, dashboard, notifications');
  r = await call('POST', '/stock/adjustments', { token: owner, body: { branchId, variantId: glass.id, qty: -2, reason: 'Cracked in display case' } });
  check('stock adjustment with reason', r.status === 201 && r.data.number === 'TRI-ADJ-000001', r.data);
  r = await call('POST', '/stock/adjustments', { token: cashier, body: { branchId, variantId: glass.id, qty: -2, reason: 'x' } });
  check('cashier cannot adjust stock', r.status === 403);
  r = await call('GET', '/audit-logs?pageSize=100', { token: owner });
  const actions = new Set(r.data.items.map((a) => a.action));
  check('audit log has void, price override, adjustment, passcode view', ['sales.void', 'price.override', 'stock.adjust', 'repair.passcode_view'].every((a) => actions.has(a)), [...actions]);
  r = await call('GET', `/stock/balances?branchId=${branchId}`, { token: owner });
  // 50 received − 2 (sale 1) − 4 (credit sale) − 1 (loyalty sale) − 2 (adjustment) = 41
  check('glass balance equals the ledger (41)', r.data.items.find((b) => b.variantId === glass.id)?.qtyOnHand === 41, r.data.items.find((b) => b.variantId === glass.id));
  r = await call('GET', `/stock/movements?variantId=${glass.id}&pageSize=100`, { token: owner });
  check('movement ledger sums to the balance', r.data.items.reduce((a, m) => a + m.qty, 0) === 41, r.data.items.map((m) => [m.type, m.qty]));

  r = await call('GET', `/reports/dashboard?branchId=${branchId}`, { token: owner });
  check('dashboard: sales, profit, repairs, receivables', r.status === 200 && r.data.sales.invoices === 3 && r.data.sales.grossProfitCents > 0 && r.data.repairs.deliveredToday === 2, r.data);
  r = await call('GET', '/reports/dashboard', { token: cashier });
  check('cashier cannot see reports', r.status === 403);

  await sleep(1500);
  r = await call('GET', '/notifications/logs?pageSize=100', { token: owner });
  const events = new Set(r.data.items.map((l) => l.event));
  check('notifications queued and sent by the worker', r.data.items.length > 0 && r.data.items.every((l) => l.status === 'SENT'), r.data.items.map((l) => [l.event, l.status]));
  check('events: invoice, job received, estimate, ready, delivered', ['INVOICE_ISSUED', 'JOB_RECEIVED', 'JOB_ESTIMATE', 'JOB_READY', 'JOB_DELIVERED'].every((e) => events.has(e)), [...events]);

  // ── 6. Tenant isolation & subscription ──
  console.log('\nTenant isolation & subscription');
  r = await call('POST', '/auth/register', { body: { shopName: `Other Shop ${run}`, businessType: 'COMPUTER', ownerName: 'Other', email: `other-${run}@demo.lk`, phone: phone(), password: 'Other@12345', branchName: 'Kandy', branchCode: 'KDY' } });
  const other = r.data.accessToken;
  r = await call('GET', `/sales/invoices/${inv1.id}`, { token: other });
  check("another shop cannot read this shop's invoice", r.status === 404, r.data);
  r = await call('GET', `/catalog/lookup?code=${imeiB}`, { token: other });
  check("another shop cannot see this shop's IMEIs", r.data.match === 'NONE', r.data);
  r = await call('POST', '/sales/invoices', { token: other, body: { branchId, lines: [{ imei: imeiB, qty: 1 }], payments: [] } });
  check("another shop cannot sell from this shop's branch", r.status === 403, r.data);
  const coverUrl = (await call('GET', `/catalog/products/${iphoneProductId}`, { token: owner })).data.images[0].url;
  f = await getBytes(coverUrl, other);
  check("another shop cannot open this shop's product photos", f.status === 404, f.status);
  r = await call('GET', `/customers/${customer.id}`, { token: other });
  check("another shop cannot read this shop's customers", r.status === 404);

  r = await call('GET', '/admin/tenants?q=Other', { headers: { 'x-admin-key': 'wrong' } });
  check('vendor console needs the admin key', r.status === 401);
  r = await call('GET', `/admin/tenants?q=${encodeURIComponent(`Other Shop ${run}`)}`, { headers: { 'x-admin-key': ADMIN_KEY } });
  const otherTenant = r.data.items?.[0];
  check('vendor console lists tenants', r.status === 200 && otherTenant, r.data);
  await call('PATCH', `/admin/tenants/${otherTenant.id}`, { headers: { 'x-admin-key': ADMIN_KEY }, body: { status: 'SUSPENDED' } });
  const suspended = (await call('POST', '/auth/login', { body: { email: `other-${run}@demo.lk`, password: 'Other@12345' } })).data.accessToken;
  r = await call('POST', '/catalog/brands', { token: suspended, body: { name: 'Dell' } });
  check('suspended shop is read-only (402)', r.status === 402, r.data);
  r = await call('GET', '/catalog/brands', { token: suspended });
  check('suspended shop can still read', r.status === 200);
  r = await call('POST', `/admin/tenants/${otherTenant.id}/invoices`, { headers: { 'x-admin-key': ADMIN_KEY } });
  r = await call('POST', `/admin/invoices/${r.data.id}/paid`, { headers: { 'x-admin-key': ADMIN_KEY }, body: { paymentRef: 'PAYHERE-123' } });
  const reactivated = (await call('POST', '/auth/login', { body: { email: `other-${run}@demo.lk`, password: 'Other@12345' } })).data.accessToken;
  r = await call('POST', '/catalog/brands', { token: reactivated, body: { name: 'Dell' } });
  check('paying the subscription invoice reactivates the shop', r.status === 201, r.data);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  console.log(`Demo shop login: ${ownerEmail} / ${ownerPass}`);
  if (failures.length) {
    console.log('Failed:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
