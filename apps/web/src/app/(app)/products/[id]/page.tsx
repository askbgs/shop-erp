'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Field, Input, Loading, Modal, PageHeader, Panel, Table } from '@/components/ui';
import { api } from '@/lib/api';
import { centsToInput, lkr, toCents } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Product, TRACKING_LABEL, Variant } from '@/lib/types';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const p = useQuery({ queryKey: ['product', id], queryFn: () => api.get<Product>(`/catalog/products/${id}`) });
  const [edit, setEdit] = useState<Variant | null>(null);
  const [form, setForm] = useState({ price: '', minPrice: '', reorder: '', barcode: '' });
  const [error, setError] = useState('');

  function open(v: Variant) {
    setEdit(v);
    setForm({ price: centsToInput(v.priceCents), minPrice: centsToInput(v.minPriceCents), reorder: String(v.reorderLevel), barcode: v.barcode ?? '' });
    setError('');
  }
  async function save() {
    try {
      await api.patch(`/catalog/variants/${edit!.id}`, { priceCents: toCents(form.price) ?? 0, minPriceCents: toCents(form.minPrice) ?? undefined, reorderLevel: Number(form.reorder) || 0, barcode: form.barcode || undefined });
      qc.invalidateQueries({ queryKey: ['product', id] });
      setEdit(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!p.data) return <Loading />;
  const d = p.data;
  return (
    <>
      <PageHeader title={d.name} sub={[d.brand?.name, d.model, d.category?.name].filter(Boolean).join(', ')} actions={<Badge tone="info">{TRACKING_LABEL[d.trackingType]}</Badge>} />
      <Panel title="Options and prices" pad={false}>
        <Table head={['Option', 'SKU', 'Barcode', 'Price', 'Lowest price', ...(can('stock.view_cost') ? ['Last cost'] : []), 'Reorder at', '']}>
          {d.variants.map((v) => (
            <tr key={v.id}>
              <td className="font-semibold">{v.name}{!v.isActive && <span className="ml-2"><Badge>Hidden</Badge></span>}</td>
              <td className="code">{v.sku}</td>
              <td className="code text-ink-3">{v.barcode ?? '—'}</td>
              <td className="num">{lkr(v.priceCents)}</td>
              <td className="num text-ink-3">{lkr(v.minPriceCents)}</td>
              {can('stock.view_cost') && <td className="num text-ink-3">{lkr(v.costCents)}</td>}
              <td className="num">{v.reorderLevel || '—'}</td>
              <td className="text-right">{can('catalog.manage') && <button type="button" className="text-sm font-semibold text-solder underline" onClick={() => open(v)}>Edit</button>}</td>
            </tr>
          ))}
        </Table>
      </Panel>
      <p className="mt-3 text-sm text-ink-3">Warranty on sale: {d.warrantyDays ? `${d.warrantyDays} days` : 'shop default'}. Price changes are kept in the price history and audit log.</p>
      <Modal open={!!edit} title={`Edit ${edit?.name ?? ''}`} onClose={() => setEdit(null)} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save changes</Button></>}>
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (Rs)"><Input inputMode="decimal" className="num" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Lowest price (Rs)"><Input inputMode="decimal" className="num" value={form.minPrice} onChange={(e) => setForm({ ...form, minPrice: e.target.value })} /></Field>
            <Field label="Reorder at"><Input type="number" className="num" value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} /></Field>
            <Field label="Barcode"><Input className="code" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></Field>
          </div>
        </div>
      </Modal>
    </>
  );
}
