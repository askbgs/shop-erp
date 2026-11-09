'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Field, Input, Loading, PageHeader, Pager, Panel, Select, Table } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { dateTime, lkr, today } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Invoice } from '@/lib/types';

export default function SalesPage() {
  const { branchId } = useSession();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['invoices', branchId, from, to, status, q, page],
    queryFn: () => api.get<Paged<Invoice> & { totals: { totalCents: number | null; balanceCents: number | null; taxCents: number | null } }>(`/sales/invoices${qs({ branchId, from, to, status, q, page, pageSize: 50 })}`),
  });
  return (
    <>
      <PageHeader title="Sales" sub="Invoices issued at this branch" />
      <Panel pad={false}>
        <div className="grid gap-3 border-b border-line-2 p-3 sm:grid-cols-4">
          <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="COMPLETED">Completed</option>
              <option value="VOIDED">Void</option>
            </Select>
          </Field>
          <Field label="Invoice number"><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="code" /></Field>
        </div>
        {!list.data ? <Loading /> : (
          <>
            <div className="num flex flex-wrap gap-6 border-b border-line-2 px-4 py-3 text-sm">
              <span>Sales <b>{lkr(list.data.totals.totalCents ?? 0)}</b></span>
              <span>VAT <b>{lkr(list.data.totals.taxCents ?? 0)}</b></span>
              <span className={list.data.totals.balanceCents ? 'text-[#7a5600]' : ''}>Unpaid <b>{lkr(list.data.totals.balanceCents ?? 0)}</b></span>
            </div>
            <Table head={['Invoice', 'When', 'Customer', 'Total', 'Balance', '']} empty="No invoices in this period.">
              {list.data.items.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/sales/${i.id}`} className="code font-semibold text-solder">{i.number}</Link></td>
                  <td className="whitespace-nowrap text-ink-3">{dateTime(i.issuedAt)}</td>
                  <td>{i.customer?.name ?? <span className="text-ink-3">Walk-in</span>}</td>
                  <td className="num">{lkr(i.totalCents)}</td>
                  <td className={i.balanceCents ? 'num font-semibold text-[#7a5600]' : 'num text-ink-3'}>{i.balanceCents ? lkr(i.balanceCents) : '—'}</td>
                  <td>{i.status === 'VOIDED' && <Badge tone="bad">Void</Badge>}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
