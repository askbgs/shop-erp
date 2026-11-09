/**
 * Invoice totals. All amounts are integer cents. Prices may be VAT-inclusive
 * (common in Sri Lankan retail) or VAT-exclusive, per tenant setting.
 */
export interface LineInput {
  qty: number;
  unitPriceCents: number;
  discountCents: number; // line discount
}

export interface LineTotals {
  grossCents: number; // qty * unit price
  discountCents: number; // line discount + allocated share of bill discount
  netCents: number; // gross - discount (the amount the customer pays for the line, before VAT if exclusive)
  taxCents: number;
  lineTotalCents: number; // amount payable for the line including VAT
}

export interface InvoiceTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** Spread an amount across weights proportionally; the remainder goes to the largest weight. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor((amount * w) / total));
  const remainder = amount - shares.reduce((a, b) => a + b, 0);
  const biggest = weights.indexOf(Math.max(...weights));
  shares[biggest] += remainder;
  return shares;
}

export function computeInvoiceTotals(
  lines: LineInput[],
  billDiscountCents: number,
  vatRateBp: number,
  pricesIncludeVat: boolean,
): InvoiceTotals {
  const gross = lines.map((l) => l.qty * l.unitPriceCents);
  lines.forEach((l, i) => {
    if (l.discountCents < 0 || l.discountCents > gross[i]) throw new Error(`Line ${i + 1}: discount must be between 0 and the line value`);
  });
  const afterLine = lines.map((l, i) => gross[i] - l.discountCents);
  const afterLineTotal = afterLine.reduce((a, b) => a + b, 0);
  if (billDiscountCents < 0 || billDiscountCents > afterLineTotal) throw new Error('Bill discount must be between 0 and the bill value');

  const billShare = allocate(billDiscountCents, afterLine);

  const out: LineTotals[] = lines.map((l, i) => {
    const discount = l.discountCents + billShare[i];
    const net = gross[i] - discount;
    let tax: number;
    let lineTotal: number;
    if (pricesIncludeVat) {
      tax = Math.round((net * vatRateBp) / (10000 + vatRateBp));
      lineTotal = net;
    } else {
      tax = Math.round((net * vatRateBp) / 10000);
      lineTotal = net + tax;
    }
    return { grossCents: gross[i], discountCents: discount, netCents: net, taxCents: tax, lineTotalCents: lineTotal };
  });

  return {
    lines: out,
    subtotalCents: gross.reduce((a, b) => a + b, 0),
    discountCents: out.reduce((a, l) => a + l.discountCents, 0),
    taxCents: out.reduce((a, l) => a + l.taxCents, 0),
    totalCents: out.reduce((a, l) => a + l.lineTotalCents, 0),
  };
}

export function formatLkr(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}Rs. ${Math.floor(abs / 100).toLocaleString('en-LK')}.${String(abs % 100).padStart(2, '0')}`;
}
