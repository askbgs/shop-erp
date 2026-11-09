/**
 * Every protected action has a permission code. Roles hold lists of codes.
 * The Owner role is granted every permission (and all branches).
 */
export const PERMISSIONS = {
  // platform
  TENANT_MANAGE: 'tenant.manage',
  BRANCH_MANAGE: 'branch.manage',
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  AUDIT_READ: 'audit.read',
  // catalog & stock
  CATALOG_READ: 'catalog.read',
  CATALOG_MANAGE: 'catalog.manage',
  PRICE_CHANGE: 'price.change',
  STOCK_READ: 'stock.read',
  STOCK_RECEIVE: 'stock.receive',
  STOCK_ADJUST: 'stock.adjust',
  STOCK_VIEW_COST: 'stock.view_cost',
  // sales
  SALES_CREATE: 'sales.create',
  SALES_READ: 'sales.read',
  SALES_VOID: 'sales.void',
  SALES_CREDIT: 'sales.credit',
  PRICE_OVERRIDE: 'price.override', // sell below minimum price
  DISCOUNT_OVERRIDE: 'discount.override', // exceed role discount limit
  PAYMENT_CREATE: 'payment.create',
  PAYMENT_READ: 'payment.read',
  // customers
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_MANAGE: 'customer.manage',
  LOYALTY_ADJUST: 'loyalty.adjust',
  // repairs
  REPAIR_READ: 'repair.read',
  REPAIR_CREATE: 'repair.create',
  REPAIR_UPDATE: 'repair.update',
  REPAIR_ASSIGN: 'repair.assign',
  REPAIR_DELIVER: 'repair.deliver',
  REPAIR_PASSCODE_VIEW: 'repair.passcode_view',
  // notifications & reports
  NOTIFICATION_MANAGE: 'notification.manage',
  REPORT_READ: 'report.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

const P = PERMISSIONS;

export interface RoleTemplate {
  name: string;
  allBranches: boolean;
  maxDiscountBp: number;
  maxRefundCents: number;
  permissions: Permission[];
}

/** Default roles created for every new tenant (editable afterwards). */
export const DEFAULT_ROLES: RoleTemplate[] = [
  { name: 'Owner', allBranches: true, maxDiscountBp: 10000, maxRefundCents: 1_000_000_000, permissions: ALL_PERMISSIONS },
  {
    name: 'Branch Manager',
    allBranches: false,
    maxDiscountBp: 2000,
    maxRefundCents: 50_000_00,
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.TENANT_MANAGE && p !== P.ROLE_MANAGE),
  },
  {
    name: 'Cashier',
    allBranches: false,
    maxDiscountBp: 500,
    maxRefundCents: 0,
    permissions: [
      P.CATALOG_READ, P.STOCK_READ, P.SALES_CREATE, P.SALES_READ, P.PAYMENT_CREATE, P.PAYMENT_READ,
      P.CUSTOMER_READ, P.CUSTOMER_MANAGE, P.REPAIR_READ, P.REPAIR_CREATE, P.REPAIR_DELIVER,
    ],
  },
  {
    name: 'Technician',
    allBranches: false,
    maxDiscountBp: 0,
    maxRefundCents: 0,
    permissions: [P.CATALOG_READ, P.STOCK_READ, P.CUSTOMER_READ, P.REPAIR_READ, P.REPAIR_UPDATE],
  },
  {
    name: 'Storekeeper',
    allBranches: false,
    maxDiscountBp: 0,
    maxRefundCents: 0,
    permissions: [P.CATALOG_READ, P.CATALOG_MANAGE, P.STOCK_READ, P.STOCK_RECEIVE, P.STOCK_VIEW_COST],
  },
  {
    name: 'Accountant',
    allBranches: true,
    maxDiscountBp: 0,
    maxRefundCents: 0,
    permissions: [P.SALES_READ, P.PAYMENT_READ, P.CUSTOMER_READ, P.REPORT_READ, P.STOCK_READ, P.STOCK_VIEW_COST, P.AUDIT_READ],
  },
];

/** Module codes that plans switch on and off. */
export const FEATURES = {
  POS: 'pos',
  INVENTORY: 'inventory',
  REPAIRS: 'repairs',
  CUSTOMERS: 'customers',
  NOTIFICATIONS: 'notifications',
  REPORTS: 'reports',
} as const;
export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

export const DEFAULT_PLANS = [
  { code: 'REPAIR_ONLY', name: 'Repair only', priceCents: 2_900_00, maxUsers: 3, features: [FEATURES.REPAIRS, FEATURES.CUSTOMERS, FEATURES.NOTIFICATIONS, FEATURES.INVENTORY] },
  { code: 'POS_REPAIRS', name: 'POS + Repairs', priceCents: 5_900_00, maxUsers: 8, features: Object.values(FEATURES) },
  { code: 'FULL', name: 'Full ERP', priceCents: 8_900_00, maxUsers: 50, features: Object.values(FEATURES) },
];
