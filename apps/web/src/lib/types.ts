export interface Variant {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  priceCents: number;
  costCents?: number;
  minPriceCents: number | null;
  reorderLevel: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  model: string | null;
  trackingType: 'SERIAL' | 'QUANTITY' | 'SERVICE';
  hasDualImei: boolean;
  warrantyDays: number | null;
  isActive: boolean;
  brand: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  variants: Variant[];
}

export interface StockUnit {
  id: string;
  variantId: string;
  branchId: string;
  imei1: string | null;
  imei2: string | null;
  serial: string | null;
  condition: string;
  status: string;
  costCents?: number;
  priceCents: number | null;
  receivedAt: string;
  variant: Variant & { product: Product };
}

export type Lookup =
  | { match: 'UNIT'; unit: StockUnit; sellable: boolean; priceCents: number }
  | { match: 'VARIANT'; variant: Variant & { product: Product; balances?: { qtyOnHand: number }[] }; priceCents: number }
  | { match: 'NONE' };

export interface Customer {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  nic: string | null;
  district: string | null;
  type: string;
  loyaltyPoints: number;
  creditLimitCents: number;
  preferredLang: string;
  notes: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  number: string;
  method: string;
  amountCents: number;
  reference: string | null;
  status: string;
  createdAt: string;
}

export interface InvoiceLine {
  id: string;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  lineTotalCents: number;
  stockUnitId: string | null;
  warrantyDays: number | null;
  warrantyEndsAt: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  branchId: string;
  status: 'COMPLETED' | 'VOIDED';
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  changeCents: number;
  pointsEarned: number;
  issuedAt: string;
  voidReason: string | null;
  customer: Pick<Customer, 'id' | 'name' | 'phone'> | null;
  lines?: InvoiceLine[];
  payments?: Payment[];
  duplicate?: boolean;
}

export type RepairStatus =
  | 'RECEIVED' | 'DIAGNOSING' | 'WAITING_APPROVAL' | 'WAITING_PARTS' | 'IN_REPAIR' | 'QUALITY_CHECK' | 'READY'
  | 'REJECTED' | 'NOT_REPAIRABLE' | 'DELIVERED' | 'CANCELLED';

export interface RepairJob {
  id: string;
  number: string;
  trackCode: string;
  branchId: string;
  deviceBrand: string | null;
  deviceModel: string;
  imei: string | null;
  serial: string | null;
  color: string | null;
  reportedFault: string;
  accessories: string[];
  conditionNotes: string | null;
  powersOn: boolean | null;
  status: RepairStatus;
  technicianId: string | null;
  diagnosis: string | null;
  estimateCents: number | null;
  approvedAt: string | null;
  labourCents: number;
  partsCents: number;
  totalCents: number;
  paidCents: number;
  promisedAt: string | null;
  warrantyDays: number | null;
  warrantyEndsAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  customer: Pick<Customer, 'id' | 'name' | 'phone'>;
  history?: { id: string; fromStatus: RepairStatus | null; toStatus: RepairStatus; note: string | null; createdAt: string }[];
  parts?: { id: string; description: string; qty: number; unitPriceCents: number }[];
  photos?: { id: string; caption: string | null; url: string | null; stage: string }[];
  payments?: Payment[];
  hasPasscode?: boolean;
  balanceCents?: number;
}

export const REPAIR_LABEL: Record<RepairStatus, string> = {
  RECEIVED: 'Received',
  DIAGNOSING: 'Diagnosing',
  WAITING_APPROVAL: 'Waiting for approval',
  WAITING_PARTS: 'Waiting for parts',
  IN_REPAIR: 'In repair',
  QUALITY_CHECK: 'Quality check',
  READY: 'Ready for pickup',
  REJECTED: 'Estimate declined',
  NOT_REPAIRABLE: 'Not repairable',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export function repairTone(s: RepairStatus): 'neutral' | 'good' | 'wait' | 'bad' | 'info' {
  if (s === 'READY') return 'good';
  if (s === 'WAITING_APPROVAL' || s === 'WAITING_PARTS') return 'wait';
  if (s === 'REJECTED' || s === 'NOT_REPAIRABLE' || s === 'CANCELLED') return 'bad';
  if (s === 'DELIVERED') return 'neutral';
  return 'info';
}

export const TRACKING_LABEL = { SERIAL: 'IMEI / serial', QUANTITY: 'Counted', SERVICE: 'Service' } as const;
