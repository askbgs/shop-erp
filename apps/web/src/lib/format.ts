const TZ = 'Asia/Colombo';

/** Integer cents → "Rs. 185,000.00" */
export function lkr(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  return `${sign}Rs. ${Math.floor(abs / 100).toLocaleString('en-LK')}.${String(abs % 100).padStart(2, '0')}`;
}

/** "185000" or "185,000.50" typed by a person → cents. Returns null for empty / invalid. */
export function toCents(input: string): number | null {
  const clean = input.replace(/[,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!clean) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  LANKAQR: 'LankaQR',
  CHEQUE: 'Cheque',
  LOYALTY_POINTS: 'Loyalty points',
};

export const CONDITION_LABEL: Record<string, string> = {
  NEW: 'New',
  OPEN_BOX: 'Open box',
  USED_A: 'Used A',
  USED_B: 'Used B',
  USED_C: 'Used C',
  REFURBISHED: 'Refurbished',
};

export const DISTRICTS = [
  'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara',
  'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya',
  'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya',
];

/** "0771234567" / "771234567" / "+94771234567" → "+94771234567" */
export function toLkPhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+94')) return d;
  if (d.startsWith('94')) return `+${d}`;
  if (d.startsWith('0')) return `+94${d.slice(1)}`;
  return `+94${d}`;
}

export function newClientRef(): string {
  return `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
