import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { MovementType, StockUnitStatus, UnitCondition } from '../../generated/prisma/client';
import { imeiError, normalizeImei } from '../../common/imei';
import { PrismaService, Tx } from '../../prisma/prisma.service';

export interface Ref {
  refType: string;
  refId: string;
  userId: string;
  note?: string;
}

export interface NewUnit {
  imei1?: string;
  imei2?: string;
  serial?: string;
  condition?: UnitCondition;
  priceCents?: number;
}

/**
 * The only place that changes stock. Every change writes a StockMovement row and
 * updates StockBalance in the same transaction, so balances always equal the ledger.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adds (+) or removes (-) quantity on the balance row; enforces the negative-stock rule. */
  async applyBalance(
    tx: Tx,
    p: { tenantId: string; branchId: string; variantId: string; qty: number; unitCostCents?: number; allowNegative: boolean; isReceipt?: boolean },
  ) {
    const existing = await tx.stockBalance.findUnique({ where: { branchId_variantId: { branchId: p.branchId, variantId: p.variantId } } });
    let avg = existing?.avgCostCents ?? 0;
    if (p.isReceipt && p.qty > 0) {
      const oldQty = Math.max(existing?.qtyOnHand ?? 0, 0);
      avg = Math.round((oldQty * avg + p.qty * (p.unitCostCents ?? 0)) / (oldQty + p.qty));
    }
    const bal = await tx.stockBalance.upsert({
      where: { branchId_variantId: { branchId: p.branchId, variantId: p.variantId } },
      create: { tenantId: p.tenantId, branchId: p.branchId, variantId: p.variantId, qtyOnHand: p.qty, avgCostCents: avg },
      update: { qtyOnHand: { increment: p.qty }, avgCostCents: avg },
    });
    if (!p.allowNegative && bal.qtyOnHand < 0) {
      throw new BadRequestException(`Not enough stock: only ${bal.qtyOnHand - p.qty} available`);
    }
    return bal;
  }

  async record(
    tx: Tx,
    m: { tenantId: string; branchId: string; variantId: string; stockUnitId?: string; type: MovementType; qty: number; unitCostCents: number } & Ref,
  ) {
    return tx.stockMovement.create({
      data: {
        tenantId: m.tenantId, branchId: m.branchId, variantId: m.variantId, stockUnitId: m.stockUnitId, type: m.type, qty: m.qty,
        unitCostCents: m.unitCostCents, refType: m.refType, refId: m.refId, note: m.note, userId: m.userId,
      },
    });
  }

  /** Validate and normalise incoming serial units; rejects duplicates within the batch and in the tenant. */
  async validateNewUnits(tx: Tx, tenantId: string, units: NewUnit[], requireImei: boolean) {
    const seen = new Set<string>();
    const errors: string[] = [];
    const out = units.map((u, i) => {
      const imei1 = u.imei1 ? normalizeImei(u.imei1) : undefined;
      const imei2 = u.imei2 ? normalizeImei(u.imei2) : undefined;
      const serial = u.serial?.trim() || undefined;
      if (requireImei && !imei1) errors.push(`Unit ${i + 1}: IMEI is required`);
      if (!imei1 && !serial) errors.push(`Unit ${i + 1}: an IMEI or serial number is required`);
      for (const imei of [imei1, imei2]) {
        if (!imei) continue;
        const err = imeiError(imei);
        if (err) errors.push(`Unit ${i + 1}: ${err}`);
      }
      for (const key of [imei1, imei2, serial]) {
        if (!key) continue;
        if (seen.has(key)) errors.push(`Unit ${i + 1}: ${key} appears twice in this receipt`);
        seen.add(key);
      }
      return { ...u, imei1, imei2, serial };
    });
    if (errors.length) throw new BadRequestException(errors);

    const codes = [...seen];
    if (codes.length) {
      const dup = await tx.stockUnit.findMany({
        where: { tenantId, OR: [{ imei1: { in: codes } }, { imei2: { in: codes } }, { serial: { in: codes } }] },
        select: { imei1: true, imei2: true, serial: true, status: true },
      });
      if (dup.length) {
        const list = dup.flatMap((d) => [d.imei1, d.imei2, d.serial]).filter((c) => c && seen.has(c));
        throw new ConflictException(`Already in the system: ${[...new Set(list)].join(', ')}`);
      }
    }
    return out;
  }

  /** Change one serialized unit's status and write the matching movement + balance change. */
  async moveUnit(
    tx: Tx,
    unitId: string,
    p: { tenantId: string; expect: StockUnitStatus[]; to: StockUnitStatus; type: MovementType; qty: 1 | -1; soldAt?: Date | null } & Ref,
  ) {
    const unit = await tx.stockUnit.findFirst({ where: { id: unitId, tenantId: p.tenantId } });
    if (!unit) throw new BadRequestException('Stock unit not found');
    // Conditional update protects against two cashiers selling the same unit at once.
    const res = await tx.stockUnit.updateMany({
      where: { id: unitId, status: { in: p.expect } },
      data: { status: p.to, soldAt: p.soldAt === undefined ? undefined : p.soldAt },
    });
    if (res.count !== 1) {
      throw new ConflictException(`Unit ${unit.imei1 ?? unit.serial} is ${unit.status.toLowerCase().replace('_', ' ')}, not available`);
    }
    await this.applyBalance(tx, { tenantId: p.tenantId, branchId: unit.branchId, variantId: unit.variantId, qty: p.qty, allowNegative: true });
    await this.record(tx, {
      tenantId: p.tenantId, branchId: unit.branchId, variantId: unit.variantId, stockUnitId: unit.id, type: p.type, qty: p.qty,
      unitCostCents: unit.costCents, refType: p.refType, refId: p.refId, userId: p.userId, note: p.note,
    });
    return unit;
  }

  /** Quantity-tracked item in or out. */
  async moveQuantity(
    tx: Tx,
    p: { tenantId: string; branchId: string; variantId: string; qty: number; type: MovementType; unitCostCents: number; allowNegative: boolean; isReceipt?: boolean } & Ref,
  ) {
    const bal = await this.applyBalance(tx, p);
    await this.record(tx, { ...p, unitCostCents: p.isReceipt ? p.unitCostCents : bal.avgCostCents || p.unitCostCents });
    return bal;
  }

  async allowNegative(tx: Tx, tenantId: string): Promise<boolean> {
    const s = await tx.tenantSettings.findUnique({ where: { tenantId }, select: { allowNegativeStock: true } });
    return s?.allowNegativeStock ?? false;
  }

  async avgCost(tx: Tx, branchId: string, variantId: string): Promise<number> {
    const b = await tx.stockBalance.findUnique({ where: { branchId_variantId: { branchId, variantId } } });
    return b?.avgCostCents ?? 0;
  }
}
