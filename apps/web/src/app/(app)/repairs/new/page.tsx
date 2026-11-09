'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Alert, Button, cx, Field, Input, PageHeader, Panel, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { lkr, PAYMENT_LABEL, toCents, toLkPhone } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Customer, RepairJob } from '@/lib/types';

const ACCESSORIES = ['SIM tray', 'SIM card', 'Memory card', 'Back cover', 'Case', 'Charger', 'Cable', 'Box', 'Laptop bag'];

export default function NewRepairPage() {
  const { branchId, can } = useSession();
  const router = useRouter();
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api.get<{ id: string; name: string }[]>('/users/technicians') });
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [checked, setChecked] = useState(false);
  const [f, setF] = useState({ name: '', deviceBrand: '', deviceModel: '', imei: '', color: '', reportedFault: '', conditionNotes: '', passcode: '', estimate: '', promisedAt: '', technicianId: '', advance: '', advanceMethod: 'CASH' });
  const [acc, setAcc] = useState<string[]>([]);
  const [powersOn, setPowersOn] = useState<'yes' | 'no' | ''>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function lookup() {
    if (phone.replace(/\D/g, '').length < 9) return;
    const c = await api.get<Customer | null>(`/customers/by-phone/${encodeURIComponent(toLkPhone(phone))}`).catch(() => null);
    setCustomer(c ?? null);
    setChecked(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const advance = toCents(f.advance);
    try {
      const job = await api.post<RepairJob>('/repairs', {
        branchId,
        ...(customer ? { customerId: customer.id } : { customer: { name: f.name, phone: toLkPhone(phone) } }),
        deviceBrand: f.deviceBrand || undefined,
        deviceModel: f.deviceModel,
        imei: f.imei || undefined,
        color: f.color || undefined,
        reportedFault: f.reportedFault,
        accessories: acc,
        conditionNotes: f.conditionNotes || undefined,
        powersOn: powersOn === '' ? undefined : powersOn === 'yes',
        passcode: f.passcode || undefined,
        estimateCents: toCents(f.estimate) ?? undefined,
        promisedAt: f.promisedAt ? new Date(f.promisedAt).toISOString() : undefined,
        technicianId: f.technicianId || undefined,
        advance: advance ? [{ method: f.advanceMethod, amountCents: advance }] : undefined,
      });
      router.replace(`/repairs/${job.id}?created=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader title="Take in a device" sub="Fill in the job card with the customer at the counter" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Panel title="Customer">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mobile number">
                <Input required inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setCustomer(null); setChecked(false); }} onBlur={lookup} placeholder="077 123 4567" autoFocus />
              </Field>
              {customer ? (
                <div className="rounded-ctl bg-solder-tint px-3 py-2 text-sm">
                  <div className="font-bold text-solder-2">{customer.name}</div>
                  <div className="text-ink-2">Returning customer</div>
                </div>
              ) : (
                <Field label="Name" hint={checked ? 'New customer' : undefined}>
                  <Input required value={f.name} onChange={set('name')} />
                </Field>
              )}
            </div>
          </Panel>

          <Panel title="Device">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Brand"><Input value={f.deviceBrand} onChange={set('deviceBrand')} placeholder="Samsung" /></Field>
              <Field label="Model"><Input required value={f.deviceModel} onChange={set('deviceModel')} placeholder="Galaxy A54" /></Field>
              <Field label="IMEI or serial"><Input value={f.imei} onChange={set('imei')} className="code" /></Field>
              <Field label="Colour"><Input value={f.color} onChange={set('color')} /></Field>
            </div>
            <Field label="What is wrong, in the customer's words" className="mt-3">
              <Textarea required minLength={3} value={f.reportedFault} onChange={set('reportedFault')} placeholder="Screen cracked after a fall, touch not working at the bottom" />
            </Field>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Condition at intake">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-2">Accessories left with the device</legend>
              <div className="flex flex-wrap gap-2">
                {ACCESSORIES.map((a) => {
                  const on = acc.includes(a);
                  return (
                    <button key={a} type="button" aria-pressed={on} onClick={() => setAcc(on ? acc.filter((x) => x !== a) : [...acc, a])} className={cx('h-9 rounded-ctl border px-3 text-sm font-semibold', on ? 'border-solder bg-solder-tint text-solder-2' : 'border-line text-ink-2')}>
                      {a}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Does it power on?">
                <Select value={powersOn} onChange={(e) => setPowersOn(e.target.value as 'yes' | 'no' | '')}>
                  <option value="">Not checked</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="Screen lock PIN or pattern" hint="Stored encrypted; only the technician sees it">
                <Input value={f.passcode} onChange={set('passcode')} autoComplete="off" className="code" />
              </Field>
            </div>
            <Field label="Scratches, dents, missing parts" className="mt-3">
              <Textarea value={f.conditionNotes} onChange={set('conditionNotes')} />
            </Field>
          </Panel>

          <Panel title="Quote and timing">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Estimate (Rs)" hint="Leave empty to quote after diagnosis"><Input inputMode="decimal" value={f.estimate} onChange={set('estimate')} className="num" /></Field>
              <Field label="Promised for"><Input type="datetime-local" value={f.promisedAt} onChange={set('promisedAt')} /></Field>
              {can('repair.assign') && (
                <Field label="Technician">
                  <Select value={f.technicianId} onChange={set('technicianId')}>
                    <option value="">Assign later</option>
                    {techs.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
              )}
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <Field label="Advance (Rs)"><Input inputMode="decimal" value={f.advance} onChange={set('advance')} className="num" /></Field>
                <Field label="Paid by">
                  <Select value={f.advanceMethod} onChange={set('advanceMethod')}>
                    {['CASH', 'CARD', 'BANK_TRANSFER', 'LANKAQR'].map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m]}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </Panel>
          <Alert>{error}</Alert>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              Create job card{toCents(f.advance) ? ` and take ${lkr(toCents(f.advance))}` : ''}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
