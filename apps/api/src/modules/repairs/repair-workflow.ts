import { RepairStatus } from '../../generated/prisma/client';

/**
 * Allowed repair job status changes. DELIVERED is reached only through the deliver
 * endpoint (it settles payment and starts the repair warranty), never by a plain status change.
 */
export const REPAIR_TRANSITIONS: Record<RepairStatus, RepairStatus[]> = {
  RECEIVED: ['DIAGNOSING', 'CANCELLED'],
  DIAGNOSING: ['WAITING_APPROVAL', 'IN_REPAIR', 'NOT_REPAIRABLE', 'CANCELLED'],
  WAITING_APPROVAL: ['IN_REPAIR', 'WAITING_PARTS', 'REJECTED'],
  WAITING_PARTS: ['IN_REPAIR', 'CANCELLED'],
  IN_REPAIR: ['QUALITY_CHECK', 'WAITING_PARTS', 'NOT_REPAIRABLE'],
  QUALITY_CHECK: ['READY', 'IN_REPAIR'],
  READY: ['IN_REPAIR'],
  REJECTED: [],
  NOT_REPAIRABLE: [],
  DELIVERED: [],
  CANCELLED: [],
};

/** Statuses from which the device can be handed back to the customer. */
export const DELIVERABLE: RepairStatus[] = ['READY', 'REJECTED', 'NOT_REPAIRABLE'];

/** Statuses in which parts, labour and details can still change. */
export const OPEN_STATUSES: RepairStatus[] = ['RECEIVED', 'DIAGNOSING', 'WAITING_APPROVAL', 'WAITING_PARTS', 'IN_REPAIR', 'QUALITY_CHECK', 'READY'];

export function canTransition(from: RepairStatus, to: RepairStatus): boolean {
  return REPAIR_TRANSITIONS[from].includes(to);
}

export const STATUS_LABEL: Record<RepairStatus, string> = {
  RECEIVED: 'Received',
  DIAGNOSING: 'Diagnosing',
  WAITING_APPROVAL: 'Waiting for your approval',
  WAITING_PARTS: 'Waiting for parts',
  IN_REPAIR: 'In repair',
  QUALITY_CHECK: 'Quality check',
  READY: 'Ready for pickup',
  REJECTED: 'Estimate declined — ready to collect',
  NOT_REPAIRABLE: 'Not repairable — ready to collect',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};
