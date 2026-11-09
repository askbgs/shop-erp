'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Field, Input, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { CONDITION_LABEL, lkr, toCents } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Product } from '@/lib/types';

interface Line {
  key: string;
  variantId: string;
  title: string;
  serial: boolean;
  dualImei: boolean;
  qty: string;
  cost: string;
  codes: string;
  condition: string;
}

/** One unit per line. "imei1 imei2" or "imei1,imei2" for dual-SIM phones. */
function parseCodes(text: string, dual: boolean) {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [a, b] = l.split(/[\s,;]+/);
      const isImei = /^\d{15}$/.test(a.replace(/-/g, ''));
      return isImei ? { imei1: a, ...(dual && b ? { imei2: b } : {}) } : { serial: a };
    });
}

export default function ReceivePage() {
  const { branchId } = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: string; unitsCreated: number } | null>(null);
  const results = useQuery({ queryKey: ['receive-search', q], queryFn: () => api.get<Paged<Product>>(`/catalog/products${qs({ q, pageSize: 8 })}`), enabled: q.length >= 2 });

  function add(p: Product, vId: string) {
    const v = p.variants.find((x) => x.id === vId)!;
    setLines([...lines, { key: `${vId}-${Date.now()}`, variantId: vId, title: `${p.name} ${v.name}`, serial: p.trackingType === 'SERIAL', dualImei: p.hasDualImei, qty: '1', cost: v.costCents ? String(v.costCents / 100) : '', codes: '', condition: 'NEW' }]);
    setQ('');
  }
  const patch = (key: string, p: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const total = lines.reduce((a, l) => a + (toCents(l.cost) ?? 0) * (l.serial ? parseCodes(l.codes, l.dualImei).length : Number(l.qty) || 0), 0);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ number: string; unitsCreated: number }>('/stock/receipts', {
        branchId,
        supplierName: supplier || undefined,
        reference: reference || undefined,
        lines: lines.map((l) => {
          const units = l.serial ? parseCodes(l.codes, l.dualImei).map((u) => ({ ...u, condition: l.condition })) : undefined;
          return { variantId: l.variantId, qty: units ? units.length : Number(l.qty), unitCostCents: toCents(l.cost) ?? 0, units };
        }),
      });
      setDone(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Panel title="Delivery recorded" className="max-w-lg">
        <p className="code text-xl font-bold">{done.number}</p>
        <p className="mt-2 text-ink-2">{done.unitsCreated ? `${done.unitsCreated} serialized unit${done.unitsCreated === 1 ? '' : 's'} added. ` : ''}Stock levels are updated.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={() => { setDone(null); setLines([]); setSupplier(''); setReference(''); }}>Receive another</Button>
          <Button onClick={() => router.push('/stock')}>Back to stock</Button>
        </div>
      </Panel>
    );
  }

  return (
    <>
      <PageHeader title="Receive stock" sub="Record a supplier delivery or opening stock. Phones need one IMEI per unit." />
      <div className="space-y-6">
        <Panel title="Supplier">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier name"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Colombo distributor" /></Field>
            <Field label="Their invoice or delivery note"><Input value={reference} onChange={(e) => setReference(e.target.value)} className="code" /></Field>
          </div>
        </Panel>

        <Panel title="Items">
          <Field label="Add a product">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or SKU" />
          </Field>
          {results.data && q.length >= 2 && (
            <ul className="mt-2 divide-y divide-line-2 rounded-ctl border border-line-2">
              {results.data.items.flatMap((p) => p.variants.filter(() => p.trackingType !== 'SERVICE').map((v) => (
                <li key={v.id} className="flex items-center justify-between px-3 py-2">
                  <span>{p.name} {v.name} <span className="text-xs text-ink-3">{p.trackingType === 'SERIAL' ? '(IMEI/serial per unit)' : ''}</span></span>
                  <Button size="sm" onClick={() => add(p, v.id)}>Add</Button>
                </li>
              )))}
              {results.data.items.length === 0 && <li className="px-3 py-3 text-ink-3">No match. Create the product first under Products.</li>}
            </ul>
          )}

          <div className="mt-4 space-y-4">
            {lines.map((l) => {
              const units = l.serial ? parseCodes(l.codes, l.dualImei) : [];
              return (
                <div key={l.key} className="rounded-ctl border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <b>{l.title}</b>
                    <button type="button" className="text-sm font-semibold text-fault hover:underline" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem]">
                    {l.serial ? (
                      <Field label={`IMEIs, one unit per line${l.dualImei ? ' (both IMEIs on one line)' : ''}`} hint={`${units.length} unit${units.length === 1 ? '' : 's'}`}>
                        <Textarea className="code min-h-28" value={l.codes} onChange={(e) => patch(l.key, { codes: e.target.value })} placeholder={l.dualImei ? '352099001761481 352099001761499' : '352099001761481'} />
                      </Field>
                    ) : (
                      <Field label="Quantity"><Input type="number" min={1} className="num" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} /></Field>
                    )}
                    <Field label="Cost each (Rs)"><Input inputMode="decimal" className="num" value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} /></Field>
                    {l.serial && (
                      <Field label="Condition">
                        <Select value={l.condition} onChange={(e) => patch(l.key, { condition: e.target.value })}>
                          {Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                      </Field>
                    )}
                  </div>
                </div>
              );
            })}
            {lines.length === 0 && <p className="py-6 text-center text-ink-3">Search above to add the first item.</p>}
          </div>
        </Panel>

        <Alert>{error}</Alert>
        <div className="flex items-center justify-end gap-4">
          <span className="num text-ink-2">Delivery value <b className="text-ink">{lkr(total)}</b></span>
          <Button variant="primary" size="lg" onClick={save} loading={busy} disabled={!lines.length}>Record delivery</Button>
        </div>
      </div>
    </>
  );
}
