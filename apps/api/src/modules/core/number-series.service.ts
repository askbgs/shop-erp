import { Injectable, NotFoundException } from '@nestjs/common';
import { DocType } from '../../generated/prisma/client';
import { Tx } from '../../prisma/prisma.service';

export const DEFAULT_SERIES: { docType: DocType; prefix: string }[] = [
  { docType: 'INVOICE', prefix: 'INV' },
  { docType: 'PAYMENT', prefix: 'PAY' },
  { docType: 'REPAIR_JOB', prefix: 'JOB' },
  { docType: 'STOCK_RECEIPT', prefix: 'GRN' },
  { docType: 'ADJUSTMENT', prefix: 'ADJ' },
];

/**
 * Per-branch document numbers such as TRI-INV-000123.
 * The increment is a single-row UPDATE, so concurrent cashiers never get the same number;
 * call it inside the same transaction that creates the document.
 */
@Injectable()
export class NumberSeriesService {
  async next(tx: Tx, branchId: string, docType: DocType): Promise<string> {
    const rows = await tx.$queryRaw<{ prefix: string; issued: number; padding: number; code: string }[]>`
      UPDATE number_series ns
         SET "nextNumber" = ns."nextNumber" + 1
        FROM branches b
       WHERE ns."branchId" = ${branchId}
         AND ns."docType" = ${docType}::"DocType"
         AND b.id = ns."branchId"
   RETURNING ns.prefix, ns."nextNumber" - 1 AS issued, ns.padding, b.code`;
    const row = rows[0];
    if (!row) throw new NotFoundException(`No number series ${docType} for this branch`);
    return `${row.code}-${row.prefix}-${String(row.issued).padStart(row.padding, '0')}`;
  }

  async createDefaults(tx: Tx, tenantId: string, branchId: string): Promise<void> {
    await tx.numberSeries.createMany({
      data: DEFAULT_SERIES.map((s) => ({ tenantId, branchId, docType: s.docType, prefix: s.prefix })),
      skipDuplicates: true,
    });
  }
}
