'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { PasswordInput } from '@/components/password-input';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.auth('login', { email, password });
      router.replace(next.startsWith('/') ? next : '/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-[2rem] leading-tight font-bold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-ink-2">Sign in to open your shop.</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <Alert>{error}</Alert>
        <Field label="Email">
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@yourshop.lk" />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-center text-ink-2">
        New to Shop ERP?{' '}
        <Link href="/register" className="font-semibold text-solder underline-offset-4 hover:underline">
          Start a 14-day free trial
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
