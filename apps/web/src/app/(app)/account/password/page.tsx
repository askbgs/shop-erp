'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { Alert, Button, Field, PageHeader, Panel } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function ChangePasswordPage() {
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const forced = me.mustChangePassword;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.auth('change-password', { currentPassword: current, newPassword: next });
      await qc.invalidateQueries();
      setCurrent('');
      setNext('');
      setConfirm('');
      if (forced) router.replace('/dashboard');
      else setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={forced ? 'Choose your own password' : 'Change password'}
        sub={forced ? 'You signed in with a temporary password. Set one only you know to continue.' : 'Other devices signed in to your account will be signed out.'}
      />
      <Panel>
        <form onSubmit={submit} className="space-y-5">
          {done && <Alert tone="good">Password changed. You stay signed in here; other devices need to sign in again.</Alert>}
          <Alert>{error}</Alert>
          <Field label={forced ? 'Temporary password' : 'Current password'}>
            <PasswordInput required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </Field>
          <Field label="New password" hint="At least 8 characters. Avoid your name, phone number or shop name.">
            <PasswordInput required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Type the new password again">
            <PasswordInput required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-ink-3"><ShieldCheck className="size-4 text-solder" /> Stored securely; nobody at the shop can see it.</span>
            <Button type="submit" variant="primary" loading={busy}>{forced ? 'Save and continue' : 'Change password'}</Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
