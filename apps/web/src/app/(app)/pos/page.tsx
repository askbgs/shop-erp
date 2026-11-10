'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ProductThumb } from '@/components/product-images';
import { Alert, Badge, Button, cx, Field, Input, Modal, Select } from '@/components/ui';
import { api, ApiError, Paged, qs } from '@/lib/api';
import { centsToInput, CONDITION_LABEL, lkr, newClientRef, PAYMENT_LABEL, toCents, toLkPhone } from '@/lib/format';
import { offlineQueue } from '@/lib/offline-queue';
import { useSession } from '@/lib/session';
import { previewTotals } from '@/lib/totals';
import { Customer, Invoice, Lookup, Product, StockUnit } from '@/lib/types';

interface CartLine {
  key: string;
  variantId: string;
  stockUnitId?: string;
  imei?: string | null;
  serial?: string | null;
  condition?: string;
  title: string;
  sub: string;
  imageUrl?: string | null;
  qty: number;
  serialized: boolean;
  listPriceCents: number;
  priceInput: string;
  discountInput: string;
}

interface PayLine {
  method: string;
  amountInput: string;
  reference: string;
}

const METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'LANKAQR', 'CHEQUE', 'LOYALTY_POINTS'];

export default function PosPage() {
  const { branchId } = useSession();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ vatRateBp: number; pricesIncludeVat: boolean; loyaltyPointValueCents: number }>('/tenant/settings') });

  const [lines, setLines] = useState<CartLine[]>([]);
  const [code, setCode] = useState('');
  const [scanMsg, setScanMsg] = useState<{ tone: 'bad' | 'good' | 'wait'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [pickUnitsFor, setPickUnitsFor] = useState<Product | null>(null);
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState('');
  const [billDiscount, setBillDiscount] = useState('');
  const [pays, setPays] = useState<PayLine[]>([{ method: 'CASH', amountInput: '', reference: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Invoice | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [queued, setQueued] = useState(0);
  const clientRef = useRef(newClientRef());
  const scanRef = useRef<HTMLInputElement>(null);

  // Retry sales saved while offline.
  useEffect(() => {
    const sync = async () => {
      if (offlineQueue.list().length) await offlineQueue.flush();
      setQueued(offlineQueue.list().length);
    };
    sync();
    const t = setInterval(sync, 30_000);
    window.addEventListener('online', sync);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', sync);
    };
  }, []);

  const products = useQuery({
    queryKey: ['pos-search', search],
    queryFn: () => api.get<Paged<Product>>(`/catalog/products${qs({ q: search, pageSize: 8 })}`),
    enabled: search.trim().length >= 2,
  });

  const totals = useMemo(() => {
    const s = settings.data ?? { vatRateBp: 1800, pricesIncludeVat: true };
    return previewTotals(
      lines.map((l) => ({ qty: l.qty, unitPriceCents: toCents(l.priceInput) ?? 0, discountCents: toCents(l.discountInput) ?? 0 })),
      toCents(billDiscount) ?? 0,
      s.vatRateBp,
      s.pricesIncludeVat,
    );
  }, [lines, billDiscount, settings.data]);

  const tendered = pays.reduce((a, p) => a + (toCents(p.amountInput) ?? 0), 0);
  const change = Math.max(tendered - totals.total, 0);
  const short = Math.max(totals.total - tendered, 0);

  function addUnit(unit: StockUnit, priceCents: number, imageUrl?: string | null) {
    if (lines.some((l) => l.stockUnitId === unit.id)) {
      setScanMsg({ tone: 'wait', text: 'That unit is already on the bill.' });
      return;
    }
    const p = unit.variant.product;
    setLines((ls) => [
      ...ls,
      {
        key: unit.id, variantId: unit.variantId, stockUnitId: unit.id, imei: unit.imei1, serial: unit.serial, condition: unit.condition,
        title: `${p.name} ${unit.variant.name}`, sub: unit.imei1 ?? unit.serial ?? '', imageUrl: imageUrl ?? p.images?.[0]?.url, qty: 1, serialized: true,
        listPriceCents: priceCents, priceInput: centsToInput(priceCents), discountInput: '',
      },
    ]);
    setScanMsg({ tone: 'good', text: `Added ${p.name} ${unit.variant.name}` });
  }

  function addVariant(product: Product, variantId: string) {
    const v = product.variants.find((x) => x.id === variantId)!;
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === v.id && !l.serialized);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...ls,
        {
          key: `${v.id}-${Date.now()}`, variantId: v.id, title: `${product.name} ${v.name}`.trim(), sub: product.trackingType === 'SERVICE' ? 'Service' : v.sku, imageUrl: product.images?.[0]?.url,
          qty: 1, serialized: false, listPriceCents: v.priceCents, priceInput: centsToInput(v.priceCents), discountInput: '',
        },
      ];
    });
    setScanMsg({ tone: 'good', text: `Added ${product.name} ${v.name}` });
  }

  async function scan(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setCode('');
    try {
      const r = await api.get<Lookup>(`/catalog/lookup${qs({ code: c, branchId })}`);
      if (r.match === 'UNIT') {
        if (!r.sellable) {
          const where = r.unit.branchId !== branchId ? 'is at another branch' : `is ${r.unit.status.toLowerCase().replace('_', ' ')}`;
          setScanMsg({ tone: 'bad', text: `${c} ${where} and cannot be sold here.` });
        } else addUnit(r.unit, r.priceCents, r.imageUrl);
      } else if (r.match === 'VARIANT') {
        if (r.variant.product.trackingType === 'SERIAL') {
          setPickUnitsFor({ ...r.variant.product, variants: [r.variant], images: r.imageUrl ? [{ id: 'cover', url: r.imageUrl }] : [] });
        } else addVariant({ ...r.variant.product, variants: [r.variant], images: r.imageUrl ? [{ id: 'cover', url: r.imageUrl }] : [] }, r.variant.id);
      } else {
        setSearch(c);
        setScanMsg({ tone: 'wait', text: `No IMEI, serial or barcode matches “${c}”. Pick from the search results instead.` });
      }
    } catch (err) {
      setScanMsg({ tone: 'bad', text: (err as Error).message });
    }
    scanRef.current?.focus();
  }

  async function findCustomer() {
    if (phone.replace(/\D/g, '').length < 9) return;
    try {
      const c = await api.get<Customer | null>(`/customers/by-phone/${encodeURIComponent(toLkPhone(phone))}`);
      setCustomer(c ?? null);
    } catch {
      setCustomer(null);
    }
  }

  function reset() {
    setLines([]);
    setPhone('');
    setCustomer(null);
    setNewName('');
    setBillDiscount('');
    setPays([{ method: 'CASH', amountInput: '', reference: '' }]);
    setError('');
    setScanMsg(null);
    clientRef.current = newClientRef();
    scanRef.current?.focus();
  }

  function buildPayload() {
    const customerPart = customer ? { customerId: customer.id } : phone.trim() && newName.trim() ? { customer: { name: newName.trim(), phone: toLkPhone(phone) } } : {};
    return {
      branchId,
      ...customerPart,
      lines: lines.map((l) => ({
        ...(l.stockUnitId ? { stockUnitId: l.stockUnitId } : { variantId: l.variantId }),
        qty: l.qty,
        unitPriceCents: toCents(l.priceInput) ?? 0,
        discountCents: toCents(l.discountInput) ?? 0,
      })),
      billDiscountCents: toCents(billDiscount) ?? 0,
      payments: pays.filter((p) => (toCents(p.amountInput) ?? 0) > 0).map((p) => ({ method: p.method, amountCents: toCents(p.amountInput)!, reference: p.reference || undefined })),
      clientRef: clientRef.current,
    };
  }

  async function complete() {
    setBusy(true);
    setError('');
    const payload = buildPayload();
    try {
      const inv = await api.post<Invoice>('/sales/invoices', payload);
      setDone(inv);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      reset();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 502 || err.status === undefined || err instanceof TypeError) {
        offlineQueue.add({ clientRef: payload.clientRef, payload, queuedAt: new Date().toISOString() });
        setQueued(offlineQueue.list().length);
        setSavedOffline(true);
        reset();
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function hold() {
    if (!lines.length) return;
    await api.post('/sales/held', { branchId, label: customer?.name ?? (newName || `Bill of ${lines.length} item${lines.length === 1 ? '' : 's'}`), payload: { lines, phone, newName, billDiscount } });
    qc.invalidateQueries({ queryKey: ['held', branchId] });
    reset();
  }

  const setLine = (key: string, patch: Partial<CartLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const canComplete = lines.length > 0 && !busy && (short === 0 || customer || (phone && newName));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
      {/* Left: find items */}
      <div className="space-y-4">
        <form onSubmit={scan} className="rounded-panel border border-line bg-surface p-4">
          <label htmlFor="scan" className="mb-2 block font-bold">Scan or type an IMEI, serial number or barcode</label>
          <div className="flex gap-2">
            <Input
              id="scan"
              ref={scanRef}
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="code h-14 text-xl"
              placeholder="35 209900 176148 1"
            />
            <Button type="submit" variant="primary" size="lg" className="h-14">Add</Button>
          </div>
          {scanMsg && (
            <p className={cx('mt-2 text-sm font-semibold', scanMsg.tone === 'bad' ? 'text-fault' : scanMsg.tone === 'good' ? 'text-solder' : 'text-[#7a5600]')} role="status">
              {scanMsg.text}
            </p>
          )}
        </form>

        <div className="rounded-panel border border-line bg-surface p-4">
          <Field label="Search products by name">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="iPhone 13, tempered glass, charger…" />
          </Field>
          {products.data && (
            <ul className="mt-3 divide-y divide-line-2">
              {products.data.items.map((p) =>
                p.variants.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                    <ProductThumb url={p.images?.[0]?.url} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{p.name} {v.name}</div>
                      <div className="text-xs text-ink-3">{p.trackingType === 'SERIAL' ? 'Each unit has its own IMEI/serial' : p.trackingType === 'SERVICE' ? 'Service' : v.sku}</div>
                    </div>
                    <span className="num text-sm">{lkr(v.priceCents)}</span>
                    <Button size="sm" onClick={() => (p.trackingType === 'SERIAL' ? setPickUnitsFor({ ...p, variants: [v] }) : addVariant(p, v.id))}>
                      {p.trackingType === 'SERIAL' ? 'Choose unit' : 'Add'}
                    </Button>
                  </li>
                )),
              )}
              {products.data.items.length === 0 && <li className="py-4 text-center text-ink-3">No products match “{search}”.</li>}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setHeldOpen(true)}>Held bills</Button>
          <Button onClick={hold} disabled={!lines.length}>Hold this bill</Button>
          {queued > 0 && <Badge tone="wait">{queued} sale{queued === 1 ? '' : 's'} waiting to sync</Badge>}
        </div>
      </div>

      {/* Right: the bill, drawn as a receipt strip */}
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="receipt rounded-t-panel border border-b-0 border-line shadow-[0_1px_0_var(--color-line)]">
          <div className="border-b border-dashed border-line px-4 py-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">Bill</h2>
              <span className="text-sm text-ink-3">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          <ul className="divide-y divide-dashed divide-line px-4">
            {lines.length === 0 && <li className="py-10 text-center text-ink-3">Scan an item to start the bill.</li>}
            {lines.map((l) => (
              <li key={l.key} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <ProductThumb url={l.imageUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-snug">{l.title}</div>
                    <div className="code text-xs text-ink-3">
                      {l.sub}
                      {l.condition && l.condition !== 'NEW' && <span className="ml-2 font-sans font-bold text-[#7a5600]">{CONDITION_LABEL[l.condition]}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-sm font-semibold text-fault hover:underline" aria-label={`Remove ${l.title}`}>
                    Remove
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-[4rem_1fr_1fr] gap-2">
                  <label className="text-xs text-ink-3">
                    Qty
                    <Input type="number" min={1} value={l.qty} disabled={l.serialized} onChange={(e) => setLine(l.key, { qty: Math.max(1, Number(e.target.value) || 1) })} className="num h-9" />
                  </label>
                  <label className="text-xs text-ink-3">
                    Price (Rs)
                    <Input inputMode="decimal" value={l.priceInput} onChange={(e) => setLine(l.key, { priceInput: e.target.value })} className="num h-9" />
                  </label>
                  <label className="text-xs text-ink-3">
                    Discount (Rs)
                    <Input inputMode="decimal" value={l.discountInput} onChange={(e) => setLine(l.key, { discountInput: e.target.value })} className="num h-9" placeholder="0" />
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div className="space-y-3 border-t border-dashed border-line px-4 py-3">
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <Field label="Customer mobile">
                <Input inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setCustomer(null); }} onBlur={findCustomer} onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && findCustomer()} placeholder="Optional" />
              </Field>
              {customer ? (
                <div className="pt-6 text-sm">
                  <div className="font-semibold">{customer.name}</div>
                  <div className="text-ink-3">{customer.loyaltyPoints} points</div>
                </div>
              ) : (
                <Field label="Name (new customer)">
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} disabled={!phone} />
                </Field>
              )}
            </div>
            <Field label="Bill discount (Rs)">
              <Input inputMode="decimal" value={billDiscount} onChange={(e) => setBillDiscount(e.target.value)} placeholder="0" className="num" />
            </Field>
          </div>

          <dl className="num space-y-1 border-t border-dashed border-line px-4 py-3 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{lkr(totals.subtotal)}</dd></div>
            {totals.discount > 0 && <div className="flex justify-between text-solder"><dt>Discount</dt><dd>−{lkr(totals.discount)}</dd></div>}
            <div className="flex justify-between text-ink-3"><dt>VAT {settings.data?.pricesIncludeVat === false ? '' : '(included)'}</dt><dd>{lkr(totals.tax)}</dd></div>
            <div className="flex justify-between pt-1 text-2xl font-bold"><dt>Total</dt><dd>{lkr(totals.total)}</dd></div>
          </dl>

          <div className="space-y-2 border-t border-dashed border-line px-4 py-3">
            {pays.map((p, i) => (
              <div key={i} className="grid grid-cols-[8.5rem_1fr_auto] gap-2">
                <Select value={p.method} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))} aria-label="Payment method">
                  {METHODS.filter((m) => m !== 'LOYALTY_POINTS' || customer).map((m) => (
                    <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>
                  ))}
                </Select>
                <Input inputMode="decimal" value={p.amountInput} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amountInput: e.target.value } : x)))} placeholder="Amount" className="num" aria-label="Amount" />
                {pays.length > 1 ? (
                  <Button variant="ghost" size="sm" className="h-10" onClick={() => setPays(pays.filter((_, j) => j !== i))} aria-label="Remove payment">×</Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setPays(pays.map((x, j) => (j === pays.length - 1 ? { ...x, amountInput: centsToInput(Math.max(totals.total - (tendered - (toCents(x.amountInput) ?? 0)), 0)) } : x)))} disabled={!lines.length}>
                Exact amount
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPays([...pays, { method: 'CARD', amountInput: centsToInput(short), reference: '' }])}>
                Split payment
              </Button>
            </div>
            <div className="num flex justify-between text-sm">
              {change > 0 ? (<><span>Change to give</span><b className="text-lg">{lkr(change)}</b></>) : short > 0 && lines.length ? (<><span className="text-[#7a5600]">Still to pay</span><b>{lkr(short)}</b></>) : <span />}
            </div>
            {short > 0 && lines.length > 0 && tendered > 0 && !customer && !(phone && newName) && <p className="text-xs text-[#7a5600]">To leave a balance on credit, add the customer.</p>}
            <Alert>{error}</Alert>
            <Button variant="primary" size="lg" className="w-full" onClick={complete} loading={busy} disabled={!canComplete}>
              Complete sale {lines.length ? lkr(totals.total) : ''}
            </Button>
            {lines.length > 0 && (
              <button type="button" onClick={reset} className="w-full text-center text-sm font-semibold text-ink-3 hover:text-fault">
                Clear bill
              </button>
            )}
          </div>
        </div>
      </aside>

      <UnitPicker product={pickUnitsFor} branchId={branchId} onClose={() => setPickUnitsFor(null)} onPick={(u, price) => { addUnit(u, price); setPickUnitsFor(null); }} />
      <HeldBills open={heldOpen} branchId={branchId} onClose={() => setHeldOpen(false)} onRecall={(p) => { setLines(p.lines); setPhone(p.phone ?? ''); setNewName(p.newName ?? ''); setBillDiscount(p.billDiscount ?? ''); setHeldOpen(false); }} />

      <Modal open={!!done} title="Sale complete" onClose={() => setDone(null)} footer={<Button variant="primary" onClick={() => setDone(null)}>Next customer</Button>}>
        {done && (
          <div className="space-y-3">
            <div className="code text-2xl font-bold">{done.number}</div>
            {done.duplicate && <Alert tone="wait">This sale was already recorded; here is the original invoice.</Alert>}
            <dl className="num space-y-1">
              <div className="flex justify-between"><dt>Total</dt><dd className="font-bold">{lkr(done.totalCents)}</dd></div>
              {done.changeCents > 0 && <div className="flex justify-between text-lg"><dt>Change</dt><dd className="font-bold">{lkr(done.changeCents)}</dd></div>}
              {done.balanceCents > 0 && <div className="flex justify-between text-[#7a5600]"><dt>On credit</dt><dd className="font-bold">{lkr(done.balanceCents)}</dd></div>}
              {done.pointsEarned > 0 && <div className="flex justify-between text-sm text-ink-2"><dt>Points earned</dt><dd>{done.pointsEarned}</dd></div>}
            </dl>
            <a href={`/api/v1/sales/invoices/${done.id}/receipt`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-ctl border border-line px-4 font-semibold">
              Print receipt
            </a>
          </div>
        )}
      </Modal>

      <Modal open={savedOffline} title="Saved on this device" onClose={() => setSavedOffline(false)} footer={<Button variant="primary" onClick={() => setSavedOffline(false)}>OK</Button>}>
        <p>The server could not be reached, so this sale is saved here and will be sent automatically when the connection is back. It will not be recorded twice.</p>
      </Modal>
    </div>
  );
}

function UnitPicker({ product, branchId, onClose, onPick }: { product: Product | null; branchId: string; onClose: () => void; onPick: (u: StockUnit, price: number) => void }) {
  const v = product?.variants[0];
  const units = useQuery({
    queryKey: ['units-in-stock', v?.id, branchId],
    queryFn: () => api.get<Paged<StockUnit>>(`/stock/units${qs({ variantId: v!.id, branchId, status: 'IN_STOCK', pageSize: 100 })}`),
    enabled: !!v,
  });
  return (
    <Modal open={!!product} title={product ? `${product.name} ${v?.name ?? ''} in stock` : ''} onClose={onClose} wide>
      {units.data?.items.length === 0 && <p className="py-6 text-center text-ink-3">None in stock at this branch.</p>}
      <ul className="divide-y divide-line-2">
        {units.data?.items.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <div className="code font-semibold">{u.imei1 ?? u.serial}</div>
              <div className="text-xs text-ink-3">{CONDITION_LABEL[u.condition]}{u.imei2 ? `, 2nd IMEI ${u.imei2}` : ''}</div>
            </div>
            <span className="num text-sm">{lkr(u.priceCents ?? v!.priceCents)}</span>
            <Button size="sm" onClick={() => onPick({ ...u, variant: { ...u.variant, product: product! } }, u.priceCents ?? v!.priceCents)}>Add</Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

interface Held {
  id: string;
  label: string | null;
  createdAt: string;
  payload: { lines: CartLine[]; phone?: string; newName?: string; billDiscount?: string };
}

function HeldBills({ open, branchId, onClose, onRecall }: { open: boolean; branchId: string; onClose: () => void; onRecall: (p: Held['payload']) => void }) {
  const qc = useQueryClient();
  const held = useQuery({ queryKey: ['held', branchId], queryFn: () => api.get<Held[]>(`/sales/held${qs({ branchId })}`), enabled: open });
  async function recall(h: Held) {
    await api.del(`/sales/held/${h.id}`);
    qc.invalidateQueries({ queryKey: ['held', branchId] });
    onRecall(h.payload);
  }
  return (
    <Modal open={open} title="Held bills" onClose={onClose}>
      {held.data?.length === 0 && <p className="py-6 text-center text-ink-3">No bills on hold.</p>}
      <ul className="divide-y divide-line-2">
        {held.data?.map((h) => (
          <li key={h.id} className="flex items-center justify-between py-2">
            <div>
              <div className="font-semibold">{h.label}</div>
              <div className="text-xs text-ink-3">{h.payload.lines?.length ?? 0} lines, held at {new Date(h.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <Button size="sm" variant="primary" onClick={() => recall(h)}>Recall</Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
