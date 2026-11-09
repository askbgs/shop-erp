/** Luhn check used by IMEI numbers (15 digits, last digit is the check digit). */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function normalizeImei(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

/** Returns an error message, or null when the IMEI is valid. */
export function imeiError(raw: string): string | null {
  const imei = normalizeImei(raw);
  if (!/^\d{15}$/.test(imei)) return `IMEI ${raw} must be exactly 15 digits`;
  if (!luhnValid(imei)) return `IMEI ${raw} fails the check-digit test`;
  return null;
}
