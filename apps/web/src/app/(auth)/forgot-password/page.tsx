'use client';

import { ArrowLeft, MessageSquareText } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

function ForgotForm() {
  const router = useRouter();
  const [email, setEmail] = useState(useSearchParams().get('email') ?? '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setStep('code');
      setInfo('If this email has an account with a mobile number, we have sent a 6-digit code by SMS. It works for 15 minutes.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { email, code, newPassword: password });
      router.replace(`/login?reset=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="text-[2rem] leading-tight font-bold tracking-tight">Reset your password</h1>

      {step === 'email' ? (
        <>
          <p className="mt-2 text-ink-2">Enter the email you sign in with. We will text a code to the mobile number on your account.</p>
          <form onSubmit={sendCode} className="mt-8 space-y-5">
            <Alert>{error}</Alert>
            <Field label="Email">
              <Input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@yourshop.lk" />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              Send me a code
            </Button>
          </form>
          <p className="mt-8 text-sm text-ink-3">
            No mobile number on your account, or no SMS arriving? Ask your shop owner to set a temporary password for you in Settings, under Staff.
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 flex gap-3 rounded-ctl bg-solder-tint px-4 py-3 text-sm text-solder-2" role="status">
            <MessageSquareText className="mt-0.5 size-5 shrink-0" />
            <span>{info}</span>
          </div>
          <form onSubmit={reset} className="mt-6 space-y-5">
            <Alert>{error}</Alert>
            <Field label="6-digit code">
              <Input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="code text-center text-2xl tracking-[0.5em]"
                autoFocus
              />
            </Field>
            <Field label="New password" hint="At least 8 characters">
              <PasswordInput required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Type it again">
              <PasswordInput required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>
              Set new password
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-2">
            No code?{' '}
            <button type="button" onClick={() => sendCode()} className="font-semibold text-solder underline-offset-4 hover:underline" disabled={busy}>
              Send it again
            </button>{' '}
            or{' '}
            <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} className="font-semibold text-solder underline-offset-4 hover:underline">
              use another email
            </button>
          </p>
        </>
      )}
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
