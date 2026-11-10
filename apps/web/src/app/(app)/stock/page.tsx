'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Badge, Button, ButtonLink, cx, Field, Input, Loading, Modal, PageHeader, Pager, Panel, Select, Table } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { CONDITION_LABEL, date, daysAgo, lkr } from '@/lib/format';
import { useSession } from '@/lib/session';
import { StockUnit } from '@/lib/types';

interface Balance {
  id: string;
  variantId: string;
  qtyOnHand: number;
  qtyAvailable: number;
  lowStock: boolean;
  avgCostCents?: number;
  valueCents?: number;
  variant: { id: string; sku: string; name: string; reorderLevel: number; priceCents: number; product: { name: string; trackingType: string } };
}

const TABS = [
  { key: 'levels', label: 'Stock levels' },
  { key: 'units', label: 'Phones & serials' },
  { key: 'ageing', label: 'Old stock' },
  { key: 'receipts', label: 'Deliveries' },
];

function StockInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') ?? 'levels';
  const { can } = useSession();
  return (
    <>
      <PageHeader
        title="Stock"
        sub="What is on the shelf at this branch"
        actions={can('stock.receive') && <ButtonLink href="/stock/receive" variant="primary">Receive stock</ButtonLink>}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => router.replace(`/stock?tab=${t.key}`)}
            className={cx('h-9 rounded-full border px-4 text-sm font-semibold transition-colors', tab === t.key ? 'border-solder bg-solder-tint text-solder-2' : 'border-line bg-surface text-ink-2')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'levels' && <Levels lowOnly={params.get('lowStock') === '1'} />}
      {tab === 'units' && <Units />}
      {tab === 'ageing' && <Ageing />}
      {tab === 'receipts' && <Receipts />}
    </>
  );
}

function Levels({ lowOnly }: { lowOnly: boolean }) {
  const { branchId, can } = useSession();
  const [q, setQ] = useState('');
  const [low, setLow] = useState(lowOnly);
  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState<Balance | null>(null);
  const data = useQuery({ queryKey: ['balances', branchId, q, low, page], queryFn: () => api.get<Paged<Balance>>(`/stock/balances${qs({ branchId, q, lowStock: low || undefined, page, pageSize: 50 })}`) });
  const showCost = can('stock.view_cost');
  return (
    <Panel pad={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 p-3">
        <Input className="max-w-xs" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or SKU" aria-label="Search stock" />
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <input type="checkbox" checked={low} onChange={(e) => { setLow(e.target.checked); setPage(1); }} className="size-4 accent-solder" />
          Only items to reorder
        </label>
      </div>
      {!data.data ? <Loading /> : (
        <>
          <Table head={['Item', 'SKU', 'On hand', 'Reorder at', ...(showCost ? ['Avg cost', 'Stock value'] : []), '']} empty={low ? 'Nothing needs reordering.' : 'No stock yet. Receive your first delivery.'}>
            {data.data.items.map((b) => (
              <tr key={b.id}>
                <td className="font-semibold">{b.variant.product.name} {b.variant.name}</td>
                <td className="code text-ink-3">{b.variant.sku}</td>
                <td className={cx('num font-bold', b.lowStock && 'text-[#7a5600]', b.qtyOnHand < 0 && 'text-fault')}>{b.qtyOnHand}</td>
                <td className="num text-ink-3">{b.variant.reorderLevel || '—'}</td>
                {showCost && <td className="num">{lkr(b.avgCostCents)}</td>}
                {showCost && <td className="num">{lkr(b.valueCents)}</td>}
                <td className="text-right">
                  {b.variant.product.trackingType === 'SERIAL' ? (
                    <Link href={`/stock?tab=units&variantId=${b.variantId}`} className="text-sm font-semibold text-solder underline">See units</Link>
                  ) : can('stock.adjust') ? (
                    <button type="button" className="text-sm font-semibold text-solder underline" onClick={() => setAdjust(b)}>Correct count</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={50} total={data.data.total} onPage={setPage} />
        </>
      )}
      <AdjustModal balance={adjust} onClose={() => setAdjust(null)} />
    </Panel>
  );
}

function AdjustModal({ balance, onClose }: { balance: Balance | null; onClose: () => void }) {
  const { branchId } = useSession();
  const qc = useQueryClient();
  const [count, setCount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const diff = balance && count !== '' ? Number(count) - balance.qtyOnHand : 0;
  async function save() {
    setError('');
    try {
      await api.post('/stock/adjustments', { branchId, variantId: balance!.variantId, qty: diff, reason });
      qc.invalidateQueries({ queryKey: ['balances'] });
      setCount('');
      setReason('');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open={!!balance} title="Correct the count" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!diff || reason.length < 3}>Save correction</Button></>}>
      {balance && (
        <div className="space-y-3">
          <p><b>{balance.variant.product.name} {balance.variant.name}</b>: the system shows <b className="num">{balance.qtyOnHand}</b>.</p>
          <Alert>{error}</Alert>
          <Field label="Counted on the shelf"><Input type="number" className="num" value={count} onChange={(e) => setCount(e.target.value)} autoFocus /></Field>
          {diff !== 0 && <p className={cx('num text-sm font-semibold', diff < 0 ? 'text-fault' : 'text-solder')}>{diff > 0 ? `+${diff}` : diff} will be recorded.</p>}
          <Field label="Reason" hint="Saved in the audit log"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged in display case" /></Field>
        </div>
      )}
    </Modal>
  );
}

const STATUS_TONE: Record<string, 'good' | 'neutral' | 'wait' | 'bad' | 'info'> = { IN_STOCK: 'good', SOLD: 'neutral', RESERVED: 'wait', IN_REPAIR: 'info', RETURNED: 'wait', WRITTEN_OFF: 'bad' };
const STATUS_LABEL: Record<string, string> = { IN_STOCK: 'In stock', SOLD: 'Sold', RESERVED: 'Reserved', IN_REPAIR: 'Used in repair', RETURNED: 'Returned', WRITTEN_OFF: 'Written off' };

function Units() {
  const { branchId } = useSession();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('IN_STOCK');
  const [page, setPage] = useState(1);
  const variantId = params.get('variantId') ?? undefined;
  const data = useQuery({ queryKey: ['units', branchId, q, status, page, variantId], queryFn: () => api.get<Paged<StockUnit>>(`/stock/units${qs({ branchId: q ? undefined : branchId, q, status: q ? undefined : status || undefined, variantId, page, pageSize: 50 })}`) });
  return (
    <Panel pad={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 p-3">
        <Input className="code max-w-xs" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Find by IMEI or serial" aria-label="Find by IMEI or serial" />
        {!q && (
          <Select className="max-w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        )}
        {q && <span className="text-sm text-ink-3">Searching every branch</span>}
      </div>
      {!data.data ? <Loading /> : (
        <>
          <Table head={['IMEI / serial', 'Product', 'Condition', 'Status', 'Received']} empty="No units match.">
            {data.data.items.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/stock/units/${u.id}`} className="code font-bold text-solder">{u.imei1 ?? u.serial}</Link>
                  {u.imei2 && <div className="code text-xs text-ink-3">{u.imei2}</div>}
                </td>
                <td>{u.variant.product.name} {u.variant.name}</td>
                <td>{CONDITION_LABEL[u.condition]}</td>
                <td><Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge></td>
                <td className="whitespace-nowrap text-ink-3">{date(u.receivedAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} pageSize={50} total={data.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

function Ageing() {
  const { branchId, can } = useSession();
  const data = useQuery({ queryKey: ['ageing', branchId], queryFn: () => api.get<{ buckets: Record<string, number>; units: { id: string; product: string; imei1: string | null; serial: string | null; days: number; costCents?: number }[] }>(`/stock/ageing${qs({ branchId })}`) });
  if (!data.data) return <Loading />;
  const b = data.data.buckets;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['0-30', 'Under a month'], ['31-60', '1 to 2 months'], ['61-90', '2 to 3 months'], ['90+', 'Over 3 months']].map(([k, l]) => (
          <div key={k} className={cx('rounded-panel border bg-surface p-4', k === '90+' && b[k] ? 'border-fault/40' : k === '61-90' && b[k] ? 'border-led' : 'border-line')}>
            <div className="text-sm text-ink-3">{l}</div>
            <div className="num text-2xl font-bold">{b[k]}</div>
          </div>
        ))}
      </div>
      <Panel title="Oldest units first" pad={false}>
        <Table head={['IMEI / serial', 'Product', 'Days in stock', ...(can('stock.view_cost') ? ['Cost'] : [])]} empty="No serialized stock on hand.">
          {data.data.units.slice().reverse().slice(0, 100).map((u) => (
            <tr key={u.id}>
              <td><Link href={`/stock/units/${u.id}`} className="code font-semibold text-solder">{u.imei1 ?? u.serial}</Link></td>
              <td>{u.product}</td>
              <td className={cx('num font-bold', u.days > 90 ? 'text-fault' : u.days > 60 ? 'text-[#7a5600]' : '')}>{u.days}</td>
              {can('stock.view_cost') && <td className="num">{lkr(u.costCents)}</td>}
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}

function Receipts() {
  const { branchId, can } = useSession();
  const [page, setPage] = useState(1);
  const data = useQuery({ queryKey: ['receipts', branchId, page], queryFn: () => api.get<Paged<{ id: string; number: string; supplierName: string | null; reference: string | null; totalCents: number; createdAt: string }>>(`/stock/receipts${qs({ branchId, page })}`) });
  if (!data.data) return <Loading />;
  return (
    <Panel pad={false}>
      <Table head={['Delivery', 'Supplier', 'Their reference', ...(can('stock.view_cost') ? ['Cost'] : []), 'Date']} empty="No deliveries recorded yet.">
        {data.data.items.map((r) => (
          <tr key={r.id}>
            <td className="code font-semibold">{r.number}</td>
            <td>{r.supplierName ?? '—'}</td>
            <td className="code text-ink-3">{r.reference ?? '—'}</td>
            {can('stock.view_cost') && <td className="num">{lkr(r.totalCents)}</td>}
            <td className="text-ink-3">{date(r.createdAt)} ({daysAgo(r.createdAt)} d)</td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pageSize={50} total={data.data.total} onPage={setPage} />
    </Panel>
  );
}

export default function StockPage() {
  return (
    <Suspense>
      <StockInner />
    </Suspense>
  );
}
