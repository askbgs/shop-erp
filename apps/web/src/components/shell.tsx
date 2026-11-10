'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Boxes, KeyRound, LayoutDashboard, LogOut, LucideIcon, Menu, Package, ReceiptText, ScanBarcode, Settings, Store, Users, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Button, cx, Field, Input, Modal, Select } from './ui';

const NAV: { href: string; label: string; perm: string; feature?: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Today', perm: 'report.read', feature: 'reports', icon: LayoutDashboard },
  { href: '/pos', label: 'Point of sale', perm: 'sales.create', feature: 'pos', icon: ScanBarcode },
  { href: '/repairs', label: 'Repairs', perm: 'repair.read', feature: 'repairs', icon: Wrench },
  { href: '/sales', label: 'Sales', perm: 'sales.read', feature: 'pos', icon: ReceiptText },
  { href: '/stock', label: 'Stock', perm: 'stock.read', feature: 'inventory', icon: Boxes },
  { href: '/products', label: 'Products', perm: 'catalog.read', feature: 'inventory', icon: Package },
  { href: '/customers', label: 'Customers', perm: 'customer.read', feature: 'customers', icon: Users },
  { href: '/settings', label: 'Settings', perm: 'user.read', icon: Settings },
];

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span aria-hidden className={cx('grid size-9 shrink-0 place-items-center rounded-[11px]', dark ? 'bg-mint text-night' : 'bg-solder text-white')}>
      <Store className="size-5" strokeWidth={2.2} />
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me, branchId, setBranchId, can, has } = useSession();
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => setMenu(false), [path]);

  // A temporary password must be replaced before anything else.
  const mustChange = me.mustChangePassword && path !== '/account/password';
  useEffect(() => {
    if (mustChange) router.replace('/account/password');
  }, [mustChange, router]);

  const items = NAV.filter((n) => can(n.perm) && (!n.feature || has(n.feature)));
  const trialDays = me.tenant.trialEndsAt ? Math.ceil((new Date(me.tenant.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;

  async function signOut() {
    await api.auth('logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-night text-white">
      <div className="flex items-center gap-3 py-5 pr-12 pl-5 lg:pr-5">
        <Logo dark />
        <div className="min-w-0">
          <div className="truncate font-bold leading-tight">{me.tenant.name}</div>
          <div className="text-xs text-night-3">Shop ERP</div>
        </div>
      </div>

      {me.branches.length > 1 ? (
        <label className="mx-4 mb-3 block">
          <span className="mb-1 block px-1 text-xs text-night-3">Branch</span>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-10 w-full rounded-ctl border border-white/10 bg-night-2 px-3 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-mint/60"
          >
            {me.branches.map((b) => (
              <option key={b.id} value={b.id} className="text-ink">{b.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="mx-4 mb-3 rounded-ctl bg-night-2 px-3 py-2 text-sm">
          <span className="text-night-3">Branch </span>
          <span className="font-semibold">{me.branches[0]?.name}</span>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Main">
        {items.map((n) => {
          const active = path === n.href || path.startsWith(n.href + '/');
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? 'page' : undefined}
              className={cx(
                'group relative flex h-11 items-center gap-3 rounded-ctl px-3 font-semibold transition-colors',
                active ? 'bg-night-2 text-white' : 'text-night-3 hover:bg-white/5 hover:text-white',
              )}
            >
              {active && <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-mint" />}
              <Icon className={cx('size-[19px]', active ? 'text-mint' : 'text-night-3 group-hover:text-white')} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="m-3 rounded-panel bg-night-2 p-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-mint/15 text-sm font-bold text-mint">{initials(me.name)}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{me.name}</div>
            <div className="text-xs text-night-3">{me.role.name}</div>
          </div>
        </div>
        <Link href="/account/password" className="mt-3 flex h-9 items-center gap-1.5 rounded-ctl px-2 text-sm font-semibold text-night-3 hover:bg-white/8 hover:text-white">
          <KeyRound className="size-4" /> Change password
        </Link>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setPinOpen(true)} className="flex h-9 items-center justify-center gap-1.5 rounded-ctl bg-white/8 text-sm font-semibold text-white hover:bg-white/15">
            <ArrowLeftRight className="size-4" /> Switch
          </button>
          <button type="button" onClick={signOut} className="flex h-9 items-center justify-center gap-1.5 rounded-ctl text-sm font-semibold text-night-3 hover:bg-white/8 hover:text-white">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="no-print hidden lg:sticky lg:top-0 lg:block lg:h-dvh">{sidebar}</aside>

      {/* Phone / tablet drawer */}
      <div className={cx('no-print fixed inset-0 z-40 lg:hidden', menu ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!menu}>
        <div className={cx('absolute inset-0 bg-night/50 transition-opacity', menu ? 'opacity-100' : 'opacity-0')} onClick={() => setMenu(false)} />
        <div className={cx('absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-lift transition-transform duration-300', menu ? 'translate-x-0' : '-translate-x-full')}>
          {sidebar}
          <button type="button" onClick={() => setMenu(false)} className="absolute top-5 right-3 grid size-9 place-items-center rounded-full text-night-3 hover:bg-white/10 hover:text-white" aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="min-w-0">
        <div className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setMenu(true)} className="grid size-10 place-items-center rounded-ctl border border-line" aria-label="Open menu" aria-expanded={menu}>
            <Menu className="size-5" />
          </button>
          <Logo />
          <span className="truncate font-bold">{me.tenant.name}</span>
        </div>
        {me.tenant.status === 'SUSPENDED' && (
          <div className="no-print bg-fault px-4 py-2.5 text-sm font-semibold text-white">Your subscription is paused. You can look at your records, but changes are blocked until payment is received.</div>
        )}
        {me.tenant.status === 'TRIAL' && trialDays !== null && trialDays <= 7 && (
          <div className="no-print bg-led-tint px-4 py-2.5 text-sm font-semibold text-[#7a5600]">
            {trialDays > 0 ? `Your free trial ends in ${trialDays} day${trialDays === 1 ? '' : 's'}.` : 'Your free trial has ended.'} Contact us to choose a plan.
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{mustChange ? null : children}</main>
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
        {users.data && users.data.length === 0 && <Alert tone="wait">No staff have a PIN yet. Set one in Settings, under Staff.</Alert>}
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
