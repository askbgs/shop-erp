'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Badge, Button, cx, Field, Input, Loading, Modal, PageHeader, Panel, Select, Table, Textarea } from '@/components/ui';
import { api, Paged, qs } from '@/lib/api';
import { centsToInput, date, dateTime, lkr, PAYMENT_LABEL, toCents } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Product, REPAIR_LABEL, RepairJob, RepairStatus, repairTone } from '@/lib/types';

const TRACK: RepairStatus[] = ['RECEIVED', 'DIAGNOSING', 'WAITING_APPROVAL', 'IN_REPAIR', 'QUALITY_CHECK', 'READY', 'DELIVERED'];
const TRACK_LABEL: Partial<Record<RepairStatus, string>> = { RECEIVED: 'Received', DIAGNOSING: 'Diagnosis', WAITING_APPROVAL: 'Approval', IN_REPAIR: 'Repair', QUALITY_CHECK: 'Check', READY: 'Ready', DELIVERED: 'Handed over' };

const ACTIONS: Record<RepairStatus, { to: RepairStatus; label: string; variant?: 'primary' | 'danger' }[]> = {
  RECEIVED: [{ to: 'DIAGNOSING', label: 'Start diagnosis', variant: 'primary' }, { to: 'CANCELLED', label: 'Cancel job', variant: 'danger' }],
  DIAGNOSING: [
    { to: 'WAITING_APPROVAL', label: 'Send estimate to customer', variant: 'primary' },
    { to: 'IN_REPAIR', label: 'Repair without approval' },
    { to: 'NOT_REPAIRABLE', label: 'Not repairable', variant: 'danger' },
  ],
  WAITING_APPROVAL: [
    { to: 'IN_REPAIR', label: 'Customer approved', variant: 'primary' },
    { to: 'WAITING_PARTS', label: 'Approved, order parts' },
    { to: 'REJECTED', label: 'Customer declined', variant: 'danger' },
  ],
  WAITING_PARTS: [{ to: 'IN_REPAIR', label: 'Parts arrived', variant: 'primary' }, { to: 'CANCELLED', label: 'Cancel job', variant: 'danger' }],
  IN_REPAIR: [{ to: 'QUALITY_CHECK', label: 'Send to quality check', variant: 'primary' }, { to: 'WAITING_PARTS', label: 'Waiting for parts' }, { to: 'NOT_REPAIRABLE', label: 'Not repairable', variant: 'danger' }],
  QUALITY_CHECK: [{ to: 'READY', label: 'Passed, ready for pickup', variant: 'primary' }, { to: 'IN_REPAIR', label: 'Failed, back to repair' }],
  READY: [{ to: 'IN_REPAIR', label: 'Reopen repair' }],
  REJECTED: [],
  NOT_REPAIRABLE: [],
  DELIVERED: [],
  CANCELLED: [],
};

function Track({ job }: { job: RepairJob }) {
  const off = ['REJECTED', 'NOT_REPAIRABLE', 'CANCELLED'].includes(job.status);
  const visited = new Set((job.history ?? []).map((h) => h.toStatus));
  const pos = job.status === 'WAITING_PARTS' ? TRACK.indexOf('IN_REPAIR') : TRACK.indexOf(job.status);
  const reached = off ? Math.max(...TRACK.map((s, i) => (visited.has(s) ? i : -1))) : pos;
  return (
    <ol className="flex overflow-x-auto rounded-panel border border-line bg-surface" aria-label="Job progress">
      {TRACK.map((s, i) => {
        const done = i < reached || (i === reached && s === 'DELIVERED');
        const here = i === reached && !off && s !== 'DELIVERED';
        const wait = here && (job.status === 'WAITING_APPROVAL' || job.status === 'WAITING_PARTS');
        return (
          <li key={s} className={cx('relative min-w-28 flex-1 border-r border-line-2 px-3 py-3 last:border-r-0', here && (wait ? 'bg-led-tint' : 'bg-solder-tint'))} aria-current={here ? 'step' : undefined}>
            <div className="flex items-center gap-2">
              <span className={cx('size-2.5 shrink-0 rounded-full', done ? 'bg-solder' : here ? (wait ? 'bg-led' : 'bg-solder ring-4 ring-solder/20') : 'bg-line')} />
              <span className={cx('text-sm font-semibold', done || here ? 'text-ink' : 'text-ink-3')}>{TRACK_LABEL[s]}</span>
            </div>
            {here && job.status === 'WAITING_PARTS' && <div className="mt-1 text-xs font-semibold text-[#7a5600]">Waiting for parts</div>}
            {here && job.status === 'WAITING_APPROVAL' && <div className="mt-1 text-xs font-semibold text-[#7a5600]">Waiting for the customer</div>}
          </li>
        );
      })}
      {off && (
        <li className="min-w-36 bg-fault-tint px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-fault" />
            <span className="text-sm font-semibold text-fault">{REPAIR_LABEL[job.status]}</span>
          </div>
        </li>
      )}
    </ol>
  );
}

function RepairDetail() {
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get('created') === '1';
  const { can, me } = useSession();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ['repair', id], queryFn: () => api.get<RepairJob>(`/repairs/${id}`) });
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api.get<{ id: string; name: string }[]>('/users/technicians') });
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState({ diagnosis: '', estimate: '', labour: '' });
  const [passcode, setPasscode] = useState<string | null>(null);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    if (job.data) setEdit({ diagnosis: job.data.diagnosis ?? '', estimate: centsToInput(job.data.estimateCents), labour: centsToInput(job.data.labourCents || null) });
  }, [job.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['repair', id] });
    qc.invalidateQueries({ queryKey: ['repairs'] });
  };
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setError(''),
    onSuccess: () => { setNote(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  if (!job.data) return <Loading />;
  const j = job.data;
  const open = !['DELIVERED', 'CANCELLED', 'REJECTED', 'NOT_REPAIRABLE'].includes(j.status);
  const mayWork = can('repair.update') && (can('repair.assign') || !j.technicianId || j.technicianId === me.id);
  const deliverable = ['READY', 'REJECTED', 'NOT_REPAIRABLE'].includes(j.status);
  const due = j.labourCents + (j.status === 'READY' || j.status === 'DELIVERED' ? j.partsCents : 0) - j.paidCents;
  const tech = techs.data?.find((t) => t.id === j.technicianId);

  return (
    <>
      <PageHeader
        title={`${[j.deviceBrand, j.deviceModel].filter(Boolean).join(' ')}`}
        sub={<><span className="code font-bold text-ink">{j.number}</span> for {j.customer.name}, {j.customer.phone}</>}
        actions={
          <>
            <a href={`/api/v1/repairs/${j.id}/job-card`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-ctl border border-line bg-surface px-4 text-sm font-semibold">Print job card</a>
            {deliverable && can('repair.deliver') && <Button variant="primary" onClick={() => setDeliverOpen(true)}>{j.status === 'READY' ? 'Hand over to customer' : 'Return device'}</Button>}
          </>
        }
      />
      {created && j.status === 'RECEIVED' && <div className="mb-4"><Alert tone="good">Job card created. Print it for the customer to sign; it carries their tracking code {j.trackCode}.</Alert></div>}

      <Track job={j} />
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {mayWork && ACTIONS[j.status].length > 0 && (
            <Panel title="Next step">
              <div className="flex flex-wrap gap-2">
                {ACTIONS[j.status].map((a) => (
                  <Button key={a.to} variant={a.variant ?? 'secondary'} loading={run.isPending} onClick={() => run.mutate(() => api.post(`/repairs/${j.id}/status`, { status: a.to, note: note || undefined }))}>
                    {a.label}
                  </Button>
                ))}
              </div>
              <Field label="Note for the job history (optional)" className="mt-3">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer approved by phone at 3 pm" />
              </Field>
              {j.status === 'DIAGNOSING' && !j.estimateCents && <p className="mt-2 text-sm text-[#7a5600]">Save an estimate below before sending it to the customer.</p>}
            </Panel>
          )}

          <Panel title="Diagnosis and charges">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Diagnosis" className="sm:col-span-2">
                <Textarea value={edit.diagnosis} disabled={!open || !mayWork} onChange={(e) => setEdit({ ...edit, diagnosis: e.target.value })} placeholder="What the technician found" />
              </Field>
              <Field label="Estimate to customer (Rs)"><Input inputMode="decimal" className="num" value={edit.estimate} disabled={!open || !mayWork} onChange={(e) => setEdit({ ...edit, estimate: e.target.value })} /></Field>
              <Field label="Labour charge (Rs)"><Input inputMode="decimal" className="num" value={edit.labour} disabled={!open || !mayWork} onChange={(e) => setEdit({ ...edit, labour: e.target.value })} /></Field>
            </div>
            {open && mayWork && (
              <div className="mt-3 flex justify-end">
                <Button
                  loading={run.isPending}
                  onClick={() => run.mutate(() => api.patch(`/repairs/${j.id}`, { diagnosis: edit.diagnosis || undefined, estimateCents: toCents(edit.estimate) ?? undefined, labourCents: toCents(edit.labour) ?? undefined }))}
                >
                  Save diagnosis and charges
                </Button>
              </div>
            )}
          </Panel>

          <Panel title="Parts used" actions={open && mayWork && <Button size="sm" onClick={() => setPartOpen(true)}>Add part</Button>} pad={false}>
            <Table head={['Part', 'Qty', 'Price', '']} empty="No parts used yet.">
              {(j.parts ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.description}</td>
                  <td className="num">{p.qty}</td>
                  <td className="num">{lkr(p.qty * p.unitPriceCents)}</td>
                  <td className="text-right">
                    {open && mayWork && (
                      <button type="button" className="text-sm font-semibold text-fault hover:underline" onClick={() => run.mutate(() => api.del(`/repairs/${j.id}/parts/${p.id}`))}>
                        Return to stock
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="History" pad={false}>
            <ol className="divide-y divide-line-2">
              {(j.history ?? []).slice().reverse().map((h) => (
                <li key={h.id} className="flex gap-4 px-4 py-2.5 text-sm">
                  <span className="w-28 shrink-0 text-ink-3">{dateTime(h.createdAt)}</span>
                  <div>
                    <Badge tone={repairTone(h.toStatus)}>{REPAIR_LABEL[h.toStatus]}</Badge>
                    {h.note && <div className="mt-1 text-ink-2">{h.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Bill">
            <dl className="num space-y-1.5 text-sm">
              {j.estimateCents ? <div className="flex justify-between text-ink-3"><dt>Estimate</dt><dd>{lkr(j.estimateCents)}</dd></div> : null}
              <div className="flex justify-between"><dt>Labour</dt><dd>{lkr(j.labourCents)}</dd></div>
              <div className="flex justify-between"><dt>Parts</dt><dd>{lkr(j.partsCents)}</dd></div>
              <div className="flex justify-between border-t border-line-2 pt-1.5 font-bold"><dt>Total</dt><dd>{lkr(j.labourCents + j.partsCents)}</dd></div>
              <div className="flex justify-between text-solder"><dt>Paid</dt><dd>{lkr(j.paidCents)}</dd></div>
              <div className={cx('flex justify-between text-base font-bold', due > 0 && 'text-[#7a5600]')}><dt>{due >= 0 ? 'Balance' : 'Refund due'}</dt><dd>{lkr(Math.abs(due))}</dd></div>
            </dl>
            {j.status !== 'CANCELLED' && can('payment.create') && (
              <Button size="sm" className="mt-3" onClick={() => setPayOpen(true)}>Take a payment</Button>
            )}
            {(j.payments ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line-2 pt-3 text-sm">
                {j.payments!.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span className="text-ink-2">{PAYMENT_LABEL[p.method]}{p.reference ? `, ${p.reference}` : ''}</span>
                    <span className="num">{lkr(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {j.warrantyEndsAt && <p className="mt-3 text-sm font-semibold text-solder">Repair warranty until {date(j.warrantyEndsAt)}</p>}
          </Panel>

          <Panel title="Device">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-ink-3">Customer tracking code</dt><dd className="code text-base font-bold tracking-wider">{j.trackCode}</dd></div>
              <div><dt className="text-ink-3">IMEI / serial</dt><dd className="code">{j.imei ?? j.serial ?? '—'}</dd></div>
              <div><dt className="text-ink-3">Fault reported</dt><dd>{j.reportedFault}</dd></div>
              <div><dt className="text-ink-3">Accessories received</dt><dd>{j.accessories.length ? j.accessories.join(', ') : 'None'}</dd></div>
              <div><dt className="text-ink-3">Condition</dt><dd>{j.conditionNotes ?? '—'}{j.powersOn === false ? '. Does not power on.' : ''}</dd></div>
              <div><dt className="text-ink-3">Promised</dt><dd>{dateTime(j.promisedAt)}</dd></div>
              <div><dt className="text-ink-3">Received</dt><dd>{dateTime(j.createdAt)}</dd></div>
            </dl>
            {j.hasPasscode && (
              <div className="mt-3 rounded-ctl border border-line-2 bg-canvas px-3 py-2">
                {passcode !== null ? (
                  <div className="flex items-center justify-between"><span className="text-sm text-ink-3">Passcode</span><span className="code text-lg font-bold">{passcode}</span></div>
                ) : (
                  <Button size="sm" onClick={() => api.get<{ passcode: string }>(`/repairs/${j.id}/passcode`).then((r) => setPasscode(r.passcode)).catch((e) => setError(e.message))}>
                    Show passcode
                  </Button>
                )}
                <p className="mt-1 text-xs text-ink-3">Each view is recorded in the audit log.</p>
              </div>
            )}
          </Panel>

          <Panel title="Technician">
            {can('repair.assign') && open ? (
              <Select value={j.technicianId ?? ''} onChange={(e) => e.target.value && run.mutate(() => api.post(`/repairs/${j.id}/assign`, { technicianId: e.target.value }))}>
                <option value="">Not assigned</option>
                {techs.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            ) : (
              <p className="text-sm">{tech?.name ?? 'Not assigned'}</p>
            )}
          </Panel>
        </div>
      </div>

      <AddPart open={partOpen} jobId={j.id} onClose={() => setPartOpen(false)} onDone={() => { setPartOpen(false); refresh(); }} />
      <Deliver open={deliverOpen} job={j} onClose={() => setDeliverOpen(false)} onDone={() => { setDeliverOpen(false); refresh(); }} />
      <TakePayment open={payOpen} jobId={j.id} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); refresh(); }} />
    </>
  );
}

function AddPart({ open, jobId, onClose, onDone }: { open: boolean; jobId: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [serial, setSerial] = useState('');
  const [error, setError] = useState('');
  const results = useQuery({ queryKey: ['part-search', q], queryFn: () => api.get<Paged<Product>>(`/catalog/products${qs({ q, pageSize: 10 })}`), enabled: open && q.length >= 2 });
  async function add(body: object) {
    setError('');
    try {
      await api.post(`/repairs/${jobId}/parts`, body);
      setQ('');
      setSerial('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open={open} title="Add a part from stock" onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <form onSubmit={(e) => { e.preventDefault(); if (serial) add({ imei: serial, qty: 1 }); }} className="flex gap-2">
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Scan a serialized part" className="code" aria-label="Part serial" />
          <Button type="submit" disabled={!serial}>Add</Button>
        </form>
        <Field label="Or search parts by name">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="screen, battery, charging port…" autoFocus />
        </Field>
        <ul className="divide-y divide-line-2">
          {results.data?.items.filter((p) => p.trackingType !== 'SERIAL').flatMap((p) =>
            p.variants.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                <span>{p.name} {v.name}</span>
                <span className="num text-sm">{lkr(v.priceCents)}</span>
                <Button size="sm" onClick={() => add({ variantId: v.id, qty: 1 })}>Add</Button>
              </li>
            )),
          )}
        </ul>
      </div>
    </Modal>
  );
}

const PAY_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'LANKAQR'];

function Deliver({ open, job, onClose, onDone }: { open: boolean; job: RepairJob; onClose: () => void; onDone: () => void }) {
  const repaired = job.status === 'READY';
  const [labour, setLabour] = useState(centsToInput(job.labourCents || null));
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ changeCents: number; refundCents: number } | null>(null);
  const total = (toCents(labour) ?? 0) + (repaired ? job.partsCents : 0);
  const due = total - job.paidCents;

  // Start from the job as it is now each time the dialog opens (labour may have changed since page load).
  useEffect(() => {
    if (!open) return;
    const startLabour = job.labourCents;
    const startDue = startLabour + (repaired ? job.partsCents : 0) - job.paidCents;
    setResult(null);
    setError('');
    setLabour(centsToInput(startLabour || null));
    setAmount(startDue > 0 ? centsToInput(startDue) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function go() {
    setBusy(true);
    setError('');
    try {
      const amt = toCents(amount) ?? 0;
      const r = await api.post<{ changeCents: number; refundCents: number }>(`/repairs/${job.id}/deliver`, { labourCents: toCents(labour) ?? job.labourCents, payments: amt > 0 ? [{ method, amountCents: amt }] : [] });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={repaired ? 'Hand over the repaired device' : 'Return the device unrepaired'} onClose={result ? onDone : onClose}
      footer={result ? <Button variant="primary" onClick={onDone}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} loading={busy}>Confirm hand-over</Button></>}>
      {result ? (
        <div className="space-y-2 text-lg">
          <p className="font-bold text-solder">Device handed over.</p>
          {result.changeCents > 0 && <p>Give change: <b className="num">{lkr(result.changeCents)}</b></p>}
          {result.refundCents > 0 && <p>Refund the customer: <b className="num">{lkr(result.refundCents)}</b> in cash.</p>}
          {repaired && <p className="text-sm text-ink-2">The repair warranty has started.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <Field label={repaired ? 'Labour charge (Rs)' : 'Diagnosis fee (Rs)'} hint={repaired ? undefined : 'Parts are not charged when the device is not repaired'}>
            <Input inputMode="decimal" className="num" value={labour} onChange={(e) => setLabour(e.target.value)} />
          </Field>
          <dl className="num space-y-1 rounded-ctl bg-canvas px-3 py-2 text-sm">
            {repaired && <div className="flex justify-between"><dt>Parts</dt><dd>{lkr(job.partsCents)}</dd></div>}
            <div className="flex justify-between"><dt>Total</dt><dd>{lkr(total)}</dd></div>
            <div className="flex justify-between"><dt>Already paid</dt><dd>{lkr(job.paidCents)}</dd></div>
            <div className="flex justify-between font-bold"><dt>{due >= 0 ? 'To collect' : 'To refund'}</dt><dd>{lkr(Math.abs(due))}</dd></div>
          </dl>
          {due > 0 && (
            <div className="grid grid-cols-[9rem_1fr] gap-2">
              <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
                {PAY_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
              </Select>
              <Input inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount received" />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TakePayment({ open, jobId, onClose, onDone }: { open: boolean; jobId: string; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  async function go() {
    setError('');
    try {
      await api.post('/payments', { repairJobId: jobId, method, amountCents: toCents(amount) });
      setAmount('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal open={open} title="Take a payment" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={go} disabled={!toCents(amount)}>Record payment</Button></>}>
      <div className="space-y-3">
        <Alert>{error}</Alert>
        <div className="grid grid-cols-[9rem_1fr] gap-2">
          <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
            {PAY_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
          </Select>
          <Input inputMode="decimal" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (Rs)" aria-label="Amount" autoFocus />
        </div>
      </div>
    </Modal>
  );
}

export default function RepairPage() {
  return (
    <Suspense>
      <RepairDetail />
    </Suspense>
  );
}
