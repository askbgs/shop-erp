'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Field, Input, Loading, Modal, PageHeader, Panel, Select, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { centsToInput, date, dateTime, lkr, PAYMENT_LABEL, toCents } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Invoice } from '@/lib/types';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/sales/invoices/${id}`) });
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  async function act(fn: () => Promise<unknown>, close: () => void) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!inv.data) return <Loading />;
  const i = inv.data;
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date(i.issuedAt)) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
  return (
    <>
      <PageHeader
        title={i.number}
        sub={<>{dateTime(i.issuedAt)}{i.customer ? <> for <Link href={`/customers/${i.customer.id}`} className="font-semibold text-solder underline">{i.customer.name}</Link></> : ', walk-in customer'}</>}
        actions={
          <>
            <a href={`/api/v1/sales/invoices/${i.id}/receipt`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-ctl border border-line bg-surface px-4 text-sm font-semibold">Print receipt</a>
            {i.status === 'COMPLETED' && i.balanceCents > 0 && can('payment.create') && <Button variant="primary" onClick={() => { setAmount(centsToInput(i.balanceCents)); setPayOpen(true); }}>Collect {lkr(i.balanceCents)}</Button>}
            {i.status === 'COMPLETED' && sameDay && can('sales.void') && <Button variant="danger" onClick={() => setVoidOpen(true)}>Void invoice</Button>}
          </>
        }
      />
      {i.status === 'VOIDED' && <div className="mb-4"><Alert>This invoice was voided: {i.voidReason}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title="Items" pad={false}>
          <Table head={['Item', 'Qty', 'Price', 'Discount', 'Total', 'Warranty']}>
            {(i.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{lkr(l.unitPriceCents)}</td>
                <td className="num text-ink-3">{l.discountCents ? lkr(l.discountCents) : '—'}</td>
                <td className="num font-semibold">{lkr(l.lineTotalCents)}</td>
                <td className="whitespace-nowrap text-ink-3">{l.warrantyEndsAt ? `Until ${date(l.warrantyEndsAt)}` : '—'}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Totals">
          <dl className="num space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{lkr(i.subtotalCents)}</dd></div>
            {i.discountCents > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{lkr(i.discountCents)}</dd></div>}
            <div className="flex justify-between text-ink-3"><dt>VAT</dt><dd>{lkr(i.taxCents)}</dd></div>
            <div className="flex justify-between border-t border-line-2 pt-1.5 text-lg font-bold"><dt>Total</dt><dd>{lkr(i.totalCents)}</dd></div>
            <div className="flex justify-between text-solder"><dt>Paid</dt><dd>{lkr(i.paidCents)}</dd></div>
            {i.balanceCents > 0 && <div className="flex justify-between font-bold text-[#7a5600]"><dt>Balance</dt><dd>{lkr(i.balanceCents)}</dd></div>}
          </dl>
          <ul className="mt-4 space-y-1 border-t border-line-2 pt-3 text-sm">
            {(i.payments ?? []).map((p) => (
              <li key={p.id} className="flex justify-between">
                <span className={p.status === 'VOIDED' ? 'text-ink-3 line-through' : 'text-ink-2'}>{PAYMENT_LABEL[p.method]}{p.reference ? `, ${p.reference}` : ''}</span>
                <span className="num">{lkr(p.amountCents)}</span>
              </li>
            ))}
          </ul>
          {i.pointsEarned > 0 && <p className="mt-3 text-sm"><Badge tone="good">{i.pointsEarned} points earned</Badge></p>}
        </Panel>
      </div>

      <Modal open={voidOpen} title="Void this invoice?" onClose={() => setVoidOpen(false)} footer={<><Button variant="ghost" onClick={() => setVoidOpen(false)}>Keep invoice</Button><Button variant="danger" disabled={reason.length < 3} onClick={() => act(() => api.post(`/sales/invoices/${i.id}/void`, { reason }), () => setVoidOpen(false))}>Void invoice</Button></>}>
        <div className="space-y-3">
          <p>Items go back into stock, payments are reversed and loyalty points are returned. This is recorded in the audit log.</p>
          <Alert>{error}</Alert>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Customer changed their mind" /></Field>
        </div>
      </Modal>
      <Modal open={payOpen} title="Collect a payment" onClose={() => setPayOpen(false)} footer={<><Button variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button><Button variant="primary" disabled={!toCents(amount)} onClick={() => act(() => api.post('/payments', { invoiceId: i.id, method, amountCents: toCents(amount) }), () => setPayOpen(false))}>Record payment</Button></>}>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <div className="grid grid-cols-[9rem_1fr] gap-2">
            <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
              {['CASH', 'CARD', 'BANK_TRANSFER', 'LANKAQR', 'CHEQUE', ...(i.customer ? ['LOYALTY_POINTS'] : [])].map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
            </Select>
            <Input inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </div>
        </div>
      </Modal>
    </>
  );
}
