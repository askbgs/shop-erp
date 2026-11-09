'use client';

import { api, ApiError } from './api';

/**
 * Sales that could not reach the server are kept in the browser and re-sent later.
 * Each sale carries a clientRef, and the API returns the original invoice for a repeated
 * clientRef, so a retry can never create a second invoice.
 */
const KEY = 'shop-erp.pos-queue';

export interface QueuedSale {
  clientRef: string;
  payload: Record<string, unknown>;
  queuedAt: string;
  lastError?: string;
}

function read(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function write(q: QueuedSale[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full or blocked */
  }
}

export const offlineQueue = {
  list: read,
  add(sale: QueuedSale) {
    write([...read().filter((s) => s.clientRef !== sale.clientRef), sale]);
  },
  /** Re-send queued sales. Network failures keep the sale queued; a business error (e.g. unit already sold) is kept with its message for staff to review. */
  async flush(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const remaining: QueuedSale[] = [];
    for (const s of read()) {
      try {
        await api.post('/sales/invoices', s.payload);
        sent++;
      } catch (e) {
        failed++;
        const err = e as ApiError;
        remaining.push({ ...s, lastError: err.status && err.status < 500 ? err.message : undefined });
      }
    }
    write(remaining);
    return { sent, failed };
  },
  discard(clientRef: string) {
    write(read().filter((s) => s.clientRef !== clientRef));
  },
};
