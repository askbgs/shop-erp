'use client';

import { Check, Cpu, LucideIcon, Smartphone, Store, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { Alert, Button, cx, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { DISTRICTS, toLkPhone } from '@/lib/format';

const BUSINESS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'PHONE', label: 'Phones', icon: Smartphone },
  { value: 'COMPUTER', label: 'Computers', icon: Cpu },
  { value: 'MIXED', label: 'Phones and computers', icon: Store },
  { value: 'REPAIR', label: 'Repairs only', icon: Wrench },
];

const PLANS = [
  { code: 'REPAIR_ONLY', name: 'Repair only', price: 'Rs. 2,900', note: 'Job cards, tracking, customers' },
  { code: 'POS_REPAIRS', name: 'POS + Repairs', price: 'Rs. 5,900', note: 'Everything for a busy counter' },
  { code: 'FULL', name: 'Full ERP', price: 'Rs. 8,900', note: 'Larger teams and branches' },
];

const STEPS = ['Your shop', 'Your account', 'First branch'];

/** "Trincomalee Main" → "TRI" */
function suggestCode(name: string) {
  return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    shopName: '', businessType: 'MIXED', planCode: 'POS_REPAIRS', ownerName: '', email: '', phone: '', password: '',
    branchName: '', branchCode: '', district: 'Trincomalee',
  });
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      await api.auth('register', { ...f, phone: toLkPhone(f.phone), branchCode: f.branchCode.toUpperCase() });
      router.replace('/dashboard');
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      // Send the person back to the step that holds the problem field.
      if (/email|password|phone|ownerName/i.test(msg)) setStep(1);
      else if (/shopName|businessType|plan/i.test(msg)) setStep(0);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-[2rem] leading-tight font-bold tracking-tight">Start your free trial</h1>
      <p className="mt-2 text-ink-2">14 days, no card needed. You can add staff and branches later.</p>

      <ol className="mt-8 grid grid-cols-3 gap-2" aria-label="Sign-up steps">
        {STEPS.map((s, n) => (
          <li key={s} aria-current={n === step ? 'step' : undefined}>
            <div className={cx('h-1.5 rounded-full transition-colors', n <= step ? 'bg-solder' : 'bg-line')} />
            <div className={cx('mt-2 flex items-center gap-1.5 text-sm font-semibold', n === step ? 'text-ink' : 'text-ink-3')}>
              {n < step && <Check className="size-4 text-solder" />}
              {s}
            </div>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="mt-6 space-y-5">
        <Alert>{error}</Alert>

        {step === 0 && (
          <>
            <Field label="Shop name">
              <Input required value={f.shopName} onChange={set('shopName')} placeholder="Trinco Mobile Centre" autoFocus />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-2">What do you sell?</legend>
              <div className="grid grid-cols-2 gap-2">
                {BUSINESS.map((b) => {
                  const on = f.businessType === b.value;
                  const Icon = b.icon;
                  return (
                    <label key={b.value} className={cx('flex cursor-pointer items-center gap-2.5 rounded-ctl border px-3 py-3 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-solder', on ? 'border-solder bg-solder-tint text-solder-2' : 'border-line hover:border-ink-3/50')}>
                      <input type="radio" name="businessType" value={b.value} checked={on} onChange={set('businessType')} className="sr-only" />
                      <Icon className={cx('size-5 shrink-0', on ? 'text-solder' : 'text-ink-3')} />
                      {b.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-2">Plan after the trial (per branch, per month)</legend>
              <div className="space-y-2">
                {PLANS.map((p) => {
                  const on = f.planCode === p.code;
                  return (
                    <label key={p.code} className={cx('flex cursor-pointer items-center gap-3 rounded-ctl border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-solder', on ? 'border-solder bg-solder-tint' : 'border-line hover:border-ink-3/50')}>
                      <input type="radio" name="planCode" value={p.code} checked={on} onChange={set('planCode')} className="sr-only" />
                      <span className={cx('grid size-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-solder bg-solder' : 'border-line')}>
                        {on && <span className="size-2 rounded-full bg-white" />}
                      </span>
                      <span className="flex-1">
                        <span className="block font-semibold">{p.name}</span>
                        <span className="block text-sm text-ink-3">{p.note}</span>
                      </span>
                      <span className="num font-bold">{p.price}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Your name">
              <Input required minLength={2} value={f.ownerName} onChange={set('ownerName')} autoFocus autoComplete="name" />
            </Field>
            <Field label="Mobile number" hint="Shop messages and your sign-in alerts come here">
              <Input required inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="077 123 4567" autoComplete="tel" minLength={9} />
            </Field>
            <Field label="Email" hint="You sign in with this">
              <Input type="email" required value={f.email} onChange={set('email')} autoComplete="username" placeholder="you@yourshop.lk" />
            </Field>
            <Field label="Password" hint="At least 8 characters">
              <PasswordInput required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid grid-cols-[1fr_7.5rem] gap-3">
              <Field label="Branch name">
                <Input
                  required
                  value={f.branchName}
                  onChange={(e) => setF({ ...f, branchName: e.target.value, branchCode: codeTouched ? f.branchCode : suggestCode(e.target.value) })}
                  autoFocus
                />
              </Field>
              <Field label="Short code">
                <Input
                  required
                  minLength={2}
                  maxLength={5}
                  pattern="[A-Za-z]{2,5}"
                  value={f.branchCode}
                  onChange={(e) => { setCodeTouched(true); setF({ ...f, branchCode: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() }); }}
                  className="code uppercase"
                  placeholder="TRI"
                />
              </Field>
            </div>
            <p className="-mt-2 text-sm text-ink-3">
              Invoices will be numbered <span className="code text-ink">{(f.branchCode || 'TRI').toUpperCase()}-INV-000001</span>
            </p>
            <Field label="District">
              <Select value={f.district} onChange={set('district')}>
                {DISTRICTS.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </Field>
          </>
        )}

        <div className="flex gap-3 pt-1">
          {step > 0 && (
            <Button size="lg" onClick={() => { setError(''); setStep(step - 1); }} className="w-32">Back</Button>
          )}
          <Button type="submit" variant="primary" size="lg" className="flex-1" loading={busy}>
            {step < STEPS.length - 1 ? 'Continue' : 'Create my shop'}
          </Button>
        </div>
      </form>

      <p className="mt-8 text-center text-ink-2">
        Already using Shop ERP?{' '}
        <Link href="/login" className="font-semibold text-solder underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
