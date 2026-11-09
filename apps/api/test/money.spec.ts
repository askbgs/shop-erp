import { allocate, computeInvoiceTotals, formatLkr } from '../src/common/money';

describe('invoice totals', () => {
  it('extracts VAT from VAT-inclusive prices', () => {
    const t = computeInvoiceTotals([{ qty: 1, unitPriceCents: 118_00, discountCents: 0 }], 0, 1800, true);
    expect(t.totalCents).toBe(118_00);
    expect(t.taxCents).toBe(18_00);
  });

  it('adds VAT to VAT-exclusive prices', () => {
    const t = computeInvoiceTotals([{ qty: 2, unitPriceCents: 100_00, discountCents: 0 }], 0, 1800, false);
    expect(t.taxCents).toBe(36_00);
    expect(t.totalCents).toBe(236_00);
  });

  it('spreads a bill discount across lines and the cents always add up', () => {
    const t = computeInvoiceTotals(
      [
        { qty: 1, unitPriceCents: 185_000_00, discountCents: 0 },
        { qty: 3, unitPriceCents: 1_499_99, discountCents: 100 },
      ],
      1_001,
      1800,
      true,
    );
    const lineDiscounts = t.lines.reduce((a, l) => a + l.discountCents, 0);
    expect(lineDiscounts).toBe(1_001 + 100);
    expect(t.totalCents).toBe(185_000_00 + 3 * 1_499_99 - 1_101);
    expect(t.taxCents).toBe(t.lines.reduce((a, l) => a + l.taxCents, 0));
  });

  it('rejects discounts larger than the value', () => {
    expect(() => computeInvoiceTotals([{ qty: 1, unitPriceCents: 100, discountCents: 101 }], 0, 0, true)).toThrow();
    expect(() => computeInvoiceTotals([{ qty: 1, unitPriceCents: 100, discountCents: 0 }], 101, 0, true)).toThrow();
  });

  it('allocate keeps the exact total', () => {
    expect(allocate(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });

  it('formats rupees', () => {
    expect(formatLkr(18_867_797)).toBe('Rs. 188,677.97');
    expect(formatLkr(-5_00)).toBe('-Rs. 5.00');
  });
});
