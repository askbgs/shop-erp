import { imeiError, luhnValid, normalizeImei } from '../src/common/imei';

describe('IMEI validation', () => {
  it('accepts a valid IMEI', () => {
    expect(luhnValid('490154203237518')).toBe(true);
    expect(imeiError('49-015420-323751-8')).toBeNull();
  });
  it('rejects a wrong check digit', () => {
    expect(imeiError('490154203237519')).toMatch(/check-digit/);
  });
  it('rejects the wrong length', () => {
    expect(imeiError('12345')).toMatch(/15 digits/);
  });
  it('strips spaces and dashes', () => {
    expect(normalizeImei('35 209900 176148 1')).toBe('352099001761481');
  });
});
