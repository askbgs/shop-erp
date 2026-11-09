'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Loading, PageHeader, Panel, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { CONDITION_LABEL, date, dateTime, lkr } from '@/lib/format';
import { REPAIR_LABEL, RepairStatus, repairTone, StockUnit } from '@/lib/types';

interface UnitDetail extends StockUnit {
  movements: { id: string; type: string; qty: number; refType: string | null; note: string | null; createdAt: string }[];
  saleLines: { id: string; invoice: { id: string; number: string; issuedAt: string; status: string; customer: { id: string; name: string; phone: string } | null } }[];
  warranty: { days: number | null; endsAt: string | null; active: boolean } | null;
  repairs: { id: string; number: string; status: RepairStatus; reportedFault: string; createdAt: string }[];
}

const MOVE_LABEL: Record<string, string> = {
  RECEIPT: 'Received', SALE: 'Sold', SALE_VOID: 'Sale voided', ADJUSTMENT_IN: 'Restored', ADJUSTMENT_OUT: 'Written off', REPAIR_ISSUE: 'Used in a repair', REPAIR_RETURN: 'Returned from a repair',
};

export default function UnitPage() {
  const { id } = useParams<{ id: string }>();
  const u = useQuery({ queryKey: ['unit', id], queryFn: () => api.get<UnitDetail>(`/stock/units/${id}`) });
  if (!u.data) return <Loading />;
  const d = u.data;
  const sale = d.saleLines.find((l) => l.invoice.status === 'COMPLETED');
  return (
    <>
      <PageHeader title={`${d.variant.product.name} ${d.variant.name}`} sub={<span className="code text-lg text-ink">{d.imei1 ?? d.serial}{d.imei2 ? ` / ${d.imei2}` : ''}</span>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="This unit">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink-3">Condition</dt><dd>{CONDITION_LABEL[d.condition]}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">Status</dt><dd><Badge tone={d.status === 'IN_STOCK' ? 'good' : 'neutral'}>{d.status.replace('_', ' ').toLowerCase()}</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-ink-3">Price</dt><dd className="num">{lkr(d.priceCents ?? d.variant.priceCents)}</dd></div>
            {d.costCents !== undefined && <div className="flex justify-between"><dt className="text-ink-3">Cost</dt><dd className="num">{lkr(d.costCents)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-3">Received</dt><dd>{date(d.receivedAt)}</dd></div>
          </dl>
        </Panel>
        <Panel title="Sale and warranty">
          {sale ? (
            <div className="space-y-2 text-sm">
              <p>Sold on {date(sale.invoice.issuedAt)}, invoice <Link href={`/sales/${sale.invoice.id}`} className="code font-semibold text-solder underline">{sale.invoice.number}</Link></p>
              {sale.invoice.customer && <p>To <Link href={`/customers/${sale.invoice.customer.id}`} className="font-semibold text-solder underline">{sale.invoice.customer.name}</Link>, {sale.invoice.customer.phone}</p>}
              {d.warranty && <p className={d.warranty.active ? 'font-semibold text-solder' : 'text-fault'}>{d.warranty.active ? 'Under warranty' : 'Warranty ended'} {d.warranty.endsAt ? `(${date(d.warranty.endsAt)})` : ''}</p>}
            </div>
          ) : <p className="text-sm text-ink-3">Not sold.</p>}
        </Panel>
        <Panel title="Repairs">
          {d.repairs.length === 0 ? <p className="text-sm text-ink-3">Never in for repair.</p> : (
            <ul className="space-y-2 text-sm">
              {d.repairs.map((r) => (
                <li key={r.id}><Link href={`/repairs/${r.id}`} className="code font-semibold text-solder underline">{r.number}</Link> <Badge tone={repairTone(r.status)}>{REPAIR_LABEL[r.status]}</Badge><div className="text-ink-3">{r.reportedFault}</div></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Every movement" className="mt-6" pad={false}>
        <Table head={['When', 'What happened', 'Note']}>
          {d.movements.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap text-ink-3">{dateTime(m.createdAt)}</td>
              <td className="font-semibold">{MOVE_LABEL[m.type] ?? m.type}</td>
              <td className="text-ink-2">{m.note ?? ''}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
