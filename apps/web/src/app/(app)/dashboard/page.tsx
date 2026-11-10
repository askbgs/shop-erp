'use client';

import { useQuery } from '@tanstack/react-query';
import { HandCoins, ReceiptText, ScanBarcode, TrendingUp, Wallet, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Badge, ButtonLink, Loading, PageHeader, Panel, Stat, Table } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { lkr, PAYMENT_LABEL, today } from '@/lib/format';
import { useSession } from '@/lib/session';
import { REPAIR_LABEL, RepairStatus, repairTone } from '@/lib/types';

interface Dashboard {
  date: string;
  sales: { invoices: number; totalCents: number; taxCents: number; discountCents: number; grossProfitCents?: number };
  payments: { method: string; amountCents: number }[];
  repairs: { open: Partial<Record<RepairStatus, number>>; deliveredToday: number; repairIncomeCents: number };
  lowStockItems: number;
  receivables: { invoices: number; balanceCents: number };
  topItems: { variantId: string; description: string; qty: number; totalCents: number }[];
}

const REPAIR_ORDER: RepairStatus[] = ['RECEIVED', 'DIAGNOSING', 'WAITING_APPROVAL', 'WAITING_PARTS', 'IN_REPAIR', 'QUALITY_CHECK', 'READY', 'REJECTED', 'NOT_REPAIRABLE'];

export default function DashboardPage() {
  const { branchId, branch, can, has } = useSession();
  const router = useRouter();
  const allowed = can('report.read') && has('reports');
  // Staff without reports start on the screen they use most.
  useEffect(() => {
    if (!allowed) router.replace(can('sales.create') && has('pos') ? '/pos' : '/repairs');
  }, [allowed, can, has, router]);
  const d = useQuery({ queryKey: ['dashboard', branchId], queryFn: () => api.get<Dashboard>(`/reports/dashboard${qs({ branchId })}`), refetchInterval: 60_000, enabled: allowed });

  const cash = d.data?.payments.reduce((a, p) => a + p.amountCents, 0) ?? 0;
  const openRepairs = d.data ? Object.values(d.data.repairs.open).reduce((a, n) => a + (n ?? 0), 0) : 0;

  return (
    <>
      <PageHeader
        title={`Today at ${branch.name}`}
        sub={new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
        actions={
          <>
            {can('repair.create') && <ButtonLink href="/repairs/new"><Wrench /> Take in a repair</ButtonLink>}
            {can('sales.create') && <ButtonLink href="/pos" variant="primary"><ScanBarcode /> Open point of sale</ButtonLink>}
          </>
        }
      />
      {!d.data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={<ReceiptText />} label="Sales today" value={lkr(d.data.sales.totalCents)} sub={`${d.data.sales.invoices} invoice${d.data.sales.invoices === 1 ? '' : 's'}`} />
            <Stat icon={<TrendingUp />} label="Gross profit" value={d.data.sales.grossProfitCents === undefined ? '—' : lkr(d.data.sales.grossProfitCents)} sub="Sales after VAT, minus cost" />
            <Stat icon={<Wallet />} label="Money received" value={lkr(cash)} sub={`Repairs delivered: ${d.data.repairs.deliveredToday}`} />
            <Stat icon={<HandCoins />} label="Owed by customers" value={lkr(d.data.receivables.balanceCents)} sub={`${d.data.receivables.invoices} unpaid invoice${d.data.receivables.invoices === 1 ? '' : 's'}`} tone={d.data.receivables.balanceCents > 0 ? 'wait' : undefined} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <Panel title={`Repairs in the shop (${openRepairs})`} actions={<Link href="/repairs" className="text-sm font-semibold text-solder underline">All repairs</Link>} pad={false}>
              <ul className="divide-y divide-line-2">
                {REPAIR_ORDER.filter((s) => d.data!.repairs.open[s]).map((s) => (
                  <li key={s}>
                    <Link href={`/repairs?status=${s}`} className="flex items-center justify-between px-4 py-3 hover:bg-canvas">
                      <Badge tone={repairTone(s)}>{REPAIR_LABEL[s]}</Badge>
                      <span className="num text-lg font-bold">{d.data!.repairs.open[s]}</span>
                    </Link>
                  </li>
                ))}
                {openRepairs === 0 && <li className="px-4 py-8 text-center text-ink-3">No devices waiting. Take one in from the repair desk.</li>}
              </ul>
            </Panel>

            <Panel title="Payments by method">
              {d.data.payments.length === 0 ? (
                <p className="py-6 text-center text-ink-3">No payments yet today.</p>
              ) : (
                <dl className="space-y-2">
                  {d.data.payments.map((p) => (
                    <div key={p.method} className="flex justify-between">
                      <dt className="text-ink-2">{PAYMENT_LABEL[p.method] ?? p.method}</dt>
                      <dd className="num font-semibold">{lkr(p.amountCents)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {d.data.lowStockItems > 0 && (
                <Link href="/stock?lowStock=1" className="mt-4 block rounded-ctl bg-led-tint px-3 py-2 text-sm font-semibold text-[#7a5600]">
                  {d.data.lowStockItems} item{d.data.lowStockItems === 1 ? ' is' : 's are'} at or below the reorder level
                </Link>
              )}
            </Panel>
          </div>

          <Panel title="Best sellers today" pad={false}>
            <Table head={['Item', 'Qty', 'Value']} empty="Nothing sold yet today.">
              {d.data.topItems.map((t) => (
                <tr key={t.variantId + t.description}>
                  <td>{t.description}</td>
                  <td className="num">{t.qty}</td>
                  <td className="num">{lkr(t.totalCents)}</td>
                </tr>
              ))}
            </Table>
          </Panel>
          <p className="text-xs text-ink-3">Figures for {d.data.date === today() ? 'today' : d.data.date}, refreshed every minute.</p>
        </div>
      )}
    </>
  );
}
