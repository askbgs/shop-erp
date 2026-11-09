'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { DISTRICTS, toLkPhone } from '@/lib/format';

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF] = useState({
    shopName: '', businessType: 'MIXED', ownerName: '', email: '', phone: '', password: '', branchName: '', branchCode: '', district: 'Trincomalee', planCode: 'POS_REPAIRS',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.auth('register', { ...f, phone: toLkPhone(f.phone), branchCode: f.branchCode.toUpperCase() });
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-panel border border-line bg-surface p-6">
      <div>
        <h1 className="text-xl font-bold">Start your 14-day trial</h1>
        <p className="mt-1 text-sm text-ink-2">No card needed. You can add branches and staff later.</p>
      </div>
      <Alert>{error}</Alert>
      <Field label="Shop name">
        <Input required value={f.shopName} onChange={set('shopName')} placeholder="Trinco Mobile Centre" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="What you sell">
          <Select value={f.businessType} onChange={set('businessType')}>
            <option value="PHONE">Phones</option>
            <option value="COMPUTER">Computers</option>
            <option value="REPAIR">Repairs only</option>
            <option value="MIXED">Phones and computers</option>
          </Select>
        </Field>
        <Field label="Plan">
          <Select value={f.planCode} onChange={set('planCode')}>
            <option value="REPAIR_ONLY">Repair only</option>
            <option value="POS_REPAIRS">POS + Repairs</option>
            <option value="FULL">Full ERP</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Your name">
          <Input required value={f.ownerName} onChange={set('ownerName')} />
        </Field>
        <Field label="Mobile number">
          <Input required inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="077 123 4567" />
        </Field>
      </div>
      <Field label="Email">
        <Input type="email" required autoComplete="username" value={f.email} onChange={set('email')} />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field label="First branch">
          <Input required value={f.branchName} onChange={set('branchName')} placeholder="Main shop" />
        </Field>
        <Field label="Branch code" hint="On invoice numbers">
          <Input required maxLength={5} value={f.branchCode} onChange={set('branchCode')} placeholder="TRI" className="code uppercase" />
        </Field>
      </div>
      <Field label="District">
        <Select value={f.district} onChange={set('district')}>
          {DISTRICTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={busy}>
        Create my shop
      </Button>
      <p className="text-center text-sm text-ink-2">
        Already have an account? <Link href="/login" className="font-semibold text-solder underline">Sign in</Link>
      </p>
    </form>
  );
}
