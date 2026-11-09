'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Alert, Button, cx, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { date, dateTime, lkr, toLkPhone } from '@/lib/format';

interface Track {
  number: string;
  shop?: string;
  device: string;
  status: string;
  statusLabel: string;
  promisedAt: string | null;
  estimateCents?: number | null;
  balanceCents?: number;
  warrantyEndsAt: string | null;
  timeline: { status: string; label: string; at: string }[];
}

function TrackForm() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await api.get<Track>(`/public/repairs/track?code=${encodeURIComponent(code.trim())}&phone=${encodeURIComponent(toLkPhone(phone))}`));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-bold">Check your repair</h1>
      <p className="mt-1 text-ink-2">Enter the tracking code from your job card or SMS, and the mobile number you gave the shop.</p>
      <form onSubmit={go} className="mt-6 space-y-3 rounded-panel border border-line bg-surface p-5">
        <Field label="Tracking code"><Input required value={code} onChange={(e) => setCode(e.target.value)} className="code uppercase tracking-wider" placeholder="K7RM2QXP4A" autoComplete="off" /></Field>
        <Field label="Mobile number"><Input required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="077 123 4567" /></Field>
        <Alert>{error}</Alert>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Check status</Button>
      </form>

      {result && (
        <section className="mt-6 rounded-panel border border-line bg-surface p-5" aria-live="polite">
          <div className="text-sm text-ink-3">{result.shop} <span className="code">{result.number}</span></div>
          <h2 className="text-xl font-bold">{result.device}</h2>
          <p className={cx('mt-2 inline-block rounded px-2 py-1 font-bold', result.status === 'READY' ? 'bg-solder-tint text-solder-2' : 'bg-line-2')}>{result.statusLabel}</p>
          {result.estimateCents ? <p className="mt-3">The estimate is <b className="num">{lkr(result.estimateCents)}</b>. Call the shop to approve it.</p> : null}
          {result.balanceCents !== undefined && <p className="mt-3">Amount to pay at pickup: <b className="num">{lkr(result.balanceCents)}</b></p>}
          {result.promisedAt && result.status !== 'DELIVERED' && <p className="mt-2 text-ink-2">Expected by {dateTime(result.promisedAt)}</p>}
          {result.warrantyEndsAt && <p className="mt-2 text-solder">Repair warranty until {date(result.warrantyEndsAt)}</p>}
          <ol className="mt-4 space-y-2 border-t border-line-2 pt-4">
            {result.timeline.map((t) => (
              <li key={t.status} className="flex justify-between text-sm"><span>{t.label}</span><span className="text-ink-3">{dateTime(t.at)}</span></li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}

export default function TrackPage() {
  return (
    <Suspense>
      <TrackForm />
    </Suspense>
  );
}
