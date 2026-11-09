import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../../prisma/prisma.service';

export interface AuditEntry {
  tenantId: string;
  userId?: string | null;
  branchId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append-only audit trail for sensitive actions. There is no update or delete path. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId ?? null,
        branchId: entry.branchId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: (entry.before ?? undefined) as any,
        after: (entry.after ?? undefined) as any,
        ip: entry.ip ?? null,
      },
    });
  }
}
