'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Field, Input, Loading, Modal, PageHeader, Pager, Panel, Select, Table } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { date, DISTRICTS, toLkPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Customer } from '@/lib/types';

export default function CustomersPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', email: '', district: '', type: 'RETAIL', preferredLang: 'en' });
  const [error, setError] = useState('');
  const list = useQuery({ queryKey: ['customers', q, page], queryFn: () => api.get<Paged<Customer>>(`/customers${qs({ q, page, pageSize: 50 })}`) });

  async function create() {
    setError('');
    try {
      await api.post('/customers', { ...f, phone: toLkPhone(f.phone), email: f.email || undefined, district: f.district || undefined });
      qc.invalidateQueries({ queryKey: ['customers'] });
      setOpen(false);
      setF({ name: '', phone: '', email: '', district: '', type: 'RETAIL', preferredLang: 'en' });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Customers" sub="Everyone who has bought from you or left a device for repair" actions={can('customer.manage') && <Button variant="primary" onClick={() => setOpen(true)}>Add a customer</Button>} />
      <Panel pad={false}>
        <div className="border-b border-line-2 p-3">
          <Input className="max-w-sm" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, phone, NIC or email" aria-label="Search customers" />
        </div>
        {!list.data ? <Loading /> : (
          <>
            <Table head={['Name', 'Mobile', 'District', 'Type', 'Points', 'Since']} empty="No customers yet. They are added automatically at the POS and repair desk.">
              {list.data.items.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/customers/${c.id}`} className="font-semibold text-solder">{c.name}</Link></td>
                  <td className="num">{c.phone}</td>
                  <td>{c.district ?? '—'}</td>
                  <td className="text-ink-2">{c.type === 'RETAIL' ? 'Retail' : c.type === 'DEALER' ? 'Dealer' : 'Corporate'}</td>
                  <td className="num">{c.loyaltyPoints}</td>
                  <td className="text-ink-3">{date(c.createdAt)}</td>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={50} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      <Modal open={open} title="Add a customer" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create} disabled={!f.name || !f.phone}>Save customer</Button></>}>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Mobile"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="077 123 4567" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="District">
              <Select value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })}>
                <option value="">—</option>
                {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                <option value="RETAIL">Retail</option>
                <option value="DEALER">Dealer</option>
                <option value="CORPORATE">Corporate</option>
              </Select>
            </Field>
            <Field label="Messages in">
              <Select value={f.preferredLang} onChange={(e) => setF({ ...f, preferredLang: e.target.value })}>
                <option value="en">English</option>
                <option value="ta">Tamil</option>
                <option value="si">Sinhala</option>
              </Select>
            </Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
