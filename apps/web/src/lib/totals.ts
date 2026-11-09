/** Same rules as the API (apps/api/src/common/money.ts) so the POS preview matches the invoice. */
export interface LineIn {
  qty: number;
  unitPriceCents: number;
  discountCents: number;
}

function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((amount * w) / total));
  shares[weights.indexOf(Math.max(...weights))] += amount - shares.reduce((a, b) => a + b, 0);
  return shares;
}

export function previewTotals(lines: LineIn[], billDiscountCents: number, vatRateBp: number, pricesIncludeVat: boolean) {
  const gross = lines.map((l) => l.qty * l.unitPriceCents);
  const afterLine = lines.map((l, i) => Math.max(gross[i] - l.discountCents, 0));
  const bill = Math.min(Math.max(billDiscountCents, 0), afterLine.reduce((a, b) => a + b, 0));
  const share = allocate(bill, afterLine);
  let tax = 0;
  let total = 0;
  afterLine.forEach((net0, i) => {
    const net = net0 - share[i];
    const t = pricesIncludeVat ? Math.round((net * vatRateBp) / (10000 + vatRateBp)) : Math.round((net * vatRateBp) / 10000);
    tax += t;
    total += pricesIncludeVat ? net : net + t;
  });
  const subtotal = gross.reduce((a, b) => a + b, 0);
  return { subtotal, discount: subtotal - afterLine.reduce((a, b) => a + b, 0) + bill, tax, total };
}
