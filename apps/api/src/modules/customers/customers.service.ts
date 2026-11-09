import { BadRequestException, Injectable } from '@nestjs/common';
import { Tx } from '../../prisma/prisma.service';

export interface QuickCustomer {
  name: string;
  phone: string;
  whatsapp?: string;
  email?: string;
}

@Injectable()
export class CustomersService {
  /** POS / repair desk quick-add: reuse the customer with this phone number or create one. */
  async findOrCreate(tx: Tx, tenantId: string, c: QuickCustomer) {
    const existing = await tx.customer.findUnique({ where: { tenantId_phone: { tenantId, phone: c.phone } } });
    if (existing) return existing;
    return tx.customer.create({ data: { tenantId, name: c.name, phone: c.phone, whatsapp: c.whatsapp ?? c.phone, email: c.email } });
  }

  async earnPoints(tx: Tx, tenantId: string, customerId: string, paidCents: number, refType: string, refId: string): Promise<number> {
    const s = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    const points = Math.floor(paidCents / s.loyaltyEarnCentsPerPt);
    if (points <= 0) return 0;
    await tx.customer.update({ where: { id: customerId }, data: { loyaltyPoints: { increment: points } } });
    await tx.loyaltyTransaction.create({ data: { tenantId, customerId, points, reason: 'Purchase', refType, refId } });
    return points;
  }

  /** Redeems points worth amountCents; returns points used. */
  async redeem(tx: Tx, tenantId: string, customerId: string, amountCents: number, refType: string, refId: string): Promise<number> {
    const s = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    if (s.loyaltyPointValueCents <= 0) throw new BadRequestException('Loyalty redemption is switched off');
    if (amountCents % s.loyaltyPointValueCents !== 0) {
      throw new BadRequestException(`Loyalty payments must be a multiple of ${s.loyaltyPointValueCents} cents`);
    }
    const points = amountCents / s.loyaltyPointValueCents;
    const res = await tx.customer.updateMany({
      where: { id: customerId, tenantId, loyaltyPoints: { gte: points } },
      data: { loyaltyPoints: { decrement: points } },
    });
    if (res.count !== 1) throw new BadRequestException('Not enough loyalty points');
    await tx.loyaltyTransaction.create({ data: { tenantId, customerId, points: -points, reason: 'Redeemed', refType, refId } });
    return points;
  }

  async reversePoints(tx: Tx, tenantId: string, customerId: string, points: number, refType: string, refId: string, reason: string) {
    if (!points) return;
    await tx.customer.update({ where: { id: customerId }, data: { loyaltyPoints: { increment: points } } });
    await tx.loyaltyTransaction.create({ data: { tenantId, customerId, points, reason, refType, refId } });
  }
}
