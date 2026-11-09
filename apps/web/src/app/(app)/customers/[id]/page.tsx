'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Loading, PageHeader, Panel, Stat, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { date, lkr } from '@/lib/format';
import { Customer, REPAIR_LABEL, RepairStatus, repairTone } from '@/lib/types';

interface Customer360 extends Customer {
  balanceDueCents: number;
  devices: { id: string; brand: string | null; model: string | null; imei: string | null; serial: string | null; stockUnitId: string | null; purchasedAt: string | null; warrantyEndsAt: string | null }[];
  invoices: { id: string; number: string; issuedAt: string; totalCents: number; balanceCents: number; status: string }[];
  repairJobs: { id: string; number: string; deviceModel: string; status: RepairStatus; totalCents: number; createdAt: string }[];
  loyaltyTxns: { id: string; points: number; reason: string; createdAt: string }[];
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const c = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Customer360>(`/customers/${id}`) });
  if (!c.data) return <Loading />;
  const d = c.data;
  return (
    <>
      <PageHeader title={d.name} sub={[d.phone, d.email, d.district].filter(Boolean).join(', ')} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Owes the shop" value={lkr(d.balanceDueCents)} tone={d.balanceDueCents > 0 ? 'wait' : undefined} />
        <Stat label="Loyalty points" value={d.loyaltyPoints} />
        <Stat label="Devices on record" value={d.devices.length} />
        <Stat label="Repairs" value={d.repairJobs.length} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Devices" pad={false}>
          <Table head={['Device', 'IMEI / serial', 'Warranty']} empty="No devices bought here yet.">
            {d.devices.map((v) => {
              const active = v.warrantyEndsAt && new Date(v.warrantyEndsAt) > new Date();
              return (
                <tr key={v.id}>
                  <td>{[v.brand, v.model].filter(Boolean).join(' ')}<div className="text-xs text-ink-3">Bought {date(v.purchasedAt)}</div></td>
                  <td>{v.stockUnitId ? <Link href={`/stock/units/${v.stockUnitId}`} className="code text-solder underline">{v.imei ?? v.serial}</Link> : <span className="code">{v.imei ?? v.serial}</span>}</td>
                  <td>{v.warrantyEndsAt ? <Badge tone={active ? 'good' : 'neutral'}>{active ? `Until ${date(v.warrantyEndsAt)}` : 'Ended'}</Badge> : '—'}</td>
                </tr>
              );
            })}
          </Table>
        </Panel>
        <Panel title="Repairs" pad={false}>
          <Table head={['Job', 'Device', 'Status', 'Bill']} empty="No repairs yet.">
            {d.repairJobs.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/repairs/${r.id}`} className="code font-semibold text-solder">{r.number}</Link></td>
                <td>{r.deviceModel}</td>
                <td><Badge tone={repairTone(r.status)}>{REPAIR_LABEL[r.status]}</Badge></td>
                <td className="num">{lkr(r.totalCents)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Invoices" pad={false}>
          <Table head={['Invoice', 'Date', 'Total', 'Balance']} empty="No purchases yet.">
            {d.invoices.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/sales/${i.id}`} className="code font-semibold text-solder">{i.number}</Link>{i.status === 'VOIDED' && <span className="ml-2"><Badge tone="bad">Void</Badge></span>}</td>
                <td className="text-ink-3">{date(i.issuedAt)}</td>
                <td className="num">{lkr(i.totalCents)}</td>
                <td className={i.balanceCents ? 'num font-semibold text-[#7a5600]' : 'num text-ink-3'}>{i.balanceCents ? lkr(i.balanceCents) : 'Paid'}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Loyalty points" pad={false}>
          <Table head={['Date', 'Reason', 'Points']} empty="No points yet.">
            {d.loyaltyTxns.map((t) => (
              <tr key={t.id}>
                <td className="text-ink-3">{date(t.createdAt)}</td>
                <td>{t.reason}</td>
                <td className={t.points < 0 ? 'num text-fault' : 'num text-solder'}>{t.points > 0 ? `+${t.points}` : t.points}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </>
  );
}
