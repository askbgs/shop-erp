/**
 * Default message templates created for each new tenant. Merge fields use {{name}}.
 * Shops can edit these, and add Tamil (ta) and Sinhala (si) versions per event.
 */
export const NOTIFICATION_EVENTS = {
  INVOICE_ISSUED: 'INVOICE_ISSUED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  JOB_RECEIVED: 'JOB_RECEIVED',
  JOB_ESTIMATE: 'JOB_ESTIMATE',
  JOB_STATUS: 'JOB_STATUS',
  JOB_READY: 'JOB_READY',
  JOB_DELIVERED: 'JOB_DELIVERED',
} as const;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export const DEFAULT_TEMPLATES: { event: NotificationEvent; channel: 'SMS' | 'WHATSAPP'; language: string; body: string }[] = [
  { event: 'INVOICE_ISSUED', channel: 'WHATSAPP', language: 'en', body: 'Thank you for shopping at {{shop}}! Invoice {{number}} for {{total}}. Warranty details are on your invoice.' },
  { event: 'PAYMENT_RECEIVED', channel: 'SMS', language: 'en', body: '{{shop}}: payment of {{amount}} received. Ref {{number}}. Thank you.' },
  { event: 'JOB_RECEIVED', channel: 'SMS', language: 'en', body: '{{shop}}: your {{device}} is received. Job {{number}}. Track: {{trackUrl}}' },
  { event: 'JOB_ESTIMATE', channel: 'WHATSAPP', language: 'en', body: '{{shop}}: estimate for job {{number}} ({{device}}) is {{estimate}}. Diagnosis: {{diagnosis}}. Reply YES to approve.' },
  { event: 'JOB_STATUS', channel: 'SMS', language: 'en', body: '{{shop}}: job {{number}} is now {{status}}.' },
  { event: 'JOB_READY', channel: 'SMS', language: 'en', body: '{{shop}}: your {{device}} (job {{number}}) is ready for pickup. Amount due: {{balance}}.' },
  { event: 'JOB_DELIVERED', channel: 'SMS', language: 'en', body: '{{shop}}: job {{number}} delivered. Repair warranty until {{warrantyUntil}}. Thank you!' },
  { event: 'JOB_RECEIVED', channel: 'SMS', language: 'ta', body: '{{shop}}: உங்கள் {{device}} பெறப்பட்டது. வேலை எண் {{number}}. நிலை அறிய: {{trackUrl}}' },
  { event: 'JOB_READY', channel: 'SMS', language: 'ta', body: '{{shop}}: உங்கள் {{device}} (வேலை {{number}}) தயாராக உள்ளது. செலுத்த வேண்டிய தொகை: {{balance}}.' },
];

export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
