'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Field, Input, Modal, Select } from './ui';

const NAV: { href: string; label: string; perm: string; feature?: string }[] = [
  { href: '/dashboard', label: 'Today', perm: 'report.read', feature: 'reports' },
  { href: '/pos', label: 'Point of sale', perm: 'sales.create', feature: 'pos' },
  { href: '/repairs', label: 'Repairs', perm: 'repair.read', feature: 'repairs' },
  { href: '/sales', label: 'Sales', perm: 'sales.read', feature: 'pos' },
  { href: '/stock', label: 'Stock', perm: 'stock.read', feature: 'inventory' },
  { href: '/products', label: 'Products', perm: 'catalog.read', feature: 'inventory' },
  { href: '/customers', label: 'Customers', perm: 'customer.read', feature: 'customers' },
  { href: '/settings', label: 'Settings', perm: 'user.read' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, branchId, setBranchId, can, has } = useSession();
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const items = NAV.filter((n) => can(n.perm) && (!n.feature || has(n.feature)));
  const trialDays = me.tenant.trialEndsAt ? Math.ceil((new Date(me.tenant.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;

  async function signOut() {
    await api.auth('logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className={cx('no-print border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r', menu ? 'block border-b' : 'hidden lg:flex')}>
        <div className="hidden items-center gap-2 px-4 py-4 lg:flex">
          <span aria-hidden className="grid size-8 place-items-center rounded-ctl bg-solder font-bold text-white">S</span>
          <div className="min-w-0">
            <div className="truncate font-bold leading-tight">{me.tenant.name}</div>
            <div className="text-xs text-ink-3">Shop ERP</div>
          </div>
        </div>
        <div className="px-3 pb-3">
          <label className="block">
            <span className="sr-only">Branch</span>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={me.branches.length < 2}>
              {me.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {items.map((n) => {
            const active = path === n.href || path.startsWith(n.href + '/');
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMenu(false)}
                className={cx('flex h-10 items-center rounded-ctl px-3 font-semibold', active ? 'bg-solder-tint text-solder-2' : 'text-ink-2 hover:bg-line-2')}
                aria-current={active ? 'page' : undefined}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line-2 p-3">
          <div className="px-1 text-sm font-semibold">{me.name}</div>
          <div className="px-1 text-xs text-ink-3">{me.role.name}</div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => setPinOpen(true)}>
              Switch user
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="no-print flex items-center justify-between border-b border-line bg-surface px-4 py-2 lg:hidden">
          <span className="font-bold">{me.tenant.name}</span>
          <Button size="sm" onClick={() => setMenu(!menu)} aria-expanded={menu}>
            {menu ? 'Close menu' : 'Menu'}
          </Button>
        </div>
        {me.tenant.status === 'SUSPENDED' && (
          <div className="no-print bg-fault px-4 py-2 text-sm font-semibold text-white">Your subscription is paused. You can look at your records, but changes are blocked until payment is received.</div>
        )}
        {me.tenant.status === 'TRIAL' && trialDays !== null && trialDays <= 7 && (
          <div className="no-print bg-led-tint px-4 py-2 text-sm font-semibold text-[#7a5600]">
            {trialDays > 0 ? `Your free trial ends in ${trialDays} day${trialDays === 1 ? '' : 's'}.` : 'Your free trial has ended.'} Contact us to choose a plan.
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>
      </div>

      <PinSwitch open={pinOpen} onClose={() => setPinOpen(false)} />
    </div>
  );
}

function PinSwitch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['pin-users'], queryFn: () => api.get<{ id: string; name: string }[]>('/users/pin-users'), enabled: open });
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setError('');
    try {
      await api.auth('pin-switch', { userId, pin });
      setPin('');
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Switch user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={go} loading={busy} disabled={!userId || pin.length < 4}>Switch</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-2">Hand the counter to another staff member without signing out.</p>
        <Alert>{error}</Alert>
        {users.data && users.data.length === 0 && <Alert tone="wait">No staff have a PIN yet. Set one in Settings → Staff.</Alert>}
        <Field label="Staff member">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="PIN">
          <Input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </Field>
      </div>
    </Modal>
  );
}
